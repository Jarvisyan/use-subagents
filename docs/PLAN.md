# JARVIS 实施计划

> 状态：P0 / 项目宪章  
> 更新日期：2026-07-24  
> 目标：先证明组织工作流有效，再比较模型、建立动态用人机制，最终作为整洁、可复用的开源项目发布。

## 1. 已冻结的初始决策

这些是试点的起始假设。后续可以根据证据修改，但不在一次实验中同时改变：

1. 用户担任 Tony Stark，只负责使命、风险边界和最终裁决。
2. P1 由 GPT-5.6 Sol 承担 JARVIS：Orchestrator 与 MARK-P：Planner；两个逻辑职位的契约、产物和绩效分开记录。
3. Plan、Execute、Check 职责固定，Agent 数量根据风险和可并行性弹性变化。
4. 共享工作区只有一个 Writer；Reviewer 使用全新上下文独立审查。
5. 首个 Demo 只使用 GPT 系列，避免流程与供应商变量同时变化。
6. 后续对照只把 MARK-X：Executor 从 Terra 替换为 DeepSeek V4 Pro。
7. Kimi K3 不常驻，仅在 Veronica 触发条件成立时作为异构 MARK-P：Planner Challenger。
8. 推理预算与团队拓扑分别决策：`High` 默认、深度任务按需升到 `Max`；House Party 只由任务依赖和隔离条件触发。支持 `Ultra` 的环境可用它执行主动调度，但不以模式名称代替任务分析。
9. 项目先采用本地规则；连续试点证明稳定后，再提炼轻量 global Skill。
10. 当前模型编制只是为了建立可比较基线，不是永久职位；P1–P4 产生证据后再启用动态权重与淘汰。
11. 项目最终在 GitHub 开源给朋友和其他开发者使用；公共源文件、私人素材和真实运行产物必须从一开始分层管理。

### 初始运行预算

- 一个 Amber Mission 默认由 JARVIS（可承载或派出 MARK-P）、一个 MARK-X：Writer 和一个 MARK-R：Reviewer 完成；满足严格条件的 Green Mission 可以由 Arc Reactor 承担 Check。
- JARVIS 最多按需增加两个 MARK-S：Scout；更多并发必须说明收益和边界。
- MARK-P：Planner 允许一次主动重规划。
- Execute–Review 默认最多两个修复循环。
- Veronica 只允许一轮交叉质询。
- 超出预算、发生范围扩张或出现未解决的 High 风险时，升级给用户。

这些数字是为了让 Demo 可控，不是永久标准。

## 2. 试点成功标准

JARVIS 的价值不是 Agent 数量，而是能否在减少人工微观检查的同时维持可靠性和可追踪性。试点成功需要同时满足：

1. 真实任务按照冻结的验收标准完成，没有未解决的 Critical / High 问题。
2. 用户没有逐行监督实现，只在使命、风险或最终采用节点介入。
3. 每项实际变更都能映射到原始计划或明确的审查修复项。
4. 出现问题时，可以定位到 Requirement、Plan、Execution、Review、Oracle 或 Environment。
5. 计划、交接、测试和审查证据可以被另一个 Agent 复现。
6. 模型替换可以在相同任务协议下做受控比较。

## 3. Mission 状态与证据契约

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

人类默认只在三个位置介入：

- `INTAKE`：澄清价值、边界或不可接受风险；
- `ESCALATED`：选择修订计划、恢复实现或终止 Mission；
- `READY_FOR_DECISION`：决定接受或拒绝结果。

`REWORK` 是有次数预算的回路，不是终点。任一活动状态遇到范围扩张、权限边界或未解决的 High 风险时都可以进入 `ESCALATED`；该状态会暂停自动流程，直到人类留下明确决策。`ACCEPTED` 只表示结果被采用；生产发布、外部通信或其他高影响动作仍需要单独授权。

### 3.2 计划中的运行目录

```text
.jarvis/
├── roles/
│   ├── planner.md
│   ├── executor.md
│   ├── reviewer.md
│   └── scout.md
├── protocols/
│   ├── risk-gates.md
│   ├── house-party.md
│   ├── veronica.md
│   └── escalation.md
├── templates/
│   ├── brief.md
│   ├── acceptance.md
│   ├── plan.md
│   ├── handoff.md
│   ├── review.md
│   └── decision.md
└── missions/
    └── <mission-id>/
        ├── brief.md
        ├── acceptance.md
        ├── plan.md
        ├── handoff.md
        ├── evidence/
        ├── review.md
        ├── decision.md
        └── metrics.json
```

