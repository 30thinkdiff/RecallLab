# V0.4.1 检查点与审查记录

更新：2026-10-28（Asia/Shanghai）。所有数据测试隔离，真实资料只在本机内存验收。

## A · 版本状态与安全整合方案

已 fetch 远程；main 仍为 44bc76f，#1–#9 均 open、非草稿、未合并。各相邻 base 是后续 head 的祖先，完整链对 main 的三方结果无冲突（旧 Git 使用三参数 merge-tree，只计算结果，不修改分支）。

| PR  | 当前 base                                | head    | 最新 CI                                                                          | 依赖检查 |
| --- | ---------------------------------------- | ------- | -------------------------------------------------------------------------------- | -------- |
| #1  | main                                     | 968c6e9 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40441840086) | 无冲突   |
| #2  | feat/project-foundation                  | e8202ee | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40459453068) | 无冲突   |
| #3  | feat/knowledge-revision-and-session-sync | 0de0ac7 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40464003547) | 无冲突   |
| #4  | fix/guard-preserved-learning-evidence    | 99e87c2 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40472978468) | 无冲突   |
| #5  | feat/material-import-and-organization    | 853b850 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40475012489) | 无冲突   |
| #6  | fix/pdf-extraction-diagnostics           | 9249877 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40503940446) | 无冲突   |
| #7  | fix/chinese-pdf-structured-import        | 170c90d | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40506668700) | 无冲突   |
| #8  | fix/ocr-retain-native-text               | 49723e6 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40529118531) | 无冲突   |
| #9  | feat/evidence-based-spaced-review        | b5be6d7 | 通过 / [运行](https://github.com/30thinkdiff/RecallLab/actions/runs/40537343813) | 无冲突   |

#9 仅为自由练习恢复查询增加 !reviewPlan 过滤及对应回归，正式计划仍只恢复 reviewPlan 轮次。实际 CI 日志：120 项单元、54 项主浏览器、2 项生产资源通过，审计 0。新分支 feat/learning-quality-and-reliability 从 b5be6d7 开始，不重写既有提交，用户 .marscode/ 原样保留。

### 可执行的整合方案（等待用户授权，未执行）

1. 授权范围为已审查阶段 #1→#9，逐个普通 merge，保留祖先提交；每次使用已核对的 head SHA 作为并发保护，不 squash/rebase/force push、不覆盖 main、不自动删除依赖分支。
2. 每合并一个后，将紧接的下一个 PR base 改为 main，核对仅含该阶段差异、无意外新提交与冲突，等待该 base 下最新 CI 通过，再合并。若 head 变化、CI 失败、出现冲突或新审查问题则停止整合，自行修复普通工程问题后重新验证。
3. #8 的自由练习混用缺陷由 #9 修复，所以不把 #8 作为最终产品停靠点；完整链至少收敛到 #9。旧阶段存在的已知问题需由后续修复一并进入 main，不逐阶段部署旧快照。
4. 最后 fetch main，在独立工作区运行完整检查/浏览器/发布资源回归，确认其树与已验证链一致，提供 main SHA 与 CI。
5. 本轮新功能 PR 另行独立审查，不因用户授权整合 #1–#9 而自动合并。

技术条件：#1–#9 均有绿色 CI、依赖关系明确、当前无合并冲突。限制：GitHub reviews API 当前全部为空，没有平台登记的 APPROVED；用户提供的独立审查结论与 CI 是不同证据。不能声称已有 GitHub 正式批准，也不能越过用户的合并授权。新增真实浏览器测试复现：#9 底层已分离，但项目页仍将正式计划标成“继续学习”并显示其控制区。本轮 A 修正项目页只展示自由练习状态，并明确自由/正式入口；建议等待此补充修复独立审查，再选择完整链的整合终点。授权前不执行任何合并。

本地基线 npm run check：120 项单元/组件及夹具/类型/Lint/格式/构建通过。新增浏览器入口隔离测试 1 项通过：正式计划存在时仍可创建/恢复自由轮次，自由练习保存 1 条事件但 0 条调度日志，再恢复原正式轮次。修复前测试在项目入口复现失败；没有删除保护断言。

## B · 可重复的完整学习验收

- learning-lifecycle.spec.ts 在 UI 核对并一次导入公开虚构 69 题，设置 30 分钟/每日 1 道新题，输入原始回答后 Good；次日只复习到期题，真实错误与自评 4 并存仍为 Again。更正答案后新版无旧状态，历史原回答和来源保留；完整导出恢复后事件、状态、调度日志和资料一致。1 项完整浏览器验收通过，类型/Lint 通过。
- 本机真实 PDF 仅在独立非持久 Chromium 上运行，不产生 Playwright 报告、截图或真实备份文件，不上传原文。PyMuPDF 用原有临时工具执行，逐页去空白文本的 SHA-256 在内存对照。
- 私有统计：11/11 页可读且 UI 全部 11 页可预览；6 部分，69 条（31/22/3/3/8/2），10 条跨页，12 个未归类字符，7 条待完善；非待完善题未发现完整标准答案直接嵌入题面的情况。规则检查不等同于语义质量保证。逐页对照全部一致。
- 私有上传→核对→批量保存 69 条→正式复习→人工核对错误为 Again→更正标准答案→新旧记忆状态隔离→保留原事件与来源→内存完整备份/恢复全部通过，外部 HTTP 请求 0。该次自动作答为验收模拟，不是用户真实学习成绩。
- 7 条待完善内容仍保存原文供批量编辑，不参与正式队列，没有为了满足题数虚构题干或答案。原文、路径、正文截图和含真实资料的备份均不进入公开报告或 Git。
