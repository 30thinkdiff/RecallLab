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
- 应用只使用文字提取 API，不接入 PDF Viewer 的脚本执行组件，并关闭提取选项中的 eval；文件及解析 Worker 都在本地处理。
- 最终执行 `npm audit` 和 `npm audit --omit=dev`，两者均为 0；完整 78 项单元/组件和 32 项真实浏览器验收通过。

该结果对应本轮锁文件和检查日期，只表示当前已知公告检查通过，不是未来安全性的保证。
