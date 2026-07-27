# DeepSeek 执行桥接

该桥接让 Codex 的主对话模型可以调用 DeepSeek V4 Pro 获取 Challenger 意见或完成实际文件修改。

## 结构

```text
主对话模型
|-- ask_deepseek
|   `-- 规划或审查意见；不访问文件
|-- run_deepseek_worker
|   `-- 一个 DeepSeek Worker 修改一个工作区
`-- run_deepseek_workers
    `-- 2-3 个 DeepSeek Worker 并行修改互不重叠的工作区
```

DeepSeek 官方支持把 V4 Pro 接入 OpenCode 等 coding agent。本项目固定使用 OpenCode `1.18.4` 作为工具循环运行时，并通过环境变量传入 `DEEPSEEK_API_KEY`。

`ask_deepseek` 不传自定义 `max_tokens`，由 provider 使用默认输出预算。`reasoning_effort` 独立控制思考深度。桥接通过 SSE（Server-Sent Events）流式增量读取 `chat/completions` 响应，按空行分隔事件、多 `data:` 行拼接、支持 `: keep-alive` 注释和 `data: [DONE]`，并以 `TextDecoder` 流式模式正确处理 UTF-8 跨 chunk。

桥接会返回 `finish_reason` 和 `truncated`。若 provider 默认预算耗尽，调用方必须把响应视为不完整证据并拆分任务，不能直接使用部分输出作出结论。

### 超时控制

- `DEEPSEEK_REQUEST_TIMEOUT_MS`：硬总时限，默认 14,100,000 ms（3h55m），允许范围 1,000..14,100,000。不重置。
- `DEEPSEEK_IDLE_TIMEOUT_MS`：空闲超时，默认 300,000 ms（5min），允许范围 1,000..600,000。每次收到网络 chunk 重置。
- 用户取消优先报 `CANCELLED`；空闲超时报 `UPSTREAM_IDLE_TIMEOUT: DeepSeek response became idle.`；硬超时报 `UPSTREAM_TIMEOUT: DeepSeek request timed out.`。
- Codex 全局 `config.toml` 中 `tool_timeout_sec` 应设为 `14400`（4h），确保不先于桥接硬超时终止。
- 原始 SSE 流上限为 128 MiB，最终回答正文上限为 16 MiB；思考流只消费、不保留。分离限制可容纳长输出的 SSE/JSON 协议开销，同时约束实际驻留内存。

## 安全边界

Worker 只允许 `read/edit/glob/grep/list` 等工作区文件工具，并明确禁止：

- 终端命令；
- 网络访问；
- 工作区外目录；
- MCP、插件和递归 subagent；
- 自动分享会话。

此外，Worker 只接受 `DEEPSEEK_ALLOWED_ROOTS` 预先允许范围内的 Git 仓库或 worktree 根目录。工作区若包含 OpenCode 项目配置或常见密钥文件（如 `.env`、PEM、私钥），桥接会拒绝启动。

同一或重叠工作区不能并行运行多个 Writer。需要并行时，主对话模型必须提供互不重叠的工作区；任一并行 Worker 失败时，整组 Worker 会先被终止并完成清理，再释放目录锁。

## 安装与验证

Windows 创建 Codex 全局目录联接：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\integrations\install-global.ps1
```

该脚本让 `~/.codex/integrations/deepseek` 指向项目中的 `integrations/`，并让全局 `solid-vibe-coding` 与 `experiment-management` 指向项目 Skill 源码。同名用户目录或指向其他位置的链接不会被覆盖。

Linux 升级会先预检全部新旧路径，安装并验证两套新 Skill，最后才移除精确指向本仓库旧源码的 `multi-subagents` 软链接；任何碰撞都会在旧链接仍保留时失败。Windows 安装器只安全安装两套新 Skill，不自动删除旧 junction；确认新 Skill 可用后，应人工核验并清理旧 junction。

Linux 使用一键配置脚本：

```bash
chmod +x integrations/install-global.sh
./integrations/install-global.sh --allowed-root /path/to/trusted/code
```

Windows 默认使用锁定的 `opencode-windows-x64`。Linux 脚本复用已经安装的 OpenCode，自动配置其绝对路径、全局软链接、密钥文件和 Codex MCP，并运行不联网的模拟测试。

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
