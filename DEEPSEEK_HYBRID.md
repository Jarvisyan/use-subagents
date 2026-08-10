# GPT–DeepSeek 原生子代理接入报告

## 1. 最终结论

截至 2026-08-10，DeepSeek 已从 MCP/sidecar 迁移为 Codex 原生 custom subagent：

- GPT-5.6 Sol 继续作为父任务模型，ChatGPT 登录和顶层 provider 未改变；
- DeepSeek 只在独立的 `v4_flash_worker` child 中运行；
- child 的 provider/model 已验证为 `deepseek/deepseek-v4-flash`；
- child 使用原生 Subagents 生命周期、独立 task、callback 和等待机制；
- 跨 provider 任务正文由一次性 plaintext `SubagentStart` Hook 交付；
- 旧 DeepSeek MCP、Codex sidecar、自研 `ask_deepseek` 适配层及回滚备份已永久删除。

最终 smoke test 已通过。失败的第一次 smoke 也定位清楚：DeepSeek 原生 child 实际启动成功，但 Hook 信任没有持久化，导致 stage 后的 assignment 没有被消费。信任状态持久化后，新顶层任务通过了上游规定的完整测试。

```text
GPT-5.6 Sol 父任务
  │
  ├─ 加载 $use-v4-flash-worker
  ├─ 形成自包含 parent assignment
  ├─ stage 到本机一次性 pending
  └─ native spawn: v4_flash_worker, fork_turns="none"
       │
       ├─ trusted SubagentStart Hook 原子 claim assignment
       ├─ DeepSeek Responses API: deepseek-v4-flash
       └─ native callback 返回父任务审查和整合
```

## 2. 当前配置

### 2.1 已安装工件

| 路径 | 作用 |
| --- | --- |
| `~/.codex/agents/v4-flash-worker.toml` | 独立 agent、DeepSeek provider、模型、上下文窗口和沙箱 |
| `~/.codex/hooks.json` | 精确匹配 `^v4_flash_worker$` 的 `SubagentStart` Hook |
| `~/.codex/hooks/codex-deepseek-subagent/plaintext_handoff.py` | stage、claim、注入、过期和失败状态处理 |
| `~/.codex/skills/use-v4-flash-worker/` | 父任务侧的选择、交付、等待、恢复和数据边界协议 |
| `~/.codex/models.json` | DeepSeek 官方模型能力目录，仅由该 child 引用 |
| `~/.codex/AGENTS.md` | 只保留一条按需加载上述 Skill 的路由索引 |
| `~/.codex/config.toml` | Codex 正式保存的 Hook enabled/trusted 状态 |

agent 的关键字段为：

```toml
name = "v4_flash_worker"
model_provider = "deepseek"
model = "deepseek-v4-flash"
model_reasoning_effort = "max"
model_catalog_json = "/user/work/yanjie/.codex/models.json"
model_context_window = 1000000
sandbox_mode = "read-only"
```

provider 使用 `https://api.deepseek.com` 的 Responses API，并从进程环境读取 `DEEPSEEK_API_KEY`。现有 API 环境被直接复用；密钥没有写入 Prompt、TOML、文档或仓库。

### 2.2 Python 与 uv

Hook 命令固定使用 `/usr/bin/python3`，不依赖项目的 `.venv`、`uv run` 或当前 shell 是否激活虚拟环境。Hook 脚本只使用 Python 标准库，因此项目级 uv 环境不会影响后续交互；反过来，Hook 也不会污染项目依赖。

### 2.3 `models.json` 是否需要

需要，但不能把它配置成 GPT 父任务的全局 catalog。

上游 custom-agent TOML 已声明 provider、模型和名义 context window，但 Codex 对未知第三方模型会使用 fallback metadata。第一次成功 smoke 的 child token 事件仍显示 fallback context，而 OpenAI Codex 的已知问题也表明：缺少 catalog 时，即使配置 `model_reasoning_effort`，运行时仍可能不向第三方 Responses provider 发送 reasoning 字段。

因此本机保留 DeepSeek 官方 `~/.codex/models.json`，但只在 `v4-flash-worker.toml` 中通过 `model_catalog_json` 引用。顶层 `~/.codex/config.toml` 不设置全局 `model_catalog_json`，所以 GPT 父任务的 `/model`、provider 和登录状态不会被替换。

