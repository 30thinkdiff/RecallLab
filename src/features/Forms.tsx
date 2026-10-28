import { useAction } from '../components/actions';
import { useState, type FormEvent } from 'react';
import type { LearningProject, PracticeItem } from '../domain/models';
import { repository } from '../persistence/repository';
import { ErrorNotice, Modal } from '../components/shared';

export function ProjectForm({
  project,
  onClose,
  onSaved,
}: {
  project?: LearningProject;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [values, setValues] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    learningGoal: project?.learningGoal ?? '',
    targetDate: project?.targetDate ?? '',
    dailyTimeBudget: project?.dailyTimeBudget ?? 20,
  });
  const action = useAction();
  const set = (key: string, value: string | number) =>
    setValues((current) => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      const id = await repository.saveProject(values, project?.id);
      onSaved(id);
    });
  }
  return (
    <Modal title={project ? '编辑学习项目' : '创建学习项目'} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="form-intro">给你的学习一个明确的方向。所有内容保存在当前浏览器。</p>
        <label>
          项目名称 <span>*</span>
          <input
            autoFocus
            required
            maxLength={100}
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="例如：认知心理学 · 期末复习"
          />
        </label>
        <label>
          项目描述
          <textarea
            maxLength={2000}
            value={values.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder="准备学习哪些内容？"
            rows={2}
          />
        </label>
        <label>
          学习目标
          <textarea
            maxLength={1000}
            value={values.learningGoal}
            onChange={(event) => set('learningGoal', event.target.value)}
            placeholder="例如：不看提示，完整复述核心概念"
            rows={2}
          />
        </label>
        <div className="form-grid">
          <label>
            目标日期
            <input
              type="date"
              value={values.targetDate}
              onChange={(event) => set('targetDate', event.target.value)}
            />
          </label>
          <label>
            每日计划（分钟）
            <input
              type="number"
              required
              min={1}
              max={1440}
              value={values.dailyTimeBudget}
              onChange={(event) => set('dailyTimeBudget', event.target.valueAsNumber)}
            />
          </label>
        </div>
        <ErrorNotice message={action.error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button" disabled={action.busy}>
            {action.busy ? '保存中…' : '保存项目'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CardForm({
  projectId,
  card,
  onClose,
}: {
  projectId: string;
  card?: PracticeItem;
  onClose: () => void;
}) {
  const [values, setValues] = useState({
    question: card?.question ?? '',
    standardAnswer: card?.standardAnswer ?? '',
    hints: card?.hints.join('\n') ?? '',
    answerCriteria: card?.answerCriteria.join('\n') ?? '',
    mnemonics: card?.mnemonics ?? '',
    confusionWarnings: card?.confusionWarnings ?? '',
    sourceLabel: card?.sourceReferences[0]?.label ?? '',
  });
  const action = useAction();
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      await repository.saveCard(projectId, values, card?.id);
      onClose();
    });
  }
  return (
    <Modal title={card ? '编辑问答题' : '添加问答题'} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="form-intro">一个问题，一次主动回忆。提示和补充信息均为可选。</p>
        {card && (
          <p className="info-note">
            修改后会生成新修订。历史记录及已开始的学习轮次保留原题与原答案。
          </p>
        )}
        <label>
          问题 <span>*</span>
          <textarea
            autoFocus
            required
            maxLength={5000}
            rows={2}
            value={values.question}
            onChange={(event) => set('question', event.target.value)}
            placeholder="你希望自己能独立回答什么问题？"
          />
        </label>
        <label>
          标准答案 <span>*</span>
          <textarea
            required
            maxLength={20000}
            rows={4}
            value={values.standardAnswer}
            onChange={(event) => set('standardAnswer', event.target.value)}
            placeholder="填写准确、完整的答案"
          />
        </label>
        <label>
          核对要点 <small>每行一项，用于自行核对</small>
          <textarea
            maxLength={10000}
            rows={2}
            value={values.answerCriteria}
            onChange={(event) => set('answerCriteria', event.target.value)}
          />
        </label>
        <label>
          渐进提示 <small>每行一条，按顺序逐条揭示</small>
          <textarea
            maxLength={5000}
            rows={2}
            value={values.hints}
            onChange={(event) => set('hints', event.target.value)}
          />
        </label>
        <details className="extra-fields">
          <summary>来源、助记与易混提醒</summary>
          <label>
            来源说明
            <input
              maxLength={1000}
              value={values.sourceLabel}
              onChange={(event) => set('sourceLabel', event.target.value)}
              placeholder="例如：教材第 3 章，第 42 页（手工填写）"
            />
          </label>
          <label>
            助记技巧
            <textarea
              maxLength={5000}
              rows={2}
              value={values.mnemonics}
              onChange={(event) => set('mnemonics', event.target.value)}
            />
          </label>
          <label>
            易混提醒
            <textarea
              maxLength={5000}
              rows={2}
              value={values.confusionWarnings}
              onChange={(event) => set('confusionWarnings', event.target.value)}
            />
          </label>
        </details>
        <ErrorNotice message={action.error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button" type="submit" disabled={action.busy}>
            {action.busy ? '保存中…' : '保存题目'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
