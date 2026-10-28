import { test, expect } from '@playwright/test';
import { seedScale } from '../support/scale';
for (const count of [100, 1000])
  test(`${count} fictional cards, four projects and long histories retain backups and responsive study drafts`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.goto('/#projects');
    const seeded = await seedScale(page, count);
    expect(seeded.cards).toBe(count);
    expect(seeded.events).toBe(count * 10);
    expect(seeded.revisions).toBe(count * 2);
    const before = Date.now();
    await page.goto(`/#project/${seeded.projectIds[0]}`);
    await expect(page.locator('.library-card').first()).toBeVisible();
    const projectReadyMs = Date.now() - before;
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '先回忆，再看答案。', exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const p = '/src/persistence/database.ts';
      const { db } = await import(p);
      const original = db.reviewEvents.toArray.bind(db.reviewEvents);
      (globalThis as typeof globalThis & { scaleFullHistoryReads: number }).scaleFullHistoryReads =
        0;
      db.reviewEvents.toArray = () => {
        (globalThis as typeof globalThis & { scaleFullHistoryReads: number })
          .scaleFullHistoryReads++;
        return original();
      };
    });
    await page.getByRole('button', { name: '输入作答', exact: true }).click();
    await page.getByLabel('你的回答').fill('公开规模验收回答');
    await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
    await page.waitForTimeout(250);
    const reads = await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { scaleFullHistoryReads: number }).scaleFullHistoryReads,
    );
    expect(reads).toBe(0);
    const roundtrip = await page.evaluate(async () => {
      const d = '/src/persistence/database.ts',
        b = '/src/persistence/backup.ts';
      const { db } = await import(d),
        { exportBackup, restoreBackup } = await import(b);
      const before = await exportBackup(db);
      const start = performance.now();
      await restoreBackup(db, before);
      const after = await exportBackup(db);
      return {
        ms: Math.round(performance.now() - start),
        exact: [
          'practiceItems',
          'reviewEvents',
          'revisions',
          'memoryStates',
          'schedulingLogs',
        ].every((k) => JSON.stringify(before.data[k]) === JSON.stringify(after.data[k])),
      };
    });
    expect(roundtrip.exact).toBe(true);
    const measurements = {
      ...seeded,
      projectReadyMs,
      fullHistoryReadsDuringDraft: reads,
      restoreAndExportMs: roundtrip.ms,
    };
    console.log(JSON.stringify(measurements));
    await testInfo.attach('fictional-scale-measurements.json', {
      body: JSON.stringify(measurements),
      contentType: 'application/json',
    });
  });
