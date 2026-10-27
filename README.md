# RecallLab · 记忆实验室

An Evidence-Driven Adaptive Learning System.

以自己的学习资料为来源，通过主动回忆与可追溯的学习记录练习知识。
核心功能在本地运行，不需要登录、数据库服务器或 AI 密钥。

## 本地运行

Ubuntu 22.04，Node.js 20.19+（本机验证版本 20.20.2）、npm 10+，现代浏览器。

```bash
cd /home/hhd/recalllib
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173>，支持热更新。无需 Docker、数据库服务器或登录。
请固定使用这个地址；浏览器数据按协议、主机名和端口隔离。

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 当前阶段

M0：基础导航、首页、开发服务器及检查工具。学习功能尚在开发。
工作约定见 [AGENTS.md](AGENTS.md)。
