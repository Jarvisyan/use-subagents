# DeepSeek 执行桥接

该桥接让 Codex 中的 GPT Chair 可以调用 DeepSeek V4 Pro 完成实际文件修改，而不只是获取文本建议。

## 结构

```text
GPT Chair
|-- ask_deepseek
|   `-- 规划或审查意见；不访问文件
|-- run_deepseek_worker
|   `-- 一个 DeepSeek Worker 修改一个工作区
`-- run_deepseek_workers
    `-- 2-3 个 DeepSeek Worker 并行修改互不重叠的 worktree
```

DeepSeek 官方支持把 V4 Pro 接入 OpenCode 等 coding agent。本项目固定使用 OpenCode `1.18.4` 作为工具循环运行时，并通过环境变量传入 `DEEPSEEK_API_KEY`。

`ask_deepseek` 的普通 `high` 调用默认允许 8K 输出，`max` 调用默认允许 32K；调用者可以显式提高到 DeepSeek V4 Pro 官方的 384K 上限。桥接会返回 `finish_reason` 和 `truncated`，避免长度耗尽时把半截回答误认为完整结果。

调用方必须把截断响应视为不完整证据，并从头按 `8K -> 32K -> 128K` 提高预算重试；若仍然截断，应拆分任务或请求用户裁决，不能直接使用部分输出作出结论。

## 安全边界

Worker 只允许 `read/edit/glob/grep/list` 等工作区文件工具，并明确禁止：

- 终端命令；
- 网络访问；
- 工作区外目录；
- MCP、插件和递归 subagent；
- 自动分享会话。

此外，Worker 只接受 `DEEPSEEK_ALLOWED_ROOTS` 预先允许范围内的 Git 仓库或 worktree 根目录。工作区若包含 OpenCode 项目配置或常见密钥文件（如 `.env`、PEM、私钥），桥接会拒绝启动。

同一或重叠工作区不能并行运行多个 Writer。需要并行时，Chair 必须先准备独立 Git worktree；任一并行 Worker 失败时，整组 Worker 会先被终止并完成清理，再释放目录锁。

## 安装与验证

创建 Codex 全局目录联接：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\integrations\install-global.ps1
```

该脚本让 `~/.codex/integrations/deepseek` 指向项目中的 `integrations/`，并让全局 `multi-subagents` Skill 指向项目 Skill 源码。此后只维护项目中的一份文件。

Windows 默认使用锁定的 `opencode-windows-x64`。Linux/macOS 不需要本项目提供安装包：使用者自行安装 OpenCode，并把 `DEEPSEEK_OPENCODE_BIN` 设置为其可执行文件的绝对路径；Worker 会优先使用该路径。

源码级验证：

```powershell
npm.cmd install --prefix integrations\deepseek-worker --cache .tmp\npm-cache --ignore-scripts
node integrations\deepseek-mcp\test.mjs
node integrations\deepseek-mcp\live-test.mjs .tmp\deepseek-live
node integrations\deepseek-mcp\pool-live-test.mjs .tmp\deepseek-pool-a .tmp\deepseek-pool-b
```

普通测试使用模拟 Provider，不产生 API 费用。两个 live test 使用合成目录调用真实 DeepSeek API。

参考：

- [DeepSeek coding-agent 集成指南](https://api-docs.deepseek.com/guides/coding_agents/)
- [DeepSeek V4 Pro API 参数](https://api-docs.deepseek.com/)
- [OpenCode 权限模型](https://opencode.ai/docs/permissions/)
