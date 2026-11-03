import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
async function data(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    return {
      sessions: await db.sessions.toArray(),
      recoveries: await db.draftRecoveries.toArray(),
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
}, info) => {
  const started = performance.now();
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
  await info.attach('direct-create-observation', {
    body: JSON.stringify({
      actor: 'Playwright automation, not a human',
      steps: ['open create', 'enter question', 'enter answer', 'save and study'],
      projectNamesRequired: 0,
      algorithmSettingsRequired: 0,
      automatedMilliseconds: Math.round(performance.now() - started),
    }),
    contentType: 'application/json',
  });
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

async function twoQuestions(page: Page) {
  await page.goto('/#compose');
  await page.getByLabel('问题', { exact: false }).fill('虚构一号使用什么标识？');
  await page.getByLabel('标准答案').fill('蓝晶标识');
  await page.getByRole('button', { name: '保存并继续添加', exact: true }).click();
  await expect(page.getByLabel('问题', { exact: false })).toHaveValue('');
  await page.getByLabel('问题', { exact: false }).fill('虚构二号使用什么标识？');
  await page.getByLabel('标准答案').fill('白晶标识');
  await page.getByRole('button', { name: '保存并学习', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
}
test('editing the current question preserves its raw answer, survives refresh and continues in the same task', async ({
  page,
}) => {
  await twoQuestions(page);
  const before = await data(page),
    session = before.sessions.find((s) => s.status === 'active')!,
    old = session.queue[session.index]!;
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('用户的旧版原始回答');
  await page.getByRole('button', { name: '修改这道题', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑问答题' })).toBeVisible();
  await page.getByLabel('标准答案').fill('用户确认的新标准答案');
  await expect(page.getByTestId('editor-status')).toHaveText('编辑草稿已保存在本机');
  await page.reload();
  await expect(page.getByLabel('标准答案')).toHaveValue('用户确认的新标准答案');
  expect((await data(page)).cards.find((c) => c.id === old.id)!.standardAnswer).toBe(
    old.standardAnswer,
  );
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await page.getByRole('button', { name: '确认更新并重新安排', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toHaveValue('');
  const after = await data(page);
  expect(after.sessions.find((s) => s.id === session.id)!.index).toBe(session.index + 1);
  expect(after.events[0]).toMatchObject({
    assessmentResult: 'ungraded',
    subjectiveMastery: null,
    userResponse: '用户的旧版原始回答',
    scheduling: { grade: null },
    snapshot: { standardAnswer: old.standardAnswer },
  });
  expect(after.cards.find((c) => c.id === old.id)!.learningStateId).not.toBe(old.learningStateId);
  expect(after.recoveries.some((r) => r.draft.userResponse === '用户的旧版原始回答')).toBe(true);
  await expect
    .poll(
      async () =>
        (await data(page)).drafts.filter(
          (d) => d.sessionId === session.id && !d.id.startsWith('recovery:'),
        ).length,
    )
    .toBe(0);
});
test('cancelling current-question editing preserves the answer exposure and original response without a grade', async ({
  page,
}) => {
  await page.clock.install();
  await twoQuestions(page);
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('揭晓前写下的原回答');
  const before = await data(page);
  await page.getByRole('button', { name: '修改这道题', exact: true }).click();
  const frozen = (await data(page)).sessions.find((s) => s.status === 'active')!.draft;
  await page.clock.fastForward(120000);
  await page.getByLabel('标准答案').fill('取消的修改');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await data(page);
  expect(after.cards).toEqual(before.cards);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.events).toEqual(before.events);
  expect(after.memories).toEqual(before.memories);
  const session = after.sessions.find((s) => s.status === 'active')!;
  expect(session.draft.responseDuration).toBe(frozen.responseDuration);
  expect(session.draft.timing?.activeMs).toBe(frozen.timing?.activeMs);
  expect(session.draft.wasAnswerRevealed).toBe(true);
  expect(session.draft.userResponse).toBe('揭晓前写下的原回答');
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toHaveCount(0);
});

test('working notes autosave independently, recover after reload, and retain question and source history', async ({
  page,
}) => {
  await twoQuestions(page);
  const before = await data(page),
    card = before.cards[0]!;
  await page.goto(`/#item/${card.id}`);
  await page.getByRole('link', { name: '编辑学习稿', exact: true }).click();
  await page
    .getByLabel('学习稿正文')
    .fill('用户补充：白晶信号只用于虚构案例。\n原始问答仍然保留。');
  await expect(page.getByTestId('note-status')).toHaveText('学习稿已自动保存 · 版本 1');
  await page.reload();
  await expect(page.getByLabel('学习稿正文')).toHaveValue(
    '用户补充：白晶信号只用于虚构案例。\n原始问答仍然保留。',
  );
  const after = await data(page);
  expect(after.cards).toEqual(before.cards);
  expect(after.memories).toEqual(before.memories);
  expect(after.revisions).toEqual(before.revisions);
  await page.goto(`/#item/${card.id}`);
  await page.getByRole('button', { name: '修改这道题', exact: true }).click();
  await page.getByLabel('标准答案').fill('用户另外更正题目答案');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await page.getByRole('button', { name: '确认更新并重新安排', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await data(page)).notes.find((n) => n.id === card.knowledgeUnitId)!.canonicalContent,
  ).toBe('用户补充：白晶信号只用于虚构案例。\n原始问答仍然保留。');
});

test('two tabs cannot silently overwrite a newer working note', async ({ page, context }) => {
  await twoQuestions(page);
  const card = (await data(page)).cards[0]!;
  await page.goto(`/#note/${card.knowledgeUnitId}`);
  await expect(page.getByLabel('学习稿正文')).toBeVisible();
  const other = await context.newPage();
  await other.goto(`/#note/${card.knowledgeUnitId}`);
  await expect(other.getByLabel('学习稿正文')).toBeVisible();
  await page.getByLabel('学习稿正文').fill('第一页面确认的新学习稿');
  await expect(page.getByTestId('note-status')).toHaveText('学习稿已自动保存 · 版本 1');
  await other.getByLabel('学习稿正文').fill('过期页面尚未保存的补充');
  await expect(other.getByRole('alert')).toContainText('另一页面');
  await expect(other.getByLabel('学习稿正文')).toHaveValue('过期页面尚未保存的补充');
  expect(
    (await data(page)).notes.find((n) => n.id === card.knowledgeUnitId)!.canonicalContent,
  ).toBe('第一页面确认的新学习稿');
});

test('narrow-screen direct creation and in-place correction remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await twoQuestions(page);
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('移动端原回答');
  await page.getByRole('button', { name: '修改这道题', exact: true }).click();
  await page.getByLabel('标准答案').fill('移动端更正答案');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await page.getByRole('button', { name: '确认更新并重新安排', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('three PDF question corrections keep immutable source, then working note and complete backup restore stay independent', async ({
  page,
}, info) => {
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/chinese-cid.pdf', import.meta.url)));
  await expect(page.getByRole('heading', { name: '候选题目（69）', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  const before = await data(page);
  const sources = await page.evaluate(async () =>
    (await import('/src/persistence/database.ts' + '')).db.sourceDocuments.toArray(),
  );
  for (const [index, card] of before.cards.slice(0, 3).entries()) {
    await page.goto(`/#item/${card.id}`);
    await page.getByRole('button', { name: '修改这道题', exact: true }).click();
    await page.getByLabel('标准答案').fill(`用户补充修正${index + 1}：这是虚构的新版标准表述。`);
    await page.getByRole('button', { name: '保存题目', exact: true }).click();
    await page.getByRole('button', { name: '确认更新并重新安排', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const card = before.cards[0]!;
  await page.goto(`/#note/${card.knowledgeUnitId}`);
  await page.getByLabel('学习稿正文').fill('用户自己整理的学习稿，不是PDF原文。');
  await expect(page.getByTestId('note-status')).toHaveText('学习稿已自动保存 · 版本 1');
  const saved = await data(page);
  expect(saved.revisions).toHaveLength(before.revisions.length + 3);
  for (const old of before.cards.slice(0, 3)) {
    const current = saved.cards.find((c) => c.id === old.id)!;
    expect(current.learningStateId).not.toBe(old.learningStateId);
    expect(current.sourceReferences).toEqual(old.sourceReferences);
    expect(
      saved.revisions.find((r) => r.id === old.currentRevisionId)!.snapshot.standardAnswer,
    ).toBe(old.standardAnswer);
  }
  expect(
    await page.evaluate(async () =>
      (await import('/src/persistence/database.ts' + '')).db.sourceDocuments.toArray(),
    ),
  ).toEqual(sources);
  await page.goto('/#backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
  ]);
  const path = info.outputPath('fictional-edited-v9.json');
  await download.saveAs(path);
  await page.getByLabel('选择 JSON 备份').setInputFiles(path);
  await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复成功');
  const restored = await data(page);
  expect(restored.cards).toEqual(saved.cards);
  expect(restored.events).toEqual(saved.events);
  expect(restored.memories).toEqual(saved.memories);
  expect(restored.notes).toEqual(saved.notes);
  expect(restored.revisions).toEqual(saved.revisions);
  await page.goto(`/#note/${card.knowledgeUnitId}`);
  await expect(page.getByLabel('学习稿正文')).toHaveValue('用户自己整理的学习稿，不是PDF原文。');
});
