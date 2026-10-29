import { sourceCriteria } from './units';
import type { AiCandidate } from './generation';
const compact = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[\s\p{P}]/gu, '')
    .toLowerCase();
export function rubricProblems(row: AiCandidate) {
  if (!row.adoptCriteria) return [];
  const required = row.criteria.filter((c) => c.required),
    seen = new Set<string>(),
    problems: string[] = [];
  for (const c of required) {
    const key = compact(c.text);
    if (/^(?:第[一二三四五六七八九十]+|[\d一二三四五六七八九十]+|要点|内容|草稿内容)$/u.test(key))
      problems.push('要点内容只有序号或笼统标签，请写出实际必要内容');
    if (seen.has(key)) problems.push('要点内容重复，请合并或删除重复项');
    seen.add(key);
  }
  return [...new Set(problems)];
}
export function contentCoverage(row: AiCandidate) {
  const clauses = sourceCriteria(row.evidenceQuote).filter((c) => c.importance === 'required');
  const quotes = row.adoptCriteria
    ? row.criteria.filter((c) => c.required).flatMap((c) => c.quotes)
    : [];
  const missing = clauses.filter((c) => !quotes.some((q) => compact(q).includes(compact(c.quote))));
  return { clauses: clauses.length, missing: missing.map((c) => c.text) };
}
