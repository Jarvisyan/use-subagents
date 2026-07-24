# JARVIS 架构设计

> 本文描述相对稳定的组织模型、运行协议和安全边界。  
> 当前模型分配、阶段实验和待办事项见 [`PLAN.md`](PLAN.md)。

## 1. 设计目标

JARVIS 要建立的不是“多模型投票群”，而是一套可追踪、可验证、可替换的人机协作组织：

1. 人类只在使命、风险和最终采用等高杠杆节点介入；
2. Plan、Execute、Check 职责分离，但 Agent 数量按任务弹性变化；
3. 每个阶段留下足以定位最早偏差的轻量证据；
4. 测试、权威数据和可复现事实高于模型共识；
5. 模型只是可竞争、可降级、可开除的岗位候选，不是永久编制；
6. 架构可以作为整洁的开源项目被他人理解、复用和扩展。

## 2. STARK Agent OS

```text
STARK Agent OS
├── Tony Stark（用户 / Mission Owner）
│   └── 定义使命、风险边界与最终裁决
├── JARVIS（主 Agent / Orchestrator）
│   └── 理解意图、组织任务、调度战衣、执行门禁、汇报结果
├── Hall of Armor（Subagent 池）
│   ├── MARK-P：Planner
│   ├── MARK-X：Executor / Writer
│   ├── MARK-R：Reviewer
│   └── MARK-S：Scout / Researcher
├── House Party Protocol
│   └── 任务存在独立工作流时，启动多战衣协作
├── Veronica Protocol
│   └── 高风险或规划僵局时，引入异构 Planner 挑战
├── Armor Qualification Protocol
│   └── 根据真实表现动态调权、降级、停职与退役
└── Arc Reactor
    └── 测试、验收标准、证据链与指标——系统的客观能源
```

### 2.1 职责矩阵

| 组织标签 | 逻辑职位 | 核心责任 | 不应承担 |
|---|---|---|---|
| Tony Stark：Mission Owner | 最终责任人 | 使命、价值、风险边界、高影响授权和最终裁决 | 逐行监督所有实现 |
| JARVIS：Orchestrator | 组织中枢 | 任务契约、风险分级、人员调度、阶段门禁和结果汇总 | 在非平凡 Mission 中既写代码又独自批准 |
| MARK-P：Planner | 规划者 | 方案、假设、数据流、影响面、验证和回滚计划 | 静默改变原始需求或验收标准 |
| MARK-X：Executor / Writer | 执行者 | 按冻结计划实现、报告偏离、提交可复现交接 | 自我审查后宣布完成 |
| MARK-R：Reviewer | 审查者 | 从原始 Brief 独立推导不变量，审查实现与证据 | 默认直接修改被审查代码 |
| MARK-S：Scout / Researcher | 侦察者 | 只读探索代码、资料、风险和候选路径 | 成为第二个无边界 Writer |
| Arc Reactor：Mechanical Verifier | 客观验证层 | 验收、测试、静态检查、数据不变量、基准和原始证据 | 用多数意见覆盖失败事实 |

这些是职责槽，不是固定人数。同一个模型担任不同职位时必须使用不同角色契约并分别评价。

## 3. Mission 生命周期

### 3.1 状态流

```text
INTAKE
  → BRIEF_LOCKED
  → PLAN_LOCKED
  → IMPLEMENTING
  → VERIFYING
      ├─→ REWORK → IMPLEMENTING
      └─→ REVIEWING
          ├─→ REWORK → IMPLEMENTING
          ├─→ ESCALATED → PLAN_LOCKED | IMPLEMENTING | READY_FOR_DECISION | REJECTED
          └─→ READY_FOR_DECISION → ACCEPTED | REJECTED
```

- `REWORK` 是有次数预算的回路，不是终点。
- 任一活动状态遇到范围扩张、权限边界或未解决的 High 风险时都可以进入 `ESCALATED`。
- `ESCALATED` 暂停自动流程，等待 Tony Stark 明确选择修订、恢复、接受残余风险或终止。
- `ACCEPTED` 只表示结果被采用；发布、付费、外部通信等高影响动作仍需单独授权。

