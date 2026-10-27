import { useRef, useState } from 'react';
import { ZodError } from 'zod';

export function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((issue) => issue.message).join('；');
  if (error instanceof Error) return error.message;
  return '操作未完成，请重试。';
}

export function useAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
