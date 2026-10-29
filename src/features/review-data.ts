import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
export function useReviewData(projectId?: string, selectedOnly = false) {
  const projects = useLiveQuery(
    async () => (await db.projects.toArray()).filter((p) => !p.archivedAt),
    [],
  );
  const preferred =
    projects?.find((p) => p.id === projectId) ??
    [...(projects ?? [])].sort(
      (a, b) =>
        (b.priority ?? 2) - (a.priority ?? 2) ||
        (a.targetDate || '9999').localeCompare(b.targetDate || '9999'),
    )[0];
  const scope = selectedOnly ? preferred?.id : projectId;
  const cards = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.practiceItems.where('projectId').equals(scope).toArray()
          : db.practiceItems.toArray(),
    [scope],
  );
  const memories = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.memoryStates.where('projectId').equals(scope).toArray()
          : db.memoryStates.toArray(),
    [scope],
  );
  const events = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.reviewEvents.where('projectId').equals(scope).toArray()
          : db.reviewEvents.toArray(),
    [scope],
  );
  const sessions = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.sessions.where('[projectId+status]').equals([scope, 'active']).toArray()
          : db.sessions.where('status').equals('active').toArray(),
    [scope],
  );
  const documents = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.sourceDocuments.where('projectId').equals(scope).toArray()
          : db.sourceDocuments.toArray(),
    [scope],
  );
  const revisions = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.revisions
              .where('practiceItemId')
              .anyOf((cards ?? []).map((c) => c.id))
              .toArray()
          : db.revisions.toArray(),
    [scope, cards],
  );
  const logs = useLiveQuery(
    async () =>
      selectedOnly && !scope
        ? []
        : scope
          ? db.schedulingLogs.where('projectId').equals(scope).toArray()
          : db.schedulingLogs.toArray(),
    [scope],
  );
  if (!projects || !cards || !memories || !events || !sessions || !documents || !revisions || !logs)
    return undefined;
  return { projects, cards, memories, events, sessions, documents, revisions, logs };
}
export type ReviewData = NonNullable<ReturnType<typeof useReviewData>>;
export function useReviewClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return now;
}