### 3.2 Mission 证据包

```text
.jarvis/missions/<mission-id>/
├── brief.md          # 目标、范围、约束与非目标
├── acceptance.md     # 可客观判定的验收标准
├── plan.md           # 方案、假设、影响面、步骤和回滚
├── handoff.md        # 实际改动、计划偏离和复现方式
├── evidence/         # 测试、日志、基准或来源
├── review.md         # 独立发现、严重级别和残余风险
├── decision.md       # 接受、返工或升级及其理由
└── metrics.json      # 时间、成本、返工、人工介入和战衣档案
```

只记录决策、接口、假设和证据，不保存或要求模型的内部思维过程。

### 3.3 故障归因

出现问题时，先定位最早偏差阶段，再更新对应战衣的绩效：

```text
Requirement | Plan | Execution | Review | Oracle | Environment
```

Plan 缺陷不能扣到 Executor，测试环境故障也不能被计算成模型质量问题。

## 4. 风险与人员配置

| 风险等级 | 典型任务 | 最小充分编制 |
|---|---|---|
| Green | 局部、可逆、强测试、无语义/API/数据流变化 | JARVIS + MARK-X：Executor + Arc Reactor |
| Amber | 跨文件或数据流、有设计判断 | JARVIS + MARK-P：Planner + MARK-X：Executor + MARK-R：Reviewer + Arc Reactor |
| Red | 核心架构、公共 API、安全、科研结论、弱 Oracle 或昂贵回滚 | JARVIS + 两名独立 MARK-P（含 Challenger）+ MARK-X：Executor + MARK-R/领域审查 + Arc Reactor + Tony 门禁 |

Green 是快速路径，Check 可以由强机械验证完成。非平凡 Mission 默认保持一个权威 Planner、一个 Writer 和一个无历史 Reviewer。

同一共享工作区只允许一个 MARK-X：Writer。并行写入必须使用隔离 worktree 或明确不重叠的工作区，并由 JARVIS 指定集成人。

## 5. 核心协议

### 5.1 House Party Protocol

只有同时满足以下条件时，才并行派出多套战衣：

- 至少存在两个真正独立的工作流；
- 工作边界与交付接口可以事先说明；
- 并行收益大于协调和集成成本；
- 写入彼此隔离，或者并行 Agent 只执行只读探索。

模型思考预算与团队拓扑分别决策。`High`、`Max` 等 reasoning effort 描述思考预算；House Party 描述任务组织。支持主动调度的 `Ultra` preset 可以执行 House Party，但不能反过来证明任务应该并行。

### 5.2 Veronica Protocol

出现以下任一情况时，才引入异构 Planner：

- 存在多个可行架构，选错后回退昂贵；
- 涉及核心数据流、公共 API、安全边界或科研结论；
- 缺少可靠的客观测试 Oracle；
- 一轮重规划后仍未收敛；
- Executor 发现计划不可执行、隐藏假设错误或范围明显扩大；
- 项目历史上出现过同类规划级事故。

协议采用有限回合：

1. 两名 Planner 从同一份冻结 Brief 独立盲规划；
2. 分别列出假设、风险、失败模式和验证方法；
3. 进行且仅进行一轮基于证据的交叉质询；
4. JARVIS 综合裁决，不按票数决定；
5. 未消除的高风险分歧交给 Tony Stark。

### 5.3 Clean-room Review

Reviewer 的独立性必须由运行机制保证：

1. MARK-R 在不继承 JARVIS、Planner 或 Executor 历史的独立任务中启动；在 Codex 中使用无历史 fork（如 `fork_turns="none"`）或等价隔离。
2. 第一遍只允许读取 `brief.md`、`acceptance.md`、项目约束、待审代码或 diff，以及 Arc Reactor 原始证据。
3. Reviewer 先冻结独立 findings；第二遍才读取 `plan.md` 与 `handoff.md`，检查可追踪性和静默偏离。
4. 不传入规划辩护、执行者自评或此前 Agent 的完整聊天记录。

