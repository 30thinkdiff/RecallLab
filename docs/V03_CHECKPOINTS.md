# V0.3 检查点

## A · 状态与依赖安全

- 本地起始工作区干净，没有未提交用户工作。
- PR #1、#2、#3 均未合并。PR #3 最新提交 `0de0ac72c768b5fc79cb72b2cda4e8159343174c` 的 [CI](https://github.com/30thinkdiff/RecallLab/actions/runs/40464003547) 通过。
- 从 PR #3 分支创建 `feat/material-import-and-organization`，后续 PR 依赖 `fix/guard-preserved-learning-evidence`，不自动合并。
- 原始代码本机通过 55 项单元/组件和 18 项浏览器回归。
- 安全审计与兼容升级后，同样 55/18 项回归、类型、Lint、格式和构建通过；npm audit 零告警。
- 资料模型与迁移先于导入界面落地，使第一批导入从创建起就保留来源，不临时存放无法追溯的题目。

## 实施记录

后续逐阶段补充：C 来源模型与备份迁移、B 结构化导入、D PDF。所有测试资料均为公开虚构内容，不读取或上传用户日常数据库。
