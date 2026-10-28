// @vitest-environment node
/* global process */
import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { locateQuote } from '../src/ai/evidence.ts';
import { candidateQualityProblem } from '../src/ai/quality.ts';
it.skipIf(process.env.RECALLLAB_SUMMARIZE_AI !== '1')(
  'derives source/quality flags without changing raw model output or inventing human scores',
  async () => {
    const corpus = JSON.parse(await readFile('evaluation/cases.json', 'utf8'));
    const report = JSON.parse(await readFile('evaluation/results.json', 'utf8'));
    expect(report.runs).toHaveLength(30);
    const rawHash = createHash('sha256')
      .update(JSON.stringify(report.runs.map((r) => r.candidates.map((c) => c.original))))
      .digest('hex');
    report.analysis = {
      version: 1,
      rawModelOutputsSha256: rawHash,
      description:
        '来源匹配、字面覆盖和规则提示为程序检查，非语义评分。引用覆盖不证明要点表述完整。原始模型输出 original 不变。',
    };
    for (const run of report.runs) {
      const fixture = corpus.find((c) => c.id === run.caseId);
      for (const c of run.candidates) {
        const match = locateQuote(fixture.text, c.quote);
        if (fixture.goal === 'verbatim' && match.status === 'matched')
          c.answer = match.anchor.quote;
      }
      const required = run.candidates.flatMap((c) => c.criteria.filter((p) => p.required));
      const quotes = required
        .flatMap((p) => p.quotes)
        .filter((q) => locateQuote(fixture.text, q).status === 'matched');
      run.metrics.requiredQuoteCoveredPoints = fixture.points.filter((p) =>
        quotes.some((q) => q.includes(p)),
      ).length;
      run.metrics.requiredTextCoveredPoints = fixture.points.filter((p) =>
        required.some((q) => q.text.includes(p)),
      ).length;
      run.metrics.promptWarnings = run.candidates.filter((c) =>
        candidateQualityProblem(c.question, c.answer, c.quote),
      ).length;
      run.metrics.exampleRequiredCount = fixture.examples.filter((p) =>
        quotes.some((q) => q.includes(p)),
      ).length;
    }
    report.summary = ['deterministic', 'standard', 'anchored'].map((strategy) => {
      const runs = report.runs.filter((r) => r.strategy === strategy);
      return {
        strategy,
        cases: runs.length,
        completed: runs.filter((r) => r.metrics.outputComplete).length,
        candidates: runs.reduce((n, r) => n + r.metrics.candidates, 0),
        sourceMatched: runs.reduce((n, r) => n + r.metrics.sourceMatched, 0),
        citationAndRubricValid: runs.reduce((n, r) => n + r.metrics.citationAndRubricValid, 0),
        promptWarnings: runs.reduce((n, r) => n + r.metrics.promptWarnings, 0),
        referencePoints: runs.reduce((n, r) => n + r.metrics.referencePoints, 0),
        quoteCovered: runs.reduce((n, r) => n + r.metrics.requiredQuoteCoveredPoints, 0),
        criterionTextCovered: runs.reduce((n, r) => n + r.metrics.requiredTextCoveredPoints, 0),
        exampleQuoteWarnings: runs.reduce((n, r) => n + r.metrics.exampleRequiredCount, 0),
        exactDuplicates: runs.reduce((n, r) => n + r.metrics.duplicateCount, 0),
        elapsedMs: runs.reduce((n, r) => n + r.elapsedMs, 0),
      };
    });
    expect(
      createHash('sha256')
        .update(JSON.stringify(report.runs.map((r) => r.candidates.map((c) => c.original))))
        .digest('hex'),
    ).toBe(rawHash);
    await writeFile('evaluation/results.json', JSON.stringify(report, null, 2) + '\n');
  },
);
