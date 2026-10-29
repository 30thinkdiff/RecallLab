import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
const root = 'evaluation/v052/';
const load = async (file) => JSON.parse(await readFile(root + file, 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const corpus = await load('corpus.json');
const original = await load('corpus-v1.json');
const comparable = (value) =>
  value.cases.map((c) => ({
    ...c,
    units: c.units.map(({ optionalExamples, ...unit }) => {
      void optionalExamples;
      return unit;
    }),
  }));
if (JSON.stringify(comparable(corpus)) !== JSON.stringify(comparable(original)))
  throw Error('Reference inputs/required facts changed: do not reuse the recorded model runs.');
const corpusHashes = new Set([
  hash(await readFile(root + 'corpus.json')),
  hash(await readFile(root + 'corpus-v1.json')),
]);
const review = await load('engineering-review.json');
const manifest = [
  ['batch-rules.json', 'deterministic'],
  ['unit-prompt-v1-and-baseline.json', 'standard'],
  ['batch-standard-8.json', 'standard'],
  ['batch-standard-16.json', 'standard'],
  ['final-units.json', 'units'],
];
const runs = [],
  artifacts = [];
for (const [file, strategy] of manifest) {
  const raw = await readFile(root + file, 'utf8'),
    data = JSON.parse(raw);
  if (!corpusHashes.has(data.corpusSha256)) throw Error(`Unknown source corpus hash: ${file}`);
  artifacts.push({ file, sha256: hash(raw), corpusSha256: data.corpusSha256 });
  for (const run of data.runs.filter((r) => r.strategy === strategy)) {
    const editorial = review.reviews.find(
      (r) => r.caseId === run.caseId && r.strategy === strategy,
    );
    if (
      !editorial ||
      editorial.rows.length !== run.rows.length ||
      editorial.rows.some((r, i) => r.question !== run.rows[i].question)
    )
      throw Error(`Review does not match actual output: ${file}/${run.caseId}`);
    runs.push({ ...run, rawFile: file, engineeringReview: editorial });
  }
}
const strategies = ['deterministic', 'standard', 'units'];
const summary = strategies.map((strategy) => {
  const selected = runs.filter((r) => r.strategy === strategy);
  if (
    selected.length !== 24 ||
    new Set(selected.map((r) => r.caseId)).size !== 24 ||
    selected.some((r) => !corpus.cases.some((c) => c.id === r.caseId))
  )
    throw Error(`Expected all 24 cases exactly once for ${strategy}`);
  const rows = selected.flatMap((r) => r.rows),
    assessed = selected.flatMap((r) => r.engineeringReview.rows);
  const add = (key) => selected.reduce((n, r) => n + r.program[key], 0);
  return {
    strategy,
    cases: selected.length,
    completed: selected.filter((r) => r.completed).length,
    casesWithCandidates: selected.filter((r) => r.rows.length).length,
    candidates: rows.length,
    sourceMatched: add('sourceMatched'),
    citationAndRubricValid: add('evidenceAndRubricValid'),
    promptWarnings: add('questionWarnings'),
    referencePoints: add('referencePoints'),
    answerLiteralCovered: add('answerLiteralCovered'),
    rubricLiteralCovered: add('rubricLiteralCovered'),
    elapsedMs: selected.reduce((n, r) => n + r.elapsedMs, 0),
    engineering: {
      readyQuestions: assessed.filter((r) => r.questionVerdict === 'ready').length,
      suggestedQuestionChanges: assessed.filter((r) => r.questionVerdict !== 'ready').length,
      suggestedAnswerChanges: assessed.filter(
        (r) => r.suggestedFieldEdits.answer && r.disposition !== 'skip',
      ).length,
      suggestedRubricChanges: assessed.filter(
        (r) => r.suggestedFieldEdits.rubric && r.disposition !== 'skip',
      ).length,
      duplicateExcess: assessed.filter((r) => r.duplicate).length,
      skip: assessed.filter((r) => r.disposition === 'skip').length,
      noRequiredEditsSuggested: assessed.filter((r) => r.disposition === 'review').length,
      requiredPointsCovered: selected.reduce(
        (n, r) => n + r.engineeringReview.requiredPointsCovered,
        0,
      ),
      rubricPointsCovered: selected.reduce(
        (n, r) => n + r.engineeringReview.rubricPointsCovered,
        0,
      ),
      independentHumanReview: false,
      userConfirmedCount: null,
    },
  };
});
const report = {
  version: 2,
  environment: {
    model: 'qwen2.5-1.5b-instruct',
    runtime: 'existing llama.cpp CPU / 2 threads / 8192 context',
    quantization: 'Q4_K_M',
    temperature: 0,
    weightsSha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  },
  corpusSha256: hash(await readFile(root + 'corpus.json')),
  annotationErratum:
    'Only optional-example boundaries corrected. All 24 texts, goals, required points and other case data unchanged; original snapshot retained.',
  selectionPolicy:
    'A: complete rules batch. B: three complete non-overlapping valid batches after service recovery. C: latest complete 24-case unit workflow run; no per-case best-output selection. Failed/interrupted and prior prompt runs retained separately.',
  limitations: [
    'AI engineering references/review, not independent human gold.',
    'Development corpus also used for prompt/rule refinement; no held-out generalization claim.',
    'Source matching and literal point inclusion do not establish semantic accuracy.',
    'C answers/rubrics are source-derived rules, not model comprehension.',
    'Final complete batches exclude earlier transport/time-out failures from content metrics; consult retained attempts for reliability.',
    'Temperature zero still yielded minor wording differences across repeated CPU runs.',
    'No actual user time or human confirmation rate measured.',
  ],
  artifacts,
  retainedAttempts: [
    'attempt1-infrastructure.json',
    'attempt2-interrupted.json',
    'unit-prompt-v1-and-baseline.json',
    'refined-units-0.json',
    'refined-units-4.json',
  ],
  summary,
  runs,
};
const output = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (
    JSON.stringify(JSON.parse(await readFile(root + 'results.json', 'utf8'))) !==
    JSON.stringify(report)
  )
    throw Error('Published summary is stale.');
} else await writeFile(root + 'results.json', output);
console.info(
  process.argv.includes('--check')
    ? 'V0.5.2: all 72 published comparisons match retained outputs.'
    : JSON.stringify(summary),
);
