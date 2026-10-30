**简体中文** | [English](README.en.md)

# Band8

Band8 是一个本地优先的 IELTS 训练 Runtime。它将外部 AI Coach 与负责执行训练、记录学习证据的软件明确分离。

`v0.1.0-alpha.1` 是面向开发者和早期本地测试的源码发布候选版本。它不是完整的 IELTS 产品，也不会估算或保证考试分数。

## 为什么要做 Band8

个性化训练需要区分两类不同的权威：

- 外部 Coach 负责诊断证据并编制个性化训练；
- Runtime 负责验证训练包、执行会话、持久化产物并记录事实证据；
- 强化系统识别经过验证的进步，而不是奖励使用时长或重复打开应用。

Coach 不是 Runtime 的权威，模型推断也绝不会被当作原始事实存储。

## 架构

```text
外部 AI Coach
       │
       │ B8TP
       ▼
Band8 Runtime
       │
       ├── 训练会话
       ├── 证据与产物
       ├── Coach 检查点交换
       ├── 强化投影
       └── 仅限回环地址的本地 Web Shell
```

生成的训练包属于不可信输入。Node.js Runtime 掌握验证、会话状态、受保护评估、产物身份、任务状态、学习日身份和强化决策的权威。React 浏览器外壳只渲染面向学习者安全的 `/api/v1/` 投影，并把用户操作提交回 Runtime。

建议先阅读[架构概览](docs/architecture/BAND8_ARCHITECTURE.md)和[信任边界](docs/architecture/TRUST_BOUNDARIES.md)。

## 当前可用能力

`v0.1.0-alpha.1` 包括：

- B8TP 0.1 和 External Coach 契约；
- 基于 Node.js/TypeScript 的 Runtime，以及符合 RFC 8785 的规范化训练包身份；
- 只追加证据、训练包幂等性，以及崩溃和重启恢复；
- 面向 Reading 的受保护客观评估，支持 `INSTRUCTION`、`PRESENT_TEXT` 和 `SELECT` 活动；
- Writing `TEXT_RESPONSE`、权威产物持久化，以及检查点/续包交换；
- 可移植、显式触发的 Coach bundle 导出；
- 由证据驱动的 Mission、有效 Streak、Retention、Transfer 和 Pattern Broken 投影；
- 基于 IANA 时区和不可变 timezone epoch 的学习时区设置；
- 仅绑定回环地址的 React/Vite Web Shell，包含 Today、Train、Progress、History 和 Coach 页面。

协议入口：[B8TP](protocol/B8TP.md)、[Coach Contract](protocol/COACH_CONTRACT.md)、[Pedagogy](protocol/PEDAGOGY.md)、[Evidence Contract](protocol/EVIDENCE_CONTRACT.md)、[Reinforcement Contract](protocol/REINFORCEMENT_CONTRACT.md)和[版本策略](protocol/VERSIONING.md)。

## 快速开始

环境要求：Node.js 20、npm 10、Python 3.11 或 3.12；运行浏览器测试还需要 Chromium 系浏览器。CI 使用 Python 3.11，本地 Linux 全新克隆验证也覆盖 Python 3.12。

```text
npm ci
python -m pip install -r requirements-protocol.txt
npm run verify:release
npm run test:e2e
```

构建并启动一个本地合成 workspace：

```text
npm run build
node dist/src/cli/index.js --workspace .tmp/band8-quickstart timezone set UTC
node dist/src/cli/index.js --workspace .tmp/band8-quickstart import tests/runtime/fixtures/reading-golden/training-package.json --protected tests/runtime/fixtures/reading-golden/protected-evaluation.json
node dist/src/cli/index.js --workspace .tmp/band8-quickstart serve
```

Server 只绑定 `127.0.0.1`，会自动选择可用端口并打开本地页面。使用 `--no-open` 可以禁止自动打开浏览器。全新克隆安装步骤和不同平台的 Python 环境命令见已经过测试的[快速开始指南](docs/QUICKSTART.md)。

## External Coach 工作流

Band8 不会调用自动 Coach 服务。Writing 到达检查点后，由 Runtime 导出仅包含数据的 bundle。用户把该 bundle 交给外部 Coach，再显式导入 continuation package。恢复训练前，Runtime 会验证训练包身份、检查点绑定、证据绑定和来源。详见 [Writing Coach 闭环](docs/runtime/PHASE1B1_WRITING_COACH_LOOP.md)。

## 证据与强化

原始证据是不可变的事实历史。Coach 假设始终标记为推断，并附带置信度和证据引用。强化系统消费 Runtime 证据，可以展示任务推进、保持、迁移、模式状态和有效学习日；它不会因为使用行为发放 XP。详见[数据流](docs/architecture/DATA_FLOW.md)和[强化系统设计](docs/runtime/PHASE1C_REINFORCEMENT_ENGINE.md)。

## 当前限制

这个 alpha 版本不包含 Speaking/audio、语音转写、自动 Codex 或 API Coach、经过校准的 IELTS 分数估算、云同步、原生移动应用、Electron/Tauri 打包、纯浏览器 PWA Runtime，也不提供官方 IELTS 评分。

## 隐私与安全

除非用户显式导出 Coach bundle，否则 Runtime 学习数据始终保留在用户选择的本地 workspace 中。数据以 JSON、NDJSON 和普通产物文件存储。本地 Server 不接入分析或遥测 SaaS，不获取外部资源，也不适合暴露到局域网或互联网。它不提供任意 shell、路径读取或 URL 获取 API。详见 [SECURITY.md](SECURITY.md) 和 [Phase 1D 安全模型](docs/runtime/PHASE1D_LOCAL_WEB_SHELL.md)。

## 开发

```text
npm ci
python -m pip install -r requirements-protocol.txt
npm run verify:release
npm run test:e2e
```

修改 Runtime 边界或公开 fixture 前，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。内容再分发规则见 [docs/CONTENT_PROVENANCE.md](docs/CONTENT_PROVENANCE.md)。发布历史见 [CHANGELOG.md](CHANGELOG.md)，当前 alpha 的发布说明见 [docs/releases/v0.1.0-alpha.1.md](docs/releases/v0.1.0-alpha.1.md)。

## 路线图

完成本地审查后的下一步，是配置公开发布和托管 CI 证据。这个 alpha 中暂缓的产品能力仍将保持暂缓，直到其契约和证据边界完成设计与验证。

## 许可证与商标

Band8 源代码采用 [Apache License 2.0](LICENSE) 许可。

Band8 是独立的开源项目，与 IELTS 及其相关权利方不存在隶属、认可或赞助关系。IELTS 是其各自权利方的商标。
