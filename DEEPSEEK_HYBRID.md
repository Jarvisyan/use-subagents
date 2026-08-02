# GPT–DeepSeek 混合接入指南与踩坑记录

本文记录如何让 Codex 保留 GPT 主模型，同时调用 DeepSeek V4 Flash 进行规划质询、方案对抗和独立审查。当前唯一实现是“GPT → MCP → 官方配置的 DeepSeek Codex sidecar”：MCP 仍是父 GPT 调用 DeepSeek 的入口，sidecar 内部再由官方 Codex 运行时处理 Responses API、工具循环和模型元数据。

文档与实现基线日期：2026-08-02。DeepSeek 的模型支持、价格和 Codex 兼容性仍可能更新，部署前应复核文末官方来源。

本文面向任意 Linux 或 Windows 用户设备，不要求复用维护者服务器的用户名、目录布局、Node/Codex 安装位置或历史测试版本。安装器会根据目标设备生成绝对路径；文中的 `<repo-root>`、`<codex-config-root>`、`<workspace-root>` 等名称都是需要由本机环境解析的逻辑位置，不是应原样复制的字符串。

## 1. 修订后的结论与架构

本项目的需求不是单纯“让 Codex 能用 DeepSeek”，而是让 GPT 在自己的任务中调用 DeepSeek 作为专业挑战者。这个目标需要同时解决两件不同的事：

1. MCP 或等价编排层负责回答“GPT 怎样调用 DeepSeek”；
2. DeepSeek 官方 Codex 配置负责回答“一个 Codex 进程怎样完整地运行在 DeepSeek 上”。

当前代码已经是下表中的方案 4，并且直接替换了方案 2：不保留第二套后端、第二个 MCP 工具或备用桥接文件。文中对方案 2 的描述只用于解释历史踩坑，不是可安装或可运行的入口。

### 1.1 四种方案不要混为一谈

| 编号 | 方案 | 适用场景 | 能否在 GPT 当前任务中自动调用 DS | DS 是否拥有完整 Codex 代理循环 |
| --- | --- | --- | --- | --- |
| 1 | DeepSeek 官方直连 Codex | 整个 Codex 都由 DS 驱动 | 否 | 是 |
| 2 | GPT → MCP → 裸 Responses API | 快速、便宜的独立文本意见 | 是 | 否 |
| 3 | GPT、DS 两套 profile/窗口 | 人工在两个完整代理间切换 | 否 | 是 |
| 4 | GPT → MCP → 官方配置的 DS Codex sidecar | 同一 GPT 任务中的完整 DS 挑战者 | 是 | 是，已实现并通过离线 sidecar/配置回归测试 |

DeepSeek 官方直连会设置顶层 `model_provider = "deepseek"`、DeepSeek API 地址和专用 `models.json`。这会让当前 Codex 进程的模型回合由 DeepSeek 驱动，适合没有 GPT 订阅或希望全程使用 DeepSeek 的机器；它不会自动把 DeepSeek 加成 OpenAI 父会话的子代理。

`models.json` 是能力目录，不是多供应商路由表。它告诉 Codex 上下文窗口、推理强度和工具格式，却不负责把 `gpt-*` 发往 OpenAI、把 `deepseek-*` 发往 DeepSeek。`model_provider` 在一个运行配置中仍是单一选择。因此 `/model` 可以选择当前目录中的模型，但不能据此推断同一会话已具备跨 provider 路由。

### 1.2 方案 2（历史存量，仅作对照）

```text
GPT 主模型（Codex 当前会话）
  │
  │ MCP：ask_deepseek
  ▼
历史上的本地轻量桥接器
  │
  │ 单次 DeepSeek Responses API 请求
  ▼
deepseek-v4-flash 返回文本意见
```

MCP 是 GPT 看得见并主动调用的工具接口，Responses API 是桥接器请求 DeepSeek 的传输协议。当前实现移除了历史上的 `OpenCode → Chat Completions API` 中间层，只保留一个无第三方 npm 依赖的 Node.js stdio MCP；它只提供 `ask_deepseek`，不会注册旧的 `run_deepseek_worker` 或 `run_deepseek_workers`。

这段流程已经从当前实现中删除。日常 GPT 配置仍不设置 `model_provider = "deepseek"`，所以 DeepSeek 不出现在 GPT 会话的 `/model` 中仍是预期行为；当前方案通过 `ask_deepseek` 验收。

### 1.3 目标方案 4：官方 backbone + 最小混合适配

```text
GPT 主模型（Codex 当前会话）
  │
  │ MCP：提交挑战任务
  ▼
隔离的 DeepSeek Codex sidecar
  │  CODEX_HOME=<独立 sidecar 目录> codex exec --ephemeral
  │  官方 model_provider + models.json
  │  模型 ↔ 工具 ↔ 模型的代理循环
  ▼
DeepSeek 最终审查报告返回 GPT
```

方案 4 仍然需要 MCP，因为官方直连本身不负责“GPT 调 DS”。MCP 后端只负责启动一个按官方方式配置的独立 Codex 进程，不再自己模拟模型代理。当前实现用独立 `DEEPSEEK_CODEX_HOME` 保存 sidecar 配置，用 `--ephemeral`、`--sandbox read-only` 和明确的工作目录运行；sidecar 配置不含任何 MCP 表，因此不会递归启动父 MCP。DeepSeek 收到的 handoff 只包含 GPT 为本次场景生成的任务和上下文，不再由 MCP 额外注入固定的 challenger、reviewer 或只读人格指令。

