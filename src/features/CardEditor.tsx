import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import { editingService } from '../persistence/editing-service';
import { cardEditToken, preservesRequirements } from '../domain/editing';
import type { PracticeItem } from '../domain/models';
import type { CardInput } from '../domain/validation';
import type { EditorDraft, CardDraftValues } from '../persistence/editable-format';
import { Modal, ErrorNotice } from '../components/shared';
import { useAction, errorMessage } from '../components/actions';
import { objectiveLabels, type LearningObjective } from '../ai/protocol';
import { downloadJson } from '../persistence/backup';
import { EditorDraftController } from './editor-draft';
import { scheduleService } from '../scheduling/service';
type Intent = 'save' | 'continue' | 'study';
export interface CardFormProps {
  projectId?: string;
  card?: PracticeItem;
  quick?: boolean;
  sessionId?: string;
  onClose: () => void;
  onStudySave?: (record: EditorDraft, input: CardInput, confirmReset: boolean) => Promise<void>;
}
function valuesOf(card?: PracticeItem): CardDraftValues {
  return {
    question: card?.question ?? '',
    standardAnswer: card?.standardAnswer ?? '',
    hints: card?.hints.join('\n') ?? '',
    answerCriteria: card?.answerCriteria.join('\n') ?? '',
    mnemonics: card?.mnemonics ?? '',
    confusionWarnings: card?.confusionWarnings ?? '',
    sourceLabel: card?.sourceReferences[0]?.label ?? (card ? '' : '用户创建'),
    ...(card?.learningObjective ? { learningObjective: card.learningObjective } : {}),
    importance: card?.importance ?? 2,
    paused: card?.paused ?? false,
  };
}
export function CardForm(props: CardFormProps) {
  const [target, setTarget] = useState(props.projectId),
    [nonce, setNonce] = useState(0),
    [record, setRecord] = useState<EditorDraft>(),
    [error, setError] = useState(''),
    [count, setCount] = useState(0),
    [preferences, setPreferences] = useState<
      Pick<CardDraftValues, 'learningObjective' | 'importance'>
    >({});
  useEffect(() => {
    let active = true;
    const now = new Date().toISOString();
    const id = props.card
      ? props.sessionId
        ? `study:${props.sessionId}:${props.card.id}:${props.card.currentRevisionId}`
        : `card:${props.card.id}`
      : `new:${target ?? 'auto'}`;
    const initial: EditorDraft = {
      id,
      epoch: crypto.randomUUID(),
      kind: 'card',
      ...(target ? { projectId: target } : {}),
      ...(props.card
        ? { practiceItemId: props.card.id, baseRevisionId: cardEditToken(props.card) }
        : {}),
      ...(props.sessionId ? { sessionId: props.sessionId } : {}),
      version: 0,
      values: { ...valuesOf(props.card), ...(!props.card ? preferences : {}) },
      createdAt: now,
      updatedAt: now,
    };
    void editingService.openDraft(initial).then(
      (d) => {
        if (active) setRecord(d);
      },
      (e) => {
        if (active) setError(errorMessage(e));
      },
    );
    return () => {
      active = false;
    };
  }, [target, nonce, props.card, props.sessionId, preferences]);
  if (!record)
    return (
      <Modal title={props.card ? '编辑问答题' : '添加问答题'} onClose={props.onClose}>
        <p role="status">正在恢复编辑草稿…</p>
        <ErrorNotice message={error} />
      </Modal>
    );
  return (
    <CardFields
      key={`${record.id}:${record.epoch}:${nonce}`}
      {...props}
      record={record}
      count={count}
      onNext={(pid, settings) => {
        setPreferences(settings);
        setRecord(undefined);
        setTarget(pid);
        if (props.quick) window.location.assign(`#compose/${pid}`);
        setNonce((n) => n + 1);
        setCount((n) => n + 1);
      }}
    />
  );
}
function CardFields(
  props: CardFormProps & {
    record: EditorDraft;
    count: number;
    onNext: (
      projectId: string,
      settings: Pick<CardDraftValues, 'learningObjective' | 'importance'>,
    ) => void;
  },
) {
  const [controller] = useState(() => new EditorDraftController(props.record));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    values = view.values as CardDraftValues;
  const current = useLiveQuery(
    () => (props.card ? db.practiceItems.get(props.card.id) : undefined),
    [props.card?.id],
  );
  const [confirmation, setConfirmation] = useState<Intent | null>(null);
  const action = useAction();
  const stale = !!props.card && !!current && cardEditToken(current) !== view.record.baseRevisionId;
  const blocked = action.busy || !!view.error || stale || (!!props.card && !!current?.archivedAt);
  const set = (patch: Partial<CardDraftValues>) => {
    setConfirmation(null);
    controller.edit({ ...values, ...patch });
  };
  async function cancel() {
    if (view.error || stale) {
      await controller.protect();
      props.onClose();
      return;
    }
    const d = await controller.flush();
    await editingService.cancelDraft(d.id, d.version, d.epoch);
    props.onClose();
  }
  async function save(intent: Intent, confirmed = false) {
    const d = await controller.flush();
    if (d.kind !== 'card') throw new Error('编辑类型不匹配');
    const input = { ...d.values };
    if (props.card && !preservesRequirements(props.card, input) && !confirmed) {
      setConfirmation(intent);
      return;
    }
    if (props.onStudySave) {
      await props.onStudySave(d, input, confirmed);
      props.onClose();
      return;
    }
    const result = await editingService.saveCard(d.projectId, input, {
      ...(props.card ? { id: props.card.id, expectedToken: d.baseRevisionId } : {}),
      confirmReset: confirmed,
      draftId: d.id,
      draftVersion: d.version,
      draftEpoch: d.epoch,
    });
    if (intent === 'continue') {
      props.onNext(result.projectId, {
        learningObjective: input.learningObjective,
        importance: input.importance,
      });
      return;
    }
    if (intent === 'study') {
      const project = (await db.projects.get(result.projectId))!;
      if (!project.automaticGoal)
        await scheduleService.configureGoal(
          project.id,
          {
            targetDate: project.targetDate,
            dailyTimeBudget: project.dailyTimeBudget,
            automaticGoal: { version: 'goal-v1', objective: input.learningObjective ?? 'exam' },
          },
          project.updatedAt,
        );
      window.location.assign(
        `#study/${await scheduleService.start(result.projectId, { adaptive: true })}`,
      );
      return;
    }
    props.onClose();
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const intent = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.dataset
      .intent as Intent | undefined;
    void action.run(() => save(intent ?? 'save'));
  }
  return (
    <Modal
      title={props.card ? '编辑问答题' : '添加问答题'}
      onClose={() => {
        if (!action.busy) void action.run(cancel);
      }}
    >
      <form onSubmit={submit}>
        {props.count > 0 && <p role="status">已添加 {props.count} 道，继续录入同一题库。</p>}
        <label>
          问题 <span>*</span>
          <textarea
            autoFocus
            required
            maxLength={5000}
            rows={2}
            value={values.question}
            disabled={action.busy}
            onChange={(e) => set({ question: e.target.value })}
          />
        </label>
        <label>
          标准答案 <span>*</span>
          <textarea
            required
            maxLength={20000}
            rows={4}
            value={values.standardAnswer}
            disabled={action.busy}
            onChange={(e) => set({ standardAnswer: e.target.value })}
          />
        </label>
        <details>
          <summary>提示、核对要点与更多设置</summary>
          <label>
            核对要点 <small>每行一项，表示必须掌握的内容</small>
            <textarea
              maxLength={10000}
              rows={3}
              value={values.answerCriteria}
              disabled={action.busy}
              onChange={(e) => set({ answerCriteria: e.target.value })}
            />
          </label>
          <label>
            渐进提示
            <textarea
              maxLength={5000}
              rows={2}
              value={values.hints}
              disabled={action.busy}
              onChange={(e) => set({ hints: e.target.value })}
            />
          </label>
          <label>
            助记技巧
            <textarea
              maxLength={5000}
              value={values.mnemonics}
              disabled={action.busy}
              onChange={(e) => set({ mnemonics: e.target.value })}
            />
          </label>
          <label>
            易混提醒
            <textarea
              maxLength={5000}
              value={values.confusionWarnings}
              disabled={action.busy}
              onChange={(e) => set({ confusionWarnings: e.target.value })}
            />
          </label>
          <label>
            学习目标（可选）
            <select
              value={values.learningObjective ?? ''}
              disabled={action.busy}
              onChange={(e) =>
                set({
                  learningObjective: e.target.value
                    ? (e.target.value as LearningObjective)
                    : undefined,
                })
              }
            >
              <option value="">沿用原有要求</option>
              {Object.entries(objectiveLabels).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            重要程度
            <select
              value={values.importance ?? 2}
              disabled={action.busy}
              onChange={(e) => set({ importance: Number(e.target.value) })}
            >
              <option value={1}>普通低优先</option>
              <option value={2}>正常</option>
              <option value={3}>重点</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!values.paused}
              disabled={action.busy}
              onChange={(e) => set({ paused: !e.target.checked })}
            />
            纳入学习范围
          </label>
          <label>
            来源说明
            <input
              maxLength={1000}
              value={values.sourceLabel}
              disabled={action.busy}
              onChange={(e) => set({ sourceLabel: e.target.value })}
            />
          </label>
          {props.card && <p>此处修改你的练习内容。原始资料与历史记录保留，学习稿独立编辑。</p>}
        </details>
        {confirmation && (
          <section role="alert">
            <p>题干、标准答案或必需内容已改变。保存后将重新安排这道题，旧记录保留。</p>
            <button
              type="button"
              className="button"
              disabled={blocked}
              onClick={() => void action.run(() => save(confirmation, true))}
            >
              确认更新并重新安排
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirmation(null)}
            >
              继续编辑
            </button>
          </section>
        )}
        {(stale || view.error) && (
          <section role="alert">
            <p>{stale ? '另一页面已更新题目，本页编辑保留，不能覆盖新答案。' : view.error}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                downloadJson(
                  { baseRevisionId: view.record.baseRevisionId, values },
                  'RecallLab-保留的编辑.json',
                )
              }
            >
              导出本页编辑
            </button>
          </section>
        )}
        <ErrorNotice message={action.error} />
        <p role="status" data-testid="editor-status">
          {view.pending
            ? '正在保存编辑草稿…'
            : view.error
              ? '本页输入保留，草稿保存发生冲突'
              : '编辑草稿已保存在本机'}
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={() => void action.run(cancel)}
          >
            取消
          </button>
          {props.quick && !props.card ? (
            <>
              <button
                type="submit"
                data-intent="continue"
                className="button secondary"
                disabled={blocked}
              >
                保存并继续添加
              </button>
              <button type="submit" data-intent="study" className="button" disabled={blocked}>
                保存并学习
              </button>
            </>
          ) : (
            <button type="submit" data-intent="save" className="button" disabled={blocked}>
              保存题目
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
