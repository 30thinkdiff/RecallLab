# 架构与工程决策 · V0.4.1

## 运行与模块

React + TypeScript 单页应用，Vite 热更新与静态生产构建，Hash 路由，无服务端依赖。原生 CSS 与 dialog 保留首轮可用界面。

| 模块                              | 职责                                         |
| --------------------------------- | -------------------------------------------- |
| domain/models、revisions          | 数据类型、修订身份、学习证据有效性与并发令牌 |
| domain/review、analytics          | 事件构建与可解释的实际记录统计               |
| persistence/database、migration   | 保留 v1/v2，新增 v3 来源表与原始保护副本     |
| persistence/backup-format、backup | JSON schema、关系校验、导出与事务式恢复      |
| persistence/repository            | 可独立测试的业务状态转移、版本检查与事务     |
| features/study-draft              | 每标签页串行写入器与可观察草稿状态           |
| features/Study、SessionControls   | 作答、版本冲突、轮次更新与结束               |
| features/ItemDetail、EventHistory | 修订差异、完整历史与当前有效统计             |
| features/Storage、Archive         | 升级前备份、恢复预览、保护副本与归档恢复     |

## 修订与有效学习证据

`PracticeItem` 是当前有效题目的投影，包含 `currentRevisionId`、数字修订号与 `learningStateId`。
`PracticeItemRevision` 以 `itemId:rN` 唯一标识，保存前驱、操作分类、修改原因、学习影响与完整快照。
仓库只追加修订，不更新或删除已有修订。

`ReviewEvent` 永远保留发生时的快照、原始作答、提示、核对来源和主观评价。
新事件 schemaVersion 2 的快照含修订与学习状态标识；旧 schemaVersion 1 事件原样留存，通过修订表关联，不回填或改写原始事件。

| 修改类型               | 默认学习影响                        |
| ---------------------- | ----------------------------------- |
| 首次创建               | 新学习状态                          |
| 旧版迁移，性质未知     | 各观察到的旧修订独立状态            |
| 用户明确选择格式性修改 | 保留有效证据，用户声明含义/考核不变 |
| 澄清                   | 默认重学，仅显式确认考核不变才保留  |
| 实质性更正             | 新状态，禁止继承旧成绩              |
| 知识替换               | 新知识单元及新状态，旧知识单元留存  |

当前有效事件要求题目 ID 相同且事件关联的学习状态等于当前状态。
因此无影响修订可以继承，不同知识目标或更正版本不会混入当前统计。分类来自用户操作，不声称 AI 或系统验证了语义等价。
未来 MemoryState/FSRS 应以学习状态标识隔离证据；本轮没有调度、预测概率或自评映射公式。

## 轮次计划与执行

`StudySession` 保留已完成队列前缀和 `index`，其事件位置不变；剩余部分允许更新。
新题默认不加入，仅由用户明确选择加入；“下轮再学”不改变本轮数量。
同步操作更新待答修订、排除归档题，不能改写已完成前缀。
提交当前事件时也会读取后续题目的最新版本并排除归档，不必完成整轮再更新。

当前题目修订不一致时禁止保存草稿、揭晓或评分。用户明确加载新版后，原草稿另存 `DraftRecovery`，当前题重答。
当前题归档时同样停止评分，更新后移除，不制造 skipped 或 incorrect 事件。
结束轮次将其设为 ended，保留已完成事件及当前有意义的未提交草稿副本；重新开始在同一事务结束旧轮次并建立新轮次，不重置历史。

## 多标签页并发