### 1.4 官方 backbone 与允许偏离

为了避免再次出现“局部字段看似合理、整体行为已经跑偏”，当前配置采用一条可审计契约：官方文件原样固定，混合层只保留明确有动机的适配差异。

| 层 | 固定或修改内容 | 动机 |
| --- | --- | --- |
| 官方模型目录 | `integrations/deepseek-codex/models.json` 原样来自 DeepSeek 官方 Codex 安装脚本；当前 SHA256 为 `b459a6e438d6a9939d01fd0dbb4693f165ed732bc8e4fd58d7145d9d94bd49a4` | 保留官方底层指令、上下文、工具格式和模型元数据，升级时用整文件同步而不是手改字段 |
| 官方 provider | `deepseek`、`https://api.deepseek.com/`、`wire_api = "responses"`、Flash 模型名 | 遵循官方接入协议；执行入口仍固定 Flash |
| 运行时推理 | 模型目录的官方默认值仍是 `high`；sidecar 配置和每次 `codex exec` 覆盖为 `max` | 满足本项目对高质量对抗审查的明确选择，不改写官方目录 |
| 密钥方式 | 用 `env_key` 从 MCP 子进程环境注入，而不是把 Key 写进配置 | 保持 provider 语义不变，同时避免明文落盘 |
| 无交互认证 | `preferred_auth_method = "apikey"`、`forced_login_method = "api"` | sidecar 没有登录终端，明确选择 API Key 认证；不改变模型、提示词或工具能力 |
| 混合编排 | 独立 `CODEX_HOME`、MCP `ask_deepseek`、`--ephemeral`、只读沙箱 | 这是“GPT 调用 DS 子代理”所必需的适配层，不属于模型能力定制 |
| 工作区兼容 | `--skip-git-repo-check` | 允许授权根目录不是 Git 仓库；仍由 `--sandbox read-only` 和 realpath 根边界限制读写范围，不绕过项目规则 |
| 任务角色 | 不在 MCP 或 `models.json` 中预设角色；由 GPT 每次生成完整任务指令 | 避免第二套角色提示与官方 Codex 指令发生错配 |

官方 `models.json` 中虽然同时列出 Flash 和 Pro，官网当前仍注明 Codex 以 Flash 为当前支持模型；目录完整保存，sidecar 运行时不自动切换 Pro。

## 2. 方案 2 与方案 4：不是简单的配置差异

### 2.1 核心差异是运行时边界

方案 2 调用的是一个模型端点。桥接器拼好 `instructions` 和 `input`，发起一次 `/responses` 请求，然后抽取最终文本。DeepSeek 无法自行读取仓库；如果它认为还需要查看另一个文件，也没有下一步工具循环可走。

方案 4 调用的是一个代理运行时。DeepSeek 先判断需要查看哪些文件，Codex sidecar 在沙箱内执行只读工具，把结果交还 DeepSeek；模型可以继续推理、再次取证，直到生成最终报告。Responses API 仍在底层使用，但它被完整的 Codex 工具循环包围。

```text
GPT 父会话（自动拥有当前聊天上下文）
  │
  ├─ 方案 2：GPT 提炼 prompt/context
  │              │  只传这段显式文字
  │              ▼
  │           单次 /responses 请求
  │              │  × 不能自行读取源文件
  │              │  × 没有工具辅助的多轮迭代
  │              ▼
  │           DS 最终文本 → 返回 GPT
  │
  └─ 方案 4：GPT 构造任务交接信息
                 │  仍不自动复制完整聊天记录
                 ▼
              DS Codex sidecar
                 ├─ 按需读取授权范围内的源文件
                 ├─ 模型 → 工具 → 结果 → 模型（零到多轮）
                 ├─ 根据新证据继续检查或结束
                 ▼
              DS 最终报告 → 返回 GPT
```

这就像“给专家寄一页材料，请他回一封邮件”和“让专家进入只读资料室自行查档”。两者都在咨询同一个专家，工作边界却完全不同。

### 2.2 两种方案都不自动共享完整父会话

需要把“对话上下文”和“工作上下文”分开理解。GPT 父代理自动拥有当前用户对话、自己先前的分析和已经收到的工具结果；DeepSeek 处在另一个请求或进程中，不会天然看到这些内容。

| 上下文来源 | 方案 2 | 方案 4 |
| --- | --- | --- |
| GPT 当前完整聊天记录 | 不自动共享 | 不自动共享 |
| GPT 显式构造的任务、约束和摘要 | 作为 `prompt/context` 传入 | 作为 sidecar 初始任务传入 |
| 仓库源文件 | 只有 GPT 复制进 `context` 的片段 | 可按任务需要在授权工作目录中自行读取 |
| 工具结果形成的新上下文 | 没有工具循环 | 在一次 sidecar 任务内持续积累 |
| 上一次 DS 调用的记忆 | 下一次调用必须由 GPT 再次传入 | 目标 PoC 使用 `--ephemeral`，新任务也必须重新交接 |
| DS 最终输出 | 返回并进入 GPT 父任务的后续上下文 | 返回并进入 GPT 父任务的后续上下文 |

