# RecallLab · 记忆实验室

An Evidence-Driven Adaptive Learning System.

本地优先、AI 可选的主动回忆学习工具。当前 **V0.3 · 资料导入与知识组织**，待体验与独立审查，未发布稳定版。

## 直接体验

已启动时打开 <http://127.0.0.1:5173>，不需要构建或执行测试。

- **明确问答题库**：导入资料 → 选择 JSON/CSV/TSV/TXT/Markdown → 预览、抽查或修改 → 选择项目 → 确认导入 → 开始学习。
- **文字型 PDF**：导入资料 → 选择 PDF → 按页预览 → 在原文框选择文字 → 创建问答、填写问题 → 核对提示并确认 → 开始学习。
- **普通讲义**：未识别明确问答时，不编造题目；从原文选择内容后手工整理。
- **追溯来源**：学习/题目历史中的来源链接 → 原文资料；学习答案的修改不会覆盖原文或旧事件。

69 道明确问答可以一次确认导入，无需填写 69 次表单。预览分页展示；不完整候选需补全或取消选择，疑似重复默认跳过。明确选择追加重复题目也不会覆盖旧题。

题库 JSON 导入只追加内容；完整数据库 JSON 备份须使用独立的“备份与恢复”入口，恢复前明确确认替换。
格式样例、限额和处理提示见 [导入指南](docs/IMPORT_GUIDE.md)。

## 本地启动与环境

Ubuntu 22.04，Node.js 20.19+（验证版本 20.20.2）、npm 10+，现代 Chromium 浏览器。

```bash
cd /home/hhd/recalllib
npm ci
npm run dev
```

固定使用 <http://127.0.0.1:5173>，支持热更新；若已有服务器，不必重复启动。无需登录、数据库服务器、Docker 或 API 密钥。

**旧数据首次升级**：先在页面下载升级前 JSON 并妥善保存，再确认升级。v1/v2 定义保持，新增 schema v3；迁移失败回滚，不自动清库。迁移事务内还会保留原始保护副本。

## 当前能力

- 项目和手工问答、提示/来源/核对要点、快速回忆及输入作答、自评与人工核对、可恢复草稿和完整事件。
- 不可变修订、实质性更正后重新学习、当前有效统计、跨标签页冲突保护、轮次更新/结束/重开、归档恢复。
- JSON/CSV/TSV/TXT/Markdown 批量追加导入，明确问答识别、可编辑预览、缺字段与重复处理、事务回滚。
- 文字型 PDF 本地 Worker 提取、逐页预览、章节定位与选文制卡；缺文字/损坏/疑似乱码有提示。
- 学习资料库及原文来源：文件校验值、格式、提取文本、页码/章节/片段位置，学习内容与原文分开。
- 完整 JSON 备份/校验恢复，兼容旧备份；资料、来源和新学习记录一起备份。

没有 OCR、直接 Word/DOCX 解析、复杂版式/公式语义识别、AI 制卡/评分、完整 FSRS、账号或云同步。
PDF 显示提取文字，不渲染原文件页面、图片和版式；需对照原 PDF 抽查阅读顺序与完整性。

## 数据与安全

日常数据保存在当前浏览器 origin 的 IndexedDB **RecallLab / schema v3**。文件读取、PDF Worker、预览和保存都在本地，不上传学习资料；解析组件没有使用 CDN。
更换浏览器、主机名、端口或无痕配置会使用不同存储空间；清除网站数据可能丢失记录，请定期下载外部备份。

保存提取原文、文件名/格式、SHA-256、来源位置和学习实体，不保存二进制原文件，请保留原文件。
自动保护副本也在同一本地库中，可单独下载；不会递归包含在普通完整备份中，不能替代外部备份。
历史事件保留当时的问答、作答和来源快照。人工核对不等于系统客观验证，自评不等于记忆概率。

依赖已做全量与生产审计并回归验证，具体风险、修复版本及范围见 [依赖安全报告](docs/DEPENDENCY_SECURITY.md)。

## 自动验证与调试

```bash
npm run check              # 夹具、类型、Lint、格式、单元/组件、构建
npx playwright install chromium
npm run test:e2e           # 全部真实浏览器验收
npm run test:e2e:ui
npm run test:e2e:debug
npm run test:report
npm run test:summary
npm run fixtures:check
```

测试使用独立 **5174 / RecallLab-test** 和临时浏览器配置，不访问日常数据库。资料全部为公开虚构内容；PDF 夹具由脚本生成。没有生产清库按钮。
GitHub Actions 保留 SHA 关联摘要、HTML/JSON/JUnit，失败时附截图与 Trace。详见 [测试矩阵](docs/TESTING.md)。

## 工程与审查

React、TypeScript 严格模式、Vite、Dexie、Zod、Papa Parse、PDF.js、Vitest、Playwright。导入和 PDF 按需加载，锁文件复现安装，不要求系统级升级。

- [产品规格](docs/PRODUCT_SPEC.md)、[架构与数据语义](docs/ARCHITECTURE.md)、[进度与限制](docs/PROGRESS.md)。
- [V0.3 检查点](docs/V03_CHECKPOINTS.md)、[变更记录](CHANGELOG.md)、[工作约定](AGENTS.md)。
- V0.3 基于已通过 CI 的 [PR #3](https://github.com/30thinkdiff/RecallLab/pull/3)，保留 PR #1→#2→#3 的叠加关系，不自动合并。
- M0/M1 和第二轮历史交付文档描述当时状态，当前以 V0.3 文档为准。
