export const pad = value => String(value).padStart(2, '0');
export const dateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function localDate(value, time = '00:00') {
  const [year, month, day] = value.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);
  return date;
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01' && dateKey(localDate(value)) === value;
}
export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function addDays(value, amount) {
  const date = localDate(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}
export function shiftMonth(value, amount) {
  const date = localDate(value.slice(0, 7) + '-01');
  date.setMonth(date.getMonth() + amount);
  return dateKey(date);
}
export function monthDays(value) {
  const first = value.slice(0, 7) + '-01';
  const start = addDays(first, -localDate(first).getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export const formatDay = value => localDate(value).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' });
export function isOverdue(task, now = new Date()) {
  if (task.completed || !task.dueDate) return false;
  return task.dueTime ? localDate(task.dueDate, task.dueTime) < now : task.dueDate < dateKey(now);
}
