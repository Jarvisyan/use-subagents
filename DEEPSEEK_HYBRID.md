# GPT–DeepSeek 混合接入指南

本文说明如何让 Codex 继续使用 GPT 作为主模型，同时把 DeepSeek V4 Flash 暴露成一个可由 GPT 主动调用的 `ask_deepseek` 工具。实现面向 Linux 与 Windows，适合规划质询、方案对抗、实现建议和独立审查。

文档与实现基线日期：2026-07-31。DeepSeek 的模型支持、价格和兼容性仍可能更新，部署前应复核文末官方来源。

## 1. 最终决策与架构

本项目最终只把 DeepSeek 注册成 GPT 可调用的 MCP 工具。日常配置保持 GPT 为 Codex 主模型，不安装 DeepSeek 官方的 Codex 直连配置，也不创建 DeepSeek 模型目录或自定义子代理：

- 不设置顶层 `model_provider = "deepseek"`；
- 不写入 `model_catalog_json` 或 `models.json`；
- 不创建 `deepseek_challenger.toml` 等原生 agent 配置；
- 不要求 DeepSeek 出现在 `/model`，验收入口是 `ask_deepseek` 工具。

### 1.1 两层接口各自负责什么

DeepSeek 官方已经支持 Codex 使用的 Responses API。若直接把 DeepSeek 配置成 Codex 的模型提供方，整个会话都会由 DeepSeek 驱动；这适合纯 DeepSeek 会话，却不会自动得到“GPT 主持、DeepSeek 挑战”的双模型工作流。

混合接入保留两层接口：

```text
GPT 主模型（Codex 当前会话）
  │
  │ MCP：ask_deepseek
  ▼
本地轻量桥接器
  │
  │ DeepSeek Responses API
  ▼
deepseek-v4-flash
```

其中 MCP 是 GPT 看得见并主动调用的工具接口，Responses API 只是桥接器请求 DeepSeek 的内部传输协议。这里不采用的是“把整个 Codex 切换成 DeepSeek”的官方直连安装方式，并不是让 MCP 回退到旧协议。

与历史方案相比，新实现移除了 `OpenCode → Chat Completions API` 中间层，只保留一个无第三方 npm 依赖的 Node.js stdio MCP。它只提供 `ask_deepseek`，不会注册旧的 `run_deepseek_worker` 或 `run_deepseek_workers`。

### 1.2 为什么不把官方直连作为默认方案

2026-07-31 在 Codex CLI 0.145.0 上的隔离测试得到三项结果：

| 测试 | 结果 | 对本项目的含义 |
| --- | --- | --- |
| DeepSeek 作为整个 Codex 的 provider | `deepseek-v4-flash` 可以通过 Responses API 正常回答 | 官方直连适合纯 DeepSeek 会话 |
| 加载 DeepSeek 官方 `models.json` | 自定义目录替换当前 GPT 目录，而不是把两方模型合并；桌面端按官方说明显示“自定义” | `/model` 不能作为 GPT 与 DeepSeek 共存入口 |
| GPT 启动 DeepSeek 原生子代理 | 本轮没有验证到子线程切换为 DeepSeek；一次已创建子线程的记录仍显示 `model_provider: openai` | 当前基线不依赖跨 provider 原生子代理 |

因此，本项目的稳定目标是“GPT 主持、DeepSeek 提供文本意见”，而不是让两家模型出现在同一个模型选择器中。只有将来 Codex 明确暴露并验证了对子线程 provider 的选择能力，才重新评估是否淘汰 MCP。

如果机器完全没有可用的 GPT/ChatGPT 主模型，MCP 不能凭空提供主代理；这种场景应在独立的 Codex 环境中采用 DeepSeek 官方直连。它是另一种部署模式，不属于本文的混合配置。

## 2. 能力与边界

### 2.1 适合的任务

一次典型调用像一次独立专家会诊：GPT 把待审计划和必要上下文交给 DeepSeek，DeepSeek 返回反例、遗漏与修正建议，最后仍由 GPT 结合本地代码和用户目标作出裁决。

`ask_deepseek` 提供四种角色：

- `challenger`：质疑假设、寻找反例，默认角色；
- `planner`：给出独立执行计划；
- `reviewer`：审查结果、回归和不可验证结论；
- `executor`：提供具体实现建议，但不直接修改文件。

