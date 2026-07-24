import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = "deepseek/deepseek-v4-pro";
const MAX_TASK_BYTES = 96 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const SKIPPED_SCAN_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "vendor",
  "dist",
  "build",
]);
const SENSITIVE_FILENAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
]);

function workerBinary() {
  const configured = process.env.DEEPSEEK_OPENCODE_BIN;
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error(
        "CONFIG_INVALID: DEEPSEEK_OPENCODE_BIN must be an absolute path.",
      );
    }
    return path.normalize(configured);
  }
  if (process.platform !== "win32") {
    throw new Error(
      "CONFIG_MISSING: install OpenCode and set DEEPSEEK_OPENCODE_BIN to its absolute path.",
    );
  }
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "deepseek-worker",
    "node_modules",
    "opencode-windows-x64",
    "bin",
    "opencode.exe",
  );
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function validateRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("INVALID_INPUT: workspace_root must be an absolute path.");
  }
  const resolved = await fs.realpath(value);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error("INVALID_INPUT: workspace_root must be a directory.");
  }
  const allowedRoots = (process.env.DEEPSEEK_ALLOWED_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowedRoots.length === 0) {
    throw new Error(
      "CONFIG_MISSING: DEEPSEEK_ALLOWED_ROOTS must explicitly authorize at least one project root.",
    );
  }
  const normalizedAllowedRoots = await Promise.all(
    allowedRoots.map((entry) => fs.realpath(entry)),
  );
  if (!normalizedAllowedRoots.some((allowed) => isInside(allowed, resolved))) {
    throw new Error(
      "WORKSPACE_DENIED: workspace_root is outside DEEPSEEK_ALLOWED_ROOTS.",
    );
  }
  await validateWorkspaceLayout(resolved);
  return resolved;
}

async function pathExists(candidate) {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function validateWorkspaceLayout(root) {
  const managedConfigRoot = process.env.ProgramData
    ? path.join(process.env.ProgramData, "opencode")
    : undefined;
  if (managedConfigRoot && (await pathExists(managedConfigRoot))) {
    throw new Error(
      "WORKSPACE_DENIED: a managed OpenCode configuration is present and may override Worker isolation.",
    );
  }
  if (!(await pathExists(path.join(root, ".git")))) {
    throw new Error(
      "WORKSPACE_DENIED: DeepSeek Worker requires a Git repository or worktree root.",
    );
  }
  for (const forbidden of ["opencode.json", "opencode.jsonc", ".opencode"]) {
    if (await pathExists(path.join(root, forbidden))) {
      throw new Error(
        `WORKSPACE_DENIED: ${forbidden} can alter the isolated OpenCode runtime.`,
      );
    }
  }

  const stack = [root];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      visited += 1;
      if (visited > 50_000) {
        throw new Error(
          "WORKSPACE_DENIED: sensitive-file scan exceeded its bounded size.",
        );
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_SCAN_DIRECTORIES.has(entry.name)) {
          stack.push(path.join(current, entry.name));
        }
        continue;
      }
      const lowerName = entry.name.toLowerCase();
      const isSensitive =
        SENSITIVE_FILENAMES.has(lowerName) ||
        (lowerName.startsWith(".env.") &&
          lowerName !== ".env.example" &&
          lowerName !== ".env.sample") ||
        lowerName.endsWith(".pem") ||
        lowerName.endsWith(".key");
      if (isSensitive) {
        throw new Error(
          `WORKSPACE_DENIED: remove sensitive file ${path.relative(root, path.join(current, entry.name))} from the DeepSeek worktree.`,
        );
      }
    }
  }
}

function validateTask(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("INVALID_INPUT: task must be a non-empty string.");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_TASK_BYTES) {
    throw new Error("INVALID_INPUT: task exceeds the byte limit.");
  }
  return value;
}

function validateEffort(value) {
  const effort = value ?? "high";
  if (effort !== "high" && effort !== "max") {
    throw new Error("INVALID_INPUT: reasoning_effort must be high or max.");
  }
  return effort;
}

function validateTimeout(value) {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 30_000 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      "INVALID_INPUT: timeout_ms must be between 30000 and 900000.",
    );
  }
  return timeout;
}

function strictConfig() {
  const permission = {
    "*": "deny",
    read: {
      "*": "allow",
      "**/.git/**": "deny",
      "**/.env": "deny",
      "**/.env.*": "deny",
      "**/*.pem": "deny",
      "**/*.key": "deny",
      "**/.npmrc": "deny",
      "**/.pypirc": "deny",
      "**/credentials.json": "deny",
    },
    edit: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    todowrite: "allow",
    external_directory: "deny",
    bash: "deny",
    task: "deny",
    webfetch: "deny",
    websearch: "deny",
    skill: "deny",
    question: "deny",
    lsp: "deny",
    doom_loop: "deny",
  };
  return JSON.stringify({
    model: MODEL,
    small_model: MODEL,
    default_agent: "deepseek_worker",
    subagent_depth: 0,
    enabled_providers: ["deepseek"],
    share: "disabled",
    autoupdate: false,
    plugin: [],
    mcp: {},
    permission,
    agent: {
      deepseek_worker: {
        description: "Workspace-constrained DeepSeek implementation worker.",
        mode: "primary",
        model: MODEL,
        steps: 30,
        prompt:
          "Implement only the assigned task. Use workspace file tools only. Never use a terminal, network, external directory, or subagent. Stop and report an exact blocker if the allowed tools are insufficient.",
        permission,
      },
    },
  });
}

