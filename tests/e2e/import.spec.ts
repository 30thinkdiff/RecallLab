import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createProject, addCard, rate } from './helpers';
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
async function upload(page: Page, name: string) {
  await page.getByLabel('选择学习资料').setInputFiles(fixture(name));
  await expect(page.getByRole('heading', { name: /候选题目/ })).toBeVisible();
}

test('imports 69 questions in one confirmation without replacing an existing project or history', async ({
  page,
}) => {
  await page.goto('/');
  await createProject(page, '保留历史的项目');
  await addCard(page, 1);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await rate(page, true);
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  await page.getByRole('link', { name: '导入资料', exact: true }).first().click();
  await upload(page, 'bank-69.json');
  await expect(
    page.getByText('已选 69 道 · 待补全 0 道 · 疑似重复 0 道', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('import-candidate')).toHaveCount(10);
  await page.getByLabel('第 1 题答案', { exact: true }).fill('用户在预览中确认的修改答案');
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回项目题库', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(70);
  await page.getByRole('link', { name: '学习记录', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('link', { name: '学习资料', exact: true }).click();
  await page.getByRole('link', { name: /bank-69.json/ }).click();
  await expect(page.getByLabel('资料原文')).toHaveValue(/虚构标准答案 1/);
  await expect(page.getByLabel('资料原文')).not.toHaveValue(/用户在预览中确认/);
});

for (const [file, answer] of [
  ['sample.csv', '第一行,中文🙂\n第二行含"引号"'],
  ['sample.tsv', '第一行\n第二行🙂'],
  ['sample.txt', '第一要点\n第二要点'],
  ['sample.md', '多行答案第一点\n第二点🙂'],
] as const) {
  test(`previews ${file} accurately and starts real learning immediately`, async ({ page }) => {
    await page.goto('/#import');
    await upload(page, file);
    await expect(page.getByLabel('第 1 题答案', { exact: true })).toHaveValue(answer);
    await page.getByRole('button', { name: /^确认导入 \d+ 道题$/ }).click();
    await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开始学习（加入本轮新题）', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '先回忆，再看答案。', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
    await expect(page.locator('.answer-panel>.preserve-lines')).toHaveText(answer);
  });
}

test('cancel and broken files leave no projects or sources; incomplete candidates can be corrected', async ({
  page,
}) => {
  await page.goto('/#import');
  await upload(page, 'sample.csv');
  await page.getByRole('button', { name: '取消本次导入', exact: true }).click();
  await page.getByRole('link', { name: '学习资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有学习资料', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '导入资料', exact: true }).first().click();
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.getByRole('alert')).toContainText('JSON');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'incomplete.json',
    mimeType: 'application/json',
    buffer: Buffer.from('[{"question":"缺少答案"}]'),
  });
  await expect(page.getByRole('button', { name: '确认导入 1 道题', exact: true })).toBeDisabled();
  await page.getByLabel('第 1 题答案', { exact: true }).fill('人工补全答案');
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
});

test('duplicates are flagged and skipped by default; a question-bank import is separate from restore', async ({
  page,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await page.getByRole('link', { name: '导入资料', exact: true }).first().click();
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'bank.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        { question: '第 1 题：什么是主动回忆？', answer: '不同的新答案' },
        { question: '真正的新题', answer: '新答案' },
      ]),
    ),
  });
  await expect(
    page.getByText('项目中有相同问题，但答案不同，请核对', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '导入第 1 题', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await page.getByRole('link', { name: '返回项目题库', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(2);
  await page.getByRole('link', { name: '导入资料', exact: true }).first().click();
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"RecallLabBackup"}'),
  });
  await expect(page.getByRole('alert')).toContainText('备份与恢复');
});

test('mobile import preview and confirmation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#import');
  await upload(page, 'sample.csv');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '确认导入 2 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
});

test('creates a manual question without uploading a file and keeps edit controls available', async ({
  page,
}) => {
  await page.goto('/#import-task');
  await page.getByRole('button', { name: '先创建项目，再手动添加问答' }).click();
  await page.getByLabel('项目名称').fill('临时记忆任务');
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('heading', { name: '临时记忆任务' })).toBeVisible();
  await page.getByRole('button', { name: '添加问答题' }).click();
  await page.getByLabel('问题', { exact: false }).fill('临时知识是什么？');
  await page.getByLabel('标准答案').fill('用户手动补充的临时答案');
  await page.getByRole('button', { name: '保存题目' }).click();
  await expect(page.getByRole('heading', { name: '临时知识是什么？' })).toBeVisible();
  await page.getByRole('button', { name: '编辑题目：临时知识是什么？' }).click();
  await page.getByLabel('标准答案').fill('用户手动修正后的答案');
  await page.getByLabel('修改原因').fill('人工补充了知识');
  await page.getByRole('button', { name: '保存题目' }).click();
  await page.getByText('查看标准答案', { exact: true }).click();
  await expect(page.getByText('用户手动修正后的答案')).toBeVisible();
});

test('pasted Q&A text enters normal import flow without selecting any external file', async ({
  page,
}) => {
  await page.goto('/#import');
  await page.getByText('粘贴文字或临时笔记', { exact: true }).click();
  await page.getByLabel('粘贴的学习内容').fill('Q: 何为主动回忆？\nA: 不看资料，从记忆中独立提取。');
  await page.getByRole('button', { name: '解析粘贴内容' }).click();
  await expect(page.getByRole('heading', { name: '候选题目（1）' })).toBeVisible();
  await expect(page.getByLabel('第 1 题答案', { exact: true })).toHaveValue(
    '不看资料，从记忆中独立提取。',
  );
  await page.getByRole('button', { name: '确认导入 1 道题' }).click();
  await expect(page.getByRole('heading', { name: '导入完成' })).toBeVisible();
  await page.getByRole('link', { name: '返回项目题库' }).click();
  await expect(page.getByRole('heading', { name: '何为主动回忆？' })).toBeVisible();
});