所以所谓“一锤子买卖”适用于方案 2 的执行边界，但不代表 DeepSeek 在一次响应内部完全不思考。`reasoning_effort = "max"` 仍可让它进行大量内部推理；限制在于它无法暂停下来索取缺失文件、执行工具，再基于新证据继续推理。

方案 4 同样从 GPT 喂给它的任务交接信息起步，但能够主动扩展自己的工作上下文。它可以发现还需要读取配置文件和测试代码，调用只读工具取得内容，然后继续判断；它看不到的仍是那些只存在于父聊天、既没有写进交接信息也没有落在项目文件里的背景。

这也是方案 4 仍需要良好 handoff 的原因。GPT 至少应传递任务目标、争议点、不可违反的约束、验收标准和相关工作目录，而不是只说“请审查一下”；同时也不应为了图省事把完整聊天记录和所有私有数据无差别外发。

### 2.3 哪些只是参数，哪些属于架构

| 能力 | 方案 2：裸 Responses MCP | 方案 4：DS Codex sidecar | 性质 |
| --- | --- | --- | --- |
| GPT 在当前任务中调用 DS | MCP 工具 | MCP 工具 | 相同的编排需求 |
| 输入上限 | 历史桥接器自设 20,000 + 40,000 字符及 160 KiB 总上限 | sidecar 按官方模型目录识别 1,048,576-token 窗口及有效比例；MCP 只保留 2 MiB handoff 安全边界 | 方案 2 的模型上限是实现选择，sidecar 的边界是编排层防护 |
| 工具调用 | 请求体没有 `tools` | Codex 负责模型与本地工具的循环 | 架构差异 |
| 仓库取证 | 只能看 GPT 复制的文本 | 可在授权沙箱中按需读取 | 架构差异 |
| 多轮执行 | 每次 `ask_deepseek` 是独立单次请求 | 一个 sidecar 任务内可多轮“模型—工具—模型” | 架构差异 |
| 模型元数据 | 不读取官方 `models.json` | 由独立 sidecar `CODEX_HOME` 加载官方目录 | 架构差异 |
| 推理强度 | 历史桥接器只暴露 `high`、`max`，默认 `high` | 官方目录支持 `low`、`high`、`max`；sidecar 与 MCP 默认均为 `max` | 可配置能力 |
| 超时 | HTTP 总时限、空闲时限和 MCP 工具时限 | 还要管理子进程、代理循环及 MCP 总时限 | 实现与运维差异 |
| 父会话上下文 | 只接收显式 `prompt/context` | 仍不会自动继承全部 GPT 历史，但可自行读取工作区 | 两种方案都需明确交接 |

把 6 万字符调大、把默认推理改成 `max`，只能改善方案 2，不能把它变成方案 4。若继续在桥接器里补工具分派、沙箱、批准策略、多轮 item 处理、上下文压缩和失败恢复，实际上是在重新实现一遍 Codex 代理运行时。

因此，之前的想法并非完全错误：若目标只是“请 DS 对一段计划发表独立意见”，方案 2 简洁而合适。真正的问题是后来把它当成了“完整 DS 子代理”的最终方案，目标与架构发生了错位。

## 3. 踩坑记录与警示

### 3.1 `models.json` 不是模型路由器

官方文件描述模型能力，顶层 `model_provider` 才决定请求发往哪里。把 DeepSeek 条目合并进 GPT 目录，并不会自动形成 OpenAI/DeepSeek 双路由；在隔离测试中，加载官方 DeepSeek 目录表现为替换当前目录，而不是给现有 GPT 列表追加一个可跨 provider 调用的模型。

### 3.2 “Responses API 支持工具”不等于裸请求自动拥有工具

DeepSeek Responses API 支持 function tools、服务端 Web Search 和 Codex 使用的 `apply_patch` custom tool，但裸调用方必须提供工具定义，并负责执行后续循环。这正是历史方案 2 的架构缺陷。当前 `ask_deepseek` 不再直接拼 `/responses` 请求，而是交给官方 Codex sidecar；工具定义、调用和后续循环由 sidecar 负责。

### 3.3 “官方上下文 1M”不等于桥接器自动获得 1M

官方 `models.json` 为 Flash 声明 1,048,576-token 上下文和 95% 有效比例。历史桥接器不加载该目录，并主动把 `prompt` 限制为 20,000 字符、`context` 限制为 40,000 字符，同时设置 160 KiB 总输入上限。当前 sidecar 已加载官方目录；MCP 仍对父代理 handoff 设置 100,000/500,000 字符和 2 MiB 字节边界，用于防止误把整个敏感环境塞进一次调用。这些是编排层安全边界，不是 DeepSeek 模型的上下文窗口或输出 token 上限。

这些保护最初有合理目的：避免单条 JSON-RPC 消息失控、意外外发整个仓库并控制延迟。错误不在于存在安全边界，而在于文档没有及时说明它和完整模型能力之间的巨大差距。

### 3.4 agent 文件中的模型名不等于切换 provider

Codex 公开文档允许自定义 agent 覆盖 `model` 和 `model_reasoning_effort`，但截至本基线没有明确保证 OpenAI 父会话的子代理可以同时切换 API 地址、认证方式和 `model_provider`。当前可调用的子代理接口也没有 provider 参数；一次实际记录仍显示子线程使用 `model_provider: openai`。

