import type { PracticeSnapshot } from '../../src/domain/models';
import type { Page } from '@playwright/test';
export async function seedScale(page: Page, count: number, rounds = 10) {
  return page.evaluate(
    async ({ count, rounds }) => {
      const d = '/src/persistence/database.ts',
        r = '/src/persistence/repository.ts',
        v = '/src/domain/revisions.ts',
        review = '/src/domain/review.ts',
        b = '/src/persistence/backup.ts';
      const { db } = await import(d),
        { repository } = await import(r),
        { snapshotOf } = await import(v),
        { freshDraft, buildReviewEvent } = await import(review),
        { exportBackup } = await import(b);
      const began = performance.now();
      const projectIds: string[] = [];
      await db.transaction('rw', db.tables, async () => {
        for (let p = 0; p < 4; p++)
          projectIds.push(
            await repository.saveProject({
              name: `虚构规模项目 ${p + 1}`,
              description: '中英文性能验收',
              learningGoal: '核对两个必要内容',
              targetDate: '',
              dailyTimeBudget: 30,
              newCardLimit: 10,
            }),
          );
        for (let i = 0; i < count; i++) {
          const input = {
            question: `虚构规模条目 ${i + 1} 的两个要求是什么？`,
            standardAnswer:
              i < 10
                ? '公开虚构长答案 Chinese English 🙂。'.repeat(100)
                : '公开虚构答案，包含甲与乙两个必要内容 Chinese English 🙂。',
            answerCriteria: '甲\n乙',
            hints: '回想第一项',
            mnemonics: '',
            confusionWarnings: '',
            sourceLabel: '自行生成公开规模资料',
          };
          const id = await repository.saveCard(projectIds[i % 4]!, input);
          const c = await db.practiceItems.get(id);
          await repository.saveCard(
            c.projectId,
            { ...input, standardAnswer: input.standardAnswer.replace('公开虚构', '公开 虚构') },
            id,
            {
              expectedRevisionId: c.currentRevisionId,
              changeType: 'cosmetic',
              changeSummary: '仅插入空白的虚构修订',
              impactOnLearningState: 'preserve',
            },
          );
        }
        for (const [p, projectId] of projectIds.entries()) {
          const cards = await db.practiceItems.where('projectId').equals(projectId).toArray();
          for (let round = 0; round < rounds; round++) {
            const timestamp = new Date(Date.UTC(2026, 8, 1 + round, 8)).toISOString(),
              queue = cards.map(snapshotOf);
            const session = {
              id: `scale-session-${p}-${round}`,
              projectId,
              queue,
              index: queue.length,
              status: 'completed',
              createdAt: timestamp,
              completedAt: timestamp,
              draft: freshDraft(timestamp, 'typed'),
              generation: `scale-${p}-${round}`,
              planVersion: 1,
              draftVersion: 1,
            };
            await db.sessions.add(session);
            const events = queue.map((snap: PracticeSnapshot, index: number) =>
              buildReviewEvent(
                {
                  ...session,
                  index,
                  draft: {
                    ...freshDraft(timestamp, 'typed'),
                    userResponse: '公开虚构回答：甲与乙。',
                    wasAnswerRevealed: true,
                    revealedAt: timestamp,
                  },
                },
                snap,
                index % 7 === 0 ? 'incorrect' : 'correct',
                index % 7 === 0 ? 4 : 3,
                timestamp,
              ),
            );
            await db.reviewEvents.bulkAdd(events);
          }
        }
      });
      const backup = await exportBackup(db);
      return {
        projectIds,
        seedAndValidationMs: Math.round(performance.now() - began),
        cards: backup.data.practiceItems.length,
        events: backup.data.reviewEvents.length,
        revisions: backup.data.revisions.length,
        backupBytes: new Blob([JSON.stringify(backup)]).size,
      };
    },
    { count, rounds },
  );
}