## 4. 分阶段路线图

### P0 — Foundation：建立试点基础

**目标：** 把口头共识变成可执行且不会互相矛盾的项目契约。

#### 任务

- [x] 保存原始讨论为本地素材，并通过 `.gitignore` 排除出公共仓库。
- [x] 将公开入口、稳定架构和执行路线分别整理为 `README.md`、`docs/ARCHITECTURE.md` 和 `docs/PLAN.md`。
- [x] 建立最小 `.gitignore`，默认忽略秘密、私人素材和真实 Mission 运行产物。
- [ ] 初始化 Git 仓库并记录基线 commit。
- [ ] 选择开源许可证；加入 `LICENSE` 前不对外声称代码可自由复用。
- [ ] 冻结 Green / Amber / Red 风险分级与升级门槛。
- [ ] 冻结 Mission 文件字段和状态转换规则。
- [ ] 将 clean-room Reviewer 固化为无历史任务，并定义首轮输入白名单与二阶段审查顺序。
- [ ] 定义秘密信息、许可证和跨供应商数据路由边界。
- [ ] 冻结 P1 证据策略：真实 `.jarvis/missions/` 全部留在本地；只提交源码、模板、schema 和测试。值得公开的证据经脱敏与许可检查后复制到 `examples/missions/`，并以摘要、复现命令和哈希为主。
- [ ] 定义 Suit Profile、角色/任务家族 taxonomy、根因归属和 Performance Ledger schema；P1–P4 只记录，不自动换帅。
- [ ] 使用 `skill-creator` 建立项目本地 JARVIS Skill，而不是立即修改全局配置。

#### 退出条件

- 一个新 Agent 只阅读 README 和角色协议，就能解释谁负责什么、何时升级以及完成需要哪些证据。
- Mission 模板可以支持第一个真实任务，不需要 Agent 猜测核心字段。
- 一个第一次访问 GitHub 的朋友能够从 README 找到架构、路线图和项目状态，且仓库中没有私人聊天、秘密或未整理的运行垃圾。

### P1 — GPT-only Bootstrap Demo：让 JARVIS 建造第一套战衣

**目标：** 用 GPT-only 团队跑通一次完整的 Plan–Execute–Check，并让项目第一次“吃自己的狗粮”。

#### 推荐 Demo Mission

实现一个最小的 **Mission Bundle 初始化与校验器**：

- 根据模板创建新的 `.jarvis/missions/<mission-id>/`；
- 校验必需文件、字段和合法状态转换；
- 检查验收项是否有对应证据；
- 输出缺失项和可定位的失败原因；
- 提供自动化测试和可复现命令。

它不是纯玩具：这个工具会成为后续每次 Mission 的 Arc Reactor 一部分；同时它范围适中、可回滚、有强客观测试，适合验证组织流程。

#### 初始编制

| 组织标签 | P1 实例 |
|---|---|
| JARVIS：Orchestrator | GPT-5.6 Sol，High |
| MARK-P：Planner | GPT-5.6 Sol，High |
| MARK-X：Executor / Writer | GPT-5.6 Terra，High，唯一默认 Writer |
| MARK-R：Reviewer | 无历史独立任务中的 GPT-5.6 Sol，High |
| MARK-S：Scout / Researcher | GPT-5.6 Luna 或确定性工具，按需 |
| Arc Reactor：Mechanical Verifier | 单元测试、静态检查和命令行验收 |

JARVIS 与 MARK-P 可以由同一 Sol 主 Agent 承载，也可以在复杂任务中拆成两个实例；无论采用哪种方式，编排决策与 Plan 产物都分别记录。

#### 执行清单

