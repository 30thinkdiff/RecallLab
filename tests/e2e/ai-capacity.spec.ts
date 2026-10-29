import { test, expect } from '@playwright/test';
import { seedScale } from '../support/scale';
test('measures AI provenance and canonical draft overhead alongside 1000 cards and 10000 events, then restores full backup', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto('/#projects');
  await seedScale(page, 1000);
  const measurements = await page.evaluate(async () => {
    const d = '/src/persistence/database.ts',
      r = '/src/persistence/repository.ts',
      b = '/src/persistence/backup.ts',
      g = '/src/ai/generation.ts',
      p = '/src/ai/providers.ts',
      a = '/src/ai/apply.ts',
      draft = '/src/ai/drafts-store.ts',
      portable = '/src/persistence/portable-backup.ts';
    const { db } = await import(d),
      { repository } = await import(r),
      { exportBackup, restoreBackup } = await import(b),
      { portableBackup, parsePortableBackup } = await import(portable),
      { generateCandidates } = await import(g),
      { MockProvider } = await import(p),
      { confirmCandidates } = await import(a),
      { saveAiDraft } = await import(draft);
    const byteLength = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;
    const baseline = await exportBackup(db),
      baselineBytes = byteLength(baseline);
    const pid = baseline.data.projects[0].id;
    const text =
      '蓝晶归档要求核对来源、保留原文和位置，所有修改须记录版本编号与原因。' +
      Array.from(
        { length: 3 },
        (_, i) =>
          `本段为第 ${i + 1} 段公开虚构中英文资料 Chinese English 🙂，不能据此推断第 ${i + 1} 类真实个人能力。`,
      ).join('');
    const doc = {
      id: crypto.randomUUID(),
      projectId: pid,
      filename: 'public-capacity.txt',
      fileType: 'txt',
      sourceHash: 'a'.repeat(64),
      byteLength: new TextEncoder().encode(text).length,
      extractedContent: text,
      pages: [],
      sections: [],
      warnings: [],
      extractionStatus: 'ready',
      parserVersion: 'capacity',
      importDigest: 'b'.repeat(64),
      initialItemIds: [],
      importedAt: new Date().toISOString(),
    };
    await db.sourceDocuments.add(doc);
    const source = { kind: 'document', id: doc.id, text, document: doc };
    const template = await generateCandidates(
      [source],
      'extract',
      'verbatim',
      new MockProvider(),
      'mock',
      new AbortController().signal,
      () => {},
    );
    for (let batch = 0; batch < 20; batch++) {
      const state = structuredClone(template);
      state.id = crypto.randomUUID();
      state.candidates = Array.from({ length: 50 }, (_, i) => ({
        ...structuredClone(template.candidates[0]),
        id: crypto.randomUUID(),
        question: `公开 AI 容量题 ${batch * 50 + i + 1}：归档应遵守哪些要求？`,
        selected: true,
      }));
      await confirmCandidates(repository, pid, state, {
        humanReviewed: true,
        completenessReviewed: true,
      });
    }
    const withProvenance = await exportBackup(db),
      provenanceBytes = byteLength(withProvenance);
    for (let batch = 0; batch < 20; batch++) {
      const state = structuredClone(template);
      state.id = crypto.randomUUID();
      await saveAiDraft(
        db,
        `capacity/${batch}`,
        pid,
        state,
        [source],
        {
          kind: 'mock',
          endpoint: '',
          model: 'mock',
          apiKey: 'fictional-not-saved',
          jsonMode: 'schema',
        },
        null,
        'capacity-tab',
      );
    }
    const before = await exportBackup(db),
      compact = JSON.stringify(before);
    const bytes = new TextEncoder().encode(compact).length,
      prettyBytes = new TextEncoder().encode(JSON.stringify(before, null, 2)).length;
    const largeText = '公开虚构的大型原文 Chinese English。'.repeat(180000);
    await db.sourceDocuments.add({
      ...doc,
      id: crypto.randomUUID(),
      filename: 'public-large-source.txt',
      extractedContent: largeText,
      byteLength: new TextEncoder().encode(largeText).length,
    });
    const largeBefore = await exportBackup(db),
      largeLogicalBytes = byteLength(largeBefore),
      packed = await portableBackup(largeBefore);
    const start = performance.now();
    await restoreBackup(db, await parsePortableBackup(JSON.stringify(packed.value)));
    const after = await exportBackup(db);
    return {
      largeLogicalBytes,
      portableFileBytes: packed.fileBytes,
      pooled: packed.pooled,
      sourcesExact:
        JSON.stringify(largeBefore.data.sourceDocuments) ===
        JSON.stringify(after.data.sourceDocuments),
      baselineBytes,
      provenanceBytes,
      bytes,
      prettyBytes,
      addedProvenanceBytes: provenanceBytes - baselineBytes,
      draftBytes: before.data.aiDrafts.reduce(
        (n: number, row: { bytesStored: number }) => n + row.bytesStored,
        0,
      ),
      cards: before.data.practiceItems.length,
      aiCards: before.data.practiceItems.filter((c: { aiProvenance?: unknown }) => c.aiProvenance)
        .length,
      events: before.data.reviewEvents.length,
      draftCount: after.data.aiDrafts.length,
      originalHistoryAndStatesExact: [
        'reviewEvents',
        'practiceItems',
        'revisions',
        'memoryStates',
        'schedulingLogs',
      ].every((key) => JSON.stringify(before.data[key]) === JSON.stringify(after.data[key])),
      secretAbsent: !compact.includes('fictional-not-saved'),
      restoreAndExportMs: Math.round(performance.now() - start),
      draftEpochsChanged: before.data.aiDrafts.every(
        (row: { id: string; epoch: string }) =>
          after.data.aiDrafts.find((next: { id: string }) => next.id === row.id).epoch !==
          row.epoch,
      ),
    };
  });
  expect(measurements.aiCards).toBe(1000);
  expect(measurements.events).toBe(10000);
  expect(measurements.cards).toBe(2000);
  expect(measurements.draftCount).toBe(20);
  expect(measurements.originalHistoryAndStatesExact).toBe(true);
  expect(measurements.draftEpochsChanged).toBe(true);
  expect(measurements.secretAbsent).toBe(true);
  expect(measurements.bytes).toBeLessThan(50 * 1024 ** 2);
  expect(measurements.largeLogicalBytes).toBeGreaterThan(50 * 1024 ** 2);
  expect(measurements.largeLogicalBytes).toBeLessThan(128 * 1024 ** 2);
  expect(measurements.portableFileBytes).toBeLessThan(50 * 1024 ** 2);
  expect(measurements.pooled).toBe(true);
  expect(measurements.sourcesExact).toBe(true);
  await info.attach('ai-capacity-measurements.json', {
    body: JSON.stringify(measurements),
    contentType: 'application/json',
  });
  console.log(JSON.stringify(measurements));
});
