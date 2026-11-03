import { useAction } from '../components/actions';
import { useState, type FormEvent } from 'react';
import type { LearningProject } from '../domain/models';
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
    priority: project?.priority ?? 2,
    newCardLimit: project?.newCardLimit ?? 10,
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
        <div className="form-grid">
          <label>
            学习优先级
            <select
              value={values.priority}
              onChange={(e) => set('priority', Number(e.target.value))}
            >
              <option value={1}>低</option>
              <option value={2}>普通</option>
              <option value={3}>高</option>
            </select>
          </label>
          <label>
            每日新题上限
            <input
              type="number"
              min={0}
              max={1000}
              required
              value={values.newCardLimit}
              onChange={(e) => set('newCardLimit', e.target.valueAsNumber)}
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

export { CardForm } from './CardEditor';
