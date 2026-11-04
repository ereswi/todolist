import { dueReminders } from './model.js';

export function notificationStatus() {
  if (!('Notification' in globalThis)) return 'このブラウザーはOS通知に対応していません';
  return { granted: 'OS通知は許可されています', denied: 'OS通知はブロックされています（画面内で通知）', default: 'OS通知はまだ許可されていません' }[Notification.permission];
}
export function showOSNotification(title, body, tag) {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification(title, { body, tag, icon: new URL('./icon.svg', import.meta.url).href });
    notification.onclick = () => { globalThis.focus(); notification.close(); };
    return true;
  } catch { return false; }
}
export function createReminders(store) {
  let busy = false;
  async function check(inAppOnly = false, now = new Date()) {
    if (busy) return;
    busy = true;
    try {
      // Even with permission, always leave a durable in-app receipt: OS delivery can fail asynchronously.
      if (!store.refresh() || !dueReminders(store.state.tasks, now).length) return;
      const outcome = await store.update(state => {
        const due = dueReminders(state.tasks, now);
        for (const task of due) {
          task.reminderHandledAt = now.toISOString();
          state.inbox.push({ id: `${task.id}:${task.remindAt}`, taskId: task.id, title: task.title, at: now.toISOString() });
        }
        return due.map(task => ({ ...task }));
      });
      // Marking first, under the same lock as all edits, prevents duplicate delivery across tabs.
      if (outcome.ok && !inAppOnly) {
        for (const task of outcome.result) showOSNotification(task.title, `期限: ${task.dueDate} ${task.dueTime}`, `${task.id}:${task.remindAt}`);
      }
    } finally { busy = false; }
  }
  return { check };
}
