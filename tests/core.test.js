import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, localDate, addDays, shiftMonth, monthDays, validDate, isOverdue } from '../calendar.js';
import { buildTask, sortTasks, removeFolder, emptyState, validateState, dueReminders } from '../model.js';
import { createStore, STORAGE_KEY } from '../storage.js';

const now = localDate('2026-11-04', '12:00');
const task = (input = {}, previous = null, clock = now) => buildTask({ title: 'テスト', dueDate: '', dueTime: '', reminderMode: 'none', ...input }, previous, clock);
test('local date parsing, leap days and year/month boundaries', () => {
  assert.equal(dateKey(localDate('2026-01-01')), '2026-01-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftMonth('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-01');
  assert.equal(monthDays('2026-02-01').length, 42);
  assert.ok(monthDays('2026-12-01').includes('2027-01-01'));
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
});
test('date-only deadline becomes overdue on the next local day', () => {
  assert.equal(isOverdue(task({ dueDate: '2026-11-04' }), now), false);
  assert.equal(isOverdue(task({ dueDate: '2026-11-03' }), now), true);
  assert.equal(isOverdue(task({ dueDate: '2026-11-04', dueTime: '11:59' }), now), true);
  assert.equal(isOverdue(task(), now), false);
  assert.equal(isOverdue({ ...task({ dueDate: '2026-11-03' }), completed: true }, now), false);
});
test('sorting puts timed before date-only before undated and keeps ties stable', () => {
  const tasks = [task({ title: 'なし' }), task({ title: '日付', dueDate: '2026-11-05' }), task({ title: '時間', dueDate: '2026-11-05', dueTime: '23:59' })];
  assert.deepEqual(sortTasks(tasks, 'due').map(t => t.title), ['時間', '日付', 'なし']);
  const older = task({ title: 'あ' }, null, localDate('2026-11-01'));
  const newer = task({ title: 'ん' });
  assert.equal(sortTasks([older, newer], 'newest')[0].id, newer.id);
  assert.equal(sortTasks([newer, older], 'oldest')[0].id, older.id);
  assert.equal(sortTasks([newer, older], 'title')[0].id, older.id);
});
test('task validation rejects whitespace, time-only and invalid dates', () => {
  assert.throws(() => task({ title: '　 ' }));
  assert.throws(() => task({ dueTime: '13:00' }));
  assert.throws(() => task({ dueDate: '2026-02-30' }));
  assert.equal(task({ title: '  お茶  ' }).title, 'お茶');
});
test('all reminder modes validate future times before deadline', () => {
  for (const [mode, expected] of [['10m', '2026-11-06T11:50'], ['1h', '2026-11-06T11:00'], ['1d', '2026-11-05T12:00'], ['custom', '2026-11-05T16:00']]) {
    const value = task({ dueDate: '2026-11-06', dueTime: '12:00', reminderMode: mode, customReminder: '2026-11-05T16:00' });
    const [date, time] = expected.split('T');
    assert.equal(value.remindAt, localDate(date, time).toISOString());
  }
  assert.throws(() => task({ reminderMode: '10m' }));
  assert.throws(() => task({ dueDate: '2026-11-04', dueTime: '12:05', reminderMode: '10m' }));
  assert.throws(() => task({ dueDate: '2026-11-05', dueTime: '12:00', reminderMode: 'custom', customReminder: '2026-11-05T12:00' }));
});
test('editing content preserves an expired handled reminder; timing changes revalidate', () => {
  const original = task({ dueDate: '2026-11-05', dueTime: '12:00', reminderMode: '10m' });
  original.reminderHandledAt = localDate('2026-11-05', '11:50').toISOString();
  const later = localDate('2026-11-06');
  const edited = task({ ...original, title: '変更', folderId: 'work' }, original, later);
  assert.equal(edited.reminderHandledAt, original.reminderHandledAt);
  assert.throws(() => task({ ...original, dueTime: '12:10' }, original, later));
  const moved = task({ ...original, dueDate: '2026-11-07' }, original, later);
  assert.equal(moved.reminderHandledAt, null);
  const custom = task({ dueDate: '2026-11-05', dueTime: '12:00', reminderMode: 'custom', customReminder: '2026-11-05T10:00' });
  assert.throws(() => task({ ...custom, dueTime: '09:00', customReminder: '2026-11-05T10:00' }, custom));
});
test('folder removal retains task identity, status, deadline and reminders', () => {
  const state = emptyState();
  const original = task({ folderId: 'work', dueDate: '2026-11-05', dueTime: '12:00', reminderMode: '1h' });
  state.folders = [{ id: 'work', name: '仕事', createdAt: now.toISOString() }]; state.tasks = [original];
  removeFolder(state, 'work');
  assert.deepEqual(state.tasks[0], { ...original, folderId: null });
  assert.equal(state.folders.length, 0);
});
test('only unhandled, unfinished reminders that are due are selected', () => {
  const original = task({ dueDate: '2026-11-05', dueTime: '12:00', reminderMode: '10m' });
  const tasks = [original, { ...original, id: 'done', completed: true }, { ...original, id: 'handled', reminderHandledAt: now.toISOString() }, task()];
  assert.equal(dueReminders(tasks, now).length, 0);
  assert.deepEqual(dueReminders(tasks, localDate('2026-11-05', '11:50')).map(t => t.id), [original.id]);
});
test('schema validation rejects corrupt records and recovers orphan folders', () => {
  const state = emptyState(); state.tasks = [task({ folderId: 'missing' })];
  assert.equal(validateState(state).tasks[0].folderId, null);
  assert.throws(() => validateState({ schemaVersion: 2 }));
  assert.throws(() => validateState({ ...emptyState(), tasks: [null] }));
  assert.throws(() => validateState({ ...emptyState(), tasks: [{ ...task(), dueDate: '2026-99-99' }] }));
  assert.throws(() => validateState({ ...emptyState(), inbox: [{ title: 'bad' }] }));
});
test('corrupt storage is never overwritten; failed saves preserve committed state', async () => {
  let raw = '{broken'; let writes = 0; const errors = [];
  const storage = { getItem: () => raw, setItem: (_, value) => { writes++; raw = value; } };
  const store = createStore(storage, null, () => {}, error => errors.push(error));
  assert.equal(store.refresh(), false);
  assert.equal((await store.update(state => state.tasks.push(task()))).ok, false);
  assert.equal(writes, 0); assert.equal(raw, '{broken');
  raw = JSON.stringify(emptyState()); store.refresh();
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal((await store.update(state => state.tasks.push(task()))).ok, false);
  assert.equal(store.state.tasks.length, 0); assert.equal(JSON.parse(raw).tasks.length, 0);
  assert.equal(errors.length, 3);
});
test('serialized updates read latest shared state, preventing cross-tab lost writes', async () => {
  let raw = JSON.stringify(emptyState()); let chain = Promise.resolve();
  const storage = { getItem: key => { assert.equal(key, STORAGE_KEY); return raw; }, setItem: (_, value) => { raw = value; } };
  const locks = { request: (_, work) => { chain = chain.then(work); return chain; } };
  const a = createStore(storage, locks, () => {}, assert.fail);
  const b = createStore(storage, locks, () => {}, assert.fail);
  await Promise.all([a.update(state => state.tasks.push(task({ title: 'A' }))), b.update(state => state.tasks.push(task({ title: 'B' })))]);
  assert.deepEqual(JSON.parse(raw).tasks.map(t => t.title), ['A', 'B']);
});
