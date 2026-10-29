// @vitest-environment node
/* global process, performance, AbortController, AbortSignal, fetch, console */
import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HttpProvider } from '../src/ai/providers.ts';
import { generateCandidates, candidateEvidence } from '../src/ai/generation.ts';
import { candidateAnswer, duplicateCandidates } from '../src/ai/apply.ts';
import { candidateQualityProblem } from '../src/ai/quality.ts';
import { extractNumbered } from '../src/importing/numbered.ts';
import { planKnowledge } from '../src/ai/units.ts';
it.skipIf(process.env.RECALLLAB_EVALUATE_V052 !== '1')(
  'runs the same 24 reference tasks through rules, standard prompt and source-unit workflow without cherry-picking',
  async () => {
    const raw = await readFile('evaluation/v052/corpus.json', 'utf8'),
      corpus = JSON.parse(raw);
    let report = {
      version: 1,
      at: new Date().toISOString(),
      corpusSha256: createHash('sha256').update(raw).digest('hex'),
      runtime: 'llama.cpp CPU, 2 threads, 8192 context, Q4_K_M',
      model: 'qwen2.5-1.5b-instruct',
      weightsSha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
      temperature: 0,
      actor: 'automated-script',
      independentHumanReview: false,
      realUserCosts: null,
      runs: [],
    };
    const output = process.env.RECALLLAB_EVAL_OUTPUT ?? 'evaluation/v052/run-results.json';
    try {
      const previous = JSON.parse(await readFile(output, 'utf8'));
      if (
        process.env.RECALLLAB_EVAL_RESUME === '1' &&
        previous.corpusSha256 === report.corpusSha256
      )
        report = previous;
    } catch {
      /* A missing output starts a fresh, explicitly scoped run. */
    }
    const strategies = process.env.RECALLLAB_EVAL_STRATEGY
      ? [process.env.RECALLLAB_EVAL_STRATEGY]
      : ['deterministic', 'standard', 'units'];
    const start = Number(process.env.RECALLLAB_EVAL_START ?? 0),
      count = Number(process.env.RECALLLAB_EVAL_COUNT ?? 24);
    for (const strategy of strategies)
      for (const fixture of corpus.cases.slice(start, start + count)) {
        if (report.runs.some((r) => r.caseId === fixture.id && r.strategy === strategy)) continue;
        if (strategy !== 'deterministic') {
          try {
            const health = await fetch('http://127.0.0.1:8089/health', {
              signal: AbortSignal.timeout(3000),
            });
            if (!health.ok) throw Error('not-ready');
          } catch {
            throw Error(
              'Local model is unavailable; batch stopped before classifying absent service as model quality.',
            );
          }
        }
        const began = performance.now();
        let state,
          rows,
          failures = [];
        if (strategy === 'deterministic') {
          const parsed = extractNumbered(fixture.text, [], fixture.id, fixture.id + '.txt');
          rows = parsed.candidates.map((c) => ({
            question: c.question,
            answer: c.standardAnswer,
            quote: c.source.excerpt,
            criteria: [],
            original: null,
            sourceMatched: fixture.text.includes(c.source.excerpt),
            evidenceValid: true,
            unit: null,
            notes: c.reviewNotes ?? [],
          }));
        } else {
          const provider = new HttpProvider({
            kind: 'compatible',
            endpoint: 'http://127.0.0.1:8089/v1',
            model: report.model,
            apiKey: '',
            jsonMode: 'schema',
            strategy,
          });
          state = await generateCandidates(
            [{ kind: 'document', id: fixture.id, text: fixture.text }],
            'extract',
            fixture.goal,
            provider,
            report.model,
            new AbortController().signal,
            () => {},
          );
          failures = state.failures;
          rows = state.candidates.map((c) => ({
            question: c.question,
            answer: candidateAnswer(c, state),
            quote: c.evidenceQuote,
            criteria: c.criteria,
            original: c.original,
            sourceMatched: candidateEvidence(c).match.status === 'matched',
            evidenceValid: candidateEvidence(c).valid,
            unit: c.unit ?? null,
            notes: [...c.notes, ...candidateEvidence(c).notes],
          }));
        }
        const points = fixture.units.flatMap((u) => u.required.map((p) => p.point));
        const required = rows.flatMap((c) => c.criteria.filter((p) => p.required));
        const answerCovered = points.filter((p) => rows.some((c) => c.answer.includes(p)));
        const rubricCovered = points.filter((p) => required.some((c) => c.text.includes(p)));
        const run = {
          caseId: fixture.id,
          strategy,
          elapsedMs: Math.round(performance.now() - began),
          completed: strategy === 'deterministic' || state.status === 'completed',
          plannedUnits: planKnowledge({ kind: 'document', id: fixture.id, text: fixture.text }).map(
            (u) => ({ start: u.start, end: u.end, notForCards: u.notForCards, chapter: u.chapter }),
          ),
          failures,
          rows,
          program: {
            candidates: rows.length,
            sourceMatched: rows.filter((c) => c.sourceMatched).length,
            evidenceAndRubricValid: rows.filter((c) => c.evidenceValid).length,
            questionWarnings: rows.filter((c) =>
              candidateQualityProblem(c.question, c.answer, c.quote),
            ).length,
            referencePoints: points.length,
            answerLiteralCovered: answerCovered.length,
            rubricLiteralCovered: rubricCovered.length,
            missingAnswerPoints: points.filter((p) => !answerCovered.includes(p)),
            missingRubricPoints: points.filter((p) => !rubricCovered.includes(p)),
            exactDuplicates: state
              ? duplicateCandidates(state.candidates, []).size
              : rows.filter((c, i) => rows.findIndex((d) => d.question === c.question) < i).length,
          },
          engineeringReview: null,
        };
        report.runs.push(run);
        await writeFile(output, JSON.stringify(report, null, 2) + '\n');
        console.info(
          `${strategy}/${fixture.id}: ${rows.length} rows / ${failures.length} failures / ${run.elapsedMs} ms`,
        );
      }
    expect(report.runs.length).toBeGreaterThan(0);
  },
  3600000,
);
