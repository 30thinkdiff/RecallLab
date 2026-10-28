import Dexie, { type Table } from 'dexie';
import type {
  KnowledgeUnit,
  LearningProject,
  PracticeItem,
  ReviewEvent,
  StudySession,
} from '../domain/models';

export class RecallDatabase extends Dexie {
  projects!: Table<LearningProject, string>;
  knowledgeUnits!: Table<KnowledgeUnit, string>;
  practiceItems!: Table<PracticeItem, string>;
  reviewEvents!: Table<ReviewEvent, string>;
  sessions!: Table<StudySession, string>;

  constructor(name = 'RecallLab') {
    super(name);
    // Never edit a released schema. Add version(2).stores(...).upgrade(...) for migrations.
    this.version(1).stores({
      projects: 'id, updatedAt',
      knowledgeUnits: 'id, projectId',
      practiceItems: 'id, projectId, knowledgeUnitId',
      reviewEvents: 'id, projectId, practiceItemId, sessionId, timestamp, &[sessionId+queueIndex]',
      sessions: 'id, projectId, status, [projectId+status]',
    });
  }
}

export const db = new RecallDatabase();