推理强度支持 `high` 和 `max`。桥接器不发送 `max_tokens` 或 `max_output_tokens`，由 DeepSeek 使用供应商默认输出预算。

### 2.2 不等同于 DeepSeek 文件 Worker

Responses API 是模型协议，不会凭空提供完整的文件工具循环。当前桥接器因此是“文本意见工具”：

- DeepSeek 看不到整个仓库，只能看到 GPT 明确传入的 `prompt` 和 `context`；
- DeepSeek 不会直接执行终端命令或修改文件；
- GPT 主会话负责读取代码、执行工具、采用或拒绝 DeepSeek 意见。

这种边界很适合对抗辩论，也比把整个工作区发送给外部 Worker 更容易审计。若以后确实需要 DeepSeek 自主改文件，应另行设计隔离 worktree、工具权限和验证流程，不应悄悄扩展 `ask_deepseek`。

### 2.3 DeepSeek Responses API 的当前限制

截至基线日期，DeepSeek 官方说明 Codex/Responses API 仅支持 `deepseek-v4-flash`，V4 Pro 预计在 2026 年 8 月初加入。Responses API 支持 function tools、服务端 Web Search 和 Codex 使用的 `apply_patch` custom tool，但不支持服务端 `previous_response_id`、conversation/store、图片输入及多数其他内置工具。

本桥接器每次调用都是独立请求。多轮“辩论记忆”由 GPT 主会话维护；需要延续时，GPT 应把上一轮关键结论放进下一次调用的 `context`。

## 3. 目录结构

```text
integrations/
├── configure-deepseek-mcp.mjs      # 跨平台、安全更新 config.toml
├── install-deepseek-hybrid.sh      # Linux 安装器
├── install-deepseek-hybrid.ps1     # Windows 安装器
└── deepseek-mcp/
    ├── server.mjs                  # MCP 与 Responses API 桥接器
    ├── test.mjs                    # 离线协议测试
    ├── test-configure.mjs          # 离线配置迁移/幂等测试
    └── live-test.mjs               # 最小真实 API 测试
```

旧的 `integrations/install-global.sh` 和 `~/.codex/integrations/deepseek` 符号链接已经删除。当前实现不依赖 OpenCode，也不需要为 `integrations/` 建立全局链接。

运行要求：

- Node.js 18 或更高版本；
- 已安装并至少运行过一次 Codex；
- 可用的 DeepSeek API Key；
- 能访问 `https://api.deepseek.com`。

## 4. Linux 快速配置

### 4.1 使用已有密钥

默认密钥文件是：

```text
~/.config/deepseek/env
```

内容格式为：

```bash
DEEPSEEK_API_KEY=sk-...
```

如果文件已存在，安装器会复用它并收紧为 `600` 权限，不会打印或复制密钥。当前服务器以前提供的 Key 可以直接复用，只要它尚未被撤销且账号余额正常。

运行：

```bash
chmod +x integrations/install-deepseek-hybrid.sh
./integrations/install-deepseek-hybrid.sh
```

需要顺便执行一次最小真实 API 测试时：

```bash
./integrations/install-deepseek-hybrid.sh --live-test
```

真实测试会产生少量 DeepSeek API 用量。普通安装默认只运行本地模拟测试，不产生 API 费用。

### 4.2 首次提供密钥

可以先通过当前 shell 提供：

```bash
export DEEPSEEK_API_KEY='sk-...'
./integrations/install-deepseek-hybrid.sh
```

安装器会将其保存到权限为 `600` 的密钥文件，然后在写入后清除脚本变量。也可以直接运行脚本并在静默提示中输入。

### 4.3 自定义路径

```bash
./integrations/install-deepseek-hybrid.sh \
  --codex-home /path/to/codex-home \
  --node-bin /absolute/path/to/node \
  --api-key-file /absolute/path/to/deepseek.env
```

## 5. Windows 快速配置