- [ ] 为 Mission 001 冻结 `brief.md`、`acceptance.md` 和风险级别。
- [ ] 确定实现语言后，补齐对应构建、测试、缓存和编辑器产物的 `.gitignore` 规则。
- [ ] MARK-P：Planner 输出方案、数据结构、边界条件、失败模式与验证映射。
- [ ] MARK-X：Executor 在不改变验收标准的前提下实现并提交 handoff。
- [ ] 保存全部确定性检查的命令、退出码和关键输出。
- [ ] MARK-R：Reviewer 通过无历史任务启动；第一遍只读取输入白名单并冻结 findings，第二遍再读取 Plan 与 handoff 检查偏离。
- [ ] 如有问题，由原 Writer 修复并复核，最多两个循环。
- [ ] 为每次角色调用记录 Suit Profile 配置指纹和根因归属，但保持静态派遣权重。
- [ ] JARVIS 汇总结果、残余风险、故障归因与指标。

#### 退出条件

- 全部验收测试通过，且没有未解决的 Critical / High finding。
- 没有未经授权的范围扩张。
- 任一改动都能映射到 Plan 或审查修复项。
- 故意破坏一个必需文件或状态时，校验器能够给出正确归因。
- Mission 001 的全过程证据足以由新 Agent 复现。

### P2 — Harden：用连续任务校准流程

**目标：** 避免从一次成功 Demo 过早抽象框架。

#### 任务

- [ ] 用 GPT-only 配置连续完成至少三个不同类型的真实 Mission。
- [ ] 覆盖 Green、Amber 和至少一个受控 Red 场景。
- [ ] 检验 House Party 是否只在存在独立工作流时触发。
- [ ] 加入失败归因和 incident 模板。
- [ ] 至少注入两个受控故障；由无历史 MARK-R：Reviewer 以 Diagnostician 专项任务，仅凭 Mission 证据包在一次审查内指出最早错误阶段及对应证据。
- [ ] 用受控缺陷注入校准 MARK-R 的漏检、误报和严重度判断。
- [ ] 形成只追加的 Performance Ledger，并验证给定历史记录可以离线重放评分；此阶段仍不自动改变派遣。
- [ ] 校准重规划、修复循环、Agent 数量和人工门禁。
- [ ] 根据实际体积、复现价值与敏感性，校准“本地真实记录 → 脱敏公开案例”的导出策略。

#### 退出条件

- 三个 Mission 都能在有限人工介入下完成并复盘。
- 对至少两个受控故障，证据链能让新 Agent 在一次审查内定位最早错误阶段，而无需重放完整聊天。
- 没有为了维护流程而产生高于其收益的文档负担。

### P3 — DeepSeek Executor A/B：试用新的 MARK-X 战衣

**目标：** 将 DeepSeek V4 Pro 注册为 MARK-X：Executor Candidate，在不改变 Planner、Reviewer、任务和验收标准的情况下，检验它能否以更低总成本承担实现。

#### 实验规则

1. 从同一基线 commit 建立两个隔离 worktree。
2. A 组使用 Terra High 的 MARK-X 档案，B 组使用 DeepSeek V4 Pro 的 MARK-X Candidate。
3. 两组使用相同的 Brief、Acceptance、Plan、工具权限、时间和重试预算。
4. 两组不得读取对方产物。
5. 分别由全新 Sol Reviewer 盲审，隐藏 Executor 身份。
6. Codex 订阅额度与外部 API 现金成本分开记录。
7. 发送代码给外部模型前先执行数据分级和秘密扫描。
8. 两组分别记录完整 Suit Profile、根因归属与 Performance Ledger，不在实验中途调整路由。

至少覆盖三个同级、不同类型的任务后，才决定默认 Executor。

#### 采用门槛

- **质量硬门槛：** 零 Critical / High 遗留，验收质量不低于 GPT 基线。
- **流程门槛：** 不显著增加返工轮数和人工监督。
- **经济门槛：** 节省足以覆盖新增审查、集成和数据治理成本。

通过门槛只意味着该档案取得 Active 资格，不意味着 DeepSeek 品牌在其他角色上自动获得同等权重。

### P4 — Veronica Experiment：测试 Kimi 的 MARK-P Challenger 档案

**目标：** 判断异构规划何时真正发现新问题，而不是把互博变成常驻仪式。

#### 协议

1. Sol MARK-P 与 Kimi K3 MARK-P Challenger 从同一份冻结 Brief 独立盲规划。
2. 双方分别列出假设、风险、失败模式和验证方法。
3. 交换方案，进行一轮基于证据的质询。
4. JARVIS 综合裁决，不按多数票决定。
5. 未消除的高风险分歧升级给 Tony Stark。

