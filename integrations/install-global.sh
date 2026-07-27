#!/usr/bin/env bash

set -euo pipefail

readonly MIN_NODE_MAJOR=18
readonly MIN_OPENCODE_VERSION="1.14.24"

usage() {
  cat <<'EOF'
用法：
  ./integrations/install-global.sh --allowed-root <可信代码根> [选项]

必需参数：
  --allowed-root PATH       DeepSeek Worker 可访问的可信代码根；可重复传入

可选参数：
  --node-bin PATH           Node.js 可执行文件；默认从 PATH 查找
  --opencode-bin PATH       OpenCode 可执行文件；默认从 PATH 查找
  --codex-home PATH         Codex 全局目录；默认 $CODEX_HOME 或 ~/.codex
  --api-key-file PATH       密钥环境文件；默认 ~/.config/deepseek/env
  --skip-tests              跳过不联网的模拟测试
  -h, --help                显示帮助

密钥来源：
  1. 若 --api-key-file 已存在，脚本复用并收紧为 600 权限；
  2. 否则使用当前环境中的 DEEPSEEK_API_KEY；
  3. 交互式终端中仍未提供时，脚本会静默提示输入。

脚本不会调用真实 DeepSeek API，也不会打印密钥。
EOF
}

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || fail "$option 缺少参数。"
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_root="$(cd -- "$script_dir/.." && pwd -P)"
solid_vibe_skill_source="$source_root/skill/solid-vibe-coding"
experiment_skill_source="$source_root/skill/experiment-management"
legacy_skill_source="$source_root/skill/multi-subagents"

codex_home="${CODEX_HOME:-${HOME:?HOME 未设置}/.codex}"
api_key_file="${XDG_CONFIG_HOME:-${HOME:?HOME 未设置}/.config}/deepseek/env"
node_bin=""
opencode_bin=""
skip_tests=false
allowed_roots=()

while (($# > 0)); do
  case "$1" in
    --allowed-root)
      require_value "$1" "${2:-}"
      allowed_roots+=("$2")
      shift 2
      ;;
    --allowed-root=*)
      allowed_roots+=("${1#*=}")
      shift
      ;;
    --node-bin)
      require_value "$1" "${2:-}"
      node_bin="$2"
      shift 2
      ;;
    --node-bin=*)
      node_bin="${1#*=}"
      shift
      ;;
    --opencode-bin)
      require_value "$1" "${2:-}"
      opencode_bin="$2"
      shift 2
      ;;
    --opencode-bin=*)
      opencode_bin="${1#*=}"
      shift
      ;;
    --codex-home)
      require_value "$1" "${2:-}"
      codex_home="$2"
      shift 2
      ;;
    --codex-home=*)
      codex_home="${1#*=}"
      shift
      ;;
    --api-key-file)
      require_value "$1" "${2:-}"
      api_key_file="$2"
      shift 2
      ;;
    --api-key-file=*)
      api_key_file="${1#*=}"
      shift
      ;;
    --skip-tests)
      skip_tests=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "未知参数：$1"
      ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || fail "该脚本当前仅支持 Linux。"