旧实现的问题是用数据库值初始化 React useState 后不再采用 liveQuery 更新，且写入没有基础版本比较；并非直接归因于 IndexedDB 同步延迟。
[Dexie 文档](<https://dexie.org/docs/dexie-react-hooks/useLiveQuery()>) 说明同 origin 的 Dexie 变更可跨标签页被观察。本轮继续使用它通知视图，但不把通知当作写入锁。

每个关键操作在事务内验证：

- `generation`：恢复备份后更新，防止旧页面的同 ID 令牌复用。
- `planVersion`：队列改变后更新，防止相同位置已换题却收到旧写入。
- `draftVersion`：每次草稿变更递增，拒绝过期基础版本。
- `revisionId`：必须匹配轮次当前快照及题目当前有效版本。

每页面的 StudyDraftController 将快速输入串行保存。自身写入标记用于区分通知先于 Promise 返回的正常情况。
干净页面采用观察到的新草稿；存在本地未保存输入时保持可见副本，拒绝覆盖并要求显式载入。
冲突输入可存为暂存副本或下载；未解决文本还保存在本标签页 sessionStorage，不能跨页面自动合并。
揭晓后禁止写入揭晓前字段。事件追加与轮次推进同一事务，唯一 `(sessionId, queueIndex)` 确保重复提交最多一条。

## 备份、升级与恢复

数据库 v1 定义保持不变，通过 [Dexie upgrade](<https://dexie.org/docs/Version/Version.upgrade()>) 新增 v2；V0.3 再新增 v3 资料表，v2→v3 不改写既有实体。
应用在正常查询打开新版前，用 [动态模式](<https://dexie.org/docs/Dexie/Dexie.open()>) 读取旧库，先提供完整 JSON 下载；用户确认后才升级。
升级事务先保存原始 v1 JSON 到 `recoveryBackups`，再变换题目、轮次并恢复可观察修订。出错则整体回滚，原 v1 库留存。

旧事件不修改。旧题库、轮次与事件可观察到的同一修订必须内容一致；矛盾时停止升级，保留备份和旧库。
没有被保存过的历史中间版本无法还原；旧修订修改类型、原因及准确时间未知，不做虚构推断。

备份 formatVersion 1，支持 databaseVersion 1/2/3，包含所有学习实体及归档数据，不递归携带自动保护副本。
恢复先验证类型、唯一 ID、项目归属、修订链、快照一致性、学习状态隔离、事件与完成前缀、暂存引用等。
用户预览确认后，在事务里捕获当前原始数据、替换全部学习表、重新检查实际写入关系。
失败整体回滚，保护副本也不会部分提交；有效备份可用于修复当前损坏数据，其原始状态仍另存保护副本。
所有恢复后轮次重新生成 generation，使其他标签页无法使用恢复前令牌。
备份上限 50 MB。旧文件的异步读取结果不能替换后续选择的文件。

## 测试隔离与报告

日常环境：5173 / RecallLab；Playwright：专用 Vite test mode、5174 / RecallLab-test，禁止复用现有服务器。
每测试使用独立浏览器上下文，进程重启测试用专属临时持久配置；Vitest 用随机命名内存 IndexedDB。
公开夹具采用固定 ID 与日期，可重复生成并检查；浏览器升级用例创建真实 native IndexedDB v10（Dexie v1）及原版索引。
无生产清库或自动演示数据入口。所有初始化仅在测试代码或用户明确恢复备份时发生。

CI 运行夹具、类型、Lint、格式、单元/组件、构建和浏览器测试。总表、失败原因、HTML/JSON/JUnit、截图与 Trace 关联 SHA；不上传临时浏览器配置。
测试矩阵与调试见 [TESTING.md](TESTING.md)。通过测试不能证明不存在其他 Bug。

## 限制

写操作仍使用较宽的本地事务范围保障完整性；V0.4.1 视图按表独立订阅，学习/项目/单题历史使用已有索引限制范围，避免草稿触发全量历史读取。全局概览、全部历史统计和完整备份仍按需读取全量；列表以 100 条增量显示，尚未声称支持无限规模。
跨标签页不提供多人实时文本合并。文件导入只有应用备份格式，不是通用题库导入。
当前仅验证 Chromium；未加入完整 FSRS、AI、账号、云同步或 PWA。

## V0.3 资料导入与来源

SourceDocument 保存文件名/格式、字节数、SHA-256、提取原文、页码/状态、章节位置、警告和解析器版本。
原始二进制不存库。提取文本按原样保存，学习内容在 KnowledgeUnit / PracticeItem 的不可变修订链中独立修改。
SourceReference 保存 documentId、UTF-16 start/end、实际 excerpt，可附 page、sectionId、recordIndex。保存与恢复都校验原文切片和页码归属；不可用页不会生成正常来源。

`importing/text` 负责纯解析和真实记录定位，Papa Parse 处理 CSV 引号与多行字段；明确问答才生成候选。
`importing/pdf` 延迟加载本地 PDF.js Worker，逐页提取、保留异常页，不执行 Viewer 脚本；乱码、空白、失败和未知顺序不伪装成完整正确内容。
`ImportCandidate` 只是可编辑预览，带实际来源。普通段落/PDF 选文不会自动编造问题。
未来 AI 可以实现新的候选生产器，但必须引用同一来源校验合同，经过同一预览/人工确认 API，不能直接覆盖已确认答案或原文。

`commitImport` 在写事务之前校验候选并计算请求摘要；事务内再次检查目标项目、重复题及来源，创建资料/知识单元/题目/初始修订。任何失败回滚全部新增内容。
资料 ID + 请求摘要使重复确认幂等；更改请求不能静默重用已提交结果。导入不修改已有学习事件或记忆状态。
编辑导入题目时保留结构化原文引用，即使修改显示名称，原始 excerpt/page 也不会被标签字符串覆盖。

v3 通过新增 store 和升级事务保护 v2 原始快照，不改变已发布 v1/v2 的表结构。v1→v3 可顺序执行两个迁移，每次原始快照可下载。
完整备份包含 sourceDocuments 与全部学习实体；恢复继续验证修订、完成前缀和来源引用，重置轮次 generation 以拒绝旧标签页写入。

资源上限与格式见 IMPORT_GUIDE.md。PDF 限额和超时保护不等于对所有复杂排版的准确性保证。
导入与 PDF 均独立代码块，初始应用不下载 PDF.js/Worker；无运行时 CDN 或文档上传。

## V0.3.1 中文 PDF / OCR

PDF.js 5.5.207 官方 legacy 主模块与对应 Worker 配对，保持 isEvalSupported=false 和 stopAtErrors=true。本地静态打包同版本 cmaps / standard_fonts / wasm；开发和发布文件分别验收。文字提取与页面绘图异常独立记录；无文字不是扫描件的充分证据。

`numbered.ts` 对真实提取文本做确定性分段：问答标记、数字/括号编号、中文章节/部分/中文序号，连接跨页片段并剔除独立页码。来源引用始终是不可变原文的连续 UTF-16 区间，跨页引用使用 page/endPage 并校验两端和中间失败页；学习答案允许去页码、分离口诀与解释，原引用保留完整证据。普通声明使用原文复述模板并标记待核对，缺答案的问题不拿题面充答案。文档标题、未归类原文、待核对和跨页计数一起预览。

OCR 通过动态模块加载 Tesseract.js 7，Worker、LSTM WASM、中英文 best-int 语言数据均由本机 origin 提供。用户明确启动，只处理图片/疑似乱码/图文混合页；混合页的原文字层保留为 textLayer，OCR 结果为单独来源层。method/confidence 与警告随资料备份，页面图像预览不入库。取消通过 AbortSignal 终止流程/页绘制/已创建 OCR Worker；初始化中尚未交出的 Worker 在就绪后终止。

没有更改 Dexie store 或索引，V0.3.1 当时 schema 为 v3；仅新增可选 title、page.method/textLayer/confidence/kind 和引用 endPage，旧数据与旧备份不需要改写。新字段在完整备份、快照和引用校验中保留，既有迁移及事务回滚测试继续运行。

私有验收脚本在仓库外，只报告数值；普通自动化和 CI 一律只使用公开虚构内容。无法复现的原始异常不编造根因，详见 V031_CHECKPOINTS.md。

## V0.4 证据与 FSRS

`scheduling/engine` 固定 ts-fsrs 5.4.2，request_retention=0.90、enable_fuzz=false、enable_short_term=true；只调用库的 createEmptyCard/next，不训练或重造遗忘曲线。`policy` 独立决定评分，`planner` 负责本地日期/排序/配额，`service` 在已有事务中更新状态。React 只做输入与解释。

MemoryState 以 learningStateId 为键，关联项目、PracticeItem、KnowledgeUnit、最后实际评分的修订、状态版本与可序列化 FSRS 卡片。新题显式加入正式计划时才初始化；v4 升级不回放旧事件。实质更正使用新 learningStateId，旧行和日志留存；格式修订保留状态但仍校验内容一致。跨题目共享学习状态及继承不同答案的已评分状态会被备份校验拒绝。

StudySession.reviewPlan 保存模式/时区/预算/逐题原因、是否允许调度与预期记忆版本。每项目恢复一个已有正式计划，不静默改选范围。自定义或预算外练习的 practiceOnly 在更新队列后仍保留。已有完整轮次不设置 reviewPlan，维持练习性质。

Repository 在进入写事务前加载调度模块；事务内重新验证会话令牌、内容修订、状态所有者与版本。原 ReviewEvent、MemoryState、SchedulingLog、队列推进原子提交，事件 ID 和 eventId 唯一约束防重；写失败回滚。日志只在真实评分时带 before/after/原始 FSRS log，无评分不伪造内部日志。

新正式事件 schemaVersion=3，保留评价来源、独立回忆、提示、主观分数、揭晓前尝试及 reviewedAt；timestamp 是保存时间。reviewedAt 来自锁定的揭晓时间，隔夜晚保存不延长间隔；旧事件不回填此字段。MemoryState.updatedAt 和决策日志 timestamp 仍表示原子保存时间。

无提示完整正确按难度 2/3/4，独立失败/完整任务缺必需点按 1；提示、未尝试或未核对为教学复测，保留长期卡片并设置 10 分钟复测。跳过不改状态。无提示复测待到点才开放，不能由旧的到期时间绕过；提前/临时练习不更新长期记忆。

保留 v1/v2/v3 定义，新增 schema v4 的 memoryStates/schedulingLogs；升级前导出旧布局，事务内保留 v3 原副本、验证后仅加新表。完整备份 v4 包含调度和计划，旧版字段默认空，不制造评分。恢复在同一事务替换并保护恢复前副本，新的会话 generation 使旧标签页令牌失效。

统计只对有效内容版本计算无提示人工核对率；口头自报和提示后成功另列，工作量保留真实旧版练习。以本地回忆发生日分组，旧事件保留原保存日。无预测概率/个人优化宣称。学习、今日页面及算法按需加载，PDF/OCR 不参与启动阻塞。

## V0.4.1 核对与可靠性

StudyDraft 可选 assessment 保存核对方式、标记、整体人工结果、自评和难度。揭晓前输入仍被锁定，updateAssessment 只能在揭晓后写，沿用事务/基础令牌/串行 controller；过期标签页保存核对时同样拒绝覆盖。新 UI 事件 schemaVersion=4，criterionChecks 逐项保存 index/criterion/result/source，详细汇总由 domain/assessment 确定，组件传入的乐观整体结果不能覆盖。旧 API 无新增草稿时保留旧证据模式，不回写旧事件。

数据库仍是 v4，无 store/index 变更；备份增加可选字段并核对快照要点、汇总和人工来源。qualityReviewedRevisionId 是本版人工检查记录，不是机器验证；内容修订后清除，新旧内容和原事件不变。两种活动轮次按 projectId+free/scheduled 分别唯一，修复 #9 两类并存却无法完整备份的问题。

workspace-data 按视图查询事件/修订/活动轮次，分开订阅避免 sessions 写入触发 reviewEvents 全表扫描；review-data 在每日页按所选项目查询，统计直接复用同份结果。本地日历缓存 Intl 格式器但每次按实际 Date 计算，未缓存时区偏移，不改变夏令时语义。根模块按 React/存储/校验拆块，PDF/OCR/调度仍按需加载，不改变 FSRS 公式。

发布构建生成 service-worker.js，仅缓存公共壳、哈希 JS/CSS（含学习路由和调度），同源 PDF/OCR 资源按需缓存。安装完整缓存后才激活；不 skipWaiting 打断旧标签页，激活后清理旧壳。GET 白名单不包括数据 API、上传或 IndexedDB；缓存失败不得阻塞正常读取。不在开发/测试 Vite 模式注册持久缓存。离线不能替代完整备份，浏览器清站点数据仍会丢失本地记录。
