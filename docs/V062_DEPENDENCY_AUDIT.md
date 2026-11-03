# V0.6.2 开发依赖安全修复

2026-11-03，PR #18 首次 CI 41594938398 在依赖审计步骤失败，其余测试尚未执行。
实际 npm audit 报告 minimatch <11.0.1，GHSA-g3hv-75wg-m249（CVE-2026-118764，中等）。12个审计节点来自 ESLint/TypeScript-ESLint 的开发依赖链，生产依赖审计为0；不能以此跳过完整审计。

依据 [官方安全公告](https://github.com/advisories/GHSA-g3hv-75wg-m249) 与 [ESLint 10 迁移说明](https://eslint.org/docs/latest/use/migrate-to-10.0.0)，显式评估后升级 ESLint 10.14.0、@eslint/js 10.0.1、typescript-eslint 8.72.1、React Hooks 7.1.1、React Refresh 0.5.7，锁定 minimatch 11.0.1。Node 20.20.2 满足引擎限制，插件声明支持 ESLint 10；不把依赖旧 callable API 的 ESLint 9 直接强制接到新版 minimatch。没有执行 npm audit fix --force、忽略漏洞或安装系统软件。

安装审计为0漏洞；新 ESLint 实际执行全仓库 lint 通过，类型检查通过。完整回归与 CI 结果见 V062_CHECKPOINTS.md，不能将安装成功当作回归已完成。
