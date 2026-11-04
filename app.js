import { dateKey, localDate, addDays, shiftMonth, monthDays, formatDay, isOverdue, pad, validDate } from './calendar.js';
import { buildTask, inFolder, sortTasks, removeFolder } from './model.js';
import { createStore, STORAGE_KEY } from './storage.js';
import { createReminders, notificationStatus, showOSNotification } from './reminders.js';

const $ = id => document.getElementById(id);
const ui = { view: 'day', date: dateKey(), month: dateKey().slice(0, 7) + '-01', folder: 'all', filter: 'all', undated: false };
let editingId = null;
let undo = null;
let undoTimer;
let composing = false;
let compositionEnded = 0;
let storageFailed = false;

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (text, className, action) => {
  const element = node('button', className, text);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
};
function storageError(error) {
  if (error.userInput) return;
  storageFailed = true;
  $('storage-error').hidden = false;
  $('storage-error-detail').textContent = `変更は保存されていません。${error.message || 'ブラウザーの保存機能を利用できません。'} 元の保存データは変更していません。`;
  $('save-status').textContent = '保存できていません';
}
// Access can itself throw in restricted browser contexts; defer it inside the store's try/catch.
const storage = { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) };
const store = createStore(storage, navigator.locks, () => {
  storageFailed = false;
  $('storage-error').hidden = true;
  $('save-status').textContent = '✓ ブラウザーに保存済み';
  render();
}, storageError);
const reminders = createReminders(store);
const folderName = id => store.state.folders.find(folder => folder.id === id)?.name || '未分類';
const folderTasks = () => store.state.tasks.filter(task => inFolder(task, ui.folder));
const filterTasks = tasks => tasks.filter(task => ui.filter === 'all' || task.completed === (ui.filter === 'completed'));