在获得端到端证据前，不应仅凭 `model = "deepseek-v4-flash"` 就宣布原生跨 provider 子代理已经成功。

### 3.5 `/model` 是当前 provider 的模型选择，不是供应商混合器

官方 DeepSeek 配置启动后，桌面端可能显示“自定义”或 DeepSeek 模型名；这说明当前 Codex 已切到 DeepSeek 配置，不代表 GPT 与 DeepSeek 已在原会话中并存。DeepSeek 官方文档还说明，不同登录方式的会话会分组显示，恢复配置并重启后才能重新看到原来的 ChatGPT 会话组。

### 3.6 `max` 慢不代表四小时工具超时就是唯一答案

当前 Codex MCP 工具时限是 14,400 秒；sidecar 子进程的总时限默认也是 14,400 秒，空闲无输出时限默认 1,800 秒。`max` 可能明显变慢，但“模型仍在思考”和“进程真正卡死”要分开处理；sidecar 会把 MCP 取消、空闲超时和总超时转换为子进程终止，不应只把所有超时无限调大。

### 3.7 完整代理能力会扩大安全边界

方案 2 只能看到显式传入的文本，容易审计；方案 4 能读取工作区，能力更强，也更容易把不该外发的内容送给上游。挑战者 PoC 应从只读沙箱、最小工作目录和敏感文件排除开始，不能为了恢复模型能力而取消数据边界。

### 3.8 保留测试证据，不把推测写成结论

仓库快照的测试证据只证明实现曾经通过对应层级，不能代替目标设备验收。任何操作系统、Codex 版本或 DeepSeek 上游升级后，都应按第 9 节重新验证：

| 测试 | 结果 | 可以得出的结论 |
| --- | --- | --- |
| DeepSeek 作为整个 Codex 的 provider | `deepseek-v4-flash` 通过 Responses API 正常回答 | 官方直连适合纯 DeepSeek Codex |
| 加载 DeepSeek 官方 `models.json` | 自定义目录替换当前 GPT 目录；桌面端按官方说明显示“自定义” | 当前 `/model` 不是 GPT/DS 双 provider 入口 |
| GPT 启动 DS 原生子代理 | 没有验证到 provider 切换；一个已创建子线程仍记录为 `model_provider: openai` | 不能依赖 agent 文件实现跨 provider |
| MCP 启动官方 DS Codex sidecar | 仓库离线回归覆盖假的 `codex exec`；目标设备可选运行真实 API 测试 | 离线通过只证明编排逻辑，真实上游、路径与权限仍需在目标设备验证 |

软件升级可能改变这些结果。后续若出现 Codex 官方的 per-agent provider 配置，应重新测试，而不是让这份历史结论永久压过新证据。

## 4. 当前方案 4 的能力与边界

### 4.1 适合的任务

一次典型调用像一次独立专家进入只读资料室：GPT 把待审计划、必要上下文和工作目录交给 DeepSeek，DeepSeek 在 sidecar 中按需查阅文件、反复取证并返回反例、遗漏与修正建议，最后仍由 GPT 结合用户目标作出裁决。

`ask_deepseek` 不再提供固定的 `role` 参数。GPT 根据当前场景把“寻找反例”“制定计划”“检查实现”或其他任务直接写入 `prompt`，把必要背景放入 `context`；MCP 只负责把这段任务交给官方 Codex sidecar，不再次解释任务角色。

官方模型支持 `low`、`high` 和 `max`；当前 MCP 工具默认值是 `max`。sidecar 配置和每次 `codex exec` 都固定传递 `model_reasoning_effort = "max"`（调用方可以显式改为 `low` 或 `high`）。实现不发送 `max_tokens` 或 `max_output_tokens`，由 Codex/DeepSeek 使用供应商默认输出预算。

### 4.2 不等同于 DeepSeek 文件 Worker

Responses API 是模型协议；当前实现把它放在官方 Codex sidecar 内，因此 `ask_deepseek` 是“只读代理意见工具”：

- DeepSeek 只看到 GPT 明确传入的 `prompt`/`context`，并可在 `DEEPSEEK_ALLOWED_ROOTS` 内读取工作区；
- sidecar 使用 `--sandbox read-only`，可以执行只读检查工具，但不会修改文件；
- GPT 主会话负责读取代码、执行工具、采用或拒绝 DeepSeek 意见。

这种边界适合对抗辩论，也比把整个工作区发送给外部 Worker 更容易审计。若以后确实需要 DeepSeek 自主改文件，应另行设计隔离 worktree、工具权限和验证流程，不应悄悄放宽当前 `ask_deepseek` 的只读约束。

### 4.3 DeepSeek Responses API 的当前限制

截至基线日期，DeepSeek 官方说明 Codex/Responses API 仅支持 `deepseek-v4-flash`，V4 Pro 预计在 2026 年 8 月初加入。Responses API 支持 function tools、服务端 Web Search 和 Codex 使用的 `apply_patch` custom tool，但不支持服务端 `previous_response_id`、conversation/store、图片输入及多数其他内置工具。

