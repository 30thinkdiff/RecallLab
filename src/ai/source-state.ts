import type { RecallDatabase } from '../persistence/database';
import type { AiSource } from './evidence';
import { ConflictError } from '../domain/revisions';
export async function sourceChanges(db: RecallDatabase, sources: AiSource[], projectId: string) {
  const messages: string[] = [];
  const project = await db.projects.get(projectId);
  if (!project || project.archivedAt) messages.push('项目已不存在或已归档');
  const seen = new Set<string>();
  for (const source of sources) {
    const key = `${source.kind}:${source.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (source.kind === 'document') {
      const current = await db.sourceDocuments.get(source.id),
        old = source.document;
      // Compare the complete source, including OCR/page diagnostics; unchanged selected text is insufficient.
      if (
        !current ||
        !old ||
        current.projectId !== projectId ||
        current.extractedContent !== source.text ||
        stable(current) !== stable(old)
      )
        messages.push('AI 依据的原资料或页面信息已变化，请保留草稿并重新生成');
    } else {
      const item = await db.practiceItems.get(source.id);
      if (
        !item ||
        item.archivedAt ||
        item.projectId !== projectId ||
        item.currentRevisionId !== source.expectedRevisionId ||
        item.standardAnswer !== source.text ||
        item.question !== source.question
      )
        messages.push('已有题目或标准答案版本已变化，请保留草稿并重新生成');
    }
  }
  return [...new Set(messages)];
}
export async function assertCurrentSources(
  db: RecallDatabase,
  sources: AiSource[],
  projectId: string,
) {
  const changes = await sourceChanges(db, sources, projectId);
  if (changes.length) throw new ConflictError(changes.join('；'));
}

function stable(value: unknown) {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
