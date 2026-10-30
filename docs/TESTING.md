# V0.6.1 实际验证

本机完整221单元/组件通过，3个按需真实模型任务未启用；96 Chromium、54 Firefox（纽约时区）、6发布/离线全通过，浏览器失败/重试均0。夹具、严格类型、Lint、格式、构建及npm audit0通过。新测覆盖：通知竞态与同步输入；明确/不完整题子集；桌面1440/窄屏390；完成后的当前状态/历史计数；合格证据与弱项；夏令时/午夜；活跃预算耗尽与漏日；默认路径离线重开/来源/历史。原学习、导入/PDF/OCR、AI草稿、v1—v8/备份、修订、CAS和1000题规模测试均保留。

原CI失败实际Trace/截图定位为同步后旧令牌假冲突，新增受控通知测试与原例重复10次通过，没有增加等待时长、删断言或配置重试。功能613941ff两类CI通过；最终收尾同HEAD结果与附件见[PR #16](https://github.com/30thinkdiff/RecallLab/pull/16)。

指标脚本tests/e2e/product-journey.spec.ts在旧UI archive2b55b8ca（复制同一测量脚本）设置RECALLLAB_JOURNEY_PHASE=baseline，在当前UI默认candidate，均单worker/同浏览器/同69条虚构短问答，各重复3次。RECALLLAB_WRITE_UX=1才落本机评测文件，可用RECALLLAB_UX_OUTPUT_DIR指定隔离输出；RECALLLAB_UX_SHA记录实际代码快照。正常CI只附指标，不覆盖已公开实测文件。npm run metrics:product汇总，fixtures:check核对摘要一致性。对新UI设置baseline不构成旧版模拟，必须使用真实旧UI隔离快照。

所有时间是脚本时间，不是用户理解/回忆耗时，未做真人试验。两浏览器/时区、390px布局不等于真机iOS/Android或Windows/macOS已验证；没有WebKit结果。详见[完整产品评测](evaluations/V061_PRODUCT_REPORT.md)。

以下保留历史版本与工程操作说明。

# V0.6 实际验证补充

本地完整check通过：211单元/组件（3个已有按需真实模型测试明确跳过）、夹具、类型、Lint、格式、构建。90 Chromium、48 Firefox（纽约时区）、5生产/离线全通过。含正式v7→v8原始备份与回滚、旧备份、CAS、跨日/夏令时、旧正式轮次采用新目标、动态新增/修订、简洁核对与人工更正、暂停草稿、预算耗尽。

33组策略情景是1项可复现的Vitest实验，已包含在211中；两项操作计量已包含在90中。脚本计量不是人类用时。公开CI不接触私有原文，不重跑真实AI效果，只测试既有Mock/协议与真实输出重放路径。私有11页资料只在隔离本机浏览器接受统计验收，不属于真人记忆实验。

首次完整浏览器失败的旧版本头/副本数断言已更新为v8，并保留全部历史/恢复验证；脚本标签已修正。发布版720px侧栏不可滚动的问题经真实日志定位、修复，最终5项发布测试通过。没有删除旧测试换绿。

最终GitHub CI与SHA关联的HTML/JSON/JUnit报告在PR #15，不把本地通过宣称为远程通过；两个时区浏览器并不等于已验证所有旅行/多时区情景。Windows/macOS/WebKit未测。

以下保留原有测试操作与历史矩阵。

# 自动化测试与独立审查

## 本地命令

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run test:e2e -- concurrency.spec.ts
npm run test:e2e -- backup.spec.ts
npm run test:e2e:ui
npm run test:e2e:debug -- revisions.spec.ts
npm run test:report
npm run test:summary
# 指向具体失败附件：
npx playwright show-trace test-results/<case>/trace.zip
```

`check` 依次检查固定夹具、严格类型、Lint、格式、Vitest 和生产构建。
首次浏览器安装需联网。CI 在 Ubuntu 22.04、Node 20.20.2 执行；本地缺系统库时按 Playwright 提示安装。
没有自动重试掩盖失败；单 worker 避免共享端口与资源竞争，CI 禁止提交 test.only。

## 隔离与可复现数据

| 环境           | 端口 / 数据库                      | 初始化                                   |
| -------------- | ---------------------------------- | ---------------------------------------- |
| 日常开发       | 5173 / RecallLab                   | 不自动种入测试数据                       |
| Playwright     | 5174 / RecallLab-test              | 每用例独立上下文，必要时 UI 恢复虚构备份 |
| 浏览器重启测试 | 同一测试 origin / 专用临时持久配置 | 仅本用例创建并关闭、重启浏览器进程       |
| Vitest         | fake-indexeddb / 随机测试库名      | beforeEach 建库，afterEach 删除测试库    |

测试服务器使用 `--mode test`，拒绝复用已运行服务器；测试初始化代码没有打入生产包。
`tests/fixtures/blank.html` 是无应用代码的测试 origin，升级用例在此用 native IndexedDB 建立原版表与索引，再进入应用走真实升级门禁。
不存在生产清库按钮或匿名调试写库 API。

`tests/fixtures/legacy-v1.json` 是可公开的虚构资料：固定 ID/日期、两项目、长答案、三条提示、相似问题、跨日多次练习、相反人工核对/自评、错误旧答案、修订答案、归档与未完成草稿。

```bash
npm run fixtures          # 生成 JSON 文件，不连接浏览器数据库
npm run fixtures:check    # 字节级比较规范化生成结果
```

浏览器备份重启用例使用 Playwright clock 固定日期；统计单元测试显式指定时区。界面浏览器测试统一 `zh-CN` / `Asia/Shanghai`。日常运行仍使用用户浏览器时区。

## 核心验收矩阵

| 任务书用例           | 自动化位置                                    | 检查结果                                                       |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| A 新增 20 题加入本轮 | revisions.spec.ts · A                         | 默认 2 题，可下轮再学，明确加入后 22 题，原输入保持            |
| B 修改待答题         | revisions.spec.ts · B                         | 当前草稿不变，后续使用新答案                                   |
| C 当前版本冲突       | revisions.spec.ts · C/D                       | 旧页面禁止揭晓/评分，保留输入再载入新版                        |
| D 错误答案更正       | C/D、history.spec.ts、analytics.test.ts       | 旧快照完整，当前有效成绩归零，重学提示                         |
| E 格式修改           | revisions.spec.ts · E、history.spec.ts        | 学习状态继承，原证据仍有效                                     |
| F 学习中归档         | revisions.spec.ts · F/G、backup.spec.ts       | 待答不出现；当前归档停止评分，无假跳过事件                     |
| G 结束轮次           | revisions.spec.ts · F/G、repository.test.ts   | 已完成事件保留，未提交作答另存，重开不清历史                   |
| H 两页输入           | concurrency.spec.ts · H、study-draft.test.ts  | 已观察更新可继续；过期写拒绝且保留输入                         |
| I 揭晓锁定           | concurrency.spec.ts · I/J、repository.test.ts | 两页锁定，过期异步写无法改证据                                 |
| J 两页提交           | concurrency.spec.ts · I/J                     | 同一位置只有一条事件，下一题不被二次推进                       |
| K 历史快照与修订提示 | history.spec.ts · K/L                         | 原作答、旧答案和“已修订”提示正确                               |
| L 题目完整历史       | history.spec.ts                               | 全部事件/版本、差异、统计、暂存副本可查看                      |
| M 真正旧库升级       | backup.spec.ts · M、backup.test.ts            | 先下载 v1，实际 native v10 升至当前 Dexie v4，原事件与草稿保留 |
| N 备份恢复与重启     | backup.spec.ts · N                            | 导出/导入后重启浏览器进程，修订与事件关系不变                  |

另有原 M0/M1 10 题完整闭环、CRUD、项目隔离、手机布局回归，以及过期题目编辑、备份文件读取竞态和无效数据拒绝。
并发 UI 用例允许观察到新版本后顺序写入并收敛；单元测试用相同基础版本确定性制造竞争，要求恰有一个拒绝，不能仅凭偶然时间窗口通过。

## 失败路径与数据安全

`backup.test.ts` 在真实 Dexie v1 架构上升级，验证：

- 原始 ReviewEvent 不被修改；归档题及未完成轮次保留。
- 引用不一致时升级事务回滚，库版本仍为 v1、记录仍在。
- 恢复写入中途模拟磁盘错误，所有表与保护副本同时回滚。
- 结构/引用/快照/完成前缀或学习状态错误的备份在替换前拒绝。
- 可用有效备份修复当前损坏数据，原损坏状态另存原始副本。
- 恢复后更换 generation，旧标签页令牌不再有效。

修订与轮次的业务规则在 repository、revisions 和 analytics 模块，可独立测试；关键约束没有埋在 UI 回调中。

## CI 报告与证据

GitHub Actions 自动运行检查与浏览器矩阵。始终尝试上传 `playwright-report-<完整 SHA>`，保留 14 天：

- HTML：完整用例、步骤和附件，可下载后 `npx playwright show-report <目录>`。
- `test-results/results.json`：机器可读统计和失败信息。
- `test-results/junit.xml`：JUnit 结果。
- 失败用例目录中的截图、错误上下文与 `trace.zip`。
- Job Summary：Commit SHA、通过/失败/跳过数量、失败位置和原因。

临时持久浏览器配置从上传中排除。报告仅包含公开夹具和自动生成的虚构测试内容；测试不访问日常库、用户私有资料或 API 密钥。
前置步骤失败而没有浏览器报告时，摘要明确写“未产生报告”，不视为通过。
远程 CI 的状态以具体 SHA 的运行结果为准，不把本地通过混同为远程通过。

## 审查建议与边界

先看备份/迁移、修订状态与 token 检查，再看 UI 和对应测试；各阶段的记录在 CHECKPOINTS_V2.md。
V0.2 PR #2 以 PR #1 为基础；V0.3 叠加在 PR #3 上，V0.4 PR #8 叠加在 PR #7 上，均不自动合并或发布。
测试通过只验证所覆盖情形；此旧阶段尚未覆盖 Firefox/WebKit、真实系统崩溃、所有存储配额与大规模数据压力。
没有为可选审查预览发布公开网站，也没有上传任何本地真实 IndexedDB 数据。

## V0.3 导入验收矩阵

V0.3 阶段验证：78 项单元/组件、32 项浏览器，包含前述 V0.2 A–N 回归。远程结果以具体 SHA 的 CI 为准。

| 本轮要求                               | 定位与证据                                                            |
| -------------------------------------- | --------------------------------------------------------------------- |
| 合法 JSON / 69 题一次确认              | importing/text.test.ts；import.spec.ts 的 69 题用例                   |
| CSV/TSV 分隔、引号、多行、中文/Unicode | text.test.ts 三种分隔；import.spec.ts 各格式完整学习                  |
| TXT/Markdown 明确结构与未知正文        | text.test.ts；import.spec.ts；pdf.spec.ts 普通 TXT 选文               |
| 损坏/不完整与预览取消                  | import.spec.ts；缺答案可补全后导入；取消不写资料/项目                 |
| 重复与已有项目追加                     | service.test.ts、import.spec.ts；重复默认不选，不覆盖原答案           |
| 事务失败回滚与重试幂等                 | service.test.ts：第二条写入失败时所有新增回滚，双确认只创建一次       |
| PDF 页码/位置、真实文本提取            | pdf.spec.ts 使用实际 PDF.js 与双页合法 PDF，选第二页、备份核对 page=2 |
| 扫描、损坏、混合空白页、疑似乱码       | pdf.spec.ts 三种真实 PDF；pdf-layout.test.ts 的替换/控制字符检测      |
| 导入即学、改题后来源与旧历史           | import.spec.ts、pdf.spec.ts、sources.test.ts、service.test.ts         |
| 旧数据升级/旧备份、资料备份恢复        | backup.test.ts 的 v1/v2→v3 与失败回滚；PDF 完整备份 UI 恢复           |
| 桌面与基本手机操作                     | import.spec.ts CSV；pdf.spec.ts PDF 选文与无横向溢出                  |

新夹具位于 `tests/fixtures/import`，生成脚本为 `generate-import-fixtures.mjs` 和 `generate-pdf-fixtures.mjs`，包含公开虚构 69 题、结构化小样、普通讲义、文本/图片/混合/损坏 PDF。
CSV 使用人工独立编码的已知字段，PDF 由最小标准对象/xref 生成；并非用解析器输出反过来伪装期望值。
PDF 桌面用例还断言没有向本机测试 origin 以外的 HTTP 服务发请求。

`npm run fixtures` 会生成全部公开夹具，`fixtures:check` 检查字节可复现。原始 Markdown 夹具保留问答换行，不接受格式器将 Q/A 合并为普通段落。
CI 额外运行依赖审计；审查入口为 V0.3 PR，基础是已通过 CI 的 PR #3。
当前未覆盖加密 PDF 的完整密码交互、所有字体/复杂排版、系统级断电/配额边界或非 Chromium 引擎；不将这些写成已验证。

## V0.3.1 真实文档矩阵

以下均是公开虚构内容或合法字体子集；私有原件不作为 CI 夹具，私有验收仅输出统计。

| 场景                                                           | 实际覆盖                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| WPS 风格中文、嵌入 Type0/CID TrueType + Identity-H + ToUnicode | chinese-cid.pdf，自行生成的 10 页虚构题库，6 章/69 条；不是声称由 WPS 直接导出的文件               |
| 中文跨页长答案、章节编号重置、括号子点、页码                   | chinese-cross-page.pdf + numbered.test.ts；引用 page/endPage 与原文范围校验，备份恢复              |
| 外置 CMap、乱码/缺失映射、较旧运行时                           | predefined-cmap / chinese-corrupt-map；主模块与 Worker 缺新辅助函数仍可读；PUA/替换/控制字符告警   |
| 英文文字型 PDF                                                 | 原有 text-two-pages.pdf 回归继续通过                                                               |
| 图文混合、仅部分页可读、缺失页                                 | mixed-inline / mixed-pages / missing-page；异常不改判扫描件，混合 OCR 保留原文字层                 |
| 中文扫描件、多页 OCR、英文 OCR                                 | chinese-scanned / english-scanned，真实本地 Tesseract + 语言数据，图像核对与编辑、取消、无外部请求 |
| 模糊页面、空白、加密、损坏                                     | blurred-scan / blank / encrypted / broken；保留未验证状态，各自提示，不无声成功                    |
| 大文件/大页数                                                  | 超 20 MB 文件在浏览器选择后拒绝；201 页合法 PDF 在提取前拒绝                                       |
| 导入→学习→来源→备份恢复                                        | chinese-pdf.spec.ts；OCR 结果和 method/confidence 完整备份恢复；原有历史/修订/冲突全量回归         |
| 桌面与基本手机                                                 | chinese-extraction.spec.ts；保留原有 import/pdf/learning 手机回归                                  |
| 发布文件资源                                                   | `npm run test:production`，在 5175 验证构建产物的 CMap、匹配 Worker、OCR WASM/中英文资源，没有 CDN |

V0.3.1 阶段本地结果：86 项单元/组件、46 项主浏览器回归（含原有 32 项行为场景）、2 项发布产物测试通过；没有删除失败项以通过测试。
扫描件旧行为测试由“拒绝后提示没有 OCR”更新为“必须明确启动 OCR、空文字禁止保存、取消不留资料”，保留原保护意图。
生产测试使用单独 reporter，报告在 `test-results/production` 与 `playwright-report/production`，同一提交关联 artifact 一并保留。CI 最后摘要分别列出主回归和生产资源验收结果。

`npm run fixtures:check` 可复现 JSON/表格及全部手写 PDF；扫描 PDF 从已提交的公开图像资产重建。可选 `subset-fictional-font.py` / `generate-raster-pdf-assets.py` 可重新子集/光栅化，依赖只用于开发，不是产品启动要求。加密 PDF 有随机盐，不要求字节重复生成，实际解析行为由回归检查。

真实文件本地验收：11 页、6 部分、69 条（31/22/3/3/8/2），逐页去空白后与 PyMuPDF 一致；7 条模板问题、10 条跨页、12 字符未归类明确报告。完整私有流程含确认导入、学习一题、来源查看及内存备份恢复，无真实正文/截图进入报告。原始失败触发条件仍未重现，不作为“已定位根因”报告。

## V0.4 可信间隔复习矩阵

新增测试只使用虚构学习内容；可控时钟覆盖本地日历边界与连续一周的实际到期复习，不强行构造不存在的成功记录。原 V0.3.1 的 PDF、OCR、导入、并发与历史证据用例继续运行。

| 要求               | 自动化位置与实际断言                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1 新题初始化       | scheduling/service.test.ts：显式建立空 FSRS 状态，不回放旧记录                                                        |
| 2 独立正确评分     | policy.test.ts、scheduled-review.spec.ts：合法 Hard/Good/Easy，默认 Good                                              |
| 3 失败不是 Hard    | policy/service.test.ts：错误或完整复述遗漏必需内容都是 Again                                                          |
| 4 提示不冒充成功   | service.test.ts：卡片不变、10 分钟无提示复测、单独保存决策                                                            |
| 5 跳过不造失败     | policy/service.test.ts：无评分、不推进状态、不扣题数预算                                                              |
| 6 自评与错误矛盾   | scheduled-review.spec.ts：人工核对错误、自评 4 仍为 Again                                                             |
| 7 原子性           | service.test.ts：调度日志写入失败时事件、状态、位置全部回滚                                                           |
| 8 刷新恢复         | scheduled-review.spec.ts、daily-review.spec.ts：输入/揭晓锁/计划仍在                                                  |
| 9 跨标签重复       | service.test.ts 确定性并发恰一成功；原 concurrency.spec.ts 继续回归                                                   |
| 10 错误答案修订    | service.test.ts：新 learningStateId，旧卡仍存但当前不继承旧成绩                                                       |
| 11 格式修订        | service.test.ts：有效状态保留；伪造跨内容继承的备份被拒绝                                                             |
| 12 迁移与恢复      | backup.test.ts：v3→v4 原事件不变、损坏升级回滚、旧备份；review-delivery.spec.ts 完整调度导出/恢复和真正浏览器进程重启 |
| 13 跨日队列        | planner.test.ts、daily-review.spec.ts：长期按本地日，分钟级按时刻                                                     |
| 14 目标日期/时区   | planner.test.ts：Asia/Shanghai / America/Los_Angeles 边界、目标前 7 天；非法时区备份拒绝                              |
| 15 预算耗尽        | planner.test.ts、daily-review.spec.ts：默认每日新题数、2 分钟配额、预算外加练不更新 FSRS、传统练习也计工作量          |
| 16 原始证据分离    | service.test.ts、scheduled-review.spec.ts：输入、自评、核对、提示、实际评分独立保留                                   |
| 17 暂停继续        | daily-review.spec.ts：返回今日页后恢复原草稿/范围                                                                     |
| 18 不伪造概率      | service.test.ts、review-delivery.spec.ts：无样本正确率为空、口头自报单列、未展示个人概率                              |
| 19 PDF进入正式复习 | review-delivery.spec.ts：公开中文 CID 69 条 PDF→导入→正式 Good；daily-review.spec.ts 另测 JSON 69 题                  |
| 20 原回归          | 完整 test:e2e 和 test:production，包含原 PDF/OCR 和资源用例                                                           |
| 题干质量/修改保护  | readiness.test.ts、review-readiness.spec.ts：陈述不复制答案、待完善批量保存后才可学、重跑 OCR 拒绝覆盖后保留修改      |
| 晚保存与一周历史   | service.test.ts：隔天保存使用实际回忆时间；连续 7 天按真实到期队列复习，日志数/卡片次数/统计/完整备份一致             |

本轮本地 119 项单元/组件、54 项主浏览器回归及 2 项发布产物测试通过；固定夹具、类型、Lint、格式、构建及完整/生产依赖审计通过。最后的晚保存排序调整再次通过 119 项和静态/构建检查，最终 CI 会重新跑完整浏览器矩阵；远程结果及报告与最终提交 SHA 关联，见检查点和 PR #8。不将已有测试矩阵之外的浏览器、操作系统、系统断电或所有存储配额场景宣称为已验证。

## V0.4.1 学习质量与规模矩阵

新增验收与旧矩阵一起运行，没有删除原保护测试：

| 范围          | 测试与证据                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自由/正式入口 | practice-isolation.spec.ts：各自恢复，练习不写调度；同时活动可完整导出。service.test.ts 同时恢复两种活动轮次                                                   |
| 69 题完整目标 | learning-lifecycle.spec.ts：核对导入→30 分钟/新题上限→输入→次日正式复习→错误+自评 4 为 Again→更正答案→新版隔离→历史来源→完整导出/恢复                          |
| 逐项核对      | assessment.test.ts、service.test.ts、criteria-check.spec.ts：全部必需项、遗漏/错误/无法确认、来源、草稿暂停刷新、原子并发、备份汇总校验                        |
| 题目质量      | quality.test.ts、readiness.test.ts、repository.test.ts：泄露/笼统/长答案缺要点/编号相同/OCR/异常来源提示，人工检查按版本，批量过期回滚，检查不解除无效题干保护 |
| 30 天/3 项目  | longitudinal.test.ts：15 题、纽约夏令时结束、目标日期、预算/新题上限、自由练习、提示、失败、实质更正/格式继承、中途/末尾恢复，无旧历史 FSRS 回放               |
| 100/1000 题   | scale.spec.ts + support/scale.ts：4 项目、1000/10000 事件、200/2000 修订、前 10 题长答案、中英文/Unicode，约 3.15/21.85 MB 完整备份，实际恢复对照              |
| 查询开销      | scale.spec.ts 监听 reviewEvents.toArray，要求切换作答模式+输入期间全量历史读取为 0；不是用计时阈值掩盖机器差异                                                 |
| 第二浏览器    | test:firefox，独立 Firefox 配置，America/New_York 时区；覆盖核对、预算、生命周期、并发、规模、中文 PDF。结果未通过前不得写成已覆盖                             |
| 离线重开      | production/offline.spec.ts：发布壳真实 ServiceWorker 缓存→关闭页面→断开网络新开页面→恢复草稿→逐项核对→正式 Good                                                |
| 原 V0.3.1     | 原有中文 PDF/OCR、备份、修订、历史证据、手机和并发持续完整回归                                                                                                 |

本机单次规模测量（非性能保证）：优化前 100/1000 题的项目开页 127/633 ms，恢复并再次导出 434/3371 ms，输入阶段均 2 次全量历史读取；优化后完整 Chromium 回归样本为 176/525 ms、411/3139 ms，输入阶段均 0 次。时间有噪声且未做统计显著性分析，不据此宣传提速比例。全局概览/全部历史统计/完整备份仍需要全量数据，未验证无限规模或所有磁盘配额。

真实 PDF 只在本机独立浏览器中验收，输出 11 页/6 部分/69 条、10 条跨页/12 个未归类字符/7 条待完善及一致性布尔值。逐页与本地 PyMuPDF 去空白后相同，完整私有流程及来源/修订/内存备份恢复通过，外部请求 0。没有真实正文、路径、截图、原文件或含原文备份进入仓库、CI、公开报告。

最终数量、第二浏览器/离线结果及对应 SHA 的 CI 见 V041_CHECKPOINTS.md 和 PR #10。Firefox、production 子报告独立输出在原 SHA artifact 内，汇总分别记录无报告/通过/失败，不把没有报告视为成功。

V0.4.1 最终收尾补充：backup.test.ts 的两个新增测试要求初始化探测不调用 deleteDatabase，并发首次写入原记录保留；Firefox 规模测试无需先等待 UI 门禁，能复现旧探测问题并验证新保护。criteria-check/lifecycle 在旧 CI 揭示时序问题后保留断言，使用稳定阶段节点、combobox 定位并等待事务对应的 UI 完成状态，不使用重试掩盖。最终矩阵为 60 项 Chromium、16 项 Firefox、3 项发布资源，结果见检查点及 PR。

最终本地完整复跑实际结果：131 项单元/组件、60 项 Chromium、16 项 Firefox、3 项发布资源/离线全部通过，无失败/跳过/自动重试。Firefox 1000 题单次样本：21.85 MB 备份、项目开页 442 ms、恢复+再次导出 6388 ms、输入期间全量历史读取 0；时间不是性能承诺。远程最终结果仍以 PR #10 的最终 head SHA 为准。

## V0.5 Alpha AI 测试边界

`src/ai/providers.test.ts` 与 `generation.test.ts` 分别覆盖通信/隐私协议和候选/来源/事务/修订/备份；模拟网络、Mock 和生成器故障是重复性保护测试，不属于真实模型效果。

`tests/e2e/ai-workspace.spec.ts` 覆盖原文保存→主动启用→候选修改/要点管理→确认→正式 FSRS→备份恢复、站内草稿、缺失引用、密钥不落盘、网络/JSON 故障及手机布局。HTTP 测试使用被 Playwright 拦截的虚构域名，不需要真实密钥。AI 工作台也加入 Firefox 矩阵。

可选真实模型评测脚本 `scripts/evaluate-ai.mjs` 只接受回环地址，使用可公开的虚构中英文和注入样例；输出候选数、引用定位/缺失、要点覆盖字符、失败与耗时，不输出原始模型内容、不自动确认。先由工程侧准备本机模型；该评测不在公共 CI 依赖网络/模型。真实私有 PDF 验收脚本与正文只留本机，公共报告仅页数/数量/错误类型和通过与否。

实际运行结果与完整限制在 V05_CHECKPOINTS.md；不把旧 SHA 的通过结果冒充最终代码，也不把 sourceMatched 解释为语义正确率。

## V0.5.1 验收入口

当前本地169单元/组件、74 Chromium、34 Firefox（含纽约时区）、4生产版/离线全部通过；最终CI按PR #12精确SHA核对。新增ai-drafts、ai-review、ai-capacity与离线候选恢复；旧数据库/历史/FSRS回归保留。真实模型任务在普通CI显式跳过，不能把CI绿色视为模型理解能力通过。

固定10份CC0材料的真实20次调用、全输出、分析脚本和局限见evaluation/、docs/evaluations/V051_MODEL_REPORT.md。另有仅本机的11页私有PDF验收，无正文统计在docs/evaluations/v051-private-statistics.json；不提交原PDF、截图、私有备份或原始模型正文。公开真实网页闭环与资源部署记录另列，均非真人用户效果试验。

容量场景为已有1000题/10000事件再加1000条含AI来源的题目与20草稿，紧凑JSON约44.4MiB，Chromium/Firefox恢复一致；50MiB上限仍可能被更长资料超过，不宣称无限规模。实际用户确认率/修改量/可用题准备时间未测量。

## V0.5.2 验收入口

公开参考由24份CC0虚构资料构成，作者和审阅者均明确为AI工程执行者，没有独立真人金标准。三种实际方案结果、全部迭代/失败及9项脚本操作成本见 [V052_MODEL_REPORT](evaluations/V052_MODEL_REPORT.md)；模型测试与CI重放分开。`fixtures:check`核对参考生成、全部72条对照、原始文件SHA及逐条审阅快照，修改原文/必需内容不能复用旧测量。

新增覆盖：非背诵目标仍锁原文、完整单元引用、显式行动拆分、枚举不明不猜、过多单元/要点保留可保存状态、只撤销变化条目的核对、暂不制卡及恢复、相同答案重复比较、可选/必需不直接合并、模型链接失效不启动/下载替代、实际UTF-8草稿总容量和并发事务、v6带草稿/历史升级v7及回滚。

大备份包括实际大于50MiB普通JSON及其去重文件、Unicode/保留字符、内容篡改、越界引用、展开炸弹和128MiB边界。浏览器2000题/10000事件/20草稿加大原文，验证题目/修订/来源/事件/记忆/调度恢复一致，草稿令牌重签。AI正式学习事件也经格式v2往返，不只检查题库条数。

完整Chromium84、Firefox44（纽约时区）、发布文件/离线4全部通过；单元191项及类型/Lint/格式/构建已通过，收尾的12项受影响浏览器流程再次通过；3个Vitest真实模型任务仅在显式启用时运行，普通CI跳过不冒充模型测试。发布网页真实本机模型另由`RECALLLAB_PRODUCTION_MODEL_TEST=1 node scripts/verify-production-local-model.mjs`在隔离配置验收，2次实际请求/2题/Good及v7恢复通过，不是CI重放或真人效果测试。私有11页文件仅在本机隔离配置验收，公开仓库只保存统计，不包含正文、截图或真实备份。