每个 sidecar 调用使用 `--ephemeral`，不持久化上一轮 DeepSeek 会话。sidecar 内部可以进行多轮“模型—工具—模型”，但跨调用的辩论记忆仍由 GPT 主会话维护；需要延续时，GPT 应把上一轮关键结论放进下一次调用的 `context`。

## 5. 仓库结构与设备本地变量

### 5.1 仓库结构

```text
integrations/
├── configure-deepseek-mcp.mjs      # 跨平台更新主配置并生成 sidecar 配置
├── install-deepseek-hybrid.sh      # Linux 安装器
├── install-deepseek-hybrid.ps1     # Windows 安装器
├── deepseek-codex/
│   └── models.json                  # DeepSeek 官方 Codex catalog 原样快照（Flash + Pro）
└── deepseek-mcp/
    ├── server.mjs                  # 唯一 MCP 入口：启动官方 Codex sidecar
    ├── test.mjs                    # 假 codex exec 的离线 sidecar 回归测试
    ├── test-configure.mjs          # 主配置、sidecar 配置和幂等测试
    └── live-test.mjs               # 最小真实 sidecar API 测试
```

旧的 `integrations/install-global.sh` 和 `~/.codex/integrations/deepseek` 符号链接已经删除。当前实现不依赖 OpenCode，也不需要为 `integrations/` 建立全局链接。

### 5.2 运行要求

- Node.js 18 或更高版本；
- 已安装并至少运行过一次 Codex；
- 可用的 DeepSeek API Key；
- 能访问 `https://api.deepseek.com`。

### 5.3 每台设备需要解析的本地位置

安装器可以从任意克隆目录运行。它不会假设仓库位于某个用户名或服务器目录下，而是从脚本自身位置找到 MCP、测试和官方模型目录。需要区分以下五个位置：

| 逻辑位置 | Linux 默认或发现方式 | Windows 默认或发现方式 | 用途 |
| --- | --- | --- | --- |
| `<repo-root>` | 用户克隆本仓库的位置 | 用户克隆本仓库的位置 | 保存安装器和 MCP 源码；可位于任意本地目录 |
| `<codex-config-root>` | `$CODEX_HOME`，未设置时为 `$HOME/.codex` | `$env:CODEX_HOME`，未设置时为 `$env:USERPROFILE\.codex` | 保存主 `config.toml` 和隔离的 `deepseek-sidecar` 目录 |
| `<key-file>` | `${XDG_CONFIG_HOME:-$HOME/.config}/deepseek/env` | `$env:USERPROFILE\.config\deepseek\env` | 本机保存 DeepSeek API Key；不得提交到 Git |
| `<workspace-root>` | 默认是运行安装器时的当前目录 | 默认是运行安装器时的当前目录 | DeepSeek sidecar 唯一获准只读检查的根目录 |
| Node/Codex 可执行文件 | 从 `PATH` 查找，也可显式指定 Node | 从 `PATH` 查找，也可显式指定 Node | 安装器将解析后的绝对路径写入 MCP 配置 |

最容易出错的是 `<workspace-root>`：如果从仓库外的目录启动安装器，默认授权根目录也会随之改变。共享配置时应推荐用户先进入希望 DeepSeek 检查的项目目录，或始终显式传入 `--allowed-root` / `-AllowedRoot`，不要复制另一台机器的绝对路径。

## 6. Linux 配置

### 6.1 使用已有密钥

默认密钥文件是：

```text
~/.config/deepseek/env
```

内容格式为：

```bash
DEEPSEEK_API_KEY=sk-...
```

如果文件已存在，安装器会复用它并收紧为 `600` 权限，不会打印或复制密钥。任意仍有效且有可用额度的 DeepSeek API Key 都可以复用；同一个 Key 是否跨设备使用应遵循账号的安全策略，每台设备都应把它保存在本机密钥文件中，而不是随仓库同步。

进入克隆后的仓库根目录再运行：

```bash
chmod +x integrations/install-deepseek-hybrid.sh
./integrations/install-deepseek-hybrid.sh
```

需要顺便执行一次最小真实 API 测试时：

```bash
./integrations/install-deepseek-hybrid.sh --live-test
```

真实测试会产生少量 DeepSeek API 用量。普通安装默认只运行本地模拟测试，不产生 API 费用。

### 6.2 首次提供密钥

可以先通过当前 shell 提供：

```bash
export DEEPSEEK_API_KEY='sk-...'
./integrations/install-deepseek-hybrid.sh
```

安装器会将其保存到权限为 `600` 的密钥文件，然后在写入后清除脚本变量。也可以直接运行脚本并在静默提示中输入。

### 6.3 自定义路径

```bash
./integrations/install-deepseek-hybrid.sh \
  --codex-home /path/to/codex-home \
  --node-bin /absolute/path/to/node \
  --allowed-root /path/to/repository \
  --api-key-file /absolute/path/to/deepseek.env
```

## 7. Windows 配置

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
  -AllowedRoot "D:\path\to\repository" `
  -ApiKeyFile "$env:USERPROFILE\.config\deepseek\env"
```

PowerShell ACL、`.cmd` 启动方式和进程树终止行为只能在 Windows 上得到有效验证；其他操作系统上的测试不能替代目标 Windows 设备验收。每台 Windows 设备安装后都应至少运行离线测试、`codex mcp get deepseek`，并在需要时执行一次 `-LiveTest`。MCP 与配置更新核心为跨平台 Node.js，实现逻辑由两套安装器共用。

