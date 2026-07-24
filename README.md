# Multi-Subagents

> 用一个强 GPT 主 Agent 主持决策，让 GPT 与 DeepSeek 在 Plan 和 Check 阶段进行有限轮次的攻防，由 DeepSeek V4 Pro 负责具体实现。

## 1. 为什么需要它

长任务有两个常见极端。

人如果规划一点、让 AI 做一点、再逐步检查一点，确实比较稳，但最终会变成人工流水线质检员。反过来，如果把整条任务链一次性交给 AI，顺利时很轻松；一旦结果异常，却很难判断问题最早出在思路、执行还是验收。

这个 Skill 想解决的只有一个问题：

> 让人退出逐步监督，同时通过多 Agent 的规划攻防、专注执行和对抗审查，降低长链任务跑偏后无法定位的风险。

它不是严丝合缝的工作流引擎，也不追求固定人数、复杂表单或无限辩论。AI 已经很擅长执行；额外模型最有价值的位置，是执行前把 Plan 想透，以及执行后把结果攻破。

## 2. 总体结构

固定的是 `Plan -> Execute -> Check` 三类责任，不是固定三个 Agent。

```text
用户
`-- GPT Chair：理解目标、组织攻防、依据证据裁决
    |-- 1. Plan
    |   `-- Chair 提出草稿 -> DeepSeek 攻击 -> Chair 防守或修订
    |-- 2. Execute
    |   |-- DeepSeek Worker：默认唯一实现者
    |   `-- 更多 DeepSeek Workers：仅用于独立 worktree
    `-- 3. Check
        |-- 可复现检查
        `-- GPT Chair 攻击 -> DeepSeek Executor 防守或修复
```

GPT Chair 保留用户目标和全局上下文。它可以调查项目、准备 worktree、运行测试和整合结果，但不应悄悄接管代码实现；需要写代码时，继续派给 DeepSeek Worker。

## 3. Plan：有限轮次的对抗规划

简单、明确、可机械验证的任务由 Chair 直接规划，不为了形式强行开会。

当存在多条合理路线、错误返工昂贵、关键假设不稳定或任务难以验证时，启动对抗规划：

```text
Chair：基于目标、约束和项目事实提出 Plan 草稿
   |
DeepSeek Challenger：定点攻击假设、反例、失败模式和验证缺口
   |
Chair：承认有效攻击并修订，或提供新证据防守
   |
DeepSeek Challenger：仅在还能提供新证据时继续反驳
```

攻防不要求双方先独立写一份完整方案。Chair 负责提出和收敛方案，DeepSeek 负责施加对抗压力。默认两轮、最多三轮；目标是暴露盲区，不是强迫达成共识，也不是按票数决定路线。

当继续辩论已经不能产生新证据时，Chair 停止讨论：

- 一方方案证据更充分：Chair 采用该方案；
- 分歧来自缺少可验证事实：先做最小调查或实验；
- 分歧涉及用户偏好、风险取舍或仍无法判断：交给用户。

提交给用户的不是整段聊天，而是一份简短证据包：

```text
争议决策
|-- 方案 A：证据与后果
|-- 方案 B：证据与后果
`-- Chair 的推荐及理由
```

## 4. Execute：只让 DeepSeek 实现

计划确定后，DeepSeek V4 Pro 是唯一代码 Writer。

### 一个实现任务

Chair 调用 `run_deepseek_worker`，提供：

- 已采用的 Plan；
- 实现范围和非目标；
- 项目约束；
- 完成标准和后续检查。

Worker 可以自主读取和编辑指定工作区，但首版不允许使用终端、网络、外部目录或递归 subagent。完成后，由 Chair 运行测试；若失败，把具体错误证据重新交给 DeepSeek 修复。

### 多个实现任务

只有子任务可以独立实现、独立验收时，才调用 `run_deepseek_workers`：

```text
独立任务 A -> DeepSeek Worker A -> worktree A
独立任务 B -> DeepSeek Worker B -> worktree B
独立任务 C -> DeepSeek Worker C -> worktree C
```

同一或相互嵌套的工作区不允许同时存在多个 Writer。并行省的是高价模型成本和墙上时间，并不天然节省总 token；耦合任务应交给一个 Worker。

DeepSeek 不可用时只重试一次，不应静默切换为 GPT 实现。

## 5. Check：让结果经受攻击

Check 先做可复现检查，再进行模型攻防。所谓可复现检查，是同样的输入和环境能够重复得到明确结果、不依赖某个模型主观看法的检查。例如测试是否通过、构建是否成功、CLI 输出是否符合预期、实验指标是否可重跑，以及链接、渲染或交互是否正常。

```text
可复现检查
-> GPT Chair 攻击 Plan 与实现
-> DeepSeek Executor 用代码、diff 和测试证据防守或修复
-> GPT Chair 根据新证据重新攻击或通过
-> Chair 裁决
```

