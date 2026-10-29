import type { Card, ReviewLog } from 'ts-fsrs';
export type StoredCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string };
export type StoredFsrsLog = Omit<ReviewLog, 'due' | 'review'> & { due: string; review: string };
export type Difficulty = 'hard' | 'good' | 'easy';
export type Grade = 1 | 2 | 3 | 4;
export type ReviewMode = 'daily' | 'due' | 'new' | 'weak' | 'chapter' | 'custom';
export type QueueReason = 'due' | 'retest' | 'focus' | 'new' | 'practice';
export interface PlanEntry {
  explanation?: string;
  estimatedSeconds?: number;
  stateVersion: number;
  reason: QueueReason;
  canSchedule: boolean;
}
export interface ReviewPlan {
  goalUpdatedAt?: string;
  adaptive?: boolean;
  compact?: boolean;
  practiceOnly?: boolean;
  mode: ReviewMode;
  timezone: string;
  createdAt: string;
  budgetMinutes: number;
  entries: Record<string, PlanEntry>;
}
export interface ReviewDecision {
  reviewedAt?: string;
  policyVersion: 'v1';
  grade: Grade | null;
  reason:
    | 'success'
    | 'failure'
    | 'partial_failure'
    | 'hinted'
    | 'no_attempt'
    | 'skipped'
    | 'ungraded'
    | 'practice';
  source: 'self_report' | 'user_checked' | 'deterministic' | 'none';
  criteriaMet: boolean | null;
  difficulty: Difficulty | null;
  nextDue?: string;
  retestDue?: string;
}
export interface MemoryState {
  id: string;
  projectId: string;
  practiceItemId: string;
  knowledgeUnitId: string;
  learningStateId: string;
  revisionId: string;
  algorithm: 'ts-fsrs@5.4.2/default-v1';
  version: number;
  card: StoredCard;
  due: string;
  retestDue?: string;
  createdAt: string;
  updatedAt: string;
}
export interface SchedulingLog {
  id: string;
  eventId: string;
  projectId: string;
  practiceItemId: string;
  learningStateId: string;
  revisionId: string;
  timestamp: string;
  decision: ReviewDecision;
  versionBefore: number;
  versionAfter: number;
  before?: StoredCard;
  after?: StoredCard;
  fsrsLog?: StoredFsrsLog;
}
