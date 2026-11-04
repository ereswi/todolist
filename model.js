import { localDate, validDate, validTime } from './calendar.js';

export const SORTS = ['due', 'newest', 'oldest', 'title'];
export const MODES = ['none', '10m', '1h', '1d', 'custom'];
export const emptyState = () => ({ schemaVersion: 1, tasks: [], folders: [], preferences: { sortOrder: 'due' }, inbox: [] });
export const inFolder = (task, folder) => folder === 'all' || task.folderId === (folder === 'none' ? null : folder);
export function sortTasks(tasks, order) {
  const collator = new Intl.Collator('ja');
  const due = t => t.dueDate ? `${t.dueDate}T${t.dueTime || '24:00'}` : '9999-99-99';
  return [...tasks].sort((a, b) => {
    let result = 0;
    if (order === 'due') result = due(a).localeCompare(due(b));
    if (order === 'newest') result = b.createdAt.localeCompare(a.createdAt);
    if (order === 'oldest') result = a.createdAt.localeCompare(b.createdAt);
    if (order === 'title') result = collator.compare(a.title, b.title);
    return result || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
export function buildTask(input, previous = null, now = new Date()) {
  const title = input.title.trim();
  if (!title) throw new Error('タスクの内容を入力してください。');
  if (title.length > 300) throw new Error('内容は300文字以内で入力してください。');
  const dueDate = input.dueDate || null;
  const dueTime = input.dueTime || null;
  const mode = input.reminderMode || 'none';
  if (dueDate && !validDate(dueDate)) throw new Error('有効な期限日を入力してください。');
  if (dueTime && (!dueDate || !validTime(dueTime))) throw new Error('期限時刻には期限日も必要です。');
  if (!MODES.includes(mode)) throw new Error('通知方式を選択してください。');
  let remindAt = null;
  if (mode !== 'none') {
    if (!dueDate || !dueTime) throw new Error('リマインドには期限日と時刻が必要です。');
    const due = localDate(dueDate, dueTime);
    let reminder;
    if (mode === 'custom') {
      const [date, time] = (input.customReminder || '').split('T');
      if (!validDate(date) || !validTime(time)) throw new Error('通知日時を入力してください。');
      reminder = localDate(date, time);
    } else if (mode === '1d') {
      reminder = new Date(due);
      reminder.setDate(reminder.getDate() - 1);
    } else {
      reminder = new Date(due.getTime() - (mode === '10m' ? 10 : 60) * 60000);
    }
    remindAt = reminder.toISOString();
    const timingChanged = !previous || previous.remindAt !== remindAt || previous.dueDate !== dueDate || previous.dueTime !== dueTime || previous.reminderMode !== mode;
    if (reminder >= due) throw new Error('通知日時は期限より前に設定してください。');
    if (timingChanged && reminder <= now) throw new Error('通知日時は現在より後に設定してください。');
  }
  return {
    id: previous?.id || crypto.randomUUID(), title, completed: previous?.completed || false,
    folderId: input.folderId || null, dueDate, dueTime, reminderMode: mode, remindAt,
    reminderHandledAt: previous?.remindAt === remindAt ? previous.reminderHandledAt : null,
    createdAt: previous?.createdAt || now.toISOString(), updatedAt: now.toISOString(),
  };
}
export function removeFolder(state, id) {
  state.folders = state.folders.filter(folder => folder.id !== id);
  state.tasks.forEach(task => { if (task.folderId === id) task.folderId = null; });
}
export const dueReminders = (tasks, now = new Date()) => tasks.filter(task => !task.completed && task.remindAt && !task.reminderHandledAt && new Date(task.remindAt) <= now);

export function validateState(value) {
  const fail = () => { throw new Error('保存データの形式が正しくありません。元のデータを保護するため、書き込みを停止しました。'); };
  const instant = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x));
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.folders) || !SORTS.includes(value.preferences?.sortOrder) || !Array.isArray(value.inbox)) fail();
  const ids = new Set();
  for (const folder of value.folders) {
    if (!folder || typeof folder.id !== 'string' || !folder.id || ids.has(folder.id) || typeof folder.name !== 'string' || !folder.name.trim() || !instant(folder.createdAt)) fail();
    ids.add(folder.id);
  }
  const taskIds = new Set();
  for (const task of value.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || taskIds.has(task.id) || typeof task.title !== 'string' || !task.title.trim() || typeof task.completed !== 'boolean' || !instant(task.createdAt) || !instant(task.updatedAt) || !MODES.includes(task.reminderMode)) fail();
    if (task.dueDate !== null && !validDate(task.dueDate)) fail();
    if (task.dueTime !== null && (!task.dueDate || !validTime(task.dueTime))) fail();
    if (task.folderId !== null && typeof task.folderId !== 'string') fail();
    if (task.reminderMode === 'none' ? task.remindAt !== null : (!task.dueTime || !instant(task.remindAt) || new Date(task.remindAt) >= localDate(task.dueDate, task.dueTime))) fail();
    if (task.reminderHandledAt !== null && !instant(task.reminderHandledAt)) fail();
    if (!ids.has(task.folderId)) task.folderId = null;
    taskIds.add(task.id);
  }
  for (const item of value.inbox) {
    if (!item || typeof item.id !== 'string' || typeof item.taskId !== 'string' || typeof item.title !== 'string' || !instant(item.at)) fail();
  }
  return value;
}
