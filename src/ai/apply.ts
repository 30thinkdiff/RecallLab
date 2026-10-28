import type { Repository } from '../persistence/repository';
import type { PracticeItem } from '../domain/models';
import { cardInputSchema, lines } from '../domain/validation';
import { ConflictError } from '../domain/revisions';
import { normalizedQuestion } from '../importing/types';
import { promptProblem } from '../domain/readiness';
import { candidateEvidence, type AiCandidate, type GenerationState } from './generation';
import { locateQuote, referenceFor } from './evidence';
import type { AiConfirmation, EvidenceAnchor } from './provenance';

export function candidateAnswer(row: AiCandidate, state: GenerationState) {
  return row.source.kind === 'answer'
    ? row.source.text
    : state.objective === 'verbatim'
      ? row.evidenceQuote.trim()
      : row.answerSuggestion.trim();
}
export function duplicateCandidates(rows: AiCandidate[], cards: PracticeItem[]) {
  const seen = new Set(
    cards.filter((c) => !c.archivedAt).map((c) => normalizedQuestion(c.question)),
  );
  const duplicates = new Set<string>();
  for (const row of rows) {
    const key = normalizedQuestion(row.question);
    if (row.source.kind === 'document' && seen.has(key)) duplicates.add(row.id);
    seen.add(key);
  }
  return duplicates;
}
export function generationMetrics(state: GenerationState, cards: PracticeItem[], confirmed = 0) {
  const matches = state.candidates.filter((c) => candidateEvidence(c).match.status === 'matched');
  return {
    candidates: state.candidates.length,
    sourceMatched: matches.length,
    missingSource: state.candidates.length - matches.length,
    duplicates: duplicateCandidates(state.candidates, cards).size,
    confirmed,
    edited: state.candidates.filter(
      (c) =>
        c.question !== c.original[0]?.question ||
        c.answerSuggestion !== c.original[0]?.answerSuggestion ||
        JSON.stringify(c.criteria.map((d) => d.text)) !==
          JSON.stringify(c.original.flatMap((o) => o.criteria.map((d) => d.text))),
    ).length,
    elapsedMs: Math.max(0, Date.now() - Date.parse(state.startedAt)),
  };
}
// No inference/network awaits inside this transaction. Every selected row succeeds or all roll back.
export async function confirmCandidates(
  repo: Repository,
  projectId: string,
  state: GenerationState,
  acknowledgements: { humanReviewed: boolean; completenessReviewed: boolean },
) {
  if (!acknowledgements.humanReviewed || !acknowledgements.completenessReviewed)
    throw new Error('请先核对原文、答案和必需要点，并确认完整性；引用匹配不代表语义正确。');
  if (state.status === 'running') throw new Error('请先完成或取消生成再确认。');
  const selected = state.candidates.filter((c) => c.selected);
  if (!selected.length || selected.length > 50) throw new Error('请选择 1—50 条候选');
  return repo.db.transaction('rw', repo.db.tables, async () => {
    const cards = await repo.db.practiceItems.where('projectId').equals(projectId).toArray();
    const duplicate = duplicateCandidates(selected, cards);
    const metrics = generationMetrics(state, cards, selected.length);
    const ids: string[] = [];
    const targets = new Set<string>();
    for (const row of selected) {
      if (
        cards.some(
          (c) => c.aiProvenance?.runId === state.id && c.aiProvenance.candidateId === row.id,
        )
      )
        throw new ConflictError('此候选已确认，请返回题库查看，不能重复提交。');
      if (duplicate.has(row.id))
        throw new Error('候选题干与已有或本批题目重复，请取消选择或改写。');
      const evidence = candidateEvidence(row);
      if (!evidence.valid || evidence.match.status !== 'matched')
        throw new Error('来源不足或要点引用无效，请修正后确认。');
      const old =
        row.source.kind === 'answer' ? cards.find((c) => c.id === row.source.id) : undefined;
      if (row.source.kind === 'answer') {
        if (
          !old ||
          old.archivedAt ||
          old.currentRevisionId !== row.source.expectedRevisionId ||
          old.standardAnswer !== row.source.text ||
          targets.has(old.id)
        )
          throw new ConflictError('题目或标准答案已变化，请保留候选并重新核对。');
        targets.add(old.id);
      } else if (!row.source.document || row.source.document.projectId !== projectId)
        throw new Error('原资料不属于此学习项目');
      const acceptedCriteria = row.adoptCriteria
        ? row.criteria
            .filter((c) => c.required)
            .map((c) => {
              const text = c.text.replace(/\s+/g, ' ').trim();
              if (!text || !c.quotes.length) throw new Error('每个必需要点都需要内容和原文依据');
              const anchors: EvidenceAnchor[] = c.quotes.map((quote) => {
                const match = locateQuote(
                  row.source.text,
                  quote,
                  row.source.kind === 'document'
                    ? evidence.match.status === 'matched'
                      ? evidence.match.anchor.start
                      : 0
                    : 0,
                  row.source.kind === 'document'
                    ? evidence.match.status === 'matched'
                      ? evidence.match.anchor.end
                      : 0
                    : row.source.text.length,
                );
                if (match.status !== 'matched') throw new Error('要点引用不能唯一定位');
                return match.anchor;
              });
              return { text, anchors };
            })
        : [];
      if (new Set(acceptedCriteria.map((c) => c.text)).size !== acceptedCriteria.length)
        throw new Error('存在重复必需要点，请合并或删除');
      const input = cardInputSchema.parse({
        question: row.question,
        standardAnswer: candidateAnswer(row, state),
        answerCriteria: row.adoptCriteria
          ? acceptedCriteria.map((c) => c.text).join('\n')
          : (old?.answerCriteria.join('\n') ?? ''),
        // New suggestions stay separate from the standard answer. Existing explanations are retained.
        hints: old?.hints.join('\n') ?? row.hints,
        mnemonics: old?.mnemonics ?? row.mnemonic,
        confusionWarnings: old?.confusionWarnings ?? row.confusion,
        sourceLabel: old?.sourceReferences[0]?.label ?? row.source.document?.filename ?? '',
        learningObjective: state.objective,
      });
      const issue = promptProblem(input);
      if (issue) throw new Error(issue);
      const start = row.source.kind === 'document' ? row.chunk.start : 0;
      const inputText = row.source.kind === 'document' ? row.chunk.text : row.source.text;
      const trace: AiConfirmation = {
        version: 1,
        runId: state.id,
        candidateId: row.id,
        provider: state.provider as AiConfirmation['provider'],
        model: state.model,
        isMock: state.provider === 'mock',
        task: state.task,
        objective: state.objective,
        generatedAt: state.startedAt,
        sourceKind: row.source.kind,
        inputId: row.source.id,
        ...(old
          ? { inputRevisionId: old.currentRevisionId }
          : { documentHash: row.source.document!.sourceHash }),
        inputStart: start,
        inputText,
        original: { items: structuredClone(row.original) },
        evidence: evidence.match.anchor,
        acceptedCriteria,
        confirmation: {
          at: new Date().toISOString(),
          humanReviewed: true,
          completenessReviewed: true,
          answerMode: old
            ? 'unchanged'
            : state.objective === 'verbatim'
              ? 'verbatim'
              : 'paraphrase',
          criterionMode: row.adoptCriteria ? 'ai-confirmed' : 'unchanged',
          question: input.question,
          answer: input.standardAnswer,
          criteria: lines(input.answerCriteria),
        },
        metrics,
      };
      const changed =
        old &&
        (old.question !== input.question ||
          JSON.stringify(old.answerCriteria) !== JSON.stringify(lines(input.answerCriteria)) ||
          old.learningObjective !== input.learningObjective);
      ids.push(
        await repo.saveCard(
          projectId,
          input,
          old?.id,
          old
            ? {
                expectedRevisionId: row.source.expectedRevisionId!,
                changeType: changed ? 'substantive' : 'cosmetic',
                changeSummary: `人工确认 AI ${state.task === 'criteria' ? '评分要点' : state.task === 'rewrite' ? '题干建议' : '质量核对'}（${state.provider === 'mock' ? '模拟演示' : state.model}）`,
                impactOnLearningState: changed ? 'reset' : 'preserve',
              }
            : undefined,
          old ? undefined : [referenceFor(row.source.document!, evidence.match.anchor)],
          trace,
        ),
      );
    }
    return ids;
  });
}
