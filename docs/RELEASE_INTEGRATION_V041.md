# v0.4.1 稳定版本整合方案

核对日期：2026-10-28（Asia/Shanghai）。下表为合并前快照；用户已明确授权执行顺序整合。实际进度见文末。

## 合并前已核对的候选版本

合并前 main 为 44bc76fccdfa1712be3fa3a2075f39973554cc45。PR #1–#10 全部 open、非草稿、CI 通过、mergeable；逐个 base 是后续 head 的祖先。只计算完整链的三方结果，冲突标记为 0，没有修改 main。

| PR  | 已验证 head SHA                          | 当前 base                                | 最新 CI                                                                   |
| --- | ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| #1  | 968c6e99e11a37720a5f4e10da44b8e7c9329b14 | main                                     | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40441840086) |
| #2  | e8202ee302bac27fdb969e86e2895b568639f03d | feat/project-foundation                  | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40459453068) |
| #3  | 0de0ac72c768b5fc79cb72b2cda4e8159343174c | feat/knowledge-revision-and-session-sync | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40464003547) |
| #4  | 99e87c256b0a6ba05ac208228fcefbc361f6a626 | fix/guard-preserved-learning-evidence    | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40472978468) |
| #5  | 853b850b3dd2c27d749503c8b039f9570b406954 | feat/material-import-and-organization    | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40475012489) |
| #6  | 924987763e825ee67c7ec205d494fe01d151ed1e | fix/pdf-extraction-diagnostics           | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40503940446) |
| #7  | 170c90d612a4396e88d1c9f5689d92d186a5a2e5 | fix/chinese-pdf-structured-import        | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40506668700) |
| #8  | 49723e699dc555e75701095fb53d1f29b328dd66 | fix/ocr-retain-native-text               | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40529118531) |
| #9  | b5be6d74debd0b391d607945c5004791d046c24f | feat/evidence-based-spaced-review        | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40537343813) |
| #10 | ad88074761e3b86b507a7a9f45ca677f4d0fd894 | fix/separate-free-and-scheduled-sessions | [通过](https://github.com/30thinkdiff/RecallLab/actions/runs/40623490815) |

用户在 V0.5 任务书中确认最近独立审查对象为 PR #10 / ad88074761e3b86b507a7a9f45ca677f4d0fd894。GitHub reviews 和 review_threads 目前为空；外部审查确认与平台 APPROVED 记录分开记载，不虚构平台批准。

已审阅 #10 的无删除初始化探测、两类活动轮次备份、事务/版本保护与 FSRS 状态隔离；新运行本地 check 131 项单元/组件、类型/Lint/格式/夹具/构建通过。#10 最终 CI 实际通过 131 单元、60 Chromium、16 Firefox、3 发布/离线，见对应运行。数据库 v4 保留 v1/v2/v3 正式迁移定义，历史不回填成 FSRS；实质更正重置有效状态，格式变更须内容校验；备份含原文/修订/事件/调度，恢复有原副本及事务回滚。

## 获授权后的可执行顺序

1. 保存上述 SHA 为合并预期；每次重新读取 PR 和 main。若有超出已审查范围的新提交、非预期 main 改动、冲突或 CI 失败，停止该步并处理，不直接带入未知修改。
2. 按 #1→#2→…→#10 普通 merge（保留祖先，不 squash/rebase/force push，不删除依赖分支）。每次使用当前已核对的 head SHA 作为并发保护。
3. 先将下一 PR base 调整为 main；重新核对差异仅含该阶段、mergeable 及当前 head 的 CI。base 改动未必自动触发默认工作流，因此不能虚称已有“新 base CI”；利用祖先/三方内容校验，要求每次合并后的 main tree 与本表对应 head tree 完全相同，再等待该 main 合并提交的 push CI 通过后继续。任何不一致停止。
4. 旧阶段仅是整合中间态，不单独发布；至少整合到 #10，不能遗漏 #9/#10 的轮次、备份和初始化保护修复。
5. 最后 main tree 必须与 ad88074 的 tree 完全相同。创建隔离工作区，在 main 执行夹具/类型/Lint/格式/131 单元/构建、60 Chromium、16 Firefox、3 发布/离线全回归，审计完整/生产依赖，核对 main SHA 的远程 CI 和报告。不得把旧 PR CI 充当最终 main CI。
6. 全部通过后为稳定成果标记 v0.4.1（先检查同名 tag，无覆盖），提供 main SHA、tag 和最终 CI。V0.5 Alpha 独立 PR，绝不随此授权自动合并。

## 授权边界

仅请求一个产品决策：是否允许将已验证的 PR #1—#10 按安全顺序合并到 main。未收到答复等于未授权；不会因等待时间经过而合并。无论是否授权，V0.5 可在 #10 基础上的独立分支推进；拒绝或暂缓不会丢弃代码或学习数据。

## 授权后实际进度（持续更新）

每步普通 merge，head SHA 与上表一致，均先调整 base 到 main；每步 fetch 后核对 main tree 与该阶段 head tree 完全相同。此前分支保留，没有 squash、rebase、强推或工作区覆盖。

| PR  | main merge commit                        | 该 main push CI    |
| --- | ---------------------------------------- | ------------------ |
| #1  | adcdf046143b3232984b222eae3c2c6dd547a748 | 40638854837 通过   |
| #2  | cd35e4eb34822c64f9f243d27bc0c5d7df95e3e9 | 40639306775 通过   |
| #3  | 7ae8f63734fd011f6f862e0479941a5c332bd2c9 | 40639589019 通过   |
| #4  | d7065efd4a909a3c4000e8e3e1ca9d66f8b6916f | 40640689727 通过   |
| #5  | d2f8b88312861538826fd7b9345763e2d5b683ec | 40641341515 通过   |
| #6  | 0b29333101217b18a85c98355cfa1fb6b4f591d0 | 40641938789 通过   |
| #7  | c1e01ae3263927a9d4c6170fc50c33ad59162899 | 40642451606 通过   |
| #8  | d49b55e89584c0fb344122dc6bf16af4079f7b21 | 40642999059 通过   |
| #9  | f0f7310df69410a62334e227c9b381723537199f | 40643670071 通过   |
| #10 | 92f44d1af63fb00d473000f48de5bd0b1fe6238a | 40644417948 运行中 |

#1—#10 已全部按授权整合。最终 main tree 与 ad88074 相同，已建立隔离工作区执行完整回归；最终 main CI、全回归和 tag 尚未结束。V0.5 PR #11 已 retarget main，差异仅为 Alpha，不夹带旧 PR。连接器的提交工作流查询只覆盖 PR 事件，所以 main push 的 run ID 使用 GitHub 公共 API 发现，再逐步读取实际 jobs 状态。
