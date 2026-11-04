import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dateKey, addDays, localDate } from '../calendar.js';
import { emptyState, buildTask } from '../model.js';
import { STORAGE_KEY } from '../storage.js';

const url = process.env.TEST_URL || 'http://127.0.0.1:4173/todolist/';
const now = new Date();
const today = dateKey(now);
const future = addDays(today, 2);
await mkdir('test-results', { recursive: true });
let checks = 0;
const passed = message => { checks++; console.log(`PASS ${message}`); };

for (const channel of ['chrome', 'msedge']) {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  const add = async (title, { date, time, mode, custom } = {}) => {
    await page.locator('#add-task').click();
    await page.locator('#task-title').fill(title);
    if (date !== undefined) await page.locator('#task-date').fill(date);
    if (time) await page.locator('#task-time').fill(time);
    if (mode) await page.locator('#task-reminder').selectOption(mode);
    if (custom) await page.locator('#task-custom-reminder').fill(custom);
    await page.locator('#save-task').click();
    await expect(page.locator('#task-dialog')).not.toBeVisible();
  };
  try {
    await page.goto(url);
    await expect(page.locator('#page-title')).toHaveText('今日のToDo');
    await add('今日の資料を整理する');
    await expect(page.locator('.task-title')).toHaveText('今日の資料を整理する');
    await page.locator('.task-check').check();
    await expect(page.locator('#summary-title')).toContainText('すべて完了');
    await expect(page.locator('.task-check')).toBeFocused();
    await page.locator('.task-check').uncheck();
    await page.getByRole('button', { name: '今日の資料を整理するを編集', exact: true }).click();
    await page.locator('#task-title').fill('明日の準備をする');
    await page.locator('#save-task').click();
    await page.getByRole('button', { name: '明日の準備をするを削除', exact: true }).click();
    await expect(page.locator('.task-title')).toHaveCount(0);
    await page.locator('#undo-delete').click();
    await expect(page.locator('.task-title')).toHaveText('明日の準備をする');
    passed(`${channel}: create/edit/complete/delete/undo`);

    await page.locator('#manage-folders').click();
    await page.locator('#folder-name').fill('仕事');
    await page.locator('#folder-form button').click();
    await expect(page.locator('#folder-name')).toHaveValue('');
    await page.locator('#folder-name').fill('仕事');
    await page.locator('#folder-form button').click();
    await expect(page.locator('#folder-form-error')).toContainText('使用済み');
    await page.locator('#folder-dialog [data-close]').click();
    await page.locator('#folder-list .folder-button').filter({ hasText: '仕事' }).click();
    await add('企画書をまとめる', { date: future, time: '18:00', mode: '1h' });
    await page.locator('[data-view="calendar"]').click();
    const calendarDate = page.getByRole('button', { name: `${future}、未完了1件`, exact: true });
    await expect(calendarDate).toBeVisible();
    await calendarDate.click();
    await expect(page.locator('.task-title')).toHaveText('企画書をまとめる');
    await page.locator('#add-task').click();
    await expect(page.locator('#task-date')).toHaveValue(future);
    await expect(page.locator('#task-folder')).not.toHaveValue('');
    await page.locator('#task-dialog [aria-label="閉じる"]').click();
    await page.locator('#manage-folders').click();
    await page.locator('.folder-edit-row input').fill('制作');
    await page.getByRole('button', { name: '名前変更', exact: true }).click();
    await expect(page.locator('.folder-edit-row input')).toHaveValue('制作');
    const beforeFolderDelete = (await read()).tasks.find(t => t.title === '企画書をまとめる');
    await page.locator('.folder-edit-row').getByRole('button', { name: '削除', exact: true }).click();
    await page.locator('#folder-dialog [data-close]').click();
    const afterFolderDelete = (await read()).tasks.find(t => t.id === beforeFolderDelete.id);
    expect(afterFolderDelete).toEqual({ ...beforeFolderDelete, folderId: null });
    passed(`${channel}: folders, duplicate prevention, rename, calendar counts, deletion preserves task`);

    await page.locator('[data-view="tasks"]').click();
    await add('<img src=x onerror=alert(1)>日付なし', { date: '' });
    await expect(page.locator('.task-title')).toHaveCount(3);
    await expect(page.locator('.task-title img')).toHaveCount(0);
    await page.locator('#sort-order').selectOption('title');
    await page.reload();
    await expect(page.locator('#page-title')).toHaveText('今日のToDo');
    await expect(page.locator('#sort-order')).toHaveValue('title');
    await page.locator('#undated-link').click();
    await expect(page.locator('.task-title')).toHaveCount(1);
    await page.locator('[data-view="tasks"]').click();
    await page.locator('#status-filter').selectOption('completed');
    await expect(page.locator('#empty-title')).toHaveText('条件に合うタスクはありません');
    await page.locator('#status-filter').selectOption('active');
    await expect(page.locator('.task-title')).toHaveCount(3);
    passed(`${channel}: shared state, filters, persistence, undated tasks, safe text rendering`);

    await page.locator('#add-task').click();
    await page.locator('#task-title').fill('　 ');
    await page.locator('#save-task').click();
    await expect(page.locator('#task-form-error')).toContainText('内容を入力');
    await page.locator('#task-title').fill('IMEチェック');
    await page.locator('#task-title').dispatchEvent('compositionstart');
    await page.locator('#task-title').press('Enter');
    await expect(page.locator('#task-dialog')).toBeVisible();
    await page.locator('#task-title').dispatchEvent('compositionend');
    await page.locator('#task-time').fill('10:00');
    await page.locator('#save-task').click();
    await expect(page.locator('#task-form-error')).toContainText('期限日も必要');
    await page.locator('#task-date').fill(future);
    await page.locator('#task-reminder').selectOption('custom');
    await page.locator('#task-custom-reminder').fill(`${future}T11:00`);
    await page.locator('#save-task').click();
    await expect(page.locator('#task-form-error')).toContainText('期限より前');
    await page.locator('#task-dialog [aria-label="閉じる"]').click();
    passed(`${channel}: whitespace/time-only/invalid reminder rejected; IME Enter suppressed`);

    // Seed synthetic boundary data in this isolated browser context, never the user's profile.
    const state = emptyState();
    const make = (title, date = today, time = '') => buildTask({ title, dueDate: date, dueTime: time, reminderMode: 'none' });
    state.tasks = [make('今日のメモ'), make('昨日の未完了', addDays(today, -1)), make('期限時刻超過', today, '00:00'), make('日付なし', ''), make('読書をする')];
    await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: STORAGE_KEY, state });
    await page.reload();
    await expect(page.locator('#overdue-list .task-title')).toHaveText('昨日の未完了');
    await expect(page.locator('#task-list .task-title')).toHaveCount(3);
    await expect(page.locator('#task-list .deadline.overdue')).toHaveCount(1);
    await page.locator('#selected-date').fill('2026-12-31');
    await page.locator('#next-date').click();
    await expect(page.locator('#selected-date')).toHaveValue('2027-01-01');
    await page.locator('[data-view="calendar"]').click();
    await page.locator('#previous-date').click();
    await expect(page.locator('#page-title')).toHaveText('2026年12月');
    await page.locator('#next-date').click();
    await expect(page.locator('#page-title')).toHaveText('2027年1月');
    await page.locator('#go-today').click();
    await page.screenshot({ path: `test-results/${channel}-calendar.png`, fullPage: true });
    await page.locator('[data-view="day"]').click();
    await page.screenshot({ path: `test-results/${channel}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#mobile-folder')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${channel}-mobile.png`, fullPage: true });
    await page.locator('#add-task').click();
    expect(await page.evaluate(() => document.querySelector('dialog[open]').getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.locator('#task-dialog [aria-label="閉じる"]').click();
    await page.locator('[data-view="calendar"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    passed(`${channel}: overdue separation, year boundary, calendar, 390/320px responsive layouts`);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-view="tasks"]').click();
    await page.locator('#add-task').click();
    await page.locator('#task-title').fill('保存失敗でも入力保持');
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('quota exceeded', 'QuotaExceededError'); }; });
    await page.locator('#save-task').click();
    await expect(page.locator('#task-dialog')).toBeVisible();
    await expect(page.locator('#task-title')).toHaveValue('保存失敗でも入力保持');
    await expect(page.locator('#storage-error')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#storage-error')).toBeVisible();
    await expect(page.locator('#save-status')).toHaveText('保存できていません');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await page.locator('#save-task').click();
    await expect(page.locator('#task-dialog')).not.toBeVisible();
    await page.evaluate(key => localStorage.setItem(key, '{corrupt'), STORAGE_KEY);
    await page.reload();
    await expect(page.locator('#storage-error')).toBeVisible();
    await page.locator('#add-task').click();
    await page.locator('#task-title').fill('上書きしない');
    await page.locator('#save-task').click();
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe('{corrupt');
    passed(`${channel}: save failure retains input; corrupt data never overwritten`);
    expect(errors).toEqual([]);
    console.log(`${channel} version: ${browser.version()}`);
  } finally { await context.close(); await browser.close(); }
}

