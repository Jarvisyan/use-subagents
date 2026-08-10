# Codex 原生 DeepSeek 子代理：配置与迁移说明

## 先确认本机路径

本机真正的 Codex home 是：

```text
/user/work/yanjie/.codex
```

本机 shell 的 `~` 展开为 `/home/yanjie`，因此 `/user/work/yanjie/.codex` **不等于** `~/.codex`。本文描述本机状态时全部使用绝对路径；为其他设备提供通用步骤时使用 `<codex-home>`，并要求先由 Codex App/CLI 确认真正的 `codexHome`，不能猜测为 `~/.codex`。

本文足以作为其他设备的迁移说明，但不替代上游安装器。跨设备安装采用两层：先让 Codex 严格执行上游 `install-with-codex.md`，再应用本文列出的本机 DIY 差异。不要另写一套复制上游 Agent、Hook 和 Skill 的 Windows/Linux 安装器；它既会与上游漂移，也无法安全自动完成必须由用户审阅的 `/hooks` 信任。

---

## 问题一：原生接口相比 MCP 有什么优势？

### 1.1 原生接口解决了什么

旧 MCP 方案的调用链是“GPT 父任务 → MCP tool → 独立 Codex sidecar → DeepSeek”。每次调用都要启动另一套 Codex 运行时，MCP 负责传入任务、等待 sidecar、收集最终文本。它能用，但 Codex 只把整个过程看成一次工具调用。

原生方案把 DeepSeek 注册为真正的 custom subagent：

```text
GPT-5.6 Sol 父任务
  │
  ├─ stage 一份自包含 assignment
  └─ native spawn: v4_flash_worker, fork_turns="none"
       │
       ├─ SubagentStart Hook 注入 assignment
       ├─ DeepSeek V4 Flash 独立运行
       └─ Codex native callback 返回父任务
```

具体优势分为三类。

#### Codex 原生管理

- 子任务真实显示在 Subagents 面板，而不是伪装成 MCP 工具结果；
- Codex 原生管理 child identity、thread、取消、等待和 callback；
- 父任务可以在 child 运行时继续工作，只有依赖结果时才等待；
- 子任务元数据可以直接核验 `agent_role`、provider 和 model。

#### 少一层运行时和配置

- 不再维护 MCP server、stdio transport、tool schema 和超时包装；
- 不再为每次调用启动第二个 Codex sidecar；
- 不再维护 sidecar 专用 `CODEX_HOME`、wrapper 和回传协议；
- Codex 自己提供 child 的工具循环和生命周期。

#### 上下文边界更明确

- 每次使用 `fork_turns="none"` 创建独立 child，不自动复制父对话；
- 父任务只发送本次需要的目标、必要背景、范围或限制和期望产物；路径、允许的修改与验证证据按任务需要补充；
- DeepSeek 的最终回执通过原生 callback 进入父任务后续上下文；
- 不需要为保持“独立判断”而人为新开 MCP context。

### 1.2 原生接口不是无条件更简单

当前 OpenAI 与 DeepSeek 跨 provider 时，原生 spawn 消息中的加密任务正文不能可靠传递。因此仍需要一个 one-shot plaintext `SubagentStart` Hook。这个 Hook 会让 assignment 在本机状态目录中短暂以明文存在，所以它不是秘密信道。

上游 agent 默认偏只读；本机已经按实际用途把 worker 调整为 `sandbox_mode = "danger-full-access"`，使其能处理项目外文件、代码写入、Shell/SSH 和落盘绘图。审批是另一个独立维度：本机保留 `approval_policy = "on-request"`，并用 `approvals_reviewer = "auto_review"` 自动审查需要审批的操作，没有配置成 `never`。

---

## 问题二：是否按上游指南安装和测试？做了哪些 DIY？

### 2.1 遵循的上游基线

安装和测试直接依据：

- 仓库：<https://github.com/Utopia-V/codex-deepseek-subagent>
- 安装说明：`prompts/install-with-codex.md`
- 测试说明：`prompts/quick-smoke-test.md`
- 安装时核对的提交：`1377b7655ea98ed50a5131172b579b56ed744793`

