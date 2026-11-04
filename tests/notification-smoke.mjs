import { chromium, expect } from '@playwright/test';

const url = process.env.TEST_URL || 'http://127.0.0.1:4173/todolist/';
for (const channel of ['chrome', 'msedge']) {
  const browser = await chromium.launch({ channel, headless: false });
  const context = await browser.newContext({ permissions: ['notifications'], timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.evaluate(() => {
      const NativeNotification = window.Notification;
      window.nativeNotificationEvents = [];
      window.Notification = class extends NativeNotification {
        constructor(...args) {
          super(...args);
          this.addEventListener('show', () => window.nativeNotificationEvents.push('show'));
          this.addEventListener('error', () => window.nativeNotificationEvents.push('error'));
        }
      };
    });
    await page.locator('#notification-settings').click();
    await expect(page.locator('#notification-status')).toHaveText('OS通知は許可されています');
    await page.locator('#test-notification').click();
    await expect(page.locator('#notification-feedback')).toContainText('OS通知を要求しました');
    await expect.poll(() => page.evaluate(() => window.nativeNotificationEvents), { timeout: 15000 }).toContain('show');
    console.log(`PASS ${channel} ${browser.version()}: real Notifications API emitted show, ${url}`);
  } finally { await context.close(); await browser.close(); }
}
