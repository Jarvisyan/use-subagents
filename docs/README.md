# JARVIS 文档地图

本目录通过“一个事实、一个权威来源”支撑项目推进。README 负责入口，Architecture 负责当前系统逻辑，Plan 负责当前位置；历史提案保留追溯价值，但不再与当前规范竞争。

## 阅读路径

```text
../README.md
└── 为什么做、准备怎样解决、现在到哪
    ├── ARCHITECTURE.md
    │   └── 总体机制、模块依赖、技术边界与架构未决项
    └── PLAN.md
        └── 当前阶段、里程碑、退出条件与下一步
            └── 当前里程碑设计文档（进入 Demo 设计后才创建）
```

## 权威文档

| 文档 | Authority | Maturity | 唯一职责 | 何时更新 |
|---|---|---|---|---|
| [`../README.md`](../README.md) | Active | Confirmed + Open | 面向新读者说明项目问题、答案、原理、当前位置和阅读入口 | 项目定位、公开能力或使用入口变化时 |
| [`../AGENTS.md`](../AGENTS.md) | Active | Confirmed | 约束主 Agent的叙事组织、决定成熟度和文档维护行为 | 项目协作或文档治理规则变化时 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Active | Confirmed + Open | 记录已确认的总体机制、模块关系、技术边界，以及明确标注的未决项 | high-level 架构决定被接受或替代时 |
| [`PLAN.md`](PLAN.md) | Active | Confirmed + Proposed | 维护唯一的当前阶段，并明确区分已确认步骤与候选路线 | 阶段推进、阻塞或下一步变化时 |

当前没有活动 Demo 设计文档，因为项目仍在 high-level 架构阶段。等 `PLAN.md` 中的 M0 退出条件满足后，才创建面向 M1 的具体设计。

## 两条状态轴

```text
Authority：Active | Historical
Maturity：Open | Proposed | Confirmed | Verified | Superseded
```

- `Active` 表示当前权威入口，不代表全文都已确认；
- `Historical` 只用于追溯，不驱动当前决定；
- `Proposed` 可以讨论，但不能直接约束实现；
- `Confirmed` 表示已经明确接受；
- `Verified` 必须链接实现、测试或运行证据；
- `Superseded` 保留历史理由，但由继任内容取代。

活动设计在 `docs/designs/` 中从 `Proposed` 开始，获准后转为 `Confirmed`，验证完成后转为 `Verified`；被替代后移入 [`archive/`](archive/)，不静默删除，也不继续当作当前事实维护。

## 维护规则

1. 同一个模型配置、阈值、状态或阶段只能有一个权威来源；
2. 其他文档只写必要摘要并链接，不复制整张表或整套规则；
3. 候选想法必须标为 `Proposed/Open`，不能使用“已经支持”“默认采用”等完成式语言；
4. 架构决定变化时同步 Architecture，阶段变化时同步 Plan，公开状态变化时同步 README；
5. 活动设计完成后保留为实施记录，结果和证据进入测试或示例，不通过改写设计稿来伪造历史。

## 历史提案

[`archive/2026-07-24-initial-design/`](archive/2026-07-24-initial-design/) 保存第一轮详细架构、路线与 Demo 设想。它们帮助后续讨论复用已有思考，但其中的协议名称、模型编制、算法阈值和实现规格都没有自动继承权。

后续只在真实需求出现时增加长期文档：

- `QUICKSTART.md`：第一个可运行版本完成后加入；
- `CONFIGURATION.md`：出现稳定配置格式后加入；
- `examples/`：只保存脱敏、可复现且通过许可检查的公开案例。

原始聊天、真实运行记录、模型完整输出和内部素材不属于公共文档。
