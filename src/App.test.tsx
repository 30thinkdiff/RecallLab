import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { db } from './persistence/database';

beforeEach(async () => {
  history.replaceState(null, '', '/');
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
});

describe('learning workspace', () => {
  it('opens the project workspace through navigation', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: '让每一次回忆，都有收获。' });
    await userEvent.click(screen.getByRole('link', { name: '学习项目' }));
    expect(await screen.findByRole('heading', { name: '学习项目', level: 1 })).toBeInTheDocument();
  });

  it('creates a project and card and records a complete typed recall', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '创建项目' }));
    await user.type(screen.getByLabelText(/项目名称/), '生物学复习');
    await user.click(screen.getByRole('button', { name: '保存项目' }));
    await screen.findByRole('heading', { name: '生物学复习', level: 1 });
    await user.click(screen.getAllByRole('button', { name: '添加问答题' })[0]!);
    await user.type(screen.getByLabelText(/^问题/), '细胞的能量工厂是什么？');
    await user.type(screen.getByLabelText(/^标准答案/), '线粒体');
    await user.click(screen.getByRole('button', { name: '保存题目' }));
    await screen.findByRole('heading', { name: '细胞的能量工厂是什么？' });
    await user.click(screen.getByRole('button', { name: '开始学习' }));
    await screen.findByRole('heading', { name: '先回忆，再看答案。' });
    expect(screen.queryByText('线粒体')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '输入作答' }));
    await user.type(screen.getByLabelText(/你的回答/), '是线粒体');
    await user.click(screen.getByRole('button', { name: '揭晓答案' }));
    expect(await screen.findByText('线粒体')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并完成本轮' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: '自行核对结果' }), 'correct');
    await user.click(screen.getByRole('radio', { name: '3 基本掌握' }));
    await user.click(screen.getByRole('button', { name: '保存并完成本轮' }));
    await screen.findByRole('heading', { name: '这一轮，完成了。' });
    await waitFor(async () => expect(await db.reviewEvents.count()).toBe(1));
    const event = await db.reviewEvents.toCollection().first();
    expect(event?.userResponse).toBe('是线粒体');
    expect(event?.assessmentResult).toBe('correct');
    expect(event?.assessmentSource).toBe('user_checked');
    expect(event?.subjectiveMastery).toBe(3);
  });
});
