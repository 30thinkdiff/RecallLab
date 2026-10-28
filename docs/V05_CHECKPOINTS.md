# V0.5 Alpha 检查点

更新：2026-10-28（Asia/Shanghai）。用户明确授权顺序整合 PR #1—#10；未授权自动合并 V0.5 新功能。

## A · 稳定版本整合准备

最新核对见 RELEASE_INTEGRATION_V041.md。#1–#10 head 与上轮一致、CI 通过、祖先链完整、无三方冲突；任务书确认外部独立审查到 ad88074，GitHub 平台 reviews/threads 为空，不虚构平台 APPROVED。
本地基线 131 项与类型/Lint/格式/构建通过；从 #10 建立 feat/source-grounded-ai-alpha，保留 .marscode/。已收到用户允许顺序普通合并的明确答复，整合正在进行；每步 main 树需与该阶段已验证 head 完全相同，并等待 main push CI。最终 tag、main SHA 和全回归尚待完成，不能把准备或中间态写成最终交付。

## B · Provider 与隐私边界

- 沿用 TypeScript 原生 fetch、已有 Zod 4.6.7，不新增模型 SDK。固定依赖仍为 Dexie4.2.1、React19.2、ts-fsrs5.4.2；无升级/强制修复。
- 独立 Mock/Ollama/OpenAI-compatible Provider。Mock 只提供明确标记的确定性演示，不属于真实 AI。Ollama 只允许 loopback；兼容接口可本机或用户明确选择的外部 HTTPS 服务。
- 调用前校验目标地址/模型并要求主动同意，默认无 AI/无资料请求。拒绝 URL 账号、查询参数、锚点、外部 HTTP；不跟随重定向、不发送浏览器 Cookie、不缓存请求。密钥由调用方内存传入，不写存储、日志、仓库或备份。
- 系统指令与 document_data 分离；没有工具定义，拒绝模型 tool_calls/refusal/未完整结束响应。只接受候选数据，Provider 没有访问学习数据库或执行模型动作的能力。数据校验与人确认仍必需，不声称提示注入已被彻底消除。
- 原生 Ollama /api/chat 的 stream=false 与 format schema；兼容 /chat/completions 的 response_format schema/json、有限输出与 store=false。按端点选择兼容 token 参数；不偷偷向备用服务转发，错误/中止/超时不泄露原始响应或密钥。
- 137 项单元/组件及夹具/类型/Lint/格式/构建通过，其中 6 项 Provider 测试覆盖 consent、URL、协议、文档注入、工具动作、非法/截断/认证错误、取消/超时与 Mock 区别。实际模型效果另测，不能用这些测试声称模型理解正确。

官方接口参考（实施时已打开核对）：

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)
- [Ollama chat](https://docs.ollama.com/api/chat)、[结构化输出](https://docs.ollama.com/capabilities/structured-outputs)

本机没有已有 Ollama/模型。正在临时目录准备 CPU 开源推理器与小型公开模型作真实效果验收；不需要 GPU 或付费密钥，不会把私有资料发到第三方。模型尚未运行，不将下载/编译当成效果通过。

## C · 来源、候选与事务保存基础

- 可取消、分块、上限 50 条的候选生成服务，非法输出/失败分段保留此前候选；恢复时核对输入、版本、目标和模型。长资料可限定原文范围，引用采用逐字唯一匹配，页码由实际位置推导。
- 人工确认前不写题库；确认后整批事务写入。阻止重复提交、缺失引用、重复题干、答案泄露及过期版本；后项失败整批回滚。
- 原文背诵标准答案直接取证据原文，已有题目的标准答案不能被 AI 覆盖。原始建议、编辑后确认内容、证据位置、模型/任务/目标、人工完整性确认及计数分别保存。
- 目标和来源记录作为可选字段进入不可变修订快照，未新增表或索引，Dexie 仍为 v4；旧备份仍可恢复。要点/目标/题干的实质变化重新建立学习状态，只有内容未变的质量记录可保留状态。后续人工修改保留原确认记录并标记已变化。
- 144 项单元/组件与完整静态/构建检查通过；新增 7 项服务测试覆盖跨页、来源缺失/歧义、例子非必需、事务回滚、取消/恢复、恶意结构、版本隔离、确认幂等及来源记录备份恢复。此检查点尚无完整产品 UI，实际模型与端到端验收留待后续报告。