((${#allowed_roots[@]} > 0)) || fail "至少需要一个 --allowed-root。"
command -v python3 >/dev/null 2>&1 || fail "需要 Python 3（用于安全更新 TOML）。"

if [[ -z "$node_bin" ]]; then
  node_bin="$(command -v node || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || fail "找不到可执行的 Node.js；请使用 --node-bin 指定。"
node_bin="$(readlink -f -- "$node_bin")"
node_major="$("$node_bin" -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" =~ ^[0-9]+$ ]] || fail "无法识别 Node.js 版本。"
((node_major >= MIN_NODE_MAJOR)) || fail "Node.js 至少需要 v$MIN_NODE_MAJOR。"

if [[ -z "$opencode_bin" ]]; then
  opencode_bin="$(command -v opencode || true)"
fi
[[ -n "$opencode_bin" && -x "$opencode_bin" ]] || {
  fail "找不到 OpenCode。请先按官方方式安装，再用 --opencode-bin 指定绝对路径。"
}
opencode_bin="$(readlink -f -- "$opencode_bin")"
opencode_version="$("$opencode_bin" --version 2>/dev/null | sed -nE 's/.*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -n 1)"
[[ -n "$opencode_version" ]] || fail "无法识别 OpenCode 版本。"
lowest_version="$(printf '%s\n%s\n' "$MIN_OPENCODE_VERSION" "$opencode_version" | sort -V | head -n 1)"
[[ "$lowest_version" == "$MIN_OPENCODE_VERSION" ]] || {
  fail "OpenCode $opencode_version 过旧，至少需要 $MIN_OPENCODE_VERSION。"
}

normalized_roots=()
for root in "${allowed_roots[@]}"; do
  [[ -d "$root" ]] || fail "allowed root 不存在或不是目录：$root"
  normalized_roots+=("$(readlink -f -- "$root")")
done
IFS=:
allowed_roots_value="${normalized_roots[*]}"
unset IFS

codex_home="$(readlink -m -- "$codex_home")"
api_key_file="$(readlink -m -- "$api_key_file")"
mkdir -p -- "$(dirname -- "$api_key_file")"

if [[ ! -f "$api_key_file" ]]; then
  api_key="${DEEPSEEK_API_KEY:-}"
  if [[ -z "$api_key" && -t 0 ]]; then
    read -r -s -p "请输入 DEEPSEEK_API_KEY：" api_key
    printf '\n'
  fi
  [[ -n "$api_key" ]] || {
    fail "密钥文件不存在，且环境中没有 DEEPSEEK_API_KEY。"
  }
  (
    umask 077
    printf 'DEEPSEEK_API_KEY=%q\n' "$api_key" >"$api_key_file"
  )
  unset api_key
  printf '已创建密钥文件：%s\n' "$api_key_file"
fi

[[ -f "$api_key_file" ]] || fail "密钥路径不是普通文件：$api_key_file"
chmod 600 -- "$api_key_file"
bash -n -- "$api_key_file" || fail "密钥环境文件不是合法的 Bash 语法。"
grep -Eq '^[[:space:]]*(export[[:space:]]+)?DEEPSEEK_API_KEY=' "$api_key_file" || {
  fail "密钥环境文件中未找到 DEEPSEEK_API_KEY 赋值。"
}

preflight_link() {
  local link_path="$1"
  local target_path="$2"
  local resolved_target
  local existing_target

  resolved_target="$(readlink -f -- "$target_path")"
  [[ -n "$resolved_target" ]] || fail "链接目标不存在：$target_path"

  if [[ -L "$link_path" ]]; then
    existing_target="$(readlink -f -- "$link_path" 2>/dev/null || true)"
    if [[ "$existing_target" == "$resolved_target" ]]; then
      return
    fi
    fail "拒绝覆盖指向其他位置的软链接：$link_path"
  fi

  if [[ -e "$link_path" || -L "$link_path" ]]; then
    fail "拒绝覆盖已有路径：$link_path"
  fi
}

install_link() {
  local link_path="$1"
  local target_path="$2"
  local resolved_target

  preflight_link "$link_path" "$target_path"
  resolved_target="$(readlink -f -- "$target_path")"
  if [[ -L "$link_path" ]]; then
    printf '软链接已正确：%s -> %s\n' "$link_path" "$resolved_target"
    return
  fi

  mkdir -p -- "$(dirname -- "$link_path")"
  ln -s -- "$resolved_target" "$link_path"
  printf '已创建软链接：%s -> %s\n' "$link_path" "$resolved_target"
}

preflight_legacy_skill_link() {
  local link_path="$1"
  local expected_target="$2"
  local raw_target
  local normalized_target

  if [[ ! -e "$link_path" && ! -L "$link_path" ]]; then
    return
  fi
  [[ -L "$link_path" ]] || fail "旧 Skill 路径不是软链接，拒绝删除：$link_path"

  raw_target="$(readlink -- "$link_path")"
  if [[ "$raw_target" == /* ]]; then
    normalized_target="$(readlink -m -- "$raw_target")"
  else
    normalized_target="$(readlink -m -- "$(dirname -- "$link_path")/$raw_target")"
  fi

  [[ "$normalized_target" == "$(readlink -m -- "$expected_target")" ]] || {
    fail "旧 Skill 软链接指向其他位置，拒绝删除：$link_path"
  }
}

remove_legacy_skill_link() {
  local link_path="$1"
  local expected_target="$2"

  preflight_legacy_skill_link "$link_path" "$expected_target"
  if [[ ! -L "$link_path" ]]; then
    return
  fi
  unlink -- "$link_path"
  printf '已移除旧 Skill 软链接：%s\n' "$link_path"
}

integration_link="$codex_home/integrations/deepseek"
solid_vibe_skill_link="$codex_home/skills/solid-vibe-coding"
experiment_skill_link="$codex_home/skills/experiment-management"
legacy_skill_link="$codex_home/skills/multi-subagents"

preflight_link "$integration_link" "$script_dir"
preflight_legacy_skill_link "$legacy_skill_link" "$legacy_skill_source"
preflight_link "$solid_vibe_skill_link" "$solid_vibe_skill_source"
preflight_link "$experiment_skill_link" "$experiment_skill_source"

install_link "$integration_link" "$script_dir"
install_link "$solid_vibe_skill_link" "$solid_vibe_skill_source"
install_link "$experiment_skill_link" "$experiment_skill_source"
preflight_link "$solid_vibe_skill_link" "$solid_vibe_skill_source"
preflight_link "$experiment_skill_link" "$experiment_skill_source"
remove_legacy_skill_link "$legacy_skill_link" "$legacy_skill_source"

config_path="$codex_home/config.toml"
server_path="$integration_link/deepseek-mcp/server.mjs"
mkdir -p -- "$codex_home"

INSTALL_CONFIG_PATH="$config_path" \
INSTALL_NODE_BIN="$node_bin" \
INSTALL_SERVER_PATH="$server_path" \
INSTALL_KEY_FILE="$api_key_file" \
INSTALL_ALLOWED_ROOTS="$allowed_roots_value" \
INSTALL_OPENCODE_BIN="$opencode_bin" \
python3 - <<'PY'
import datetime
import json
import os
import pathlib
import re
import shlex
import shutil
import tempfile
try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None

config_path = pathlib.Path(os.environ["INSTALL_CONFIG_PATH"])
node_bin = os.environ["INSTALL_NODE_BIN"]
server_path = os.environ["INSTALL_SERVER_PATH"]
key_file = os.environ["INSTALL_KEY_FILE"]
allowed_roots = os.environ["INSTALL_ALLOWED_ROOTS"]
opencode_bin = os.environ["INSTALL_OPENCODE_BIN"]

text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
text = re.sub(
    r"(?ms)^# BEGIN use-subagents deepseek\n.*?^# END use-subagents deepseek\n?",
    "",
    text,
)
for section in ("mcp_servers.deepseek", "mcp_servers.deepseek.env"):
    text = re.sub(
        rf"(?ms)^\[{re.escape(section)}\][^\n]*(?:\n|\Z).*?(?=^\[|\Z)",
        "",
        text,
    )

launch = (
    "set -a; source "
    + shlex.quote(key_file)
    + "; set +a; exec "
    + shlex.quote(node_bin)
    + " "
    + shlex.quote(server_path)
)

quote = lambda value: json.dumps(value, ensure_ascii=False)
block = "\n".join(
    [
        "# BEGIN use-subagents deepseek",
        "[mcp_servers.deepseek]",
        'command = "/bin/bash"',
        f"args = [{quote('-lc')}, {quote(launch)}]",
        'env_vars = ["DEEPSEEK_API_KEY"]',
        'enabled_tools = ["ask_deepseek", "run_deepseek_worker", "run_deepseek_workers"]',
        "tool_timeout_sec = 14400",
        'default_tools_approval_mode = "approve"',
        "",
        "[mcp_servers.deepseek.env]",
        f"DEEPSEEK_ALLOWED_ROOTS = {quote(allowed_roots)}",
        f"DEEPSEEK_OPENCODE_BIN = {quote(opencode_bin)}",
        "# END use-subagents deepseek",
    ]
)

updated = text.rstrip()
if updated:
    updated += "\n\n"
updated += block + "\n"
if tomllib is not None:
    tomllib.loads(updated)

config_path.parent.mkdir(parents=True, exist_ok=True)
if config_path.exists():
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = config_path.with_name(config_path.name + f".bak-{stamp}")
    shutil.copy2(config_path, backup)
    print(f"已备份 Codex 配置：{backup}")

fd, temporary_name = tempfile.mkstemp(
    prefix=f".{config_path.name}.",
    dir=config_path.parent,
    text=True,
)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(updated)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary_name, 0o600)
    os.replace(temporary_name, config_path)
finally:
    if os.path.exists(temporary_name):
        os.unlink(temporary_name)

print(f"已更新 Codex 配置：{config_path}")
PY

if [[ "$skip_tests" == false ]]; then
  printf '正在运行不联网的模拟测试……\n'
  "$node_bin" "$script_dir/deepseek-mcp/test.mjs"
fi

cat <<EOF

Linux 全局安装完成。

  DeepSeek MCP：$integration_link
  Solid Vibe Coding Skill：$solid_vibe_skill_link
  Experiment Management Skill：$experiment_skill_link
  Codex 配置：$config_path
  密钥文件：$api_key_file
  OpenCode：$opencode_bin ($opencode_version)
  Allowed roots：$allowed_roots_value

请完全重启 Codex，使新的 MCP 配置和工具 schema 生效。
EOF