同模型的新实例只能带来上下文独立，不能带来模型家族独立。Red Mission 仍需异构 Reviewer、领域专家或强客观 Oracle。

## 6. Armor Qualification：动态权重与淘汰

### 6.1 评价单位

初始模型分配只是组织假设，不是永久职位。真正被评价的是可复现的 **Suit Profile（战衣档案）**：

```text
profile_schema_version
+ role
+ task_taxonomy_version / task_family
+ model_snapshot
+ reasoning_effort
+ prompt_version
+ context_policy_version
+ tool_policy_version
```

例如：

```text
MARK-X：Executor
└── code.python × deepseek-v4-pro-2026-04-24 × high × executor-v3 × tools-v1
```

同一模型担任 Planner、Executor 和 Reviewer 时分别记账。模型版本、关键 Prompt、上下文策略或工具权限发生实质变化时创建新档案。某个档案被开除，不代表整个模型品牌在所有岗位上失去资格。

### 6.2 资格门禁

动态权重不是事实投票权。路由前依次执行：

1. **资格门禁**：能力、工具、数据边界、许可证和风险等级是否允许调用；
2. **质量硬门槛**：结果必须不劣于当前岗位基线，低价格不能抵消低质量；
3. **综合效益**：质量合格后再比较返工后的总成本、延迟和人工介入；
4. **受控探索**：只把少量可逆任务交给候选档案，防止组织永久固化。

伪造证据、泄露秘密、越权执行不可逆操作等诚信或安全事故直接触发停职，不经过平均分稀释。

### 6.3 角色指标

| 战衣档案 | 主要指标 |
|---|---|
| JARVIS：Orchestrator | 风险分级与升级是否正确、Mission 成功率、协调成本 |
| MARK-P：Planner | 验收覆盖、假设完整度、计划可执行性、Plan 源缺陷与重规划 |
| MARK-X：Executor | 首轮验收率、有效缺陷严重度、范围遵循、返工、回归和复现性 |
| MARK-R：Reviewer | 经确认的缺陷召回率与准确率、漏检、误阻塞和严重度校准 |
| MARK-S：Scout | 来源真实性、覆盖度、决策价值、时效和总成本 |

成本按“完成 Mission 的总成本”计算，包括 API、订阅额度、重试、额外 Review 和人工分钟，而不是只看 Token 单价。

### 6.4 初始评分算法

V1 采用透明、可重放的 EWMA。每个完成根因归属的角色表现得到 `Sₜ ∈ [0,100]`：

```text
EWMAₜ = 0.25 × Sₜ + 0.75 × EWMAₜ₋₁
confidence = n / (n + 8)
conservative_score =
  confidence × EWMA + (1 - confidence) × role_baseline
```

只有通过质量门槛后才计算路由效用：

```text
utility =
  75% 质量
  + 10% 可追踪性
  + 10% Mission 总成本
  + 5% 延迟
```

这些是 P5 的可配置初始值，不是永久真理。权重只在 Mission 结束并完成独立裁决后更新；Mission 进行中冻结 `profile_id`、路由策略版本和评分规则。

所有分量先按同一任务家族归一化为“越高越好”的 `0–100` 分；成本与延迟需要反向换算，并同时保留原始值。不同任务家族的分数不直接横向比较。

### 6.5 人事状态

```text
Candidate（候选）
  → Probation（试用）
  → Active（在职）
  → Preferred（主力）
  → Restricted（降级）
  → Suspended（停职）
  → Decommissioned（退役 / 开除）
```

初始晋退规则：