无付费 `codex debug models` 已确认该目录实际注册：1,048,576 context、`low/high/max` 三档、`max` 可选、Responses 所需工具元数据。新增 catalog 后需要完整重启 Codex App，使长驻 app-server 丢弃旧模型目录缓存。

## 3. 与上游手册的一致性

安装和测试依据：

- `Utopia-V/codex-deepseek-subagent` 当前 `main`；
- 安装说明 `prompts/install-with-codex.md`；
- 测试说明 `prompts/quick-smoke-test.md`；
- 安装时核对的上游提交为 `1377b7655ea98ed50a5131172b579b56ed744793`。

严格遵循的部分包括：

1. 使用真实 agent 名 `v4_flash_worker`，没有继续把 MCP 名称冒充原生 agent；
2. 使用独立 child 配置，不修改 GPT 父任务的顶层 provider/model；
3. 使用 `deepseek-v4-flash`、Responses wire API 和 1,000,000 context window；
4. 使用 one-shot plaintext handoff、精确 matcher 和 at-most-once 消费语义；
5. 父任务先 stage，成功后才以 `fork_turns="none"` 原生 spawn；
6. 不使用直接 API、替代 provider、另一个 Codex CLI 或 MCP fallback；
7. 用全新顶层任务运行官方 quick smoke，并核对子任务元数据和 pending 消费。

### 3.1 本机自适配

只有两项本机适配：

- 按用户明确要求，在 agent TOML 增加 `model_reasoning_effort = "max"`，并让该 child 私有引用 DeepSeek 官方 `models.json`；这既避免 underthinking，也绕开第三方 fallback metadata 丢弃 reasoning/context 能力的问题。
- 用户已明确执行 `/hooks` 信任，但 Codex 实际仍报告 `untrusted`；因此通过 Codex 正式配置接口持久化该 Hook 的 enabled/trusted 状态。没有绕过 Hook，也没有关闭安全门。

没有保留早期自研的 `ask_deepseek` 整体改名。该名称同时牵涉 agent、matcher、状态文件、Skill 和 smoke oracle；继续维护改名分支会偏离现成上游并增加故障面。当前唯一真实身份是 `v4_flash_worker`。

## 4. 旧 MCP 配置的处理

### 4.1 复用的内容

旧 MCP 中真正需要延续的只有 DeepSeek API 凭据及其外部环境注入方式。模型用途仍是 `deepseek-v4-flash`，但 provider 配置现在属于独立 agent，不再属于 MCP sidecar。

### 4.2 不再需要的内容

以下组件已被原生 child 生命周期替代：

- MCP server 和 `ask_deepseek` MCP tool schema；
- 每次调用启动的第二个 Codex sidecar；
- sidecar 专用 `CODEX_HOME` 和 sidecar 模型目录副本；当前只保留原生 child 私有引用的官方 catalog；
- MCP 请求超时、stdio transport 和 wrapper；
- 自研 `ask_deepseek` native 安装器、Hook、Skill 和测试分支。

`codex mcp list` 当前只剩 `openaiDeveloperDocs`，不存在 DeepSeek MCP。旧 sidecar、DeepSeek/ask-deepseek 回滚备份和仓库中的对应实现文件已按用户授权永久删除，不再具备回滚能力。

## 5. Context、Skill 与推理配置

### 5.1 child context

每次 spawn 都是独立 child context，不复用父任务完整对话。V2 调用使用 `fork_turns="none"`；这个字段属于每次 spawn 的原生接口参数，不是 custom-agent TOML 的持久化字段，因此由 `$use-v4-flash-worker` Skill 按需约束，没有重复写入 global rule 浪费常驻 token。

父任务必须交付一份自包含 assignment，至少包含目标、必要上下文、范围、排除项、权限、验收标准、证据和停止条件。无关聊天历史、密钥和私有数据不应发送给 DeepSeek。

### 5.2 Skill

原生 child 能看到运行时提供的 Skill 清单，但不能假设模型一定会自动选择正确 Skill。如果任务依赖某个业务 Skill，父 assignment 应明确写出：

```text
required_skill: $skill-name
Read the complete SKILL.md before acting.
Return SKILL_USED and SKILL_PATH_READ.
```

