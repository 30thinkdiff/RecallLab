# 架构与工程决策

## 运行方式

单页 React + TypeScript 应用，Vite 提供开发热更新与静态生产构建。
无后端、无账号、无付费 API；IndexedDB 是 M1 唯一持久数据来源。
Hash 路由保留项目与学习轮次地址，刷新可继续，不要求服务器提供路由重写。
原生 CSS 与 dialog 降低初始依赖；规模扩大后再评估 Tailwind 或组件库。

## 模块边界

| 模块                   | 职责                                       |
| ---------------------- | ------------------------------------------ |
| domain/models          | 项目、知识、练习、轮次、事件的类型         |
| domain/validation      | Zod 输入校验与逐行文本处理                 |
| domain/review          | 回忆条件、人工核对来源与主观反馈的事件构建 |
| persistence/database   | Dexie 数据库与版本化表定义                 |
| persistence/repository | 事务、归档、修订、学习推进和并发防重       |
| features/Forms         | 项目和问答编辑                             |
| features/Workspace     | 概览、题库、项目和历史                     |
| features/Study         | 作答、提示、揭晓、核对、评价、跳过         |
| components             | 异步错误反馈、原生弹窗与存储错误边界       |

界面使用 Dexie live query 读取本地事务快照；数据库变更会触发视图刷新。
参考 [Dexie React 文档](https://dexie.org/docs/Tutorial/React)。

## 已实现的数据模型

`LearningProject` 保存目标与时间计划。
`KnowledgeUnit` 保存知识内容与手工来源引用。
`PracticeItem` 独立保存练习问题、标准答案、核对要点、提示、助记和修订号。
M1 每次手工制卡创建一个知识单元和一道自由回忆题，二者用 ID 关联，后续可扩展一对多。

`StudySession` 保存项目、题目快照队列、当前索引、状态与当前作答草稿。
`ReviewEvent` 追加保存原始作答、人工核对结果、主观自评、回忆条件、用时和题目快照。
二者均持久化；会话 ID 和队列位置组成事件 ID，另有复合唯一索引。
时间保存为 ISO UTC 字符串，界面用用户浏览器时区显示。

尚未创建未被使用的 SourceDocument、MemoryState、ConfusionRelation、Intervention 表。
未来导入资料、调度和干预时用新增版本迁移接入，不能把它们压入 ReviewEvent 的主观评分字段。

## 重要不变量

1. 知识、题目和事件分别存表；自评不替代实际表现。
2. 事件与轮次推进在同一事务提交；失败回滚，重复点击和多标签页提交不能推进两次。
3. 草稿更新在事务内与最新草稿合并，校验轮次状态和题目索引；揭晓后禁止改写此前的作答。
4. 切换回答模式不抹掉提示使用记录。输入内容逐次保存；揭晓前状态可恢复。
5. 每次学习使用启动时的题目快照；编辑题目增加修订号，历史显示当时的问答。
6. 项目和题目归档，不级联抹掉学习证据。归档项目不可开始或继续学习。
7. 当前不修改既有事件，暂无改评分入口；未来修正应添加更正事件并关联原事件。

## 证据策略

快速回忆须主动点击“我已尝试回忆”才标记尝试；输入作答根据揭晓前非空输入记录尝试。
使用任何提示就不标为无提示回忆。跳过不标记独立回忆、不产生主观掌握评分。
揭晓后人工正确性判断与 0–4 自评可以矛盾，原样保存。
未核对为 ungraded，不强制用户伪造正确性。
没有 FSRS 映射、记忆概率或自动评分；这些应在 M2/M5 独立设计与验证。
响应时间以题目草稿开始至揭晓（或跳过）计算，包含中途暂停；不解释成纯答题耗时。

## 存储版本与迁移

数据库名 `RecallLab`，当前 Dexie schema 版本 1；事件有独立 `schemaVersion: 1`。
数据库只有一个已发布 schema，目前不存在旧产品数据迁移。
未来保留 `version(1)` 定义，新增 `version(2).stores(...).upgrade(...)`，在事务里迁移已有记录，
不得通过删除数据库或改写已有版本来升级。
迁移前应在 M2 增加导出备份并对旧数据库夹具做升级测试。
参考 [Dexie 版本 API](<https://dexie.org/docs/Version/Version.upgrade()>)。

## 测试与构建

Vitest + fake-indexeddb 测试校验、持久化、隔离、快照、事务与事件语义；Testing Library 验证实际交互。
原生 dialog 在 jsdom 中仅模拟 showModal/close，焦点与真实浏览器交互由 Playwright 覆盖。
Playwright 验收 10 题完整闭环、CRUD、浏览器持久配置重启及手机布局。
GitHub CI 配置使用 [checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、
[upload-artifact](https://github.com/actions/upload-artifact) 的 v7，固定 Node.js 20.20.2 和锁文件安装。

## 当前限制与扩展

全量读取本地项目和事件适合初期个人题库；大规模历史需按项目查询、分页和聚合。
会话复制完整题目队列，优先保证历史准确，未来可用不可变修订表减少重复。
没有完整运行时数据库损坏校验或恢复向导；存储错误会明确显示，不自动清空。
本轮只验证 Chromium；Firefox、WebKit、跨设备同步和浏览器存储回收尚未验收。
AI provider、文档解析、FSRS 和统计模块都在本轮范围外。