// Deterministic notification checks: preserve the real scheduler/store, replace only OS transport.
for (const channel of ['chrome', 'msedge']) {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
  await context.addInitScript(() => {
    window.sentNotifications = [];
    window.Notification = class {
      static permission = 'granted';
      static requestPermission() { return Promise.resolve(this.permission); }
      constructor(title, options) { window.sentNotifications.push({ title, ...options }); }
      close() {}
    };
  });
  const page = await context.newPage(); const second = await context.newPage();
  try {
    await page.goto(url); await second.goto(url);
    const ready = emptyState();
    const at = new Date();
    const makeReminder = (title, extra = {}) => ({
      ...buildTask({ title, dueDate: addDays(today, 1), dueTime: '23:00', reminderMode: 'none' }),
      reminderMode: 'custom', remindAt: new Date(at.getTime() - 1000).toISOString(), ...extra,
    });
    ready.tasks = [makeReminder('通知対象'), makeReminder('完了済み', { completed: true }), makeReminder('処理済み', { reminderHandledAt: at.toISOString() })];
    await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: STORAGE_KEY, state: ready });
    const check = async p => p.evaluate(async () => {
      const { createStore } = await import('./storage.js');
      const { createReminders } = await import('./reminders.js');
      const store = createStore(localStorage, navigator.locks, () => {}, error => { throw error; });
      await createReminders(store).check(false);
    });
    await Promise.all([check(page), check(second)]);
    const sent = [...await page.evaluate(() => window.sentNotifications), ...await second.evaluate(() => window.sentNotifications)];
    expect(sent.map(n => n.title)).toEqual(['通知対象']);
    await check(page); await check(second);
    expect((await page.evaluate(() => window.sentNotifications.length)) + (await second.evaluate(() => window.sentNotifications.length))).toBe(1);
    await page.reload();
    await expect(page.locator('#reminder-items li')).toHaveCount(1);
    expect(await page.evaluate(() => window.sentNotifications.length)).toBe(0);
    passed(`${channel}: cross-tab deduplication, completed/handled exclusion and reload persistence (OS transport stub)`);

    await second.close();
    ready.tasks = [makeReminder('起動時の見逃し')]; ready.inbox = [];
    await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: STORAGE_KEY, state: ready });
    await page.reload();
    await expect(page.locator('#reminder-items')).toContainText('起動時の見逃し');
    expect(await page.evaluate(() => window.sentNotifications.length)).toBe(0);
    await page.locator('#dismiss-reminders').click();
    for (const permission of ['denied', 'unsupported', 'throws']) {
      ready.tasks = [makeReminder(`通知 ${permission}`)]; ready.inbox = [];
      await page.evaluate(({ key, state, permission }) => {
        localStorage.setItem(key, JSON.stringify(state));
        if (permission === 'unsupported') delete window.Notification;
        else if (permission === 'throws') window.Notification = class { static permission = 'granted'; constructor() { throw new Error('OS unavailable'); } };
        else Notification.permission = permission;
      }, { key: STORAGE_KEY, state: ready, permission });
      await check(page);
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).inbox.length, STORAGE_KEY)).toBe(1);
    }
    passed(`${channel}: startup overdue aggregation, denied/unsupported/throwing OS fallback`);
  } finally { await context.close(); await browser.close(); }
}
console.log(`Browser verification complete: ${checks} scenario groups passed. URL: ${url}`);
