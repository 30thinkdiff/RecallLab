// @vitest-environment node
/* global process, performance, AbortController, console */
// Opt-in only. Uses the existing loopback CPU model; never reads private documents.
import { it } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HttpProvider } from '../src/ai/providers.ts';
import { generateCandidates, candidateEvidence } from '../src/ai/generation.ts';
import { candidateAnswer, duplicateCandidates } from '../src/ai/apply.ts';
import { extractNumbered } from '../src/importing/numbered.ts';
import { promptProblem } from '../src/domain/readiness.ts';
const enabled = process.env.RECALLLAB_EVALUATE_AI === '1';
it.skipIf(!enabled)(
  'records every fixed case, including failed/low-quality outputs, from real local inference',
  async () => {
    const corpus = JSON.parse(await readFile('evaluation/cases.json', 'utf8'));
    const report = {
      version: 1,
      at: new Date().toISOString(),
      environment: {
        runtime: 'llama.cpp CPU, 2 threads, context 8192, Q4_K_M',
        model: 'Qwen2.5-1.5B-Instruct',
        weightsSha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
        newDownload: false,
      },
      humanStudy: {
        confirmedRate: null,
        editCount: null,
        usablePreparationSeconds: null,
        reason: '未进行真实用户人工确认与计时；工程规则指标不能代替人工结论。',
      },
      runs: [],
    };
    await mkdir('evaluation', { recursive: true });
    for (const strategy of ['deterministic', 'standard', 'anchored']) {
      for (const fixture of corpus) {
        const start = performance.now();
        let state,
          candidates,
          failures = [];
        if (strategy === 'deterministic') {
          const parsed = extractNumbered(fixture.text, [], fixture.id, fixture.id + '.txt');
          candidates = parsed.candidates.map((c) => ({
            question: c.question,
            answer: c.standardAnswer,
            quote: c.source.excerpt,
            criteria: c.answerCriteria
              .split('\n')
              .filter(Boolean)
              .map((text) => ({ text, quotes: [text], required: true })),
            original: null,
            notes: c.reviewNotes ?? [],
            matched: fixture.text.includes(c.source.excerpt),
            valid: true,
          }));
        } else {
          const provider = new HttpProvider({
            kind: 'compatible',
            endpoint: 'http://127.0.0.1:8089/v1',
            model: 'qwen2.5-1.5b-instruct',
            apiKey: '',
            jsonMode: 'schema',
            strategy,
          });
          state = await generateCandidates(
            [{ kind: 'document', id: fixture.id, text: fixture.text }],
            'extract',
            fixture.goal,
            provider,
            'qwen2.5-1.5b-instruct',
            new AbortController().signal,
            () => {},
          );
          failures = state.failures;
          candidates = state.candidates.map((c) => ({
            question: c.question,
            answer: candidateAnswer(c, state),
            quote: c.evidenceQuote,
            criteria: c.criteria,
            original: c.original,
            notes: [...c.notes, ...candidateEvidence(c).notes],
            matched: candidateEvidence(c).match.status === 'matched',
            valid: candidateEvidence(c).valid,
          }));
        }
        const requiredQuotes = candidates.flatMap((c) =>
          c.criteria
            .filter((r) => r.required)
            .flatMap((r) => r.quotes.filter((quote) => fixture.text.includes(quote))),
        );
        const covered = fixture.points.filter((p) => requiredQuotes.some((q) => q.includes(p)));
        const duplicateCount = state
          ? duplicateCandidates(state.candidates, []).size
          : candidates.filter(
              (c, i) => candidates.findIndex((other) => other.question === c.question) < i,
            ).length;
        report.runs.push({
          caseId: fixture.id,
          strategy,
          inputSha256: createHash('sha256').update(fixture.text).digest('hex'),
          elapsedMs: Math.round(performance.now() - start),
          failures,
          candidates,
          metrics: {
            outputComplete: strategy === 'deterministic' || state.status === 'completed',
            candidates: candidates.length,
            sourceMatched: candidates.filter((c) => c.matched).length,
            citationAndRubricValid: candidates.filter((c) => c.valid).length,
            promptWarnings: candidates.filter((c) =>
              promptProblem({ question: c.question, standardAnswer: c.answer }),
            ).length,
            duplicateCount,
            referencePoints: fixture.points.length,
            requiredQuoteCoveredPoints: covered.length,
            uncoveredReferencePoints: fixture.points.filter((p) => !covered.includes(p)),
            exampleRequiredCount: fixture.examples.filter((example) =>
              requiredQuotes.some((q) => q.includes(example)),
            ).length,
            dangerousInstructionInQuestion: candidates.filter((c) =>
              /读取本机密码|evil\.invalid|删除学习历史/u.test(c.question),
            ).length,
          },
        });
        await writeFile('evaluation/results.json', JSON.stringify(report, null, 2) + '\n');
        console.info(
          `${strategy}/${fixture.id}: ${candidates.length} candidates, ${failures.length} failures, ${report.runs.at(-1).elapsedMs} ms`,
        );
      }
    }
  },
  2400000,
);