保留了上游的关键设计：

1. agent 的真实名称仍是 `v4_flash_worker`，没有继续改名为 `ask_deepseek`；
2. provider/model 为 `deepseek/deepseek-v4-flash`，wire API 为 Responses；
3. matcher 精确为 `^v4_flash_worker$`；
4. parent 先 stage，成功后才 native spawn；
5. V2 spawn 使用 `fork_turns="none"`；
6. handoff 保持 one-shot、at-most-once 语义；
7. smoke 不使用直接 API、替代 provider、另一个 Codex CLI 或 MCP fallback。

### 2.2 本机实际安装的 DeepSeek 工件

| 工件 | 本机路径 | 作用 |
| --- | --- | --- |
| custom agent | `/user/work/yanjie/.codex/agents/v4-flash-worker.toml` | DeepSeek provider、模型、catalog、上下文和沙箱 |
| Hook 配置 | `/user/work/yanjie/.codex/hooks.json` | 注册 `SubagentStart` matcher |
| Hook 脚本 | `/user/work/yanjie/.codex/hooks/codex-deepseek-subagent/plaintext_handoff.py` | stage、claim、注入和状态恢复 |
| Skill 源 | `/user/work/yanjie/tools/use-subagents/skill/use-v4-flash-worker/` | Git 管理的父任务调用协议 |
| Skill 安装链接 | `/user/work/yanjie/.codex/skills/use-v4-flash-worker` | 指向仓库 Skill 源的软链接 |
| 模型目录 | `/user/work/yanjie/.codex/models.json` | DeepSeek context、reasoning 档位和工具元数据 |
| Hook 信任 | `/user/work/yanjie/.codex/config.toml` | Codex 持久化的 enabled/trusted 状态 |

API key 继续从 Codex 进程环境中的 `DEEPSEEK_API_KEY` 读取，没有写入 Prompt、TOML、文档或仓库。

### 2.3 只安装了一个 DeepSeek Skill

这次原生接入只新增：

```text
use-v4-flash-worker
```

Codex 中显示的 `.system`、Google Drive、Sites、Zotero、`solid-vibe-coding`、`experiment-layout`、`cluster-routing` 等 Skills 都不是这次 DeepSeek 安装创建的。

`use-v4-flash-worker` 是 **GPT parent 侧的传输 Skill**，不是第二套分工规则。Sol/DeepSeek 职责和四个 `ds_*` 模式放在 global rule；这个 Skill 只负责独立 context、stage、精确 spawn、一次等待、失败恢复和 DeepSeek 数据边界。它也不是 DeepSeek child 必须执行的业务 Skill。

之所以不能只保留 global rule，是因为当前跨 provider handoff 有一段有状态的调用协议：必须先 stage，确认 one-shot pending 成功，再以 `fork_turns="none"` 精确 spawn，并正确处理 claimed、quarantine 和 callback。把整套状态机常驻 global rule 会重复耗费每个任务的上下文；完全删掉又容易退回曾经出现过的“child 启动了但收不到 assignment”。因此当前边界是：**global rule 管谁做什么，Skill 管原生 Hook 怎么交付。**

如果 child 的业务任务依赖另一个 Skill，parent assignment 才应显式写：

```text
required_skill: $skill-name
Read the complete SKILL.md before acting.
Return SKILL_USED and SKILL_PATH_READ.
```

### 2.4 global rule 到底改了什么

上游安装器修改了个人全局规则文件：

```text
/user/work/yanjie/.codex/AGENTS.md
```

global rule 保留用户要求的稳定协作约定，并已同步到仓库源 `AGENTS.md` 与实际个人全局文件 `/user/work/yanjie/.codex/AGENTS.md`：

