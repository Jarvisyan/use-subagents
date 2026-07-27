# Solid Vibe Coding

> 一套基于作者自己科研工作流设计的 provider-neutral 方法：人只保留 Plan Gate 和 Check Gate，AI 自动完成中间的对抗规划、自适应执行、实现一致性审计和证据整理。

## 1. 设计来源：真实科研迭代，而不是抽象流程图

这套设计来自作者原本反复使用的一条工作流：

```text
用户与单个模型多轮讨论
-> 形成实验 Plan
-> 模型集中执行，并自动解决小 bug
-> 结果 promising：move on
-> 结果不 promising 或明显反直觉：人工核验数据流和实现
-> 修实现或换方案
-> 进入下一轮 Plan、执行和观察
-> 直到 idea 足以形成论文或达到 SOTA
```

它的优势是灵活、快速，而且允许研究思路逐轮加深。问题也恰恰来自模型越来越强：只要结果没有明显反直觉，人就很容易跳过“实现是否真的符合 Plan”这一步。一个看起来合理甚至很好的结果，可能悄悄掩盖数据流偏差、错误配置、评价泄漏或未声明的 baseline 改动，并把错误带进后续迭代。

另一种极端是人规划一点、让 AI 做一点、再检查一点。它比较稳，却让研究者变成人工流水线质检员。

Solid Vibe Coding 想解决的不是“每个小动作都绝不出错”，而是：

> 让人退出逐步监督，同时保留对整轮探索是否 solid 的判断力；VibeCoding 可以自动推进，但不能退化成只凭最终分数决定成败的 RandomCoding。

## 2. 核心设计：自动推进一轮研究，把关键判断留给用户

固定的不是模型品牌、Agent 数量或执行拓扑，而是研究迭代中两次需要用户判断的时刻：

```text
研究问题
-> 对抗式选择并设计当前最值得做的实验
-> [用户根据 Plan 报告决定是否执行]
-> 在已接受的 Plan 内执行
-> 对抗式检查实现与结果是否可信
-> [用户根据 Check 报告决定信任、修复、重规划或停止]
```

默认提问启动的主对话模型贯穿整个迭代，持续持有用户目标、项目上下文、采用的 Plan、执行状态和最终证据。Plan Challenger 与 Check Challenger 是两个先后启用的临时 subagent：前者参与实验选择与设计，后者在实验结束后核对实际实现和证据。每次讨论自动进行一至三轮；如果继续辩论已经不会改变 Plan 或 Check 结论，就提前结束。

## 3. `solid-vibe-coding`：工作流控制层

### Plan：选择并设计当前最值得做的实验

规划不是先列出所有可能实验再逐个执行，而是先找出当前的根源性不确定性：如果它无法通过，哪些下游改进即使成功也可能没有用。主模型围绕这个问题提出实验，Challenger 攻击其中最可能改变实验选择或设计的漏洞，双方用证据修订，直到形成一套可供用户判断的 Plan。

Plan 需要讲清实验为什么值得优先做、设计为什么能区分关键解释、不同结果会怎样改变下一步，以及实验采用的 backbone 和施加在它之上的 intended delta。Plan 报告还要交代正反双方争论了什么、哪些漏洞已经解决、还剩什么不确定性。用户据此决定是否进入执行，而不是接收一张缺少动机的动作清单。

### Execute：在已接受的 Plan 内推进

执行不绑定 provider，也不强制另开执行模型。主模型可以直接执行，也可以根据任务结构委派或并行推进；用户指定外部模型时遵循该选择。执行过程中可以处理不改变实验的小 bug 和实现细节，但不能因为出现意外结果就静默改变实验问题、评价标准或追加实验。无法在 Plan 内解决的阻塞应返回给用户判断。

### Check：判断实现和结果是否可信

Check Challenger 接收已接受的 Plan、实际实现和实验证据，并直接比较两者：Plan 规定死的部分是否如实实现，开放选择最终如何落地，相对 backbone 是否引入了未声明的改动，以及现有证据是否足以支持结果解释。

