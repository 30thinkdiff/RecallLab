import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
export function useReviewData() {
  return useLiveQuery(() =>
    db.transaction(
      'r',
      [
        db.projects,
        db.practiceItems,
        db.memoryStates,
        db.reviewEvents,
        db.sessions,
        db.sourceDocuments,
        db.revisions,
        db.schedulingLogs,
      ],
      async () => {
        const [projects, cards, memories, events, sessions, documents, revisions, logs] =
          await Promise.all([
            db.projects.toArray(),
            db.practiceItems.toArray(),
            db.memoryStates.toArray(),
            db.reviewEvents.toArray(),
            db.sessions.toArray(),
            db.sourceDocuments.toArray(),
            db.revisions.toArray(),
            db.schedulingLogs.toArray(),
          ]);
        return {
          projects: projects.filter((p) => !p.archivedAt),
          cards,
          memories,
          events,
          sessions,
          documents,
          revisions,
          logs,
        };
      },
    ),
  );
}
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
