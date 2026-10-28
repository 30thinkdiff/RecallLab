import { test, expect } from '@playwright/test';
import { createProject, addCard } from './helpers';
test('formal input recall, contradictory self-rating, refresh and pause retain trustworthy scheduling evidence', async ({
  page,
}) => {
  await page.goto('/#projects');
  await createProject(page, '虚构间隔复习');
  await addCard(page, 1);
  const projectId = await page.evaluate(() => location.hash.split('/')[1]!);
  const sessionId = await page.evaluate(async (id) => {
    const path = '/src/scheduling/service.ts';
    const { scheduleService } = await import(path);
    return scheduleService.start(id);
  }, projectId);
  await page.goto(`/#study/${sessionId}`);
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('公开虚构但错误的回答');
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  await page.reload();
  await expect(page.getByLabel('你的回答')).toHaveValue('公开虚构但错误的回答');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByLabel('自行核对结果').selectOption('incorrect');
  await page.getByRole('radio', { name: '4 完全掌握', exact: true }).click();
  await page.getByRole('button', { name: '保存并完成本轮', exact: true }).click();
  await expect(page.getByLabel('本次复习结果')).toContainText('Again');
  await expect(page.getByLabel('本次复习结果')).toContainText('下次到期');
  const saved = await page.evaluate(async () => {
    const path = '/src/persistence/database.ts';
    const { db } = await import(path);
    const events = await db.reviewEvents.toArray();
    const m = await db.memoryStates.toArray();
    return {
      grade: events[0]?.scheduling?.grade,
      feeling: events[0]?.subjectiveMastery,
      source: events[0]?.assessmentSource,
      reps: m[0]?.card.reps,
    };
  });
  expect(saved).toEqual({ grade: 1, feeling: 4, source: 'user_checked', reps: 1 });
});