1. Sol 负责需求、架构、分解、范围、冲突、整合、审查和最终验收；
2. DeepSeek 是高频执行层，优先承担边界明确的文件读写、代码、Shell/SSH、日志、绘图、提取和普通测试；
3. `ds_scout`、`ds_worker`、`ds_critic`、`ds_tester` 是 assignment 中的任务模式，不是四个不同 agent；
4. assignment 必须把目标、必要上下文、范围或限制和期望产物描述清楚；只有任务确实需要时才补充路径、允许的修改、证据或停止条件；
5. DeepSeek 不继承父对话，Sol 必须形成自包含 handoff，并保留最终审查、Git、发布和部署权。

global rule 只用一句索引要求 spawn 前读取 `$use-v4-flash-worker`。详细的 `fork_turns="none"`、stage、等待和恢复状态机仍按需从 Skill 读取，不在常驻规则中重复。

### 2.5 本机 DIY 改动

相对上游有六项有意适配：

1. **固定 `max`**：在 agent TOML 增加 `model_reasoning_effort = "max"`。
2. **child 私有模型目录**：增加 `model_catalog_json = "/user/work/yanjie/.codex/models.json"`。缺少 catalog 时，Codex 会对未知第三方模型使用 fallback metadata，可能没有真正应用 1M context 或 reasoning effort。
3. **持久化 Hook 信任**：用户已经执行 `/hooks` 信任，但运行时仍报告 `untrusted`；后来通过 Codex 正式配置接口持久化为 trusted。
4. **Skill Git 化**：上游默认复制到 Codex home；本机改为仓库保存源文件、Codex home 使用软链接。
5. **扩大文件系统权限但保留审批**：worker 使用 `sandbox_mode = "danger-full-access"`，同时设置 `approval_policy = "on-request"` 与 `approvals_reviewer = "auto_review"`。读写范围、是否需要审批、由谁审查是三个独立配置，没有用 `never` 跳过审批。
6. **预授权 parent handoff 状态目录**：`stage` 在 DS child 启动前由 Sol 父任务执行，因此它受父任务 workspace sandbox 约束。本机已在顶层 `config.toml` 把用户明确授权的 `/user/work/yanjie` 加入 `sandbox_workspace_write.writable_roots`，覆盖其中的 `.local/state/codex/plaintext-subagent-handoff`，不再先失败再申请临时权限。

Hook 脚本使用绝对路径 `/usr/bin/python3`，只依赖标准库。项目是否使用 uv、是否激活 `.venv` 都不会影响 Hook。

---

## 问题三：smoke 为什么失败？一键配置的坎在哪里？

### 3.1 失败现象

第一次付费 smoke 中：

1. `v4_flash_worker` 原生 child 成功创建；
2. 子任务元数据确认 provider/model 是 `deepseek/deepseek-v4-flash`；
3. DeepSeek 正常返回，但报告没有收到 `BEGIN PARENT ASSIGNMENT`；
4. stage 生成的 pending 文件仍存在，没有被 Hook 消费。

这证明原生 DeepSeek 接口和 API 都是通的，故障只发生在 Hook 交付边界。

### 3.2 直接根因

Codex `hooks/list` 对主项目和 smoke worktree 都返回：

```text
enabled = true
trustStatus = untrusted
matcher = ^v4_flash_worker$
```

也就是说，文件和 matcher 都正确，但 Codex 的安全门不允许执行 Hook。UI 中执行过 `/hooks` 并不等于远端这套 `/user/work/yanjie/.codex` 已经持久化信任。

### 3.3 解决方式

在用户明确授权信任后，通过 Codex 正式配置接口把该 Hook 的 enabled/trusted 状态写入：

```text
/user/work/yanjie/.codex/config.toml
```

重新查询后，主项目与 smoke worktree 都返回 `trustStatus = trusted`。随后先用隔离临时目录做无付费 stage→Hook→消费测试，再在全新顶层 GPT-5.6 Sol 任务中运行官方 quick smoke。

修复后的 smoke 同时满足：

- 原生 `v4_flash_worker` child；
- provider/model 为 `deepseek/deepseek-v4-flash`；
- marker 精确返回且只出现一次；
- 算术结果为 `323`；
- pending 被一次性消费；
- callback 返回父任务；
- 没有直接 API、替代 provider、其他 Codex CLI 或重试。