#### 观察指标

- Challenger 是否发现新的重大假设、风险或可行替代方案；
- 方案是否因此发生实质变化；
- 编码前发现的问题数量；
- 下游返工、缺陷、时间和费用变化；
- `有价值挑战次数 / Veronica 触发次数`。

完成多个真实触发案例后，才能调整触发阈值；不因一次精彩表现把双 Planner 设为默认。

### P5 — Adaptive Routing：动态权重与战衣淘汰

**目标：** 使用 P1–P4 的真实记录校准派遣权重，让长期低质量的战衣档案被降级、停职或开除，同时保留对新模型的受控试用通道。

权重表示“在通过硬门禁的候选中优先派谁”，不是投票权或事实权威。评价单位是：

```text
档案 schema 版本 × 角色 × 任务 taxonomy 版本/家族 × 模型快照
× 推理强度 × Prompt 版本 × 上下文策略版本 × 工具权限版本
```

#### 初始评分

只有完成根因归属的任务才更新对应档案：

```text
EWMAₜ = 0.25 × Sₜ + 0.75 × EWMAₜ₋₁
confidence = n / (n + 8)
conservative_score =
  confidence × EWMA + (1 - confidence) × role_baseline
```

通过质量硬门槛后，再按 `75% 质量 + 10% 可追踪性 + 10% Mission 总成本 + 5% 延迟` 形成初始路由效用。比例和阈值必须版本化、可配置、可重放。

#### 任务

- [ ] 建立 Armor Registry、只追加 Performance Ledger 和版本化 routing policy。
- [ ] 用 P1–P4 历史 Mission 做离线回放，验证评分与升降级可以复现。
- [ ] 先运行 Routing Shadow，只给出派遣建议而不自动换帅；需要质量样本时另行运行隔离的 Evaluation Shadow。
- [ ] 实现 Candidate → Probation → Active → Preferred 的晋升，以及 Restricted → Suspended → Decommissioned 的降级与开除。
- [ ] 把安全、诚信、数据和许可证事故设为硬停职门禁，不允许平均分抵消。
- [ ] Green 最多使用 20% 评估预算试用候选，Amber 最多 10%，Red 禁止自动探索。
- [ ] 新模型快照、关键 Prompt 或工具策略变化时创建新档案，并对供应商静默升级触发重新验证。
- [ ] 所有路由输出说明证据、策略版本、人工覆盖和回退方式。

#### 退出条件

- 每次路由都能解释“为什么是这套战衣”，且离线回放结果一致。
- Routing Shadow 建议经离线回放后在质量上不劣于静态基线，并在总成本、延迟或人工负担上带来可测收益。
- 动态策略没有突破任何权限、隐私或 Critical / High 质量门禁。
- 随时可以一键恢复 P1 的静态模型编制。
- 退役只针对具体 Suit Profile，不用少量样本给整个模型品牌定终身。

### P6 — Productize & Open-source：固化并发布

**目标：** 只把真实 Mission 证明有效的规则固化为可从干净 clone 使用的开源版本。

#### 工程化任务

- [ ] 固定 Mission schema、角色契约、风险分级和 routing policy 版本机制。
- [ ] 固定 House Party、Veronica、Armor Qualification、Review 和 Escalation 协议。
- [ ] 对照 Superpowers、gstack、Agentic Orchestration Control（AOC）和 Swarms，选择性吸收成熟机制。
- [ ] 将项目特有约束保留在本地 `AGENTS.md`，将跨项目控制循环提炼为轻量 global Skill。
- [ ] 模型 ID 保留为可替换配置，不写死进角色协议。
- [ ] 至少在另一类项目中复用成功后，再决定是否封装成插件或增加 UI。

#### GitHub 发布任务

- [ ] 选择并加入 `LICENSE`，完成第三方归属和依赖许可证检查。
- [ ] 从全新 clone 验证安装、Quick Start、示例 Mission 和全部测试。
- [ ] 建立最小 CI：测试、静态检查、Skill 与 schema 校验。
- [ ] 扫描当前文件及 Git 历史中的秘密、个人信息、本地路径和私人聊天。
- [ ] 发布一个经过脱敏、许可检查且可复现的 `examples/missions/` 案例。
- [ ] 说明外部模型会收到哪些代码与上下文、支持环境、已知限制和非生产承诺。
- [ ] 加入 `SECURITY.md`；确认接受外部贡献时再加入精简 `CONTRIBUTING.md`。
- [ ] 完成 STARK/JARVIS 命名与“非官方、无关联”声明审查。
- [ ] 打 `v0.1.0` 标签并发布简短 release notes。

