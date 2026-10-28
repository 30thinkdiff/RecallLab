import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
export function useWorkspaceData(route: string) {
  const [section, id] = route.split('/');
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const cards = useLiveQuery(() => db.practiceItems.toArray(), []);
  const sessions = useLiveQuery(async () => {
    if (section === 'study' && id) {
      const s = await db.sessions.get(id);
      return s ? [s] : [];
    }
    if (section === 'project' && id)
      return db.sessions.where('[projectId+status]').equals([id, 'active']).toArray();
    if (section === 'home' || section === 'projects')
      return db.sessions.where('status').equals('active').toArray();
    return [];
  }, [section, id]);
  const events = useLiveQuery(() => {
    if (section === 'home' || section === 'history') return db.reviewEvents.toArray();
    if (section === 'study' && id) return db.reviewEvents.where('sessionId').equals(id).toArray();
    if (section === 'project' && id) return db.reviewEvents.where('projectId').equals(id).toArray();
    if (section === 'item' && id)
      return db.reviewEvents.where('practiceItemId').equals(id).toArray();
    return [];
  }, [section, id]);
  const revisions = useLiveQuery(() => {
    if (section === 'home' || section === 'history') return db.revisions.toArray();
    if (section === 'item' && id) return db.revisions.where('practiceItemId').equals(id).toArray();
    if (section === 'project' && id)
      return db.revisions
        .where('practiceItemId')
        .anyOf((cards ?? []).filter((c) => c.projectId === id).map((c) => c.id))
        .toArray();
    return [];
  }, [section, id, cards]);
  const draftRecoveries = useLiveQuery(
    () =>
      section === 'item' && id
        ? db.draftRecoveries.where('practiceItemId').equals(id).toArray()
        : [],
    [section, id],
  );
  if (!projects || !cards || !sessions || !events || !revisions || !draftRecoveries)
    return undefined;
  return { projects, cards, sessions, events, revisions, draftRecoveries };
}