- Candidate 完成至少 3 个隔离的 Shadow Evaluation 或 Green 样本且无安全事故后进入 Probation；
- Probation 至少完成 8 个有效任务、来自不少于 3 个 Mission，达到岗位质量线后转为 Active；
- Active 至少完成 15 个任务、来自不少于 5 个 Mission，质量更好或质量非劣且总成本显著改善后转为 Preferred；
- 连续 3 次低于质量线，或最近窗口返工明显恶化时降级；
- 一次诚信/安全事故，或最近 8 次中出现 2 个归因到该档案的 Critical/High 失败时停职；
- Suspended 档案通过 3 次受控复职测试后回到 Restricted/Probation；仍不达标，或版本停止服务、无法满足安全与许可证要求时退役。

阈值写入版本化策略，不写死在角色协议或代码中。

### 6.6 探索与恢复

- Green：最多 20% 的评估预算用于 Candidate/Probation；
- Amber：最多 10%；
- Red：不自动探索，只使用已验证档案或由 Tony Stark 显式批准；
- **Routing Shadow** 只生成路由建议，不执行候选，也不计质量样本；
- **Evaluation Shadow** 在隔离 worktree 或离线回放中执行同一任务，经过相同验收与盲审后才可计入试用样本，但结果不进入主交付；
- 每次路由必须解释所用证据、策略版本和人工覆盖；
- 任何时候都可以一键恢复 P1 的静态模型编制。

模型快照或关键配置更新后，新档案不能直接继承旧版本主力身份；同系列历史最多作为少量弱先验。供应商别名被静默更新时，档案进入 `needs-revalidation`。

### 6.7 防止同模型自评

证据优先级：

```text
确定性测试 / 权威数据
  > 盲化的独立 Reviewer
  > 经复核的人工或异构模型裁决
  > 生成者自述
```

- 模型自评不进入分数；
- Reviewer 不知道 Executor 的模型身份；
- 有争议的 finding 必须由测试、代码证据或独立裁决确认；
- Reviewer 自身通过受控缺陷注入、后续逃逸缺陷和误报率评价；
- Planner 与同家族 Reviewer 的一致意见不能当成两份模型独立证据。

## 7. 模型与数据边界

模型 ID 是可替换配置，不写死在角色协议中。跨供应商调用意味着向该供应商披露实际发送的代码和上下文，因此路由前必须通过：

- 秘密信息和个人信息检查；
- 仓库许可证与第三方代码边界；
- 项目允许的供应商和地区；
- 角色所需的最小上下文白名单；
- 高影响工具与写入权限门禁。

## 8. 开源仓库边界

稳定源文件和脱敏案例应该公开；私人素材与真实运行记录默认本地保存：

```text
公开
├── README、架构、路线图与许可证
├── Skill、角色协议、模板、schema 和测试
├── 脱敏、可复现的 examples/missions/
└── 聚合后的实验方法、指标与结论

默认忽略
├── 私人聊天与身份信息
├── .env、API key 和账户数据
├── .jarvis/missions/ 中的真实运行记录
├── 原始模型输出、日志、缓存和临时 worktree
└── 含敏感代码、本地路径或额度信息的 evidence/metrics
```

真实 Mission 只有在人工脱敏、复现和许可检查后，才能复制到 `examples/`。不能为了展示“透明”而把私人聊天、完整提示词或内部思维过程直接上传。

## 9. 不变量与反模式

- 不允许 Planner 在失败后静默修改原始需求或验收标准。
- 不允许 Executor 静默偏离计划。
- 不允许多个 Writer 修改同一共享工作区的重叠文件。
- 不允许非平凡 Mission 在同一上下文中“实现并自我批准”。
- 不用模型投票覆盖测试、数据或权威来源。
- 不自动执行删除、发布、付费、外发数据等高影响操作。
- 不进行无限重试、无限辩论或无边界增加 Agent。
- 不让低价格抵消质量、安全或隐私门槛。
- 不用一次成功或失败给整个模型品牌定终身。
- 不要求每个标点修改都成立一家公司。

系统目标是降低意外、缩短故障定位链并持续优化组织，而不是承诺消灭所有 Bug。
