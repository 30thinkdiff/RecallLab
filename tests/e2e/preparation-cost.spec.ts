import { test, expect, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const corpus = JSON.parse(
  readFileSync(new URL('../../evaluation/v052/corpus.json', import.meta.url), 'utf8'),
) as typeof import('../../evaluation/v052/corpus.json');
import { sourceCriteria } from '../../src/ai/units';
import { createProject } from './helpers';
const actual = process.env.RECALLLAB_COST_REAL === '1';
const replayPath = 'evaluation/v052/cost-model-replay.json';
const tasks = ['long-answer', 'paragraphs', 'textbook-cn'];
for (const taskId of tasks)
  for (const method of ['manual', 'rule', 'ai'])
    test(`records scripted preparation operations for ${taskId}/${method}, separately from human work`, async ({
      page,
    }, info) => {
      test.setTimeout(120000);
      const fixture = corpus.cases.find((c) => c.id === taskId)!;
      const units = fixture.units;
      const prose = taskId === 'textbook-cn';
      const source = prose
        ? fixture.text
        : units.map((u) => `问题：${u.acceptableQuestions[0]}\n答案：${u.quote}`).join('\n\n');
      const counts = {
        click: 0,
        fill: 0,
        check: 0,
        select: 0,
        file: 0,
        textSelection: 0,
        typedCharacters: 0,
      };
      const click = async (locator: Locator) => {
        counts.click++;
        await locator.click();
      };
      const fill = async (locator: Locator, value: string) => {
        counts.fill++;
        counts.typedCharacters += value.length;
        await locator.fill(value);
      };
      const check = async (locator: Locator) => {
        counts.check++;
        await locator.check();
      };
      const select = async (locator: Locator, value: string) => {
        counts.select++;
        await locator.selectOption(value);
      };
      const criteria = (i: number) =>
        sourceCriteria(units[i]!.quote)
          .filter((c) => c.importance === 'required')
          .map((c) => c.text);
      await page.goto('/#projects');
      await createProject(page, `公开成本基线-${taskId}-${method}`);
      const started = Date.now();
      let modelMs = 0;
      if (method === 'manual') {
        for (const [i, u] of units.entries()) {
          await click(page.getByRole('button', { name: '添加问答题', exact: true }).first());
          await fill(page.getByLabel('问题', { exact: false }), u.acceptableQuestions[0]!);
          await fill(page.getByLabel('标准答案'), u.quote);
          await fill(page.getByLabel('核对要点', { exact: false }), criteria(i).join('\n'));
          await click(page.getByRole('button', { name: '保存题目', exact: true }));
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
      } else {
        await click(
          page
            .getByRole('navigation', { name: '主导航' })
            .getByRole('link', { name: '导入资料', exact: true }),
        );
        counts.file++;
        await page.getByLabel('选择学习资料').setInputFiles({
          name: `public-cost-${taskId}.txt`,
          mimeType: 'text/plain',
          buffer: Buffer.from(source),
        });
        if (prose) {
          await expect(
            page.getByRole('heading', { name: '候选题目（0）', exact: true }),
          ).toBeVisible();
          await check(page.getByLabel('我已核对警告，确认要保存的内容', { exact: true }));
          if (method === 'rule') {
            const area = page.getByLabel('资料原文', { exact: true });
            await area.focus();
            counts.textSelection++;
            await page.keyboard.press('ControlOrMeta+a');
            await area.press('Shift');
            await click(page.getByRole('button', { name: '用选中原文创建问答', exact: true }));
          }
        } else await expect(page.getByLabel('第 1 题问题', { exact: true })).toBeVisible();
        if (method === 'rule') {
          for (const [i, u] of units.entries()) {
            const row = page.getByTestId('import-candidate').nth(i);
            await fill(
              page.getByLabel(`第 ${i + 1} 题问题`, { exact: true }),
              u.acceptableQuestions[0]!,
            );
            await click(row.getByText('提示、核对要点与原文来源', { exact: true }));
            await fill(row.getByLabel('核对要点', { exact: true }), criteria(i).join('\n'));
          }
          await click(
            page.getByRole('button', { name: `确认导入 ${units.length} 道题`, exact: true }),
          );
          await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
        } else {
          if (!prose) await click(page.getByRole('button', { name: '全部取消选择', exact: true }));
          await click(page.getByRole('button', { name: '仅保存资料', exact: true }));
          await click(page.getByRole('link', { name: 'AI 辅助整理', exact: true }));
          await check(page.getByLabel('启用本次 AI 辅助', { exact: true }));
          await select(page.getByLabel('学习目标'), fixture.goal);
          await select(page.getByLabel('引用方式'), 'units');
          let recorded: { task: string; input: string; response: unknown }[] = [];
          if (!actual) recorded = JSON.parse(await readFile(replayPath, 'utf8'));
          await page.route('http://127.0.0.1:8089/v1/chat/completions', async (route) => {
            const began = Date.now(),
              body = route.request().postDataJSON(),
              input = JSON.parse(body.messages[1].content).document_data as string;
            if (actual) {
              const response = await route.fetch({
                timeout: 100000,
                headers: { ...route.request().headers(), origin: 'http://127.0.0.1:5173' },
              });
              const json = await response.json();
              await route.fulfill({ json });
              modelMs += Date.now() - began;
              recorded.push({ task: taskId, input, response: json });
              let previous: typeof recorded = [];
              try {
                previous = JSON.parse(await readFile(replayPath, 'utf8'));
              } catch {
                /* First run has no previous public cost record. */
              }
              await writeFile(
                replayPath,
                JSON.stringify(
                  [
                    ...previous.filter((r) => !(r.task === taskId && r.input === input)),
                    ...recorded.filter((r) => r.input === input),
                  ],
                  null,
                  2,
                ) + '\n',
              );
            } else {
              const saved = recorded.find((r) => r.task === taskId && r.input === input);
              expect(saved, 'recorded real-model unit response must exist').toBeTruthy();
              await route.fulfill({ json: saved!.response });
            }
          });
          await check(page.getByLabel('我已查看发送内容，同意本次发送到上方地址'));
          await click(page.getByRole('button', { name: '生成候选', exact: true }));
          await expect(page.locator('.ai-candidate')).toHaveCount(units.length, {
            timeout: 110000,
          });
          // A fixed end state makes UI comparisons reproducible. This is not a judgement that alternative wording is wrong.
          for (const [i, u] of units.entries()) {
            const row = page.locator('.ai-candidate').nth(i);
            if (i) await click(row.locator('summary').first());
            await fill(row.getByLabel('候选题干'), u.acceptableQuestions[0]!);
            await check(row.getByLabel('选择此候选'));
          }
          await check(page.getByLabel('我已对照原资料', { exact: false }));
          await check(page.getByLabel('我已检查未覆盖原文', { exact: false }));
          await click(page.getByRole('button', { name: '确认保存所选候选', exact: true }));
          await expect(
            page.getByRole('heading', { name: `已确认保存 ${units.length} 条`, exact: true }),
          ).toBeVisible();
        }
      }
      const elapsedMs = Date.now() - started;
      const data = await page.evaluate(async () => {
        const p = '/src/persistence/database.ts';
        const { db } = await import(p);
        return (await db.practiceItems.toArray()).map(
          (c: { standardAnswer: string; answerCriteria: string[] }) => ({
            answer: c.standardAnswer,
            criteria: c.answerCriteria,
          }),
        );
      });
      expect(data).toHaveLength(units.length);
      for (const [i, u] of units.entries()) {
        const saved = data.find(
          (c: { answer: string; criteria: string[] }) => c.answer === u.quote,
        );
        expect(saved).toBeTruthy();
        expect(saved!.criteria).toEqual(criteria(i));
      }
      const record = {
        taskId,
        method,
        actor: 'automated-script',
        sourceQuestionsPreprovided: !prose,
        measuredAt: new Date(started).toISOString(),
        learningGoal: fixture.goal,
        excluded:
          'Project creation, material authoring, human reading and reasoning; fixed reference wording may overestimate editing.',
        requestTransport:
          method === 'ai'
            ? actual
              ? 'local test proxy to existing model; production CORS unchanged'
              : 'frozen recorded response replay; no model request'
            : 'not applicable',
        realModel: actual && method === 'ai',
        modelReplay: !actual && method === 'ai',
        elapsedMs,
        modelMs,
        counts,
        cards: units.length,
        referenceNormalization:
          'All questions forced to a fixed acceptable reference for reproducibility; alternative valid phrasing may not need these edits.',
        humanReadingAndJudgementTime: null,
        realUserTime: null,
        sourceTraceability:
          method === 'manual'
            ? 'manual cards do not automatically retain document positions'
            : 'document-linked',
      };
      await info.attach('scripted-preparation-cost.json', {
        body: JSON.stringify(record),
        contentType: 'application/json',
      });
      if (actual) {
        let rows: { taskId: string; method: string }[] = [];
        try {
          rows = JSON.parse(await readFile('evaluation/v052/cost-results.json', 'utf8'));
        } catch {
          /* First run has no previous public cost record. */
        }
        await writeFile(
          'evaluation/v052/cost-results.json',
          JSON.stringify(
            [...rows.filter((r) => r.taskId !== taskId || r.method !== method), record],
            null,
            2,
          ) + '\n',
        );
      }
      console.log(JSON.stringify(record));
    });
