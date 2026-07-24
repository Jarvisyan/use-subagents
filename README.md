# JARVIS

> 一套面向 Codex 的全局多 Agent 协作 Skill：把用户的粗略想法组织成 `Plan → Execute → Check`，让人保持 high-level 监督，同时避免长链任务失控后无从定位。

JARVIS 目前处于 high-level 设计阶段，尚未实现 Demo。项目计划在验证有效后于 GitHub 开源；在此之前，根目录的 `README.md` 是唯一权威文档。

## Motivation

随着 Agent 的执行能力增强，人机协作容易落入两个极端。

一种方式是人规划一点、Agent 执行一点、人再逐步检查。它比较稳，但人会被迫持续检查数据流、参数和局部实现，无法真正把任务交出去。

另一种方式是把长任务一次性交给 Agent。顺利时体验很好；一旦最终结果异常，却很难判断最早的问题来自思路、执行还是验收，因为所有因素都混在同一条长链里。

JARVIS 的出发点因此很简单：

> 为了避免长链迷失，我们借鉴公司的分工方式，让多个 Agent 分别参与 Plan、Execute 和 Check；用户只负责方向、重要取舍与最终判断。

这个项目不追求建立一套严丝合缝的官僚系统。当前判断是：AI 通常已经具有很强的执行力，最值得加强的是前端的 **Plan** 和后端的 **Check**；Execute 应在明确计划下保留充分自由。

## STARK Agent OS

固定的是三类责任，不是三个固定 Agent，也不是固定人数：

```text
STARK Agent OS
└── 用户 / Project Owner
    └── JARVIS / Chair Agent
        ├── Plan：决定应该怎样做
        │   ├── Planner：提出主要方案
        │   ├── Independent Planner / Challenger：按需提供独立方案或质疑
        │   ├── Researcher：按需查清关键事实
        │   └── JARVIS：比较证据并收敛为一个可执行计划
        │
        ├── Execute：把计划变成结果
        │   ├── Executor：对整体实现负责
        │   ├── Workers：只在任务能够独立拆分时并行
        │   └── 发现计划不成立时返回 Plan
        │
        └── Check：独立判断结果是否可信
            ├── Tests / Evidence：检查可客观验证的结果
            ├── Independent Reviewer：对照目标、计划与实际产物
            └── 通过、返回 Execute，或返回 Plan
```

JARVIS 是主持和调度者：它决定何时需要额外视角，汇总分歧，并把真正涉及用户偏好或目标取舍的问题交还用户。多 Subagent 是提升思考质量和并行效率的手段，不是目的。

## Plan

Plan 解决的是“执行得很好，但一开始想得不够好”。

### 最小流程

```text
理解目标与项目现状
→ 找出关键未知和可能路线
→ 按需引入独立方案、挑战或研究
→ 比较假设、证据与代价
→ JARVIS 收敛为一个可执行计划
```

简单、明确的任务不必强制召集多个 Planner。只有当存在关键不确定性、多条合理路线、陌生领域或昂贵返工时，才值得增加独立视角。

多个 Agent 的目标是暴露盲点，而不是开会投票或强求一致。JARVIS 应根据事实和可验证证据作出技术裁决；证据无法解决、且会改变用户真实目标的分歧，才交给用户。

Plan 的结果至少要让后续知道：

- 准备解决什么问题，什么不在范围内；
- 选择了什么路线，关键假设是什么；
- 工作如何拆分，怎样判断完成。

这些内容不要求固定 schema，也不要求为每个任务制造冗长文档。

模型品牌不写死，但能力应与责任匹配：Chair 和 Plan 优先保证推理质量；Execute 在计划清楚后可以权衡能力与成本；Check 必须足够独立，也必须有能力挑战计划和结果。

## Execute

Execute 解决的是“计划合理，但实现没有忠实落地”。

执行阶段保持轻量：

- 默认由一个 Executor 对整体结果负责；
- 只有彼此独立、能够分别验收的工作才交给多个 Workers 并行；
- Agent 可以自主决定局部实现，不需要逐步向用户请示；
- 如果新事实推翻了计划，应明确返回 Plan，而不是悄悄改变整体方向。

Execute 不承担重新证明整个方案是否正确。它的核心责任是：在计划边界内把事情做好，并清楚呈现实际完成了什么。

## Check

Check 解决的是“看起来做完了，但没人独立确认它是否真的完成”。

Reviewer 应使用独立上下文，至少对照三样东西：

```text
原始目标
＋ JARVIS 收敛并采用的 Plan
＋ 实际产物与可观察结果
```

这里的“独立”不是仅仅换一个线程名称，而是让 Reviewer 在新的上下文中直接看到必要输入，不继承 Executor 的完整自我解释。

它重点回答四个问题：

1. 原始任务是否真正完成；
2. 实际结果是否忠实执行了 Plan；
3. Plan 中要求的内容是否有遗漏；
4. 是否未经允许增加、删除或改变了内容。

能够客观检查的部分优先使用普通测试、运行结果或其他证据；不能机械判断的部分再由独立 Reviewer 审查。

Check 不只是给出“通过/不通过”，还要指出应该回到哪里：

```text
计划合理，但实现偏离      → 返回 Execute
实现忠实，但计划不能达成目标 → 返回 Plan
目标或产品取舍需要改变      → 交给用户
```

JARVIS 最终只需保留一条最小记录：

```text
Plan 摘要 → Execute 实际结果 → Check 证据与判断
```

这就是最小的长链定位能力，不需要先建设复杂的证据系统或状态机。

## Codex 如何实现

### Global Skill 能做什么