GPT Chair 直接切换到攻击者立场，对照原始目标、采用的 Plan、实际产物和检查结果寻找偏差；DeepSeek Executor 负责举证防守或修复。高风险任务可以额外启动 Fresh GPT Reviewer，但它不是默认流程。

默认两轮、最多三轮。Review 分别判断：

1. Plan 是否真正满足原始目标；
2. 实现是否忠实满足 Plan；
3. 是否遗漏要求；
4. 是否未经允许增加、删除或改变内容。

计划正确但实现偏离，返回 Execute；实现忠实但 Plan 错误，返回 Plan；高影响争议仍无法解决，则把证据包交给用户。

## 6. 为什么 DeepSeek 原来不能编辑文件

DeepSeek API 本身只是一个推理接口：

```text
输入：messages
输出：文本或 tool-call 意图
```

它不会自动获得本机文件系统、终端或 Codex 的沙箱。最初的 `ask_deepseek` 只是：

```text
Codex -> 发送 prompt/context -> DeepSeek API -> 返回文本
```

所以 DeepSeek 可以建议怎么改，却不能真正读取仓库、修改文件或反复执行工具。

现在增加了两层能力：

```text
multi-subagents/SKILL.md
`-- 决定什么时候规划、执行、审查

DeepSeek MCP Bridge
`-- 把 Codex 的执行任务交给外部 Worker

OpenCode Agent Runtime
`-- 将 DeepSeek 的 tool calls 变成受限的 read/edit 操作

DeepSeek V4 Pro API
`-- 负责理解代码和决定具体修改
```

因此，Skill 负责“什么时候调用谁”，MCP 负责“连接 Codex 与外部 Worker”，OpenCode 提供“手”，DeepSeek 提供“脑”。只写一个 Skill 无法凭空给外部模型增加文件工具。

DeepSeek 官方支持以 V4 Pro 作为 OpenCode 等 coding agent 的后端；当前实现固定使用 OpenCode `1.18.4` 和 `deepseek-v4-pro`，默认推理强度为 `high`，困难任务可升为 `max`。

### 输出预算

DeepSeek V4 Pro 的官方最大输出是 384K，但最大能力不等于每次调用的合理默认值。当前采用“较小默认值 + 自动恢复”的分层预算：

```text
普通 high 调用：8K
困难 max 调用：32K
检测到截断：8K → 32K → 128K
仍然截断：拆分问题或交给用户判断
显式人工请求：最高可使用供应商允许的上限
```

用户不需要盯着工具日志发现截断。Chair 必须检查桥接返回的 `finish_reason: length` 和 `truncated: true`；一旦出现，就把本次输出视为不完整证据，并以更高一档预算从头重试。截断内容只能帮助判断如何重试，不能用于 Plan 或 Check 的最终裁决。

把默认值直接设为上限不会自动消耗全部 token，但会允许异常调用生成极长内容，并挤占 Chair 的上下文。因此默认保留 8K：它足以容纳大多数有边界的任务；真正超出时，由上述规则自动恢复，而不是依赖用户发现。

## 7. 全局安装

DeepSeek 的开发源码和 Skill 只保存在本项目。Codex 全局目录通过 Windows 目录联接指向这些源码，因此这里只维护一份，修改后无需再次复制同步：

```text
本项目
|-- skill/multi-subagents/SKILL.md
|-- integrations/deepseek-mcp/
|-- integrations/deepseek-worker/
`-- integrations/install-global.ps1
```

```text
~/.codex/skills/multi-subagents
`-- junction -> 本项目/skill/multi-subagents

~/.codex/integrations/deepseek
`-- junction -> 本项目/integrations
```

全局安装命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\integrations\install-global.ps1
```

用户级 `~/.codex/config.toml` 指向全局 MCP：

```toml
[mcp_servers.deepseek]
command = '<ABSOLUTE_NODE_PATH>'
args = ['<USER_HOME>\.codex\integrations\deepseek\deepseek-mcp\server.mjs']
env_vars = ["DEEPSEEK_API_KEY"]
enabled_tools = ["ask_deepseek", "run_deepseek_worker", "run_deepseek_workers"]
tool_timeout_sec = 930
default_tools_approval_mode = "approve"

[mcp_servers.deepseek.env]
DEEPSEEK_ALLOWED_ROOTS = '<ABSOLUTE_TRUSTED_PROJECT_ROOT>'
```

将三个占位符替换为本机绝对路径。位于同一可信代码根下的 Git 项目不需要逐个配置；若项目分布在不同顶层目录，再把必要范围加入 `DEEPSEEK_ALLOWED_ROOTS`。

`approve` 会默认放行该 MCP 的普通工具调用，避免每次手动确认；它不会绕过 Codex 对密钥外发、危险写入等行为的安全审查。

