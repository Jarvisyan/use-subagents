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