Codex 当前支持由主 Agent 启动专门化 Subagents，并明确说明：适用的 Skill 指令可以要求 Codex 进行委派。不同 Subagent 在独立线程中工作，主 Agent 收集结果并统一回复。[Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

因此，一个 Global JARVIS Skill 可以把上述流程写进 `SKILL.md`：

```text
用户任务触发 JARVIS Skill
→ JARVIS 判断当前任务需要哪些独立视角
→ 在 Plan 和 Execute 中按需调用 Subagents
→ 非平凡任务执行后启动独立 Check
→ 收集结果、处理返工并向用户汇总
```

简单任务的 Check 可以只是客观测试，不必每次都启动 Reviewer；非平凡任务则默认经过独立审查。这个过程属于指令驱动的自动调度，不是一个确定性的工作流引擎。Codex 仍会结合任务、可用工具、权限和运行环境作出判断；Skill 应表达必要原则，不应把每个任务锁进固定人数和固定轮次。

首版只需要一个 Global Skill，不为每个项目再造一套 JARVIS Skill。具体项目的代码、现有说明、测试和用户要求仍然构成该任务的上下文。

对于原生 Codex Subagents，可以使用自定义 Agent 配置分别指定角色指令、GPT 模型、推理强度、工具和沙箱；Global Skill 负责“何时调用谁”，这些配置负责“该 Agent 怎样运行”。[Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

### Kimi、DeepSeek 能否成为 Subagent

结论分三层：

```text
只使用 Codex 原生模型
└── 可以由 Global Skill 直接要求 Codex 调度 Subagents

使用 Kimi / DeepSeek
└── 当前不能仅填入模型名就成为原生 Subagent
    ├── Codex 自定义 Provider 当前要求 Responses API
    ├── 两家当前公开接口主要是 Chat Completions
    ├── 因而需要协议转译 Gateway，或独立外部 Worker
    └── 混合供应商调度仍需在目标客户端实测

只有一个 SKILL.md
└── 不能完成 Provider、API key、协议转换和兼容适配
```

Codex 当前允许配置自定义模型 Provider，但精确配置参考把 `responses` 列为唯一支持的 wire API；Provider 和认证也属于用户级配置，不能由一个项目 Skill 自动替朋友完成。[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)

DeepSeek 和 Kimi 都提供 OpenAI-compatible Chat Completions 与 Tool Calls，但这并不等于兼容 Codex 的完整 Agent 循环。Kimi 官方的 Codex 指南也明确使用本地路由器，在 Codex Responses 与 Kimi Chat Completions 之间转换协议。[DeepSeek API](https://api-docs.deepseek.com/guides/agent_integrations/openclaw) · [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) · [Kimi API](https://platform.kimi.ai/docs/api/overview) · [Kimi Codex 接入指南](https://platform.kimi.ai/docs/guide/codex-kimi)

但这条路径目前仍是**待验证能力**，不是 JARVIS 已经交付的功能：

- 当前文档没有保证同一个 OpenAI 主会话能为每个 Subagent 分别切换供应商；
- Gateway 还要正确处理流式响应、工具结果、多轮上下文和模型特有字段；
- 使用外部模型意味着任务上下文和必要代码会发送给相应供应商。

所以第一版先用 Codex 原生 Subagents 验证工作流；确认 JARVIS 本身有效后，再分别测试“Responses Gateway”或“独立 Worker”路线。不同供应商的模型只在 Plan 盲点或 Check 独立性值得额外成本时引入，不作为每个任务的固定编制。

## 当前路线

```text
1. High-level 设计（当前）
   └── 逐一确认 Plan、Execute、Check 的必要职责与边界

2. 最小 Global Skill
   └── 用简洁 SKILL.md 固化流程，不加入固定编制和复杂协议

3. Codex 原生验证
   └── 在真实任务中检查规划质量、独立审查和故障定位是否有用

4. 外部模型实验
   └── 分别验证 DeepSeek / Kimi 的 Gateway 或独立 Worker，不同时改变其他变量

5. 开源发布
   └── 整理为朋友能够安装和理解的 Skill；确有需要时再包装 Plugin
```

当前不设计固定 Agent 数量、风险等级、Mission schema、动态权重、模型淘汰或价格路由。以后只有真实任务暴露出明确问题时，才增加对应机制。

判断 JARVIS 是否值得发布，最终只看四件事：

- 多 Agent 是否形成了比单次规划更可靠的 Plan；
- Independent Reviewer 是否能发现遗漏和未经允许的改动；
- 用户是否确实减少了逐步检查；
- 出错后是否能判断应返回 Plan 还是 Execute。

## 项目与参考

根 `README.md` 是当前唯一权威文档。新开对话时只需让 Codex 先阅读本文件，再说明本次要讨论或验证的部分。

早期私人聊天保留在本地并由 `.gitignore` 排除；第三方参考仓库的浅克隆保留在被忽略的 `references/local/repos/`，仅用于研究，不是运行依赖，也不会直接复制进 JARVIS。

主要参考：

- 技术基础：[OpenAI Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- Plan 与分阶段审查：[Superpowers](https://github.com/obra/superpowers)
- 公司角色与专业工作流：[gstack](https://github.com/garrytan/gstack)
- Check、证据与审计：[Agentic Orchestration Control](https://github.com/ZypherHQ/agent-orchestration-skill)
- 任务依赖与并行：[Swarms](https://github.com/am-will/swarms)

项目尚未选择开源许可证。在加入 `LICENSE` 前，请不要假定仓库内容已经获得复制、修改或分发授权。`STARK` 与 `JARVIS` 是当前工作名称，正式发布前还会进行命名与权利审查。
