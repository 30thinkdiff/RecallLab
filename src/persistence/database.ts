import Dexie, { type Table } from 'dexie';
import { DATABASE_VERSION } from './version';
import type { AiDraftRecord } from '../ai/drafts-format';
import type { MemoryState, SchedulingLog } from '../scheduling/types';
import type {
  KnowledgeUnit,
  LearningProject,
  PracticeItem,
  ReviewEvent,
  StudySession,
  PracticeItemRevision,
  DraftRecovery,
  RecoveryBackup,
  SourceDocument,
} from '../domain/models';
import { dataTables, v5Tables, v2Tables, v3Tables, legacyTables, migrateBackup } from './migration';
import { validateBackup } from './backup-format';

export class RecallDatabase extends Dexie {
  aiDrafts!: Table<AiDraftRecord, string>;
  projects!: Table<LearningProject, string>;
  knowledgeUnits!: Table<KnowledgeUnit, string>;
  practiceItems!: Table<PracticeItem, string>;
  reviewEvents!: Table<ReviewEvent, string>;
  sessions!: Table<StudySession, string>;
  revisions!: Table<PracticeItemRevision, string>;
  draftRecoveries!: Table<DraftRecovery, string>;
  recoveryBackups!: Table<RecoveryBackup, string>;
  sourceDocuments!: Table<SourceDocument, string>;
  memoryStates!: Table<MemoryState, string>;
  schedulingLogs!: Table<SchedulingLog, string>;

  constructor(name = import.meta.env.MODE === 'test' ? 'RecallLab-test' : 'RecallLab') {
    super(name);
    this.on('ready', () => {
      if (Math.floor(this.backendDB().version / 10) > DATABASE_VERSION)
        throw new Error('这份数据来自更新版本，请使用最新 RecallLab 打开；不要清除网站数据。');
    });
    // Never edit a released schema. Add version(2).stores(...).upgrade(...) for migrations.
    this.version(1).stores({
      projects: 'id, updatedAt',
      knowledgeUnits: 'id, projectId',
      practiceItems: 'id, projectId, knowledgeUnitId',
      reviewEvents: 'id, projectId, practiceItemId, sessionId, timestamp, &[sessionId+queueIndex]',
      sessions: 'id, projectId, status, [projectId+status]',
    });
    this.version(2)
      .stores({
        revisions: 'id, practiceItemId, learningStateId, &[practiceItemId+revisionNumber]',
        draftRecoveries: 'id, sessionId, practiceItemId, createdAt',
        recoveryBackups: 'id, createdAt',
      })
      .upgrade(async (transaction) => {
        const raw: Record<string, unknown[]> = {};
        for (const name of legacyTables) raw[name] = await transaction.table(name).toArray();
        const backup = {
          format: 'RecallLabBackup',
          formatVersion: 1,
          databaseVersion: 1,
          createdAt: new Date().toISOString(),
          data: raw,
        };
        // This copy and all transforms share the upgrade transaction. Failure leaves v1 untouched.
        await transaction.table('recoveryBackups').add({
          id: crypto.randomUUID(),
          createdAt: backup.createdAt,
          reason: 'migration',
          json: JSON.stringify(backup),
        });
        const migrated = migrateBackup(validateBackup(backup));
        for (const name of v2Tables) {
          if (name === 'reviewEvents' || name === 'projects' || name === 'knowledgeUnits') continue;
          await transaction.table(name).bulkPut(migrated[name]);
        }
      });
    this.version(3)
      .stores({ sourceDocuments: 'id, projectId, sourceHash, importedAt' })
      .upgrade(async (transaction) => {
        const data: Record<string, unknown[]> = {};
        for (const name of v2Tables) data[name] = await transaction.table(name).toArray();
        const backup = {
          format: 'RecallLabBackup',
          formatVersion: 1,
          databaseVersion: 2,
          createdAt: new Date().toISOString(),
          data,
        };
        await transaction.table('recoveryBackups').add({
          id: crypto.randomUUID(),
          createdAt: backup.createdAt,
          reason: 'migration',
          json: JSON.stringify(backup),
        });
        validateBackup(backup);
        // Only add the source store. Existing items, revisions, drafts and events remain untouched.
      });
    this.version(4)
      .stores({
        memoryStates: 'id, projectId, practiceItemId, learningStateId, due',
        schedulingLogs: 'id, &eventId, projectId, practiceItemId, learningStateId, timestamp',
      })
      .upgrade(async (transaction) => {
        const data: Record<string, unknown[]> = {};
        for (const name of v3Tables) data[name] = await transaction.table(name).toArray();
        const backup = {
          format: 'RecallLabBackup',
          formatVersion: 1,
          databaseVersion: 3,
          createdAt: new Date().toISOString(),
          data,
        };
        await transaction.table('recoveryBackups').add({
          id: crypto.randomUUID(),
          createdAt: backup.createdAt,
          reason: 'migration',
          json: JSON.stringify(backup),
        });
        validateBackup(backup);
        // Old events are evidence, not FSRS ratings. Leave both new tables empty.
      });
    this.version(5)
      .stores({})
      .upgrade(async (transaction) => {
        const data: Record<string, unknown[]> = {};
        for (const name of v5Tables) data[name] = await transaction.table(name).toArray();
        const backup = {
          format: 'RecallLabBackup',
          formatVersion: 1,
          databaseVersion: 4,
          createdAt: new Date().toISOString(),
          data,
        };
        await transaction.table('recoveryBackups').add({
          id: crypto.randomUUID(),
          createdAt: backup.createdAt,
          reason: 'migration',
          json: JSON.stringify(backup),
        });
        validateBackup(backup);
        // No data transforms or history replay. Exported v5 backups reject legacy v4 parsers; old Dexie clients can still auto-open newer databases, so downgrade editing is unsupported.
      });
    this.version(6)
      .stores({ aiDrafts: 'id, projectId, updatedAt, bytesStored' })
      .upgrade(async (transaction) => {
        const data: Record<string, unknown[]> = {};
        for (const name of v5Tables) data[name] = await transaction.table(name).toArray();
        const before = {
          format: 'RecallLabBackup',
          formatVersion: 1,
          databaseVersion: 5,
          createdAt: new Date().toISOString(),
          data,
        };
        await transaction.table('recoveryBackups').add({
          id: crypto.randomUUID(),
          createdAt: before.createdAt,
          reason: 'migration',
          json: JSON.stringify(before),
        });
        validateBackup(before);
        // Only add empty candidate drafts. Do not rewrite events, confirmed sources, or scheduling.
      });
    this.version(7)
      .stores({})
      .upgrade(async (transaction) => {
        const data: Record<string, unknown[]> = {};
        for (const name of dataTables) data[name] = await transaction.table(name).toArray();
        const before = {
          format: 'RecallLabBackup',
          formatVersion: 1,
          databaseVersion: 6,
          createdAt: new Date().toISOString(),
          data,
        };
        await transaction
          .table('recoveryBackups')
          .add({
            id: crypto.randomUUID(),
            createdAt: before.createdAt,
            reason: 'migration',
            json: JSON.stringify(before),
          });
        validateBackup(before);
        // Semantic version for unit planning/review decisions; no historical or scheduling rewrites.
      });
  }
}

export const db = new RecallDatabase();