API key 只保存在本机环境变量 `DEEPSEEK_API_KEY`，不会写入 Skill、仓库或 `config.toml`。目录联接会让正文修改立即反映到全局路径，但 Codex 通常在新会话或重启后重新读取 Skill 元数据和 MCP 配置。

### Windows 与 Linux

仓库不提交 OpenCode 二进制。Windows 安装脚本会根据锁文件下载当前验证版本，并创建目录联接；Linux 云服务器则由使用者按 OpenCode 官方方式安装，然后把绝对路径交给 Worker：

```bash
export DEEPSEEK_OPENCODE_BIN="$(command -v opencode)"
export DEEPSEEK_API_KEY="..."

ln -s /path/to/use-subagents/skill/multi-subagents \
  ~/.codex/skills/multi-subagents
ln -s /path/to/use-subagents/integrations \
  ~/.codex/integrations/deepseek
```

Linux 的 MCP 配置还需把 `DEEPSEEK_OPENCODE_BIN` 加入 `env_vars`。项目不为不同系统分发安装包；操作系统只决定 OpenCode 的安装路径和全局链接方式，Skill 与桥接源码保持同一份。

## 8. 安全边界

允许 DeepSeek 编辑文件意味着相关代码会发送给 DeepSeek。当前桥接采用以下限制：

- 仅接受 `DEEPSEEK_ALLOWED_ROOTS` 下的 Git 仓库或 worktree 根；
- 拒绝包含 `.env`、私钥、PEM、凭据文件的工作区；
- 拒绝项目内 `opencode.json`、`opencode.jsonc` 和 `.opencode/`，防止覆盖权限；
- 仅开放工作区内 `read/edit/glob/grep/list`；
- 禁止终端、网络、外部目录、插件、MCP 和递归 subagent；
- 一个工作区只允许一个 Writer；
- 并行组任一 Worker 失败时，先终止并等待其他 Worker，再释放目录锁；
- 工具调用默认要求批准。

这些保护降低常见风险，但不能证明任意代码库绝不包含秘密。应优先使用干净 worktree，不要把生产凭据放进交给外部模型的工作区。

## 9. 本次调试过程

### 阶段一：验证普通 API

先用 DeepSeek 官方 `chat/completions` 接口实现 `ask_deepseek`，固定模型为 V4 Pro，启用 thinking，并测试鉴权、超时、取消、响应大小、重定向和密钥脱敏。

结果：DeepSeek 能参与 Plan 和 Review，但只能返回文本。

### 阶段二：增加 Agent 工具循环

为了让 DeepSeek 真正操作代码，引入 DeepSeek 官方支持的 OpenCode。第一次通过通用 npm 包安装失败，因为 Windows 平台包没有正确落地；随后固定安装 `opencode-windows-x64@1.18.4`。

结果：DeepSeek 成功读取隔离目录的 README，并按要求只修改一行。

### 阶段三：解决真实运行卡住

封装成 Worker 后，第一次真实测试一直等待到超时。原因不是模型能力，而是启动 Worker 时清理环境变量过度，把本机代理变量一并删除，导致 OpenCode 无法访问 DeepSeek API。

修正后只转发必要的系统变量、API key 和代理变量。单 Worker 恢复为十几秒内完成。

### 阶段四：安全复核

第一轮实现虽然能工作，但复核发现四个关键问题：

1. 调用者可以把任意目录声明为 workspace；
2. 项目 OpenCode 配置可能覆盖权限；
3. Worker 可能读到 `.env` 或私钥；
4. 并行组中一个 Worker 失败后，其他 Worker 可能继续写文件。

对应修复为：可信根 allowlist、Git 根校验、拒绝项目 OpenCode 配置、敏感文件扫描和读取 deny、唯一受限 Agent、跨调用目录锁，以及并行 fail-fast 后等待清理。

### 阶段五：验证结果

当前已经通过：

- MCP 桥接单元测试；
- Skill 格式校验；
- 单个 DeepSeek Worker 的真实文件编辑；
- 两个 DeepSeek Workers 在不同 Git 工作区中的真实并行编辑；
- 密钥未进入仓库扫描。

真实并行测试中，两个 Worker 分别只修改自己的 README，证明“一个 Writer 一个 worktree”的主路径已经跑通。

## 10. 当前状态

当前版本已经具备：

```text
Plan：GPT + DeepSeek 有限轮次攻防
Execute：一个或多个隔离的 DeepSeek V4 Pro Workers
Check：可复现检查 + GPT Chair 与 DeepSeek 有限轮次攻防
```

它仍是一个轻量实验版本。首版有意不加入固定角色编制、复杂任务 schema、动态模型权重或自动淘汰；只有真实使用暴露出明确问题时，再增加对应约束。

## 参考

- [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [DeepSeek coding-agent 集成指南](https://api-docs.deepseek.com/guides/coding_agents/)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [OpenCode Agent 配置](https://opencode.ai/docs/agents/)
- [OpenCode 权限模型](https://opencode.ai/docs/permissions/)