在 PowerShell 中进入仓库目录：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\integrations\install-deepseek-hybrid.ps1
```

默认位置：

```text
Codex 配置：%USERPROFILE%\.codex\config.toml
密钥文件：%USERPROFILE%\.config\deepseek\env
```

如果默认密钥文件已存在，安装器直接复用。否则优先读取当前进程的 `DEEPSEEK_API_KEY`，仍不存在时使用安全输入提示创建文件，并尝试把 ACL 收紧到当前 Windows 用户。

执行真实 API 测试：

```powershell
.\integrations\install-deepseek-hybrid.ps1 -LiveTest
```

自定义路径：

```powershell
.\integrations\install-deepseek-hybrid.ps1 `
  -CodexHome "D:\codex-home" `
  -NodeBin "C:\Program Files\nodejs\node.exe" `
  -ApiKeyFile "$env:USERPROFILE\.config\deepseek\env"
```

Windows 脚本在本仓库的 Linux 服务器上无法实际执行，因此发布前应在目标 Windows 机器运行其离线测试和 `codex mcp get deepseek`。MCP 与配置更新核心均为跨平台 Node.js，实现逻辑由两套安装器共用。

## 6. 安装器会修改什么

安装器不会更改以下 Codex 主模型设置：

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
```

它也不会写入 `model_provider`、`model_catalog_json`、`models.json` 或 `agents/*.toml`，因此不会改变 `/model` 中的 GPT 模型目录。

它只替换旧的 `[mcp_servers.deepseek]` 及其子表，然后追加受标记管理的新配置：

```toml
# BEGIN use-subagents deepseek-hybrid
[mcp_servers.deepseek]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/integrations/deepseek-mcp/server.mjs"]
enabled_tools = ["ask_deepseek"]
startup_timeout_sec = 10
tool_timeout_sec = 14400
default_tools_approval_mode = "approve"
enabled = true

[mcp_servers.deepseek.env]
DEEPSEEK_API_KEY_FILE = "/absolute/path/to/deepseek/env"
# END use-subagents deepseek-hybrid
```

密钥值不会写进 `config.toml`，这里只保存密钥文件路径。安装前已有的 `config.toml` 会备份为：

```text
config.toml.bak-deepseek-YYYYMMDD-HHMMSS-mmm
```

配置通过同目录临时文件原子替换。重复运行安装器只会更新一个管理块，不会不断追加重复 MCP。

## 7. 验证

### 7.1 不联网测试

```bash
node integrations/deepseek-mcp/test.mjs
node integrations/deepseek-mcp/test-configure.mjs
```

第一项通过本机回环模拟 Responses API，验证：

- 请求路径是 `/responses`；
- 模型是 `deepseek-v4-flash`；
- `reasoning.effort` 正确传递；
- 不发送任何手工输出 token 上限；
- 输出文本、usage、认证错误和密钥脱敏正确；
- MCP 只注册 `ask_deepseek`。

第二项验证旧 MCP 段迁移、其他 Codex 配置保留、备份和重复安装幂等性。

### 7.2 Codex 配置解析

```bash
codex mcp get deepseek
```

应看到：

- `enabled: true`；
- `transport: stdio`；
- 工具允许列表只有 `ask_deepseek`；
- command 指向当前 Node.js；
- args 指向新的 `server.mjs`。

DeepSeek 没有出现在 `/model` 是预期行为，不代表安装失败。混合方案应通过 MCP 配置和 `ask_deepseek` 调用结果验收。

### 7.3 最小真实 API 测试

Linux：

```bash
DEEPSEEK_API_KEY_FILE="$HOME/.config/deepseek/env" \
  node integrations/deepseek-mcp/live-test.mjs
```

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY_FILE = "$env:USERPROFILE\.config\deepseek\env"
node .\integrations\deepseek-mcp\live-test.mjs
```

成功时只输出模型、状态和 token usage，不输出密钥或完整思维链。

### 7.4 会话级验证

完全重启 Codex，创建新会话后可以使用：

```text
先独立分析这个实现方案，然后调用 ask_deepseek，要求 challenger 寻找反例。
最后由你比较双方证据并作出裁决，不要把 DeepSeek 的回答直接当成结论。
```

如果希望每次复杂计划都做对抗，可以把类似规则放进项目 `AGENTS.md`；不要要求把密钥、`.env` 或无关私有文件放进 `context`。

## 8. 安全策略

### 8.1 密钥

- 密钥文件不进入 Git；
- Linux 使用 `600` 权限；
- Windows 安装器尝试应用仅当前用户可读写的 ACL；
- MCP 错误会过滤形如 `sk-...` 的字符串；
- 配置和测试日志不打印 Key。

同一个有效 DeepSeek API Key 可以被旧 API 与 Responses API 复用；协议变化不要求创建新 Key。如果 Key 曾经进入聊天、Git、终端历史或公开日志，应立即撤销并轮换，而不是继续复用。

### 8.2 数据外发

`ask_deepseek` 是外部网络调用。GPT 应只发送完成质询所需的最小文本，不应发送：

- API Key、密码、令牌和私钥；
- `.env`、云凭据、Cookie；
- 未经授权的个人或客户数据；
- 与问题无关的完整仓库内容。

对敏感项目，可把 `default_tools_approval_mode` 从 `"approve"` 改为 `"prompt"`，让每次调用先请求确认。

### 8.3 接口固定

生产环境固定访问 `https://api.deepseek.com/responses`。`DEEPSEEK_BASE_URL` 覆盖只允许在 `NODE_ENV=test`、测试 Key 和回环 HTTP 地址同时满足时使用，避免配置被改向未知上游。

## 9. 回滚与故障定位

### 9.1 回滚配置

先完全退出 Codex，再把最近的备份恢复为 `config.toml`。Linux 示例：

```bash
cp ~/.codex/config.toml.bak-deepseek-<时间戳> ~/.codex/config.toml
chmod 600 ~/.codex/config.toml
```

Windows PowerShell：

```powershell
Copy-Item "$env:USERPROFILE\.codex\config.toml.bak-deepseek-<时间戳>" `
  "$env:USERPROFILE\.codex\config.toml" -Force
```

密钥文件没有被迁移或删除，回滚配置不需要轮换 Key。

### 9.2 常见错误

- `CONFIG_MISSING`：密钥文件路径错误、不可读或缺少赋值；
- `AUTH_FAILED`：Key 已失效或账号拒绝认证；
- `RATE_LIMITED`：达到并发/速率限制；
- `UPSTREAM_IDLE_TIMEOUT`：响应长时间没有任何网络数据；
- `UPSTREAM_TIMEOUT`：超过硬总时限；
- `BAD_RESPONSE`：上游返回无效 JSON、没有最终文本或响应超过内存边界；
- Codex 看不到工具：完全重启 Codex，并运行 `codex mcp get deepseek` 检查绝对路径；
- `/model` 没有 DeepSeek：混合方案不会安装 DeepSeek 模型目录，这是预期行为，请检查 `ask_deepseek` 而不是模型选择器。

## 10. 官方信息来源

DeepSeek：

- [接入 Codex](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)：说明 Codex 使用 Responses API，以及直接模型提供方的官方配置方式；
- [使用 Responses API](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)：请求格式、流式事件、参数、items 和 tools 兼容性；
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：V4 Flash/Pro 模型能力、上下文、输出、价格和并发；
- [首次调用 API](https://api-docs.deepseek.com/zh-cn/)：官方 base URL、模型名和认证方式；
- [限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)：并发限制、`user_id` 与 keep-alive 行为。

Codex / MCP：

- [Codex MCP 配置](https://developers.openai.com/codex/mcp)：stdio MCP 的 `command`、`args`、`env`、工具允许列表和超时配置；
- [Codex 配置参考](https://developers.openai.com/codex/config-reference)：`mcp_servers` 的完整配置字段；
- [Codex 高级配置](https://developers.openai.com/codex/config-advanced)：自定义模型提供方和凭据处理；
- [Model Context Protocol](https://modelcontextprotocol.io/specification/)：MCP JSON-RPC、初始化和工具调用协议。

## 11. 维护建议

当 DeepSeek 增加 V4 Pro Responses API 支持时，不应直接把 Flash 静默替换为 Pro。Flash 在本架构中承担低成本、高频 challenger，Pro 更适合作为显式高质量档位。若以后同时支持两者，建议新增模型参数或第二个工具，并保留默认 Flash，以免改变既有成本和延迟预期。

不要因为 Codex 支持自定义 agent 文件，就推断 GPT 子线程已经能切换到 DeepSeek provider。只有在子线程元数据、实际请求和端到端结果都证明跨 provider 生效后，才考虑增加原生 DeepSeek agent；在此之前不向主配置加入官方 `models.json`。

每次升级至少重复三类验证：离线协议测试、Codex 配置解析、最小真实 API 测试。只有三者都通过，才说明“代码正确、Codex 能加载、上游真实可用”三个层面同时成立。