`$use-v4-flash-worker` 本身是父任务侧的传输 Skill，不是 child 的业务 Skill。global rule 只负责在考虑、创建、继续或排障该 worker 时加载它；详细 stage、spawn、等待和恢复协议都留在 Skill 中按需读取。

### 5.3 上下文窗口和思考强度

- context window 由 agent TOML 和官方 catalog 共同声明；Codex 实际 catalog 值为 1,048,576，无需每次 Prompt 重复声明；
- DeepSeek child 的默认 reasoning effort 已本机覆盖为 `max`，catalog 同时声明 `max` 为受支持档位；
- smoke 验证的是任务交付和原生 provider/model 边界，不依赖父任务把完整历史传给 child。

## 6. Bug、修复与测试证据

### 6.1 第一次 smoke 为什么失败

第一次测试中：

1. stage 成功，pending 文件存在；
2. 原生 child 成功创建；
3. 子任务元数据确认为 `agent_role=v4_flash_worker`、`model_provider=deepseek`、`model=deepseek-v4-flash`；
4. DeepSeek 返回“缺少任务契约”；
5. pending 没有被消费。

这证明原生 DeepSeek 接口本身是通的，故障只在 `SubagentStart` Hook 没有运行。Codex 的 `hooks/list` 随后直接给出根因：相关 Hook 在主项目和 smoke worktree 中都仍是 `untrusted`。

### 6.2 修复

用户已经明确授权信任该 Hook，因此把信任通过 Codex 的正式配置接口写入 `~/.codex/config.toml`，并重新查询两个工作目录。两边都返回：

```text
enabled = true
trustStatus = trusted
matcher = ^v4_flash_worker$
```

随后在隔离临时状态目录完成无付费验证：stage 成功、Hook 输出完整 `BEGIN/END PARENT ASSIGNMENT`、pending 被消费，只留下空锁文件。

### 6.3 修复后官方 smoke

在全新顶层 GPT-5.6 Sol 任务中严格执行上游 `quick-smoke-test.md`，结果为：

- 独立原生 child：通过；
- `agent_role=v4_flash_worker`：通过；
- `model_provider=deepseek`：通过；
- `model=deepseek-v4-flash`：通过；
- 新鲜 marker 精确返回且只出现一次：通过；
- 算术结果 `323`：通过；
- pending one-shot 消费，无 claimed/quarantine：通过；
- native callback 返回父任务：通过；
- 没有替代 provider、直接 API、另一个 Codex CLI 或重试：通过。

因此当前配置已通过真正的跨 provider 原生子代理验收，而不只是 UI 卡片或本地文件检查。

在 smoke 通过后新增的官方 catalog 没有再次产生付费请求；无付费 `codex debug models` 已验证 JSON 可解析，并正确暴露 `deepseek-v4-flash` 的 1M context、工具能力与 `max` reasoning 元数据。完整重启 App 后，后续新 child 会加载该最终目录。

## 7. 使用边界

适合交给 `v4_flash_worker` 的任务是边界明确、原始材料较多、最终结论较短的读取、检索、日志分析、代码审查、枚举、提取和普通只读测试。GPT 父任务继续负责需求解释、架构、范围控制、重要判断、验证、commit/push/PR、部署和最终交付。

当前上游 agent 默认 `sandbox_mode = "read-only"`。因此它可以分析代码和执行允许的只读命令，但不能直接落盘修改项目。若以后确实要让 DeepSeek 承担代码写入、SSH 变更或生成图文件，需要单独评估并显式扩大 custom-agent 权限；这不是本轮严格上游安装的一部分。

调度时遵守以下边界：

1. 先加载 `$use-v4-flash-worker`，再 stage；
2. stage 失败时绝不 spawn；
3. 只用精确 `agent_type=v4_flash_worker` 和 `fork_turns="none"`；
4. 运行中依靠原生 callback 或一次任务尺度等待，不短轮询；
5. missing assignment、claimed/quarantine 或 callback 丢失都视为 transport failure；
6. 不静默回退到 MCP、直接 API、其他 provider 或另一个 Codex CLI；
7. assignment 会短暂以 plaintext 存在本机状态目录，不能把它当作秘密信道。
