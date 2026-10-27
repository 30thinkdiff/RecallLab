import { expect, type Page } from '@playwright/test';
export async function createProject(page: Page, name = '认知心理学复习') {
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill(name);
  await page.getByLabel('学习目标').fill('能够无提示复述核心知识');
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function addCard(page: Page, index: number) {
  await page.getByRole('button', { name: '添加问答题', exact: true }).first().click();
  await page.getByLabel('问题', { exact: false }).fill(`第 ${index} 题：什么是主动回忆？`);
  await page.getByLabel('标准答案').fill(`答案 ${index}：不查看资料，主动从记忆中提取知识。`);
  await page.getByLabel('核对要点', { exact: false }).fill('不查看资料\n主动提取');
  await page.getByLabel('渐进提示', { exact: false }).fill('先不要看资料\n从记忆中提取');
  await page.getByRole('button', { name: '保存题目' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: `第 ${index} 题：什么是主动回忆？`, exact: true }),
  ).toBeVisible();
}

export async function editCard(page: Page, index: number, answer: string, kind = 'substantive') {
  await page
    .getByRole('button', { name: `编辑题目：第 ${index} 题：什么是主动回忆？`, exact: true })
    .click();
  await page.getByLabel('标准答案').fill(answer);
  await page.getByLabel('修订类型').selectOption(kind);
  await page
    .getByLabel('修改原因')
    .fill(kind === 'cosmetic' ? '仅调整标点，不改变含义' : '更正虚构资料中的错误答案');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
export async function rate(page: Page, last = false) {
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByLabel('自行核对结果').selectOption('correct');
  await page.getByRole('radio', { name: '3 基本掌握', exact: true }).click();
  await page
    .getByRole('button', { name: last ? '保存并完成本轮' : '保存并下一题', exact: true })
    .click();
}