## 8. 安装器会修改什么

安装器不会更改以下 Codex 主模型设置：

```toml
# 现有 GPT model 与 reasoning 设置保持原样
model = "<existing-gpt-model>"
model_reasoning_effort = "<existing-value>"
```

主 GPT 配置不会写入 `model_provider = "deepseek"`，也不会把 DeepSeek 模型目录合并进 `/model`。安装器只在 `<codex-config-root>/deepseek-sidecar/` 下生成官方 provider 配置和 `models.json`，供子进程使用；这里的根目录来自用户选择的 `--codex-home` / `-CodexHome` 或本机默认值。

它只替换旧的 `[mcp_servers.deepseek]` 及其子表，然后追加受标记管理的新配置：

```toml
# BEGIN use-subagents deepseek-hybrid
[mcp_servers.deepseek]
command = "<node-bin>"
args = ["<repo-root>/integrations/deepseek-mcp/server.mjs"]
enabled_tools = ["ask_deepseek"]
startup_timeout_sec = 10
tool_timeout_sec = 14400
default_tools_approval_mode = "approve"
enabled = true

[mcp_servers.deepseek.env]
DEEPSEEK_API_KEY_FILE = "<key-file>"
DEEPSEEK_CODEX_HOME = "<codex-config-root>/deepseek-sidecar"
DEEPSEEK_CODEX_BIN = "<codex-bin>"
DEEPSEEK_ALLOWED_ROOTS = "<workspace-root>"
# END use-subagents deepseek-hybrid
```

sidecar 目录中的 `config.toml` 由安装器生成，关键内容是：

```toml
model = "deepseek-v4-flash"
model_provider = "deepseek"
preferred_auth_method = "apikey"
forced_login_method = "api"
model_reasoning_effort = "max"
model_catalog_json = "<codex-config-root>/deepseek-sidecar/models.json"
approval_policy = "never"
sandbox_mode = "read-only"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
env_key = "DEEPSEEK_API_KEY"
```

以上片段用于解释字段，不建议跨设备手工复制。安装器会把尖括号表示的逻辑位置转换成当前操作系统格式的绝对路径；Windows 实际路径会使用盘符和反斜杠，Linux 使用以 `/` 开头的路径。

注意：`models.json` 是官方安装脚本的原样快照（来源 URL 为 [官方 Codex 安装脚本](https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.sh)，本仓库同步日期为 2026-08-02，SHA256 为 `b459a6e438d6a9939d01fd0dbb4693f165ed732bc8e4fd58d7145d9d94bd49a4`）。安装器和运行时都会校验该 SHA256；不要在本地修改底层指令或能力字段。本实现的运行时默认值由 sidecar `config.toml` 和每次 `codex exec` 的显式覆盖共同设为 `max`，所以实际 `ask_deepseek` 默认是 `max`，但官方目录中的 `default_reasoning_level = "high"` 保持不变。

如果 DeepSeek 官方目录发生更新，应先明确更新 backbone、重新记录来源和 SHA256，再同步 `configure-deepseek-mcp.mjs`、`server.mjs`、安装器与测试；不要为了临时角色或提示词需要直接编辑 `models.json`。

密钥值不会写进 `config.toml`，这里只保存密钥文件路径。安装前已有的 `config.toml` 会备份为：

```text
config.toml.bak-deepseek-YYYYMMDD-HHMMSS-mmm
```

配置通过同目录临时文件原子替换。重复运行安装器只会更新一个管理块，不会不断追加重复 MCP。如果主配置已经含有 DeepSeek 官方直连的顶层 `model_provider`、`model` 或 `model_catalog_json`，安装器会明确报错并停止，不会擅自删除这些用户配置；先恢复 GPT 主配置后再安装混合入口。

## 9. 每台设备的验证

### 9.1 不联网测试

```bash
node integrations/deepseek-mcp/test.mjs
node integrations/deepseek-mcp/test-configure.mjs
```

第一项启动临时假的 `codex exec`，验证实际 sidecar 命令行包含 `--ephemeral`、`--sandbox read-only`、递归关闭、Flash 模型和 `model_reasoning_effort="max"`，并验证父 handoff、usage、工作区边界、子进程环境隔离、成功输出密钥脱敏和“不发送 `max_tokens`”。它还确认不会额外注入固定角色或 handoff 约束、非法超时不会启动子进程，也不再绕过项目 `.rules`。它不访问网络。

第二项验证旧 MCP 段迁移、sidecar `config.toml`/`models.json` 生成、主配置保留、备份和重复安装幂等性；如果主配置已有 DeepSeek 官方直连字段，则验证安装器会停止而不删除它。

### 9.2 Codex 配置解析

先在主 Codex 配置下检查 MCP，再让 Codex 单独解析 sidecar 目录。`<sidecar-home>` 是安装器输出的实际路径，默认等于 `<codex-config-root>/deepseek-sidecar`：

```bash
codex mcp get deepseek
CODEX_HOME="<sidecar-home>" codex debug models
```

Windows PowerShell 中第二条可写为：

```powershell
$previousCodexHome = $env:CODEX_HOME
try {
    $env:CODEX_HOME = "<sidecar-home>"
    codex debug models
} finally {
    $env:CODEX_HOME = $previousCodexHome
}
```

