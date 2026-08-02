#!/usr/bin/env bash

set -euo pipefail

readonly MIN_NODE_MAJOR=18

usage() {
  cat <<'EOF'
用法：
  ./integrations/install-deepseek-hybrid.sh [选项]

选项：
  --codex-home PATH       Codex 配置目录；默认 $CODEX_HOME 或 ~/.codex
  --node-bin PATH         Node.js 可执行文件；默认从 PATH 查找
  --allowed-root PATH      允许 sidecar 只读访问的根目录；默认当前目录
  --api-key-file PATH     DeepSeek 密钥文件；默认 ~/.config/deepseek/env
  --skip-tests            跳过离线测试
  --live-test             安装后执行一次最小真实 API 测试（会产生少量费用）
  -h, --help              显示帮助

密钥优先级：
  1. 复用已有 --api-key-file；
  2. 使用当前环境中的 DEEPSEEK_API_KEY 创建密钥文件；
  3. 交互式终端静默提示输入。

脚本只注册 ask_deepseek。它不会修改 Codex 的主模型，也不会打印密钥。
DeepSeek 通过官方 Codex sidecar 配置运行，默认推理强度为 max。
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
server_path="$script_dir/deepseek-mcp/server.mjs"
models_path="$script_dir/deepseek-codex/models.json"
test_path="$script_dir/deepseek-mcp/test.mjs"
config_test_path="$script_dir/deepseek-mcp/test-configure.mjs"
live_test_path="$script_dir/deepseek-mcp/live-test.mjs"
configure_path="$script_dir/configure-deepseek-mcp.mjs"
codex_home="${CODEX_HOME:-${HOME:?HOME 未设置}/.codex}"
api_key_file="${XDG_CONFIG_HOME:-${HOME:?HOME 未设置}/.config}/deepseek/env"
allowed_root=""
node_bin=""
codex_bin=""
skip_tests=false
live_test=false

while (($# > 0)); do
  case "$1" in
    --codex-home)
      require_value "$1" "${2:-}"
      codex_home="$2"
      shift 2
      ;;
    --codex-home=*)
      codex_home="${1#*=}"
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
    --allowed-root)
      require_value "$1" "${2:-}"
      allowed_root="$2"
      shift 2
      ;;
    --allowed-root=*)
      allowed_root="${1#*=}"
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
    --live-test)
      live_test=true
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

[[ "$(uname -s)" == "Linux" ]] || fail "此脚本面向 Linux；Windows 请运行 install-deepseek-hybrid.ps1。"

if [[ -z "$node_bin" ]]; then
  node_bin="$(command -v node || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || fail "找不到可执行的 Node.js。"
node_bin="$(readlink -f -- "$node_bin")"
node_major="$($node_bin -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" =~ ^[0-9]+$ ]] || fail "无法识别 Node.js 版本。"
((node_major >= MIN_NODE_MAJOR)) || fail "Node.js 至少需要 v$MIN_NODE_MAJOR。"

codex_bin="$(command -v codex || true)"
[[ -n "$codex_bin" && -x "$codex_bin" ]] || fail "找不到可执行的 codex；方案 4 需要 Codex CLI 作为 DeepSeek sidecar。"
codex_bin="$(readlink -f -- "$codex_bin")"

for required_file in "$server_path" "$models_path" "$test_path" "$config_test_path" "$live_test_path" "$configure_path"; do
  [[ -f "$required_file" ]] || fail "缺少安装文件：$required_file"
done

codex_home="$(readlink -m -- "$codex_home")"
api_key_file="$(readlink -m -- "$api_key_file")"
if [[ -z "$allowed_root" ]]; then
  allowed_root="$(pwd -P)"
fi
allowed_root="$(readlink -m -- "$allowed_root")"
[[ -d "$allowed_root" ]] || fail "允许工作区根目录不存在：$allowed_root"
mkdir -p -- "$(dirname -- "$api_key_file")"

if [[ ! -f "$api_key_file" ]]; then
  api_key="${DEEPSEEK_API_KEY:-}"
  if [[ -z "$api_key" && -t 0 ]]; then
    read -r -s -p "请输入 DEEPSEEK_API_KEY：" api_key
    printf '\n'
  fi
  [[ "$api_key" =~ ^sk-[A-Za-z0-9_-]+$ ]] || {
    fail "密钥文件不存在，且未获得格式有效的 DEEPSEEK_API_KEY。"
  }
  (
    umask 077
    printf 'DEEPSEEK_API_KEY=%s\n' "$api_key" >"$api_key_file"
  )
  unset api_key
  printf '已创建密钥文件：%s\n' "$api_key_file"
fi

[[ -f "$api_key_file" ]] || fail "密钥路径不是普通文件：$api_key_file"
chmod 600 -- "$api_key_file"

if [[ "$skip_tests" == false ]]; then
  printf '正在运行离线 MCP 测试……\n'
  "$node_bin" "$test_path"
  printf '正在运行离线配置迁移测试……\n'
  "$node_bin" "$config_test_path"
fi

config_path="$codex_home/config.toml"
sidecar_home="$codex_home/deepseek-sidecar"
mkdir -p -- "$codex_home"
"$node_bin" "$configure_path" \
  --config "$config_path" \
  --node "$node_bin" \
  --server "$server_path" \
  --key-file "$api_key_file" \
  --sidecar-home "$sidecar_home" \
  --models "$models_path" \
  --codex-bin "$codex_bin" \
  --allowed-root "$allowed_root"

printf '正在让 Codex 解析并检查 MCP 配置……\n'
CODEX_HOME="$codex_home" "$codex_bin" mcp get deepseek

if [[ "$live_test" == true ]]; then
  printf '正在执行最小真实 DeepSeek Codex sidecar 测试（max 推理）……\n'
  DEEPSEEK_API_KEY_FILE="$api_key_file" \
    DEEPSEEK_CODEX_HOME="$sidecar_home" \
    DEEPSEEK_CODEX_BIN="$codex_bin" \
    DEEPSEEK_ALLOWED_ROOTS="$allowed_root" \
    "$node_bin" "$live_test_path"
fi

cat <<EOF

DeepSeek 混合接入安装完成。

  主模型：保持现有 Codex/GPT 配置不变
  MCP 工具：ask_deepseek
  DeepSeek 模型：deepseek-v4-flash
  运行方式：官方 DeepSeek Codex Responses API sidecar
  默认推理强度：max
  Codex 配置：$config_path
  sidecar 配置：$sidecar_home
  密钥文件：$api_key_file

请完全重启 Codex。在新会话中要求主模型调用 ask_deepseek，即可进行 GPT–DeepSeek 对抗审查。
EOF
