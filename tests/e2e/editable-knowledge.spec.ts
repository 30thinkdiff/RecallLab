import { test, expect, type Page } from '@playwright/test';
async function data(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    return {
      projects: await db.projects.toArray(),
      cards: await db.practiceItems.toArray(),
      events: await db.reviewEvents.toArray(),
      memories: await db.memoryStates.toArray(),
      revisions: await db.revisions.toArray(),
      notes: await db.knowledgeUnits.toArray(),
      drafts: await db.editorDrafts.toArray(),
    };
  });
}
test('home creates a useful question without a file, project form, revision fields or algorithm settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: '直接创建问答', exact: true }).click();
  await expect(page.getByLabel('核对要点', { exact: false })).not.toBeVisible();
  await page.getByLabel('问题', { exact: false }).fill('虚构协议使用哪种标识？');
  await page.getByLabel('标准答案', { exact: false }).fill('青晶信号');
  await page.getByRole('button', { name: '保存并学习', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
  const s = await data(page);
  expect(s.cards).toHaveLength(1);
  expect(s.projects).toHaveLength(1);
  expect(s.cards[0]!.creationOrigin).toBe('user');
  expect(s.cards[0]!.sourceReferences[0]!.label).toBe('用户创建');
});
test('ten consecutive questions reuse the same container and resume an unfinished raw editor after refresh', async ({
  page,
}) => {
  await page.goto('/#compose');
  for (let i = 0; i < 9; i++) {
    await page.getByLabel('问题', { exact: false }).fill(`虚构规则${i + 1}使用哪种标识？`);
    await page.getByLabel('标准答案', { exact: false }).fill(`青晶标识${i + 1}`);
    await page.getByRole('button', { name: '保存并继续添加', exact: true }).click();
    await expect(page.getByLabel('问题', { exact: false })).toHaveValue('');
  }
  await page.getByLabel('问题', { exact: false }).fill('虚构规则10使用哪种标识？');
  await page.getByLabel('标准答案', { exact: false }).fill('青晶标识10');
  await expect(page.getByTestId('editor-status')).toHaveText('编辑草稿已保存在本机');
  await page.reload();
  await expect(page.getByLabel('标准答案', { exact: false })).toHaveValue('青晶标识10');
  await page.getByRole('button', { name: '保存并学习', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
  const s = await data(page);
  expect(s.projects).toHaveLength(1);
  expect(s.cards).toHaveLength(10);
  expect(new Set(s.cards.map((c) => c.projectId)).size).toBe(1);
});
test('cancelling a new question changes no project, card or scheduling state', async ({ page }) => {
  await page.goto('/#compose');
  await page.getByLabel('问题', { exact: false }).fill('尚未确认的虚构问题');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '让每一次回忆，都有收获。' })).toBeVisible();
  const s = await data(page);
  expect(s.cards).toHaveLength(0);
  expect(s.projects).toHaveLength(0);
  expect(s.events).toHaveLength(0);
  expect(s.memories).toHaveLength(0);
  expect(s.revisions).toHaveLength(0);
});
