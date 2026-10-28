import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { rate } from './helpers';
test('69-item learning lifecycle retains sources and isolates a corrected answer through spaced review and restore', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-28T08:00:00Z') });
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/bank-69.json', import.meta.url)));
  await expect(page.getByLabel('第 1 题问题', { exact: true })).toHaveValue(/虚构导入题 01/);
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await page.getByRole('link', { name: '返回项目题库', exact: true }).click();
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '设置学习预算与目标', exact: true }).click();
  await page.getByLabel('每日计划（分钟）').fill('30');
  await page.getByLabel('每日新题上限').fill('1');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('公开虚构原始回答：第一要点、第二要点。');
  await rate(page, true);
  await expect(
    page.getByRole('link', { name: '查看今日复习与下次到期', exact: true }),
  ).toBeVisible();
  const first = await page.evaluate(async () => {
    const path = '/src/persistence/database.ts';
    const { db } = await import(path);
    return (await db.reviewEvents.toArray())[0];
  });
  expect(first.scheduling.grade).toBe(3);
  await page.clock.setSystemTime(new Date('2026-10-29T08:00:00Z'));
  await page.getByRole('link', { name: '查看今日复习与下次到期', exact: true }).click();
  await page.getByLabel('复习范围').selectOption('due');
  await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('公开虚构失败回答。');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByLabel('自行核对结果').selectOption('incorrect');
  await page.getByRole('radio', { name: '4 完全掌握', exact: true }).click();
  await page.getByRole('button', { name: '保存并完成本轮', exact: true }).click();
  await expect(page.getByLabel('本次复习结果')).toContainText('Again');
  const projectId = first.projectId,
    itemId = first.practiceItemId;
  await page.goto(`/#project/${projectId}`);
  await page
    .getByRole('button', { name: `编辑题目：${first.snapshot.question}`, exact: true })
    .click();
  await page.getByLabel('标准答案').fill('公开虚构更正答案：此前答案有误。');
  await page.getByLabel('修改原因').fill('完整生命周期验收：更正错误标准答案');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/#item/${itemId}`);
  await expect(page.getByRole('status')).toContainText('新版需要重新学习');
  await page.getByLabel('统计范围').selectOption('all');
  await page.locator('.history-list summary').first().click();
  await expect(page.locator('.history-list')).toContainText('公开虚构原始回答');
  const state = await page.evaluate(async (itemId) => {
    const path = '/src/persistence/database.ts';
    const { db } = await import(path);
    const c = await db.practiceItems.get(itemId);
    return {
      old: (await db.memoryStates.where('practiceItemId').equals(itemId).toArray()).length,
      current: await db.memoryStates.get(c.learningStateId),
      sourceCount: c.sourceReferences.length,
    };
  }, itemId);
  expect(state.old).toBe(1);
  expect(state.current).toBeUndefined();
  expect(state.sourceCount).toBe(1);
  await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
  ]);
  const path = testInfo.outputPath('fictional-lifecycle.json');
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8'));
  expect(backup.data.practiceItems).toHaveLength(69);
  expect(backup.data.reviewEvents).toHaveLength(2);
  expect(backup.data.schedulingLogs).toHaveLength(2);
  await page.getByLabel('选择 JSON 备份').setInputFiles(path);
  await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复成功');
  const after = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const b = '/src/persistence/backup.ts';
    const { db } = await import(p);
    const { exportBackup } = await import(b);
    return (await exportBackup(db)).data;
  });
  expect(after.reviewEvents).toEqual(backup.data.reviewEvents);
  expect(after.memoryStates).toEqual(backup.data.memoryStates);
  expect(after.schedulingLogs).toEqual(backup.data.schedulingLogs);
  expect(after.sourceDocuments).toEqual(backup.data.sourceDocuments);
});