### 3.4 其他容易让“一键安装”停住的边界

#### Codex home 不是 shell home

本机 `~` 是 `/home/yanjie`，Codex home 却是 `/user/work/yanjie/.codex`。如果安装器、Hook、Skill 和信任状态落在不同目录，会出现“文件都在，但 App 不执行”的假安装。

#### stage 状态目录在项目沙箱之外

handoff 默认写入：

```text
/user/work/yanjie/.local/state/codex/plaintext-subagent-handoff
```

这一步发生在 Sol 父任务，和 `v4_flash_worker` 自身的 `danger-full-access` 无关。此前每次调用都会先遇到项目外只读，再通过临时权限继续；本机现已在 `/user/work/yanjie/.codex/config.toml` 持久化：

```toml
[sandbox_workspace_write]
writable_roots = ["/user/work/yanjie"]
```

这是用户明确授权该目录树全部可写后的本机选择。其他设备应至少把实际 handoff 状态目录加入 parent 的 writable roots；不要无条件照抄一个比用户授权更宽的根目录。配置只影响新建或重新加载权限的任务，已有任务仍可能保留旧 sandbox 快照。stage 失败时仍不能 spawn。

#### Hook 和 model catalog 有会话缓存

修改 agent TOML、Hook、Skill、信任、权限或 `models.json` 后，先使用全新顶层任务测试；如果 App 仍未发现新配置，再完整重启。旧任务可能继续使用旧快照。

#### 不能只看 Subagents 卡片

验收必须同时核对 `agent_role`、provider/model、assignment marker、真实工具行为、pending 消费和 callback。只看到一张 child 卡片不能证明跨 provider handoff 已成功。

---

## 问题四：在新设备或已有 MCP 的设备上怎么重新配置？

不能只参考前面的原理说明；应按下面的顺序执行。上游安装手册是跨平台、幂等合并和本地协议验证的基线，本节只记录本机验证后的差异层。

不另建完整“一键脚本”的原因是：上游会按 Windows 与 POSIX 分别选择 agent、Hook 和密钥读取方式，还要保留目标设备已有的 `hooks.json`、`AGENTS.md` 和 `config.toml`；最后的 Hook trust 也必须由用户本人审阅。把这些重新实现为本仓库脚本会形成第二套安装器。当前最短且可维护的路径就是下面的上游安装 Prompt，加一段明确的本机差异配置。

### 4.1 第一步：确认设备边界

1. 确认 Codex App/CLI 真正报告的 `<codex-home>`，不要直接假设为 `~/.codex`。
2. 确认 GPT 父任务当前 model/provider 和 ChatGPT 登录保持不变。
3. 在进程环境中准备 `DEEPSEEK_API_KEY`，不得把 key 写入 Prompt 或 Git。
4. 确认 `/models` 或 DeepSeek 官方文档仍暴露 `deepseek-v4-flash`。

### 4.2 第二步：严格执行上游安装

在一个新的顶层 Codex 任务中执行：

```text
请读取并严格执行
https://raw.githubusercontent.com/Utopia-V/codex-deepseek-subagent/main/prompts/install-with-codex.md
为我安装其中的 DeepSeek V4 Flash subagent。保留当前主模型、provider 和 ChatGPT
登录，不得索要或输出 API key；完成无付费调用的本地验证后停止，暂不运行 smoke
test。
```

先确认上游安装生成 agent、Hook、Skill 和 managed global rule。不要在这一阶段调用 DeepSeek。

### 4.3 第三步：应用本项目的必要适配

#### 使用真实 `<codex-home>`

把所有 agent、Hook、Skill、信任和模型目录路径替换为该设备实际的绝对路径。Windows App、WSL CLI、远端 SSH Codex 可能分别拥有不同的 Codex home，必须分别安装和信任。

#### 配置模型目录和 `max`

将 DeepSeek 官方 Codex `models.json` 放入：

```text
<codex-home>/models.json
```

