// Public fictional material only. Fixed IDs/dates make migrations and reports reproducible.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { format } from 'prettier';
const day = '2026-10-20T08:00:00.000Z';
const projects = ['p-alpha', 'p-beta'].map((id, index) => ({
  id,
  name: index ? '虚构资料 · 项目乙' : '虚构资料 · 项目甲',
  description: '完全虚构的回归测试资料',
  learningGoal: '区分虚构概念',
  targetDate: '',
  dailyTimeBudget: 20,
  createdAt: day,
  updatedAt: day,
}));
function card(id, question, standardAnswer, projectId = 'p-alpha') {
  return {
    id,
    projectId,
    knowledgeUnitId: `k-${id}`,
    question,
    standardAnswer,
    answerCriteria: ['回答核心要点'],
    practiceType: 'free_recall',
    hints: ['先回想颜色', '再回想协议名称', '核对顺序'],
    mnemonics: '虚构助记',
    confusionWarnings: '不要混淆甲乙',
    sourceReferences: [{ label: '公开虚构测试手册' }],
    verificationStatus: 'user_authored',
    revision: 1,
    createdAt: day,
    updatedAt: day,
  };
}
const old = card('q-crystal', '虚构协议甲：蓝晶对应哪种颜色？', '旧答案：红色（测试中设定为错误）');
const current = {
  ...old,
  standardAnswer: '新版答案：蓝色',
  revision: 2,
  updatedAt: '2026-10-24T08:00:00.000Z',
};
const long = card(
  'q-long',
  '虚构流程：完整列举四个阶段。',
  '第一阶段收集蓝晶。\n第二阶段核对图谱。\n第三阶段登记状态。\n第四阶段归还蓝晶。',
);
const similar = card('q-similar', '虚构协议乙：蓝晶对应哪种颜色？', '绿色（与协议甲不同）');
const archived = {
  ...card('q-archived', '已归档的虚构问题', '归档答案'),
  archivedAt: '2026-10-25T08:00:00.000Z',
};
const other = card('q-other', '项目乙的独立问题', '项目乙专用答案', 'p-beta');
const practiceItems = [current, long, similar, archived, other];
const knowledgeUnits = practiceItems.map((item) => ({
  id: item.knowledgeUnitId,
  projectId: item.projectId,
  title: item.question,
  knowledgeType: 'fact',
  canonicalContent: item.standardAnswer,
  sourceReferences: item.sourceReferences,
  importance: 1,
  difficulty: null,
  tags: [],
  verificationStatus: 'user_authored',
  createdAt: day,
  updatedAt: item.updatedAt,
}));
function snapshot(item) {
  const {
    id,
    knowledgeUnitId,
    question,
    standardAnswer,
    answerCriteria,
    hints,
    mnemonics,
    confusionWarnings,
    sourceReferences,
    revision,
  } = item;
  return {
    id,
    knowledgeUnitId,
    question,
    standardAnswer,
    answerCriteria,
    hints,
    mnemonics,
    confusionWarnings,
    sourceReferences,
    revision,
  };
}
const fresh = {
  responseMode: 'typed',
  userResponse: '',
  hintLevelUsed: 0,
  wasAnswerRevealed: false,
  attemptedBeforeReveal: false,
  confidenceBeforeReveal: null,
  startedAt: day,
  revealedAt: null,
};
const sessions = [
  {
    id: 's-first',
    projectId: 'p-alpha',
    queue: [snapshot(old), snapshot(long)],
    index: 2,
    status: 'completed',
    createdAt: day,
    completedAt: '2026-10-20T08:04:00.000Z',
    draft: fresh,
  },
  {
    id: 's-second',
    projectId: 'p-alpha',
    queue: [snapshot(old)],
    index: 1,
    status: 'completed',
    createdAt: '2026-10-21T08:00:00.000Z',
    completedAt: '2026-10-21T08:02:00.000Z',
    draft: fresh,
  },
  {
    id: 's-active',
    projectId: 'p-alpha',
    queue: [snapshot(old), snapshot(long), snapshot(similar)],
    index: 1,
    status: 'active',
    createdAt: '2026-10-22T08:00:00.000Z',
    completedAt: null,
    draft: {
      ...fresh,
      userResponse: '尚未完成的虚构长答案草稿',
      startedAt: '2026-10-22T08:02:00.000Z',
    },
  },
];
function event(session, index, result, mastery, time, hint = 0) {
  const item = session.queue[index];
  return {
    id: `${session.id}:${index}`,
    schemaVersion: 1,
    projectId: session.projectId,
    practiceItemId: item.id,
    knowledgeUnitId: item.knowledgeUnitId,
    sessionId: session.id,
    queueIndex: index,
    timestamp: time,
    responseMode: 'typed',
    userResponse: '虚构用户的原始回答',
    assessmentResult: result,
    subjectiveMastery: mastery,
    confidenceBeforeReveal: 3,
    hintLevelUsed: hint,
    wasAnswerRevealed: true,
    wasIndependentRecall: hint === 0,
    responseDuration: 30000,
    errorTypes: [],
    interventionType: hint ? 'hint' : null,
    assessmentSource: 'user_checked',
    snapshot: item,
  };
}
const reviewEvents = [
  event(sessions[0], 0, 'incorrect', 4, '2026-10-20T08:02:00.000Z', 1),
  event(sessions[0], 1, 'correct', 0, '2026-10-20T08:04:00.000Z'),
  event(sessions[1], 0, 'correct', 4, '2026-10-21T08:02:00.000Z'),
  event(sessions[2], 0, 'correct', 3, '2026-10-22T08:02:00.000Z'),
];
const backup = {
  format: 'RecallLabBackup',
  formatVersion: 1,
  databaseVersion: 1,
  createdAt: '2026-10-26T08:00:00.000Z',
  data: { projects, knowledgeUnits, practiceItems, reviewEvents, sessions },
};
const output = new URL('../tests/fixtures/legacy-v1.json', import.meta.url);
const content = await format(JSON.stringify(backup), {
  ...JSON.parse(await readFile(new URL('../.prettierrc.json', import.meta.url), 'utf8')),
  parser: 'json',
});
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== content)
    throw new Error(
      'Fixture differs from generator; run npm run fixtures and review the public data diff.',
    );
} else {
  await mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
  await writeFile(output, content);
}