应看到：

- `enabled: true`；
- `transport: stdio`；
- 工具允许列表只有 `ask_deepseek`；
- command 指向当前 Node.js；
- args 指向新的 `server.mjs`；
- sidecar 的模型目录显示官方快照中的 `deepseek-v4-flash` 与 `deepseek-v4-pro`，二者均保留 1,048,576 context 和 `low/high/max`；实际 MCP 运行入口仍固定 Flash。

DeepSeek 没有出现在 `/model` 是预期行为，不代表安装失败。混合方案应通过 MCP 配置和 `ask_deepseek` 调用结果验收。

### 9.3 最小真实 API 测试（默认 max）

下列命令使用默认目录；如果安装时指定了自定义路径，应改成安装器最终输出的 `<key-file>`、`<sidecar-home>`、`<codex-bin>` 和 `<workspace-root>`。

Linux：

```bash
DEEPSEEK_API_KEY_FILE="$HOME/.config/deepseek/env" \
  DEEPSEEK_CODEX_HOME="$HOME/.codex/deepseek-sidecar" \
  DEEPSEEK_CODEX_BIN="$(command -v codex)" \
  DEEPSEEK_ALLOWED_ROOTS="$PWD" \
  node integrations/deepseek-mcp/live-test.mjs
```

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY_FILE = "$env:USERPROFILE\.config\deepseek\env"
$env:DEEPSEEK_CODEX_HOME = "$env:USERPROFILE\.codex\deepseek-sidecar"
$env:DEEPSEEK_CODEX_BIN = (Get-Command codex).Source
$env:DEEPSEEK_ALLOWED_ROOTS = (Get-Location).Path
node .\integrations\deepseek-mcp\live-test.mjs
```

成功时只输出 provider、模型、`max`、状态、耗时、事件数和 token usage，不输出密钥或完整思维链。验收条件是 `ok=true`、`provider=deepseek`、`model=deepseek-v4-flash`、`reasoning_effort=max` 和 `status=completed`；耗时、事件数与 token usage 取决于设备、网络和上游版本，不应照抄维护者机器的数值。该测试会调用真实 DeepSeek API 并产生少量用量。

### 9.4 会话级验证

完全重启 Codex，创建新会话后可以使用：

```text
先独立分析这个实现方案，然后调用 ask_deepseek，把当前争议点、证据和验收标准写进任务，要求 DeepSeek 寻找反例。
最后由你比较双方证据并作出裁决，不要把 DeepSeek 的回答直接当成结论。
```

如果希望每次复杂计划都做对抗，可以把类似规则放进项目 `AGENTS.md`；不要要求把密钥、`.env` 或无关私有文件放进 `context`。

## 10. 安全策略

### 10.1 密钥

- 密钥文件不进入 Git；
- Linux 使用 `600` 权限；
- Windows 安装器尝试应用仅当前用户可读写的 ACL；
- MCP 错误会过滤形如 `sk-...` 的字符串；
- 配置和测试日志不打印 Key。

同一个有效 DeepSeek API Key 可以被旧 API 与 Responses API 复用；协议变化不要求创建新 Key。如果 Key 曾经进入聊天、Git、终端历史或公开日志，应立即撤销并轮换，而不是继续复用。

### 10.2 数据外发

`ask_deepseek` 是外部网络调用。GPT 应只发送完成质询所需的最小 handoff，并只给 sidecar 配置必要的工作区根目录，不应发送或授权读取：

- API Key、密码、令牌和私钥；
- `.env`、云凭据、Cookie；
- 未经授权的个人或客户数据；
- 与问题无关的完整仓库内容。

对敏感项目，可把 `default_tools_approval_mode` 从 `"approve"` 改为 `"prompt"`，让每次调用先请求确认。

### 10.3 接口固定

生产 sidecar 配置固定使用 `https://api.deepseek.com/`、`wire_api = "responses"` 和 `env_key = "DEEPSEEK_API_KEY"`。MCP 不再接受 `DEEPSEEK_BASE_URL` 或直接把请求改向任意 HTTP 上游；离线测试使用假的 `codex` 可执行文件，不会把生产配置切到测试端点。

## 11. 回滚与故障定位

### 11.1 回滚配置

先完全退出 Codex，再把最近的备份恢复为 `config.toml`。以下命令展示默认目录；使用自定义 `--codex-home` / `-CodexHome` 时，应把路径替换为实际 `<codex-config-root>`。Linux 示例：

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

### 11.2 常见错误

- `CONFIG_MISSING` / `CONFIG_INVALID`：密钥、sidecar 目录、Codex 可执行文件或允许工作区配置错误；
- `SIDECAR_FAILED` / `SIDECAR_UNAVAILABLE`：子进程启动失败、Codex 配置无法加载或上游返回错误；
- `SIDECAR_IDLE_TIMEOUT`：默认 1,800 秒没有任何子进程输出；
- `SIDECAR_TIMEOUT`：超过默认 14,400 秒总时限；
- `BAD_RESPONSE`：sidecar 没有最终报告或输出超过内存边界；
- Codex 看不到工具：完全重启 Codex，并运行 `codex mcp get deepseek` 检查绝对路径；
- `/model` 没有 DeepSeek：混合方案不会把 DeepSeek 合并进 GPT 模型目录，这是预期行为，请检查 `ask_deepseek` 而不是模型选择器。

