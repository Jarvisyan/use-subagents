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

## 2. 核心设计：一轮自动化，只保留两个 Human Gate

固定的是两个用户必须判断的边界，而不是模型品牌、Agent 数量或执行拓扑：

```text
用户提出 idea 或问题
-> 主对话模型形成正方 Plan
-> 临时 Plan Challenger 对抗审查
-> [Plan Gate：用户判断是否合理、是否值得执行]
-> 主对话模型直接执行或协调执行者
-> 主对话模型重建 Plan 到实现和证据的映射
-> 临时 Check Challenger 对抗审查
-> [Check Gate：用户判断实现是否忠实、未规定的选择是否可接受]
-> move on / 修实现 / 重新规划 / 补充实验 / 停止
```

只有默认提问启动的主对话模型贯穿整个迭代。它持续持有用户目标、项目上下文、采用的 Plan、执行状态和最终证据。Plan Challenger 与 Check Challenger 都是临时新开的 subagent：它们读取主模型的完整主张和证据进行定点攻击，在对应 Gate 的攻防结束后关闭。

“独立 Challenger”指独立的 subagent 上下文，不是脱离正方辩词做盲审，也不是让主模型自己模拟左右脑互搏。

## 3. `solid-vibe-coding`：工作流控制层

### Plan Gate

主模型先把 idea 展开成完整的低层设计：动机、科学主张、适用的 baseline、reference implementation 或 backbone 及预期改动、分析对象、开放选择、评价合同，以及成功与失败如何改变决策。Challenger 再攻击其中的薄弱 claim。

一个 blocking objection 必须同时说明：

- 它影响哪项 claim；
- 具体 failure mode 或反例是什么；
- 最小判别证据是什么；
- 它会改变用户的哪项决定。

Plan Challenger 不是泛泛寻找“可能有风险”，而是集中攻击五类会让实验失去解释力的问题：

1. 动机、问题定义和主张是否抓住了真正要验证的问题；
2. 设计能否隔离目标变量，排除混杂与竞争解释；
3. 开放选择和实现边界是否足以在事后核验 Plan-to-code 一致性；
4. evaluator 与验收逻辑能否区分关键结果；
5. 可能结果是否真的会改变下一项决策，成本与风险是否值得。

主模型用证据防守或修订，Challenger继续攻击修订后的主张。至少一轮、最多三轮；中间轮次无需用户监督。只有同时存在 blocking objection，并且下一轮能加入新的判别证据、检查结果或实质修订时，才自动继续；如果反方已经没有具体异议，则提前结束。最终由主模型按证据裁决，不按模型投票，也不伪造共识。

交给用户的不是动作清单，而是一段可以直接判断的故事：问题为什么出现，正方为什么提出这套方案，反方抓住了什么漏洞，双方用什么证据解决了哪些争议，还剩什么不确定性，以及批准后会验证什么。

### 自适应执行

执行不绑定某个 provider，也不强制另开 executor。主模型可以直接执行，也可以把一个任务交给 subagent，或把真正独立的子任务并行委派；用户指定外部模型时则遵循该选择。

Plan Gate 冻结的不只是科学语义，也包括资源与费用、权限、外部副作用，以及允许的恢复和诊断范围。执行者可以在这个包络内自主处理实现细节、安全重试和小 bug；任何一条边界发生实质扩张，都必须返回 Plan Gate。弱结果、意外结果或不确定结果本身不构成自动追加实验的授权。

### Check Gate

Check Gate 首先不问实验结果好不好，而是确认“我们实际实现的是不是用户批准的 Plan”。主模型先重建：

```text
冻结 Plan
-> 实际代码、配置和数据流
-> Plan 中开放选择的具体落地
-> 相对 baseline、reference implementation 或 backbone 的重要改动
-> 用于证明上述映射的 diff、配置、数据流和运行证据
-> 在实现一致性成立后，实验输出可支持的结论、限制与不确定性
```

主模型先运行适用的可复现检查，再把冻结 Plan、实际 diff/实现、产物、检查证据和失败项一起交给 Check Challenger，而不是只给一份精选摘要。反方集中攻击四类问题：

1. 实现、数据流、开放选择的落地和 baseline delta 是否忠实于 Plan；
2. Plan 没有规定死的选择实际上如何落地，是否有遗漏或未经声明的偏离；
3. 实际 diff、输入、检查和运行证据是否足以证明这份一致性账目；
4. 后续结果解释是否把实现缺陷或其他解释误当成 idea 的证据。

这样，即使结果 promising，也不能跳过实现一致性审计；如果实现与 Plan 一致但结果不理想，证据才应归因到 idea，而不是先假设代码有 bug。

报告分两次组织：先建立完整的 claim/evidence/uncertainty/consequence map，再按用户必须判断的少数问题重新叙述。聊天本身必须自洽，文档只在解释之后提供精确证据指针。汇报完成后流程停在 Check Gate，由用户判断实现是否可信、哪些开放选择需要接受或修正，再决定 move on、修实现、重新规划、补充实验或停止。

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
├── Plan Gate：对抗规划并交给用户判断
├── Adaptive Execution：选择合适执行拓扑
└── Check Gate：核对 Plan 与实现并交给用户判断

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