#### 退出条件

- 一位没有参与开发的朋友可以从干净 clone 在几分钟内理解项目，并按 Quick Start 跑通示例。
- 公共仓库不包含私人聊天、真实 Mission、秘密、原始模型输出或不可复现的临时文件。
- 发布的接口、文档、示例和测试彼此一致。

## 5. 统一实验指标

每个 Mission 至少记录七类指标：

| 类别 | 指标 |
|---|---|
| Outcome | 验收结果、回归、遗留缺陷 |
| Quality | Reviewer findings、严重性、有效性、范围偏移 |
| Process | 重规划次数、修复轮数、人工介入次数与分钟数 |
| Cost | 墙钟时间、Codex quota、外部 API 现金成本 |
| Traceability | 证据完整度、复现结果、故障定位阶段 |
| Challenge | 新增 Agent 是否发现实质问题或缩短总耗时 |
| Roster | Suit Profile、状态、根因归属、保守分、策略版本与路由理由 |

模型之间的比较必须先冻结任务、验收、权限与预算；一项任务只能证明流程跑通，不能证明某个模型普遍更强。模型自评不进入分数，Planner 缺陷不能扣给 Executor，Oracle 或 Environment 故障也不能作为模型淘汰依据。

## 6. 未决决策

以下问题不会阻塞 README，但必须在对应阶段开始前解决：

### P0 前解决

- Mission schema 的必需字段与状态转换格式。
- Green / Amber / Red 的精确定义。
- 首个 `examples/missions/` 公开案例采用哪种脱敏、复现与哈希策略。
- 跨供应商可发送的数据等级与秘密扫描方式。
- 首个开源许可证。
- Suit Profile 和任务家族 taxonomy 的粒度，避免过细后没有足够样本。

### P1 前解决

- 校验器采用的实现语言和命令行接口。
- Reviewer 无历史隔离方式及首轮输入白名单。
- 测试证据保存原始输出还是摘要加哈希。

### P3 前解决

- A/B 的具体任务集合和统计门槛。
- DeepSeek 可访问的仓库范围、许可证与隐私条件。

### P5 前解决

- 各角色质量硬门槛、role baseline 和根因争议裁决方式。
- EWMA、晋退样本量、探索比例和“显著改善”的初始配置。
- Armor Registry 与 Performance Ledger 中哪些字段可以公开。

### 对外发布前解决

- 是否加入“非官方致敬”声明，避免 JARVIS、STARK 等名称造成品牌混淆。
- 是否保留项目名称，或只将钢铁侠术语用于内部协议代号。

## 7. 当前阶段的非目标

- 不建造通用多 Agent 平台或复杂 UI。
- 不默认启动大量 Agent、无限讨论或多数投票。
- 不在共享工作区安排多个 Writer 修改重叠文件。
- 不让 Agent 自主执行生产发布、不可逆操作或外部通信。
- 不用模型多样性代替测试、权限、回滚和证据。
- 不从一次 Demo 宣称某家模型普遍优于另一家。
- 不直接照搬大型第三方 Skill，也不立即污染所有项目的全局配置。
- 不发布私人聊天、真实 Mission、秘密、原始模型输出或未经整理的证据堆。
- 不用一个全局模型总分抹掉它在不同岗位、任务家族和版本上的差异。

## 8. 当前下一步

按顺序推进，不同时引入多个实验变量：

1. 完成 P0 中的风险分级、Mission schema 和本地 Skill；
2. 冻结 Mission 001 的 Brief 与 Acceptance；
3. 启动 P1 GPT-only Demo；
4. 复盘至少三个 Mission 后，再进入 DeepSeek A/B；
5. 只有 Veronica 条件真实触发时，才启动 Kimi 规划实验；
6. P1–P4 数据充分后先用 Routing Shadow 校准动态权重；
7. 通过干净 clone 验证后，再发布 GitHub `v0.1.0`。