## 12. 官方信息来源

DeepSeek：

- [接入 Codex](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)：说明 Codex 使用 Responses API，以及直接模型提供方的官方配置方式；
- [官方 Codex 安装脚本](https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.sh)：`models.json` 与 provider 配置的可复核来源；本仓库只同步其中的官方模型目录，不执行脚本本身；
- [使用 Responses API](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)：请求格式、流式事件、参数、items 和 tools 兼容性；
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：V4 Flash/Pro 模型能力、上下文、输出、价格和并发；
- [首次调用 API](https://api-docs.deepseek.com/zh-cn/)：官方 base URL、模型名和认证方式；
- [限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)：并发限制、`user_id` 与 keep-alive 行为。

Codex / MCP：

- [Codex MCP 配置](https://developers.openai.com/codex/mcp)：stdio MCP 的 `command`、`args`、`env`、工具允许列表和超时配置；
- [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)：`model_provider`、`model_catalog_json`、`mcp_servers` 等配置字段；
- [Codex Profiles](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles)：说明独立配置叠加方式；本实现用独立 `CODEX_HOME` 达到同样的 provider 隔离，避免覆盖 GPT 主配置；
- [Codex 子代理](https://learn.chatgpt.com/docs/agent-configuration/subagents)：公开支持的自定义 agent 模型配置及其边界；
- [Model Context Protocol](https://modelcontextprotocol.io/specification/)：MCP JSON-RPC、初始化和工具调用协议。

## 13. 发布基线、设备验收与维护

### 13.1 仓库级自动化基线

仓库自带测试用于检查实现契约，而不是证明某台用户设备已经配置成功：

1. `test.mjs` 使用假的 `codex exec`，验证 MCP 只注册 `ask_deepseek`、handoff 不注入固定角色、默认 `max`、只读沙箱、环境隔离、工作区边界、超时清理和密钥脱敏；
2. `test-configure.mjs` 验证主 GPT 设置保留、旧 MCP 迁移、sidecar 配置、官方目录哈希、备份和重复安装幂等性；
3. `node --check` 与 `git diff --check` 用于发现 JavaScript 语法和补丁格式问题；
4. 这些测试不访问真实 DeepSeek API，也不能验证用户设备的 PATH、代理、防火墙、Windows ACL 或上游账号状态。

### 13.2 每台目标设备的验收清单

一次完整部署至少应留下以下本机证据：

1. 记录操作系统、Node、Codex 版本和实际 `<codex-config-root>`，避免之后拿另一台机器的路径排错；
2. 运行对应安装器且离线测试通过，确认输出的 `<sidecar-home>`、`<key-file>` 和 `<workspace-root>` 符合本机预期；
3. `codex mcp get deepseek` 显示 MCP 已启用且工具允许列表只有 `ask_deepseek`；
4. 用 `<sidecar-home>` 执行 `codex debug models`，确认 Flash/Pro、1,048,576 context、95% effective window 和 `low/high/max` 被当前 Codex 版本识别；
5. 在允许产生少量 API 用量时运行一次 live test，确认实际 provider、Flash、Responses 和 `max` 链路；
6. 完全重启 Codex，在新会话中要求 GPT 调用 `ask_deepseek`，确认 DeepSeek 能在授权 `<workspace-root>` 内完成只读取证。

某一步通过不能替代其他步骤。例如离线测试通过只说明编排代码正确；`debug models` 通过只说明 Codex 能解析目录；只有 live test 才能证明密钥、网络和真实上游在该设备上可用。

### 13.3 通用运行形态

实际命令由 `server.mjs` 生成，逻辑上等价于：

```bash
CODEX_HOME="<sidecar-home>" \
  "<codex-bin>" exec --ephemeral --json --sandbox read-only \
  --cd "<workspace-root>" --output-last-message "<temporary-output-file>" -
```

`<sidecar-home>` 保存 DeepSeek 官方 provider 和 `models.json`；MCP 负责构造 handoff、选择授权工作目录、启动或取消子进程并抽取最终报告。任何设备都不应把 DeepSeek provider 直接覆盖到 GPT 主配置，也不应让 sidecar 默认拥有写权限。

### 13.4 升级纪律

官方目录同时列出 Flash 与 Pro，但本架构的运行入口仍显式固定为 Flash；这只是成本、延迟和已验证行为的稳定性选择，不是删除 Pro 元数据。若以后切换模型，应作为显式的 provider/profile 变更，重新核对官方目录哈希、真实 API 能力和回归结果，不通过复制第二套 MCP 后端来实现。

不要因为 Codex 支持自定义 agent 文件，就推断 GPT 子线程已经能切换到 DeepSeek provider。只有在子线程元数据、实际请求和端到端结果都证明跨 provider 生效后，才考虑增加原生 DeepSeek agent；在此之前不向主配置加入官方 `models.json`。

每次升级至少重复四类验证：官方 provider/model 解析、sidecar 工具循环、最小真实 API 测试、跨平台子进程与沙箱测试。只有这些都通过，才说明“配置正确、Codex 能加载、上游真实可用、权限边界有效”四个层面同时成立。
