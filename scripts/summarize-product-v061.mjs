import { URL } from 'node:url';
import console from 'node:console';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
const directory = new URL('../evaluation/v061/', import.meta.url);
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[1], min: sorted[0], max: sorted[2], values };
};
async function summarize(phase) {
  const files = [0, 1, 2].map((i) => `${phase}-${i}.json`);
  const rows = await Promise.all(
    files.map(async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))),
  );
  if (
    rows.some(
      (row) =>
        row.phase !== phase ||
        row.codeSnapshot !== rows[0].codeSnapshot ||
        JSON.stringify(row.preparationQuality) !== JSON.stringify(rows[0].preparationQuality),
    )
  )
    throw new Error('Review inconsistent experiment snapshots/quality before summarizing.');
  return {
    files,
    codeSnapshot: rows[0].codeSnapshot,
    browser: rows[0].browser,
    viewport: rows[0].viewport,
    timezone: rows[0].timezone,
    firstQuestionMs: stats(rows.map((r) => r.firstQuestionMs)),
    firstSavedMs: stats(rows.map((r) => r.firstSavedMs)),
    counts: Object.fromEntries(
      Object.keys(rows[0].counts).map((key) => [key, stats(rows.map((r) => r.counts[key]))]),
    ),
    resumeOperations: stats(rows.map((r) => r.resumeOperations)),
    preparationQuality: rows[0].preparationQuality,
  };
}
const report = {
  version: 1,
  date: '2026-10-30',
  actor: 'Playwright, not a real learner',
  conditions:
    'Same public fictional 69 short-answer entries; exam goal, seven days, thirty minutes; isolated baseline archive and current app; no AI.',
  baseline: await summarize('baseline'),
  candidate: await summarize('candidate'),
  limitations: [
    'Single Linux host; three runs per condition; background load not rigorously controlled.',
    'Script timing excludes human reading, judgment and recall. No demonstrated improvement in learning outcomes.',
    'Literal source/fixture checks are not independent human semantic assessment.',
    'Not an authenticated competitive end-to-end speed comparison.',
  ],
};
const output = new URL('summary.json', directory);
if (process.argv.includes('--check')) {
  if (JSON.stringify(JSON.parse(await readFile(output, 'utf8'))) !== JSON.stringify(report))
    throw new Error('Regenerate V0.6.1 product summary.');
} else await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log('V0.6.1 measured product summary is consistent.');