function renderFolders() {
  const items = [{ id: 'all', name: 'すべてのタスク', icon: '▦' }, { id: 'none', name: '未分類', icon: '▱' }, ...store.state.folders.map(f => ({ ...f, icon: '▱' }))];
  if (!items.some(item => item.id === ui.folder)) ui.folder = 'all';
  $('folder-list').replaceChildren();
  $('mobile-folder').replaceChildren();
  for (const item of items) {
    const count = store.state.tasks.filter(task => inFolder(task, item.id) && !task.completed).length;
    const element = button('', `folder-button${ui.folder === item.id ? ' active' : ''}`, () => { ui.folder = item.id; render(); });
    element.setAttribute('aria-pressed', String(ui.folder === item.id));
    element.append(node('span', 'folder-icon', item.icon), node('span', 'folder-name', item.name), node('span', 'folder-count', count));
    $('folder-list').append(element);
    const option = node('option', '', `${item.name} (${count})`); option.value = item.id; $('mobile-folder').append(option);
  }
  $('mobile-folder').value = ui.folder;
}
function taskRow(task) {
  const row = node('article', `task-row${task.completed ? ' completed' : ''}`);
  row.dataset.taskId = task.id;
  const check = node('input', 'task-check');
  check.type = 'checkbox'; check.checked = task.completed;
  check.setAttribute('aria-label', `${task.title}を${task.completed ? '未完了' : '完了'}にする`);
  check.addEventListener('change', async () => {
    const completed = check.checked;
    const result = await store.update(state => {
      const current = state.tasks.find(t => t.id === task.id);
      if (current) { current.completed = completed; current.updatedAt = new Date().toISOString(); }
    });
    if (!result.ok) render();
    if (result.ok && !completed) await reminders.check(true);
  });
  const content = node('div', 'task-content');
  content.append(node('div', 'task-title', task.title));
  const meta = node('div', 'task-meta');
  meta.append(node('span', 'folder-tag', folderName(task.folderId)));
  const overdue = isOverdue(task);
  meta.append(node('span', `deadline${overdue ? ' overdue' : ''}`, `${task.dueDate ? `${task.dueDate.replaceAll('-', '/')} ${task.dueTime || '時刻なし'}` : '日付なし'}${overdue ? ' · 期限超過' : ''}`));
  if (task.remindAt) {
    const reminder = node('span', '', task.reminderHandledAt ? '通知済み' : '♧ リマインド');
    reminder.title = new Date(task.remindAt).toLocaleString('ja-JP'); meta.append(reminder);
  }
  content.append(meta);
  const actions = node('div', 'task-actions');
  const edit = button('編集', '', () => openTask(task.id)); edit.setAttribute('aria-label', `${task.title}を編集`);
  const remove = button('削除', '', () => deleteTask(task.id)); remove.setAttribute('aria-label', `${task.title}を削除`);
  actions.append(edit, remove); row.append(check, content, actions);
  return row;
}
function render() {
  renderFolders();
  const today = dateKey();
  const isToday = ui.date === today;
  const calendar = ui.view === 'calendar';
  const day = ui.view === 'day';
  $('today-label').textContent = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  for (const tab of document.querySelectorAll('[data-view]')) {
    if (tab.dataset.view === ui.view) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  $('page-eyebrow').textContent = calendar ? 'A LITTLE LOOK AHEAD' : day ? 'YOUR DAILY FOCUS' : 'MAKE ROOM FOR WHAT MATTERS';
  $('page-title').textContent = calendar ? localDate(ui.month).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' }) : day ? isToday ? '今日のToDo' : formatDay(ui.date) : ui.undated ? '日付なしのタスク' : 'タスク管理';
  $('page-subtitle').textContent = calendar ? 'これからの予定を、見渡そう。' : day ? `${formatDay(ui.date)} — ${isToday ? '今日も、自分のペースで。' : 'この日に進めたいこと。'}` : 'やることを整理して、次の一歩を軽く。';
  $('daily-summary').hidden = !day;
  $('date-navigation').hidden = ui.view === 'tasks';
  $('date-picker-label').hidden = calendar;
  $('selected-date').value = ui.date;
  $('previous-date').setAttribute('aria-label', calendar ? '前月' : '前日');
  $('next-date').setAttribute('aria-label', calendar ? '翌月' : '翌日');
  $('go-today').textContent = calendar ? '今月' : '今日';
  $('list-controls').hidden = calendar;
  $('sort-order').value = store.state.preferences.sortOrder;
  $('status-filter').value = ui.filter;
  $('tasks-section').hidden = calendar;
  $('calendar-section').hidden = !calendar;
  const tasks = folderTasks();
  const onDay = tasks.filter(task => task.dueDate === ui.date);
  const done = onDay.filter(task => task.completed).length;
  const remaining = onDay.length - done;
  $('summary-title').textContent = onDay.length ? remaining ? `あと ${remaining} 件。ひとつずつ、進めよう。` : 'すべて完了。おつかれさまでした！' : '予定のない一日も、大切に。';
  $('summary-description').textContent = onDay.length ? `${onDay.length} 件のタスクのうち、${done} 件が完了しています` : '今日やりたいことを、ひとつ追加してみませんか。';
  $('progress-label').textContent = `${done} / ${onDay.length} 完了`;
  $('progress-fill').style.width = `${onDay.length ? done / onDay.length * 100 : 0}%`;
  const overdue = day && isToday && ui.filter !== 'completed' ? tasks.filter(task => !task.completed && task.dueDate && task.dueDate < today) : [];
  $('overdue-section').hidden = !overdue.length;
  $('overdue-count').textContent = overdue.length;
  $('overdue-list').replaceChildren(...sortTasks(overdue, store.state.preferences.sortOrder).map(taskRow));
  const base = day ? onDay : ui.undated ? tasks.filter(task => !task.dueDate) : tasks;
  const visible = sortTasks(filterTasks(base), store.state.preferences.sortOrder);
  $('list-heading').textContent = day ? isToday ? '今日のタスク' : 'この日のタスク' : ui.undated ? '日付なし' : ui.folder === 'all' ? 'すべてのタスク' : ui.folder === 'none' ? '未分類' : folderName(ui.folder);
  $('list-count').textContent = `${visible.length} 件 · 未完了 ${base.filter(t => !t.completed).length} 件`;
  $('task-list').replaceChildren(...visible.map(taskRow));
  $('empty-state').hidden = !!visible.length;
  $('empty-title').textContent = base.length ? '条件に合うタスクはありません' : 'まだタスクはありません';
  $('empty-description').textContent = base.length ? '完了状態やフォルダを切り替えてみてください。' : day ? 'やることを書き出して、一日をすっきり始めましょう。' : '思いついたことから、気軽に追加しましょう。';
  $('empty-add').hidden = !!base.length;
  const undated = tasks.filter(task => !task.dueDate && !task.completed).length;
  $('undated-link').hidden = !day;
  $('undated-link').textContent = `日付なしのタスク ${undated} 件をタスク管理で見る →`;
  if (calendar) renderCalendar(tasks);
  const inbox = store.state.inbox;
  $('reminder-inbox').hidden = !inbox.length;
  $('reminder-items').replaceChildren(...inbox.map(item => node('li', '', `${item.title} — ${new Date(item.at).toLocaleString('ja-JP')}`)));
}
function renderCalendar(tasks) {
  $('calendar-grid').replaceChildren(...monthDays(ui.month).map(date => {
    const count = tasks.filter(task => task.dueDate === date && !task.completed).length;
    const element = button('', `calendar-day${date.slice(0, 7) !== ui.month.slice(0, 7) ? ' outside' : ''}${date === dateKey() ? ' today' : ''}${date === ui.date ? ' selected' : ''}`, () => {
      ui.date = date; ui.month = date.slice(0, 7) + '-01'; ui.view = 'day'; ui.undated = false; render(); $('page-title').scrollIntoView({ block: 'nearest' });
    });
    element.setAttribute('aria-label', `${date}、未完了${count}件`);
    element.append(node('span', 'day-number', Number(date.slice(-2))));
    if (count) element.append(node('span', 'calendar-count', `${count} 件`));
    return element;
  }));
}
function setFolderOptions(select, selected) {
  select.replaceChildren();
  for (const folder of [{ id: '', name: '未分類' }, ...store.state.folders]) {
    const option = node('option', '', folder.name); option.value = folder.id; select.append(option);
  }
  select.value = selected || '';
}
function openTask(id = null) {
  editingId = id;
  const task = id ? store.state.tasks.find(task => task.id === id) : null;
  if (id && !task) return;
  $('task-form').reset();
  $('task-form-error').textContent = '';
  $('task-dialog-title').textContent = task ? 'タスクを編集' : 'タスクを追加';
  $('save-task').textContent = task ? '変更を保存' : '追加する';
  $('task-title').value = task?.title || '';
  setFolderOptions($('task-folder'), task ? task.folderId : ['all', 'none'].includes(ui.folder) ? '' : ui.folder);
  $('task-date').value = task ? task.dueDate || '' : ui.view === 'tasks' ? '' : ui.date;
  $('task-time').value = task?.dueTime || '';
  $('task-reminder').value = task?.reminderMode || 'none';
  if (task?.remindAt) {
    const date = new Date(task.remindAt);
    $('task-custom-reminder').value = `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  $('custom-reminder-label').hidden = $('task-reminder').value !== 'custom';
  $('task-dialog').showModal(); $('task-title').focus();
}
$('task-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (composing) return;
  const input = Object.fromEntries(new FormData(event.currentTarget));
  $('save-task').disabled = true;
  let formError;
  const result = await store.update(state => {
    const previous = editingId ? state.tasks.find(task => task.id === editingId) : null;
    try {
      if (editingId && !previous) throw new Error('このタスクは別のタブで削除されました。入力内容を控えて、新しく追加してください。');
      if (input.folderId && !state.folders.some(f => f.id === input.folderId)) input.folderId = '';
      const task = buildTask(input, previous);
      if (previous) state.tasks[state.tasks.indexOf(previous)] = task; else state.tasks.push(task);
    } catch (error) { formError = error.message; error.userInput = true; throw error; }
  });
  $('save-task').disabled = false;
  if (result.ok) { $('task-dialog').close(); await reminders.check(true); }
  else {
    $('task-form-error').textContent = formError || '保存できませんでした。入力内容を残しています。ブラウザーの保存設定を確認してください。';
  }
});
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; compositionEnded = performance.now(); });
document.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229 || performance.now() - compositionEnded < 100)) event.preventDefault(); });
$('task-reminder').addEventListener('change', () => { $('custom-reminder-label').hidden = $('task-reminder').value !== 'custom'; });
async function deleteTask(id) {
  const result = await store.update(state => {
    const task = state.tasks.find(task => task.id === id);
    state.tasks = state.tasks.filter(task => task.id !== id);
    return task;
  });
  if (!result.ok || !result.result) return;
  undo = { task: result.result, expires: Date.now() + 5000 };
  clearTimeout(undoTimer);
  $('toast-message').textContent = 'タスクを削除しました'; $('toast').hidden = false;
  undoTimer = setTimeout(() => { undo = null; $('toast').hidden = true; }, 5000);
}
$('undo-delete').addEventListener('click', async () => {
  if (!undo || Date.now() > undo.expires) return;
  const task = structuredClone(undo.task);
  const result = await store.update(state => {
    if (task.folderId && !state.folders.some(folder => folder.id === task.folderId)) task.folderId = null;
    if (!state.tasks.some(current => current.id === task.id)) state.tasks.push(task);
  });
  if (result.ok) { clearTimeout(undoTimer); undo = null; $('toast').hidden = true; await reminders.check(true); }
});
function checkFolderName(state, value, id = null) {
  const name = value.trim();
  if (!name || name.length > 60) throw new Error('フォルダ名は1〜60文字で入力してください。');
  if (['すべて', 'すべてのタスク', '未分類'].includes(name) || state.folders.some(folder => folder.id !== id && folder.name === name)) throw new Error('そのフォルダ名は使用済みです。別の名前を入力してください。');
  return name;
}
async function folderUpdate(callback) {
  let message;
  const result = await store.update(state => { try { callback(state); } catch (error) { message = error.message; error.userInput = true; throw error; } });
  $('folder-form-error').textContent = result.ok ? '' : message || '保存できませんでした。';
  if (result.ok) renderFolderEditor();
  return result.ok;
}
function renderFolderEditor() {
  $('folder-editor').replaceChildren(...store.state.folders.map(folder => {
    const row = node('div', 'folder-edit-row');
    const input = node('input'); input.value = folder.name; input.maxLength = 60; input.setAttribute('aria-label', `${folder.name}の新しい名前`);
    row.append(input, button('名前変更', '', () => folderUpdate(state => {
      const current = state.folders.find(f => f.id === folder.id);
      if (current) current.name = checkFolderName(state, input.value, folder.id);
    })), button('削除', '', () => folderUpdate(state => removeFolder(state, folder.id))));
    return row;
  }));
}
$('folder-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (composing) return;
  const input = $('folder-name');
  const name = input.value;
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  if (await folderUpdate(state => state.folders.push({ id: crypto.randomUUID(), name: checkFolderName(state, name), createdAt: new Date().toISOString() }))) {
    if (input.value === name) input.value = '';
  }
  submit.disabled = false;
});
$('manage-folders').addEventListener('click', () => { $('folder-form-error').textContent = ''; renderFolderEditor(); $('folder-dialog').showModal(); });
for (const element of document.querySelectorAll('[data-close]')) element.addEventListener('click', () => $(element.dataset.close).close());
for (const element of document.querySelectorAll('[data-view]')) element.addEventListener('click', () => { ui.view = element.dataset.view; ui.undated = false; if (ui.view === 'calendar') ui.month = ui.date.slice(0, 7) + '-01'; render(); });
$('mobile-folder').addEventListener('change', event => { ui.folder = event.target.value; render(); });
$('status-filter').addEventListener('change', event => { ui.filter = event.target.value; render(); });
$('sort-order').addEventListener('change', async event => { const value = event.target.value; await store.update(state => { state.preferences.sortOrder = value; }); render(); });
function moveDate(amount) {
  if (ui.view === 'calendar') ui.month = shiftMonth(ui.month, amount);
  else { ui.date = addDays(ui.date, amount); ui.month = ui.date.slice(0, 7) + '-01'; }
  render();
}
$('previous-date').addEventListener('click', () => moveDate(-1));
$('next-date').addEventListener('click', () => moveDate(1));
$('go-today').addEventListener('click', () => { ui.date = dateKey(); ui.month = ui.date.slice(0, 7) + '-01'; render(); });
$('selected-date').addEventListener('change', event => { if (validDate(event.target.value)) { ui.date = event.target.value; ui.month = ui.date.slice(0, 7) + '-01'; render(); } });
$('undated-link').addEventListener('click', () => { ui.view = 'tasks'; ui.undated = true; render(); });
$('add-task').addEventListener('click', () => openTask());
$('empty-add').addEventListener('click', () => openTask());
$('retry-storage').addEventListener('click', () => store.refresh());
$('dismiss-reminders').addEventListener('click', () => store.update(state => { state.inbox = []; }));
$('notification-settings').addEventListener('click', () => { $('notification-status').textContent = notificationStatus(); $('notification-feedback').textContent = ''; $('notification-dialog').showModal(); });
$('enable-notifications').addEventListener('click', async () => {
  try { if ('Notification' in globalThis) await Notification.requestPermission(); }
  catch { $('notification-feedback').textContent = 'OS通知を有効にできません。画面内でお知らせします。'; }
  $('notification-status').textContent = notificationStatus();
  if ('Notification' in globalThis && Notification.permission === 'denied') $('notification-feedback').textContent = '許可を変更する場合は、ブラウザーのサイト設定で通知を許可してください。';
});
$('test-notification').addEventListener('click', () => {
  const shown = showOSNotification('ToDoリストのテスト通知', 'リマインドをこのようにお知らせします。', 'todolist-test');
  $('notification-feedback').textContent = shown ? 'OS通知を要求しました。表示されない場合はOSの通知設定も確認してください。' : 'テスト通知：画面内でお知らせしています。OS通知は利用できません。';
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) store.refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { store.refresh(); reminders.check(true); } });
window.addEventListener('focus', () => { store.refresh(); reminders.check(true); });
store.refresh();
if (!storageFailed) reminders.check(true);
setInterval(() => reminders.check(false), 20000);
// Refresh overdue markers and the date header when the device crosses a date/time boundary.
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) render(); }, 30000);
