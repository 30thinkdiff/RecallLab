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
