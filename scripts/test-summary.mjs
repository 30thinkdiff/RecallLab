import { readFile, appendFile } from 'node:fs/promises';
import process from 'node:process';
let summary = `## RecallLab browser verification\n\nCommit: ${process.env.RECALLLAB_REVIEW_SHA ?? process.env.GITHUB_SHA ?? 'local'}\n\n`;
try {
  const report = JSON.parse(await readFile('test-results/results.json', 'utf8'));
  const stats = report.stats;
  summary += `Passed: ${stats.expected}; Failed: ${stats.unexpected}; Flaky: ${stats.flaky}; Skipped: ${stats.skipped}.\n\n`;
  const failures = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? [])
          if (result.status === 'failed' || result.status === 'timedOut') {
            failures.push(
              `${spec.file}:${spec.line} — ${spec.title}\n${result.error?.message ?? result.status}`,
            );
          }
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  if (failures.length)
    summary +=
      'Failures (full logs, screenshots and traces in the attached report):\n\n' +
      failures.map((value) => '```text\n' + value.replaceAll('```', '') + '\n```').join('\n') +
      '\n';
  summary +=
    '\nDownload the commit-associated Playwright artifact for the HTML report. All fixtures are fictional and isolated from the daily database.\n';
} catch {
  summary +=
    'No browser report was produced. Inspect the preceding setup/type/lint/unit/build steps; this does not mean the tests passed.\n';
}
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
else process.stdout.write(summary);
