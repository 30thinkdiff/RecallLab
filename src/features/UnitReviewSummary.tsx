import { planKnowledge } from '../ai/units';
import type { AiSource } from '../ai/evidence';
import type { GenerationState } from '../ai/generation';
import { candidateEvidence } from '../ai/generation';
import type { PracticeItem } from '../domain/models';
export function UnitReviewSummary({
  state,
  sources,
  cards,
  update,
  disabled,
}: {
  state: GenerationState;
  sources: AiSource[];
  cards: PracticeItem[];
  update: (s: GenerationState) => void;
  disabled: boolean;
}) {
  const units = sources.flatMap((source) =>
    planKnowledge(source).map((unit) => ({ source, unit })),
  );
  const rows = units.map(({ source, unit }) => {
    const candidates = state.candidates.filter(
      (c) =>
        c.source.id === source.id &&
        (c.unit?.key === unit.key ||
          (() => {
            const m = candidateEvidence(c).match;
            return (
              m.status === 'matched' && m.anchor.start <= unit.start && m.anchor.end >= unit.end
            );
          })()),
    );
    const confirmed = cards.some(
      (c) =>
        c.aiProvenance?.runId === state.id &&
        c.aiProvenance.inputId === source.id &&
        c.aiProvenance.evidence.start <= unit.start &&
        c.aiProvenance.evidence.end >= unit.end,
    );
    return {
      unit,
      candidates,
      confirmed,
      deferred:
        state.deferredUnits?.includes(unit.key) ||
        unit.notForCards ||
        candidates.some((c) => c.deferred),
    };
  });
  const missing = rows.filter((r) => !r.candidates.length && !r.confirmed && !r.deferred);
  return (
    <section className="info-note" aria-label="知识单元核对">
      <h3>按原文检查准备进度</h3>
      <p>
        规则规划 {rows.length} 个原文单元 · {missing.length} 个尚无候选 ·{' '}
        {rows.filter((r) => r.deferred).length} 个暂不制卡 ·{' '}
        {rows.filter((r) => r.confirmed).length} 个已确认。
      </p>
      <p className="muted">
        按章节/段落定位，不代表语义知识覆盖率；仍需检查未归类文字与问题是否覆盖全部必要内容。
      </p>
      <details>
        <summary>查看章节、遗漏及暂不制卡</summary>
        {rows.slice(0, 80).map(({ unit, candidates, confirmed, deferred }) => (
          <div key={unit.key}>
            <p>
              <strong>{unit.chapter}</strong> ·{' '}
              {confirmed
                ? '已确认'
                : deferred
                  ? '暂不制卡'
                  : candidates.length
                    ? '已有候选，仍需核对'
                    : '尚无候选'}{' '}
              · {unit.title || `原文位置 ${unit.start + 1}—${unit.end}`}
            </p>
            {(!candidates.length || deferred) && <p className="preserve-lines">{unit.text}</p>}
            {!confirmed && (
              <button
                className="button subtle"
                disabled={disabled || unit.notForCards}
                onClick={() =>
                  update({
                    ...state,
                    deferredUnits: deferred
                      ? (state.deferredUnits ?? []).filter((k) => k !== unit.key)
                      : [...(state.deferredUnits ?? []), unit.key],
                    candidates: state.candidates.map((c) =>
                      candidates.some((x) => x.id === c.id)
                        ? { ...c, deferred: !deferred, selected: false }
                        : c,
                    ),
                  })
                }
              >
                {deferred ? '恢复此单元核对' : '此单元暂不制卡'}
              </button>
            )}
            {unit.notForCards && <p>原文没有清晰可核对结论，保留资料，不自动编造答案。</p>}
          </div>
        ))}
        {rows.length > 80 && <p>仅展开前80个单元，请按页或题目分批整理。</p>}
      </details>
    </section>
  );
}
