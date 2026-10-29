import { test, expect, chromium } from '@playwright/test';
import { createProject, addCard, rate } from './helpers';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
test('formal state and raw evidence survive backup restore and a real browser restart', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const profile = testInfo.outputPath('profile');
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    locale: 'zh-CN',
  });
  try {
    let page = context.pages()[0]!;
    await page.goto('http://127.0.0.1:5174/#projects');
    await createProject(page, '虚构持久复习');
    await addCard(page, 1);
    await page.getByRole('link', { name: '今日复习', exact: true }).click();
    await expect(page.getByLabel('可信复习统计')).toContainText(
      '尚无输入作答后人工核对的无提示样本',
    );
    await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
    await page.getByRole('button', { name: '输入作答', exact: true }).click();
    await page.getByLabel('你的回答').fill('公开虚构完整回答');
    await rate(page, true);
    await page.getByRole('link', { name: '查看今日复习与下次到期', exact: true }).click();
    await expect(page.getByLabel('可信复习统计')).toContainText('100%（1 / 1 次）');
    await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
    ]);
    const path = testInfo.outputPath('fictional-fsrs.json');
    await download.saveAs(path);
    const before = JSON.parse(await readFile(path, 'utf8'));
    expect(before.databaseVersion).toBe(8);
    expect(before.data.memoryStates).toHaveLength(1);
    expect(before.data.schedulingLogs).toHaveLength(1);
    await page.getByLabel('选择 JSON 备份').setInputFiles(path);
    await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
    await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('恢复成功');
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chromium',
      locale: 'zh-CN',
    });
    page = context.pages()[0]!;
    await page.goto('http://127.0.0.1:5174/#daily');
    await expect(page.getByLabel('可信复习统计')).toContainText('100%（1 / 1 次）');
    const after = await page.evaluate(async () => {
      const path = '/src/persistence/database.ts';
      const { db } = await import(path);
      return {
        memories: await db.memoryStates.toArray(),
        logs: await db.schedulingLogs.toArray(),
        events: await db.reviewEvents.toArray(),
      };
    });
    expect(after.memories).toEqual(before.data.memoryStates);
    expect(after.logs).toEqual(before.data.schedulingLogs);
    expect(after.events).toEqual(before.data.reviewEvents);
  } finally {
    await context.close();
  }
});
test('PDF knowledge enters spaced review and self-report is not shown as objectively measured accuracy', async ({
  page,
}) => {
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/chinese-cid.pdf', import.meta.url)));
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await page.getByRole('button', { name: '按计划学习新题（FSRS）', exact: true }).click();
  await page.getByRole('button', { name: '我已尝试回忆', exact: true }).click();
  await rate(page, false);
  await page.getByRole('link', { name: '暂停并返回今日复习', exact: true }).click();
  await expect(page.getByLabel('可信复习统计')).toContainText('尚无输入作答后人工核对的无提示样本');
  await expect(page.getByLabel('可信复习统计')).toContainText('1 次正确 / 1 次已核对自报');
});
