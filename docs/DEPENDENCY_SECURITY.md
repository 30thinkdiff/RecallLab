# 依赖安全检查 · 2026-10-27

执行 `npm audit --json`，基于已验证 PR #3。未运行 `npm audit fix --force`，未升级系统 Node/npm。

| 依赖           | 原始等级 | 范围与影响                                                                                         | 处理                  |
| -------------- | -------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| Vitest 4.0.18  | 严重     | 开发依赖；UI 服务器监听时可能任意读文件/执行，不是静态产品运行依赖。项目未启用 Vitest UI，但仍修复 | 同主版本升级 4.1.12   |
| @vitest/mocker | 中危     | 测试工具传递依赖；重定向 mock 读文件/注入风险，不进入产品包                                        | 随 Vitest 升级 4.1.12 |
| Vite 7.3.1     | 高危     | 开发服务器文件访问/路径绕过等；不进入静态构建，但本机体验会运行开发服务器，不能忽略                | 同主版本升级 7.3.7    |
| esbuild 0.27.x | 低危     | 开发传递依赖，公告主要涉及 Windows 开发服务器，本项目为 Ubuntu；仍升级                             | 兼容更新到 0.28.2     |

工具公告：[Vitest 安全公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)、[Vite 安全公告](https://github.com/vitejs/vite/security/advisories/GHSA-v2wj-q39q-566r)。原审计还列出相关 mocker、launch-editor 和路径访问公告；包级共 4 个受影响依赖（1 严重、1 高危、1 中危、1 低危）。

升级后 `npm audit` 为 0，55 项单元/组件、18 项 Chromium、类型/Lint/格式/生产构建通过。继续固定 127.0.0.1 监听，锁文件提交。新导入解析库加入后还会复查审计；这不保证未来不会出现新漏洞。

## V0.3 解析库复查

- Papa Parse 5.7.0：生产依赖，用于本地 CSV/TSV 字符串解析；安装后审计为 0。
- PDF.js 首选兼容 Node20 的 5.6.205，但审计发现 [GHSA-hq66-cqwq-w95j](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j)，高危，属于生产解析依赖，不能忽略。
- 该公告影响从 5.6.83 引入的版本；采用未受其影响的 5.5.207，而不是强制升级到要求更高 Node 的版本。保留现有 Node20，锁定主包及 Worker 同版本。
- 应用使用文字提取与页面绘制 API，不接入 PDF Viewer 的脚本执行组件，并关闭提取选项中的 eval；文件及解析 Worker 都在本地处理。
- 最终执行 `npm audit` 和 `npm audit --omit=dev`，两者均为 0；完整 78 项单元/组件和 32 项真实浏览器验收通过。

该结果对应本轮锁文件和检查日期，只表示当前已知公告检查通过，不是未来安全性的保证。

## V0.3.1 本地资源与 OCR

- PDF.js 仍固定 5.5.207，切换同版本官方 legacy API/Worker，未关闭安全选项。CMap、标准字体及图像 WASM 随构建本地提供，参见 [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/api.js.html) 与 [官方兼容说明](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-support)。
- 新增生产依赖 Tesseract.js 7.0.0 / core 7.0.0（Apache-2.0），中英文语言包 1.0.0（包声明 MIT）；选用 best-int LSTM，按需从本机资源加载。原始 PDF、渲染图像和文字不会发送到 OCR 云服务。参见 [官方离线配置](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)。
- vite-plugin-static-copy 3.4.0 为开发依赖，兼容现有 Node20 与 Vite7，无强制升级。发布目录 OCR 资源约 24 MB（含多个架构兼容变体），客户端实际选取一个引擎，首次约 8 MB，不在应用启动时加载。
- 中文夹具的 ARPHIC 字体子集及完整许可在 tests/fixtures/pdf-assets；不是用户字体或学习内容。可选 Python 重建工具只用于开发，不是用户运行 PDF/OCR 的依赖。
- 最终完整/生产审计结果以本轮交付和 CI 为准；不把依赖安装成功等同于识别准确性保证。

V0.3.1 最终本机 `npm audit` 与 `npm audit --omit=dev` 均为 0（含新增 OCR 依赖），对应日志只包含依赖信息。公开许可证/通知随构建放在 `third-party/`；测试字体内嵌了 2026-10-27 子集修改说明。

## V0.4 FSRS

npm 确认 latest=5.4.2、beta=6.0.0-beta.15，固定安装生产依赖 ts-fsrs 5.4.2（MIT、Node>=20），核对安装包类型和稳定 next/createEmptyCard API，不使用 6.x beta 文档接口。无额外运行服务、网络或个人模型优化依赖；许可随应用分发。默认参数和 0.90 目标是通用配置，不是个体最优结论。最终全量/生产审计及 CI 结果见本轮交付。

V0.4 最终本机 `npm audit --json` 与 `npm audit --omit=dev --json` 均为 0（严重/高/中/低/信息均 0），含生产调度依赖。未执行强制升级，原有 PDF/OCR 依赖版本保持兼容；最终锁文件还由 CI 同样审计。

## V0.4.1

2026-10-28 最终锁文件完整/生产 npm audit 均为 0（严重/高/中/低/信息均 0），没有强制升级，也没有引入 AI 或 OCR 云服务。Firefox 是与锁文件 Playwright 配套的开发测试浏览器，不进入产品包。

新增发布版 ServiceWorker 只缓存公共构建壳与同源 PDF/OCR 静态资源，白名单 GET，不缓存用户上传/IndexedDB/恢复备份；没有增加外部 API。缓存额度失败不应阻断已有网络读取；首次未缓存的解析资源不保证离线可用。清除网站数据会删除缓存和学习库，仍需用户下载完整备份。

## V0.5 Alpha

2026-10-28，完整与生产依赖 npm audit 均为 0；没有新增模型 SDK、强制升级或账户依赖。Provider 使用已有 Zod 与原生 fetch，AI 默认关闭，网络请求须主动确认地址/范围；密钥仅内存，不落 IndexedDB、浏览器存储或备份。外部 HTTPS 接口有显式选择，本机验收不发送私有资料到外部。拒绝重定向/工具调用、限制输出/批量/时限，模型只提出待确认数据，不具有题库写权限。

真实效果验收使用临时 CPU llama.cpp v0.7.0（无工具、仅 loopback、仅本机来源 CORS、关闭正文日志）和官方 [Qwen2.5-1.5B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF)（Apache-2.0）。固定 revision 91cad51170dc346986eccefdc2dd33a9da36ead9，Q4_K_M 1117320736 字节；下载 SHA256 校验为 6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e。二进制/权重不进入网页包或仓库，也未执行文档内指令。API 来源匹配不消除语义错误与提示注入对模型建议的影响，人工核对仍必需。

正式 schema v5 原地保护升级与旧备份兼容。旧 Dexie 的兼容重试不能被版本号当作写锁，明确不支持旧版编辑升级后的库；当前版本拒绝未来主版本和保留升级前副本，不能虚称所有旧客户端已被追溯阻止。

## V0.5.1（2026-10-28）

当前锁文件完整 npm audit 实测为0（info/low/moderate/high/critical均0）。本轮未新增或强制升级npm依赖，只变更应用版本号。本机模型不随npm或Git分发，没有自动下载/系统安装/开机服务。真实模型版本与局限、启动授权和动态库目录见V051_CHECKPOINTS及AI_GUIDE。

## V0.5.2 · 2026-10-29

实际执行全量 `npm audit --json`，信息/低/中/高/严重均0。复用已安装依赖及Node20.20.2，没有新增生产/开发依赖、强制升级、安装系统软件或下载模型；npm锁文件仅同步应用版本。本次已知公告结果不代表未来永久安全。