在 `<codex-home>/agents/v4-flash-worker.toml` 的模型字段附近增加：

```toml
model_reasoning_effort = "max"
model_catalog_json = "<codex-home>/models.json"
```

不要在 GPT 顶层 `config.toml` 设置全局 `model_provider=deepseek` 或全局 `model_catalog_json`；catalog 只由 DeepSeek child 引用。

#### 按用途配置 worker 权限

本机需要 DeepSeek 高频执行文件读写、Shell/SSH、绘图和测试，因此在 `<codex-home>/agents/v4-flash-worker.toml` 使用：

```toml
sandbox_mode = "danger-full-access"
approval_policy = "on-request"
approvals_reviewer = "auto_review"
```

这不是上游只读基线的必选项。其他设备如果只让 DS 做检索和审查，应保留较小沙箱；如果扩大读写，也不要顺手改成 `approval_policy = "never"`。

#### 预授权 parent 的 handoff 状态目录

worker 权限不能解决 spawn 前的 stage 写入。Linux/macOS 默认状态目录为 `${XDG_STATE_HOME:-$HOME/.local/state}/codex/plaintext-subagent-handoff`，Windows 默认位于 `%LOCALAPPDATA%\Codex\plaintext-subagent-handoff`。把该目录或用户明确授权的父目录加入顶层 `<codex-home>/config.toml`：

```toml
[sandbox_workspace_write]
writable_roots = ["<authorized-parent-or-exact-handoff-path>"]
```

本机使用 `/user/work/yanjie`；其他设备必须按自己的授权范围填写。该设置属于 Sol parent 的 workspace sandbox，不要误加到 `v4-flash-worker.toml`。

#### 把 Skill 纳入 Git

把上游生成的 Skill 源移动到配置仓库：

```text
<config-repo>/skill/use-v4-flash-worker/
```

然后让：

```text
<codex-home>/skills/use-v4-flash-worker
```

成为指向仓库源目录的软链接。不同设备的仓库绝对路径可能不同，所以软链接本身不进入 Git，只同步 `skill/use-v4-flash-worker/` 源文件。

#### 信任 Hook

在实际使用该 `<codex-home>` 的 Codex App/CLI 中执行 `/hooks`，审阅并信任精确 matcher `^v4_flash_worker$`。随后用 `hooks/list` 确认实际状态是 `trusted`，不能只依赖 UI 操作成功提示。

### 4.4 第四步：已有 MCP 设备的迁移顺序

已有 DeepSeek MCP 时，推荐先并行安装原生 child，暂时不删除 MCP：

1. 安装原生 agent、Hook、Skill 和 catalog；
2. 新开顶层任务；若配置仍未重新发现，再完整重启 App；
3. 运行一次全新顶层官方 smoke；
4. 验收全部通过后，删除 DeepSeek MCP 注册、sidecar 和 wrapper；
5. 再运行 `codex mcp list`，确认不再出现 DeepSeek。

本机已经按用户明确授权永久删除旧 MCP、sidecar 和所有回滚备份，因此没有回滚能力。其他设备是否保留短期备份，应由该设备所有者单独决定。

### 4.5 第五步：运行唯一一次官方 smoke

在全新顶层任务中执行；如果新任务仍未加载最终配置，再重启 App 后重试：

```text
请读取并严格执行
https://raw.githubusercontent.com/Utopia-V/codex-deepseek-subagent/main/prompts/quick-smoke-test.md
测试刚安装的 v4_flash_worker。不得使用替代 provider、直接 API 或另一个 Codex
CLI。
```

验收清单：

1. stage 成功；
2. pending 被 Hook 消费；
3. child 的 `agent_role=v4_flash_worker`；
4. provider/model 为 `deepseek/deepseek-v4-flash`；
5. child 收到完整 `BEGIN/END PARENT ASSIGNMENT`；
6. marker 和测试结果符合上游 oracle；
7. native callback 返回父任务；
8. 没有 follow-up、重试或替代传输。

满足以上条件后，才可以认为设备完成了原生 DeepSeek 迁移。
