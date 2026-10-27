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

| 任务书用例           | 自动化位置                                    | 检查结果                                                   |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| A 新增 20 题加入本轮 | revisions.spec.ts · A                         | 默认 2 题，可下轮再学，明确加入后 22 题，原输入保持        |
| B 修改待答题         | revisions.spec.ts · B                         | 当前草稿不变，后续使用新答案                               |
| C 当前版本冲突       | revisions.spec.ts · C/D                       | 旧页面禁止揭晓/评分，保留输入再载入新版                    |
| D 错误答案更正       | C/D、history.spec.ts、analytics.test.ts       | 旧快照完整，当前有效成绩归零，重学提示                     |
| E 格式修改           | revisions.spec.ts · E、history.spec.ts        | 学习状态继承，原证据仍有效                                 |
| F 学习中归档         | revisions.spec.ts · F/G、backup.spec.ts       | 待答不出现；当前归档停止评分，无假跳过事件                 |
| G 结束轮次           | revisions.spec.ts · F/G、repository.test.ts   | 已完成事件保留，未提交作答另存，重开不清历史               |
| H 两页输入           | concurrency.spec.ts · H、study-draft.test.ts  | 已观察更新可继续；过期写拒绝且保留输入                     |
| I 揭晓锁定           | concurrency.spec.ts · I/J、repository.test.ts | 两页锁定，过期异步写无法改证据                             |
| J 两页提交           | concurrency.spec.ts · I/J                     | 同一位置只有一条事件，下一题不被二次推进                   |
| K 历史快照与修订提示 | history.spec.ts · K/L                         | 原作答、旧答案和“已修订”提示正确                           |
| L 题目完整历史       | history.spec.ts                               | 全部事件/版本、差异、统计、暂存副本可查看                  |
| M 真正旧库升级       | backup.spec.ts · M、backup.test.ts            | 先下载 v1，实际 native v10 升至 Dexie v2，原事件与草稿保留 |
| N 备份恢复与重启     | backup.spec.ts · N                            | 导出/导入后重启浏览器进程，修订与事件关系不变              |

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
本轮 PR #2 以 PR #1 的分支为基础，未自动合并或发布。
测试通过只验证所覆盖情形；尚未覆盖 Firefox/WebKit、真实系统崩溃、所有存储配额与大规模数据压力。
没有为可选审查预览发布公开网站，也没有上传任何本地真实 IndexedDB 数据。
