import type { Repository } from '../persistence/repository';
import { cardInputSchema, projectInputSchema, type ProjectInput } from '../domain/validation';
import { sourceDocumentSchema } from '../persistence/backup-format';
import { assertSourceReference } from '../domain/sources';
import type { SourceDocument } from '../domain/models';
import { sha256 } from './text';
import { MAX_CARDS, duplicateReasons, type ImportCandidate, type ParsedMaterial } from './types';

export type ImportTarget = { projectId: string } | { newProject: ProjectInput };
export async function commitImport(
  repo: Repository,
  material: ParsedMaterial,
  rows: ImportCandidate[],
  target: ImportTarget,
  allowDuplicates = false,
  reviewedWarnings = false,
) {
  if (
    material.document.fileType === 'pdf' &&
    !material.document.pages.some((p) => p.status !== 'failed' && p.text.trim())
  )
    throw new Error('PDF 没有可保存的文字，请先完成文字提取或本地 OCR。');
  if (rows.length > MAX_CARDS) throw new Error(`单次最多导入 ${MAX_CARDS} 道题`);
  const selected = rows.filter((row) => row.selected);
  const inputs = selected.map((row) => cardInputSchema.parse(row));
  if (material.document.warnings.length && !reviewedWarnings)
    throw new Error('请先核对提取警告，再确认保存资料');
  const normalizedTarget =
    'projectId' in target ? target : { newProject: projectInputSchema.parse(target.newProject) };
  const digest = await sha256(
    new TextEncoder().encode(
      JSON.stringify({
        material: material.document,
        rows: selected.map((row, index) => ({ input: inputs[index], source: row.source })),
        target: normalizedTarget,
      }),
    ),
  );
  return repo.db.transaction('rw', repo.db.tables, async () => {
    const previous = await repo.db.sourceDocuments.get(material.document.id);
    if (previous) {
      if (previous.importDigest !== digest)
        throw new Error('这次导入已保存。若要再次导入，请重新选择文件。');
      return {
        projectId: previous.projectId,
        documentId: previous.id,
        itemIds: previous.initialItemIds,
        skipped: rows.length - selected.length,
      };
    }
    const projectId =
      'projectId' in normalizedTarget
        ? normalizedTarget.projectId
        : await repo.saveProject(normalizedTarget.newProject);
    const project = await repo.db.projects.get(projectId);
    if (!project || project.archivedAt) throw new Error('目标项目已归档或不存在，请重新选择');
    const document: SourceDocument = sourceDocumentSchema.parse({
      ...material.document,
      projectId,
      importedAt: new Date().toISOString(),
      importDigest: digest,
      initialItemIds: [],
    });
    const existing = await repo.db.practiceItems.where('projectId').equals(projectId).toArray();
    if (!allowDuplicates && duplicateReasons(selected, existing).size)
      throw new Error('发现重复或同题不同答案。请在预览中跳过，或明确确认仍要导入；不会覆盖旧题。');
    for (const row of selected) assertSourceReference(row.source, document, projectId);
    await repo.db.sourceDocuments.add(document);
    const itemIds: string[] = [];
    for (let index = 0; index < selected.length; index++)
      itemIds.push(
        await repo.saveCard(projectId, inputs[index]!, undefined, undefined, [
          selected[index]!.source,
        ]),
      );
    await repo.db.sourceDocuments.put({ ...document, initialItemIds: itemIds });
    return { projectId, documentId: document.id, itemIds, skipped: rows.length - selected.length };
  });
}
