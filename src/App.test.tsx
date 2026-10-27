import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('application shell', () => {
  it('opens the project workspace through navigation', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '学习项目' }));
    expect(screen.getByRole('heading', { name: '学习项目', level: 1 })).toBeInTheDocument();
  });
});
