export interface LearningProject {
  id: string;
  name: string;
  description: string;
  learningGoal: string;
  targetDate: string;
  dailyTimeBudget: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface SourceReference {
  documentId?: string;
  page?: number;
  excerpt?: string;
  label: string;
}

export interface KnowledgeUnit {
  id: string;
  projectId: string;
  title: string;
  knowledgeType:
    'fact' | 'definition' | 'list' | 'concept' | 'formula' | 'procedure' | 'application';
  canonicalContent: string;
  sourceReferences: SourceReference[];
  importance: number;
  difficulty: number | null;
  tags: string[];
  verificationStatus: 'user_authored' | 'unverified' | 'verified';
  createdAt: string;
  updatedAt: string;
}

export interface PracticeItem {
  id: string;
  projectId: string;
  knowledgeUnitId: string;
  question: string;
  standardAnswer: string;
  answerCriteria: string[];
  practiceType: 'free_recall';
  hints: string[];
  mnemonics: string;
  confusionWarnings: string;
  sourceReferences: SourceReference[];
  verificationStatus: 'user_authored';
  revision: number;
  currentRevisionId: string;
  learningStateId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export type Performance = 'correct' | 'partially_correct' | 'incorrect' | 'ungraded' | 'skipped';
export type SubjectiveMastery = 0 | 1 | 2 | 3 | 4;
export type ResponseMode = 'quick' | 'typed';

// Sessions and events use a snapshot so later edits do not rewrite learning evidence.
export type PracticeSnapshot = Pick<
  PracticeItem,
  | 'id'
  | 'knowledgeUnitId'
  | 'question'
  | 'standardAnswer'
  | 'answerCriteria'
  | 'hints'
  | 'mnemonics'
  | 'confusionWarnings'
  | 'sourceReferences'
  | 'revision'
> & { revisionId?: string; learningStateId?: string };

export type VersionedSnapshot = PracticeSnapshot & { revisionId: string; learningStateId: string };
export type ChangeType =
  'initial' | 'legacy' | 'cosmetic' | 'clarification' | 'substantive' | 'replacement';
export interface PracticeItemRevision {
  id: string;
  practiceItemId: string;
  revisionNumber: number;
  previousRevisionId: string | null;
  changeType: ChangeType;
  changeSummary: string;
  impactOnLearningState: 'preserve' | 'reset';
  learningStateId: string;
  createdAt: string;
  snapshot: PracticeSnapshot;
}

export interface DraftRecovery {
  id: string;
  sessionId: string;
  practiceItemId: string;
  revision: number;
  createdAt: string;
  reason: string;
  draft: StudyDraft;
}

export interface RecoveryBackup {
  id: string;
  createdAt: string;
  reason: 'migration' | 'restore';
  json: string;
}

export interface SessionToken {
  generation: string;
  planVersion: number;
  draftVersion: number;
  revisionId: string;
}

export interface StudyDraft {
  responseMode: ResponseMode;
  userResponse: string;
  hintLevelUsed: number;
  wasAnswerRevealed: boolean;
  attemptedBeforeReveal: boolean;
  confidenceBeforeReveal: number | null;
  startedAt: string;
  revealedAt: string | null;
}

export interface StudySession {
  id: string;
  projectId: string;
  queue: PracticeSnapshot[];
  index: number;
  status: 'active' | 'completed' | 'ended';
  createdAt: string;
  completedAt: string | null;
  draft: StudyDraft;
  generation: string;
  planVersion: number;
  draftVersion: number;
}

export interface ReviewEvent {
  id: string;
  schemaVersion: 1 | 2;
  projectId: string;
  practiceItemId: string;
  knowledgeUnitId: string;
  sessionId: string;
  queueIndex: number;
  timestamp: string;
  responseMode: ResponseMode;
  userResponse: string;
  assessmentResult: Performance;
  subjectiveMastery: SubjectiveMastery | null;
  confidenceBeforeReveal: number | null;
  hintLevelUsed: number;
  wasAnswerRevealed: boolean;
  wasIndependentRecall: boolean;
  responseDuration: number;
  errorTypes: string[];
  interventionType: 'hint' | null;
  assessmentSource: 'self_report' | 'user_checked' | 'none';
  snapshot: PracticeSnapshot;
}