Check 的目标是形成发现而不是自动修实验。即使结果 promising，也必须先确认实现与 Plan 一致；如果存在偏离或证据缺口，应在 Check 报告中说明，而不是边检查边修改、重跑后覆盖原现场。用户根据报告决定结果是否可信，以及下一轮应修实现、重新规划、补充实验还是停止。

### Plan 与 Check 报告

两类报告都先建立完整的底层推理和证据，再按主题与子主题组织成用户容易判断的故事。文档保留审计和复现所需的细节；聊天汇报保留决策相关的要点，讲清动机、论证、证据、限制和后果，随后再给出精确的文档或产物指针。用户的工作是判断合理性，而不是替 AI 重新总结一遍。

## 4. `experiment-management`：实验信息架构层

对抗讨论解决“判断是否 solid”，但不能单独解决脚本与输出随迭代失控的问题。第二套 skill 负责让用户一眼看懂：

- 当前 Plan 包含哪些可独立判断的分析对象；
- Plan 和各对象有哪些受支持的执行入口；
- 哪些输出是主要证据；
- 当前结论与下一道 Gate 是什么。

它不强制 `current/`、`outputs/`、`src/` 等固定名字，而是约束语义关系：

- 按分析对象组织，不按命令、Agent、seed、retry 或时间线组织；
- 明确区分公开入口与内部实现；
- 明确区分主要结果、支持证据和可再生成中间产物；
- 一个 Plan 或对象允许有多个真正不同的执行入口，但必须在公开表面说明每个入口回答什么；
- 参数化系统性 variants，避免复制脚本与输出树；
- 下游对象通过上游 Gate 后再懒创建。

这样文件系统承担的是“帮助用户快速判断”，而不是忠实展示 AI 做过的每一个动作。

## 5. 两套 Skill 如何配合

```text
solid-vibe-coding
├── Plan：对抗式选择和设计当前最值得做的实验
├── Execute：在已接受的 Plan 内推进
└── Check：核对 Plan、实现与证据，并交给用户判断

experiment-management
├── 把 Plan 映射为分析对象与公开入口
├── 把运行产物分成主要证据与支持材料
└── 保持跨迭代的计划、报告、日志与清理可追溯
```

通常由 `solid-vibe-coding` 驱动完整研究迭代；当任务会产生持久实验脚本、输出和报告时，再组合使用 `experiment-management`。后者不判断科学方案是否正确，前者也不规定具体目录布局。

## 6. 可选 Provider Adapter：DeepSeek

仓库中现有的 DeepSeek bridge 已经验证了三类可选能力：

- 用 `ask_deepseek` 提供文本 Challenger；
- 用 `run_deepseek_worker` 让外部模型在受限工作区执行；
- 用 `run_deepseek_workers` 并行处理互不重叠的执行任务。

它通过 OpenCode 为 DeepSeek 提供受限文件工具，并实现可信根、敏感文件拒绝、工作区写锁、超时和并行失败清理。它证明了外部 provider 可以接入这套角色契约，但不是 Solid Vibe Coding 的默认模型、唯一执行者或必要依赖。

DeepSeek 是可选 provider，因此不在 `agents/openai.yaml` 中声明为必需依赖。只要相应 MCP 已可用，用户在任务中明确要求由 DeepSeek 担任 Challenger 或执行者即可。

安装、配置、安全边界和验证方式见 [DeepSeek 执行桥接](integrations/deepseek-mcp/README.md)。现有安装脚本会同时链接两套新 skill；它们仍可脱离 DeepSeek adapter 独立使用。

## 7. 当前草案状态

当前仓库由两套 provider-neutral skill 构成：

- `skill/solid-vibe-coding/`
- `skill/experiment-management/`

原 `multi-subagents` 原型已经由这两套职责更单一的 skill 取代。首版刻意不加入固定模型编制、任务难度路由、执行者限制、Git/worktree 流程或强制目录名。只有跨任务重复出现且无法由现有 meta 约束覆盖的问题，才值得进入通用 skill。

## 参考

核心编排：

- [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

DeepSeek 可选适配器：

- [DeepSeek coding-agent 集成指南](https://api-docs.deepseek.com/guides/coding_agents/)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [OpenCode Agent 配置](https://opencode.ai/docs/agents/)
- [OpenCode 权限模型](https://opencode.ai/docs/permissions/)
