import { test, expect, type Locator } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { createProject, addCard } from './helpers';
for (const mode of ['legacy', 'compact'] as const)
  test(`measures actual scripted per-answer operations: ${mode}`, async ({ page }, info) => {
    await page.goto('/#projects');
    await createProject(page, '公开交互成本对照');
    await addCard(page, 1);
    if (mode === 'legacy') {
      await page.getByRole('link', { name: '今日复习', exact: true }).click();
      await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
    } else {
      await page.getByRole('link', { name: '继续今天学习', exact: true }).click();
      await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '先回忆，再看答案。' })).toBeVisible();
    const counts = { click: 0, fill: 0, select: 0, typedCharacters: 0 };
    const click = async (l: Locator) => {
      counts.click++;
      await l.click();
    };
    const fill = async (l: Locator, text: string) => {
      counts.fill++;
      counts.typedCharacters += text.length;
      await l.fill(text);
    };
    const select = async (l: Locator, v: string) => {
      counts.select++;
      await l.selectOption(v);
    };
    const started = Date.now();
    if (mode === 'legacy') await click(page.getByRole('button', { name: '输入作答', exact: true }));
    await fill(
      page.getByRole('textbox', { name: /^你的回答/ }),
      '主动回忆是在不看材料时尝试提取知识。',
    );
    if (mode === 'legacy') {
      await click(page.getByRole('button', { name: '揭晓答案', exact: true }));
      await select(page.getByLabel('自行核对结果', { exact: true }), 'correct');
      await click(page.getByRole('radio', { name: '3 基本掌握', exact: true }));
      await click(page.getByRole('button', { name: '保存并完成本轮', exact: true }));
    } else {
      await click(page.getByRole('button', { name: '提交回答', exact: true }));
      await click(page.getByRole('button', { name: '全部正确，继续', exact: true }));
    }
    await expect(
      page.getByRole('heading', { name: '这一轮，完成了。', exact: true }),
    ).toBeVisible();
    const record = {
      actor: 'Playwright automated script; not human user time',
      mode,
      counts,
      operations: counts.click + counts.fill + counts.select,
      scriptElapsedMs: Date.now() - started,
      scope:
        'One typed independent answer with aggregate manual feedback; excludes once-only import/goal setup and reading/thinking time',
    };
    expect(record.operations).toBe(mode === 'legacy' ? 6 : 3);
    await info.attach('learning-interaction-cost', {
      body: JSON.stringify(record, null, 2),
      contentType: 'application/json',
    });
    if (process.env.RECALLLAB_WRITE_COST === '1') {
      await mkdir('evaluation/v06', { recursive: true });
      await writeFile(
        `evaluation/v06/interaction-${mode}.json`,
        JSON.stringify(record, null, 2) + '\n',
      );
    }
  });