function childEnvironment(apiKey, runtimeRoot) {
  const environment = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    all_proxy: process.env.all_proxy,
    no_proxy: process.env.no_proxy,
    DEEPSEEK_API_KEY: apiKey,
    OPENCODE_CONFIG_CONTENT: strictConfig(),
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_AUTO_SHARE: "false",
    XDG_DATA_HOME: path.join(runtimeRoot, "data"),
    XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
    XDG_CACHE_HOME: path.join(runtimeRoot, "cache"),
    XDG_STATE_HOME: path.join(runtimeRoot, "state"),
  };
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}

function terminateProcessTree(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    const taskkill = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const killer = spawn(
      taskkill,
      ["/pid", String(child.pid), "/t", "/f"],
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    killer.unref();
  }
  child.kill();
}

function executionPrompt(task) {
  return [
    "You are the sole implementation worker for this bounded task.",
    "Inspect and edit only the supplied workspace. Follow existing project instructions.",
    "Do not use terminal commands, network access, external directories, or subagents.",
    "Implement the task directly with file tools. Do not silently expand scope.",
    "If the task cannot be completed with the allowed tools, stop and state the exact blocker.",
    "Finish with a concise summary of files changed and any checks the Chair should run.",
    "",
    "Task:",
    task,
  ].join("\n");
}

function parseEvents(stdout, workspaceRoot) {
  const events = [];
  let sessionId;
  const textParts = [];
  const changedFiles = new Set();
  const toolCalls = [];
  let cost = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    events.push(event);
    sessionId ??= event.sessionID;
    if (event.type === "text" && typeof event.part?.text === "string") {
      textParts.push(event.part.text);
    }
    if (event.type === "step_finish" && Number.isFinite(event.part?.cost)) {
      cost += event.part.cost;
    }
    if (event.type === "tool_use") {
      const state = event.part?.state;
      toolCalls.push({
        tool: event.part?.tool,
        status: state?.status,
        title: state?.title,
      });
      const changed = state?.metadata?.filediff?.file;
      if (typeof changed === "string") {
        const resolved = path.resolve(workspaceRoot, changed);
        if (!isInside(workspaceRoot, resolved)) {
          throw new Error(
            "SECURITY_BOUNDARY: worker reported a change outside workspace_root.",
          );
        }
        changedFiles.add(resolved);
      }
    }
  }

  return {
    session_id: sessionId,
    summary: textParts.join("\n").trim() || "DeepSeek Worker completed.",
    changed_files: [...changedFiles],
    tool_calls: toolCalls,
    estimated_cost_usd: Number(cost.toFixed(8)),
    event_count: events.length,
  };
}

export async function normalizeWorkerRequest(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("INVALID_INPUT: worker arguments must be an object.");
  }
  const allowed = new Set([
    "workspace_root",
    "task",
    "reasoning_effort",
    "timeout_ms",
  ]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw new Error("INVALID_INPUT: worker arguments contain unsupported fields.");
    }
  }
  return {
    workspaceRoot: await validateRoot(args.workspace_root),
    task: validateTask(args.task),
    reasoningEffort: validateEffort(args.reasoning_effort),
    timeoutMs: validateTimeout(args.timeout_ms),
  };
}

export function rootsAreIndependent(roots) {
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (isInside(roots[left], roots[right]) || isInside(roots[right], roots[left])) {
        return false;
      }
    }
  }
  return true;
}

export async function runWorker(request, options = {}) {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error(
      "CONFIG_MISSING: DEEPSEEK_API_KEY is unavailable. Set it locally and restart Codex.",
    );
  }
  const binary = options.binary ?? workerBinary();
  const argsPrefix = options.argsPrefix ?? [];
  await fs.access(binary);
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepseek-worker-"));
  const controller = options.controller;

  try {
    const args = [
      ...argsPrefix,
      "run",
      "--pure",
      "--auto",
      "--dir",
      request.workspaceRoot,
      "--model",
      MODEL,
      "--variant",
      request.reasoningEffort,
      "--agent",
      "deepseek_worker",
      "--format",
      "json",
      executionPrompt(request.task),
    ];

    const output = await new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd: request.workspaceRoot,
        env: childEnvironment(apiKey, runtimeRoot),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let forcedError;
      const stop = (error) => {
        forcedError ??= error;
        terminateProcessTree(child);
      };
      const timer = setTimeout(() => {
        stop(new Error("UPSTREAM_TIMEOUT: DeepSeek Worker timed out."));
      }, request.timeoutMs);
      const onAbort = () =>
        stop(new Error("CANCELLED: DeepSeek Worker was cancelled."));
      controller?.signal.addEventListener("abort", onAbort, { once: true });

      const collect = (current, chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          stop(new Error("BAD_RESPONSE: worker output exceeded the size limit."));
          return current;
        }
        return current + chunk.toString("utf8");
      };
      child.stdout.on("data", (chunk) => {
        stdout = collect(stdout, chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = collect(stderr, chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        controller?.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        controller?.signal.removeEventListener("abort", onAbort);
        if (forcedError) {
          reject(forcedError);
          return;
        }
        if (code !== 0) {
          const safe = stderr.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]");
          reject(
            new Error(
              `WORKER_FAILED: OpenCode exited with code ${code}. ${safe.slice(0, 500)}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });
    return parseEvents(output, request.workspaceRoot);
  } finally {
    await fs.rm(runtimeRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
