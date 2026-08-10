#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const SERVER_NAME = "deepseek-codex-sidecar";
const SERVER_VERSION = "2.1.0";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_REASONING_EFFORT = "max";
const DEFAULT_TOTAL_TIMEOUT_MS = 14_400_000;
const DEFAULT_IDLE_TIMEOUT_MS = 1_800_000;
const MAX_TOTAL_TIMEOUT_MS = 14_400_000;
const MAX_IDLE_TIMEOUT_MS = 3_600_000;
const MAX_CONCURRENT_REQUESTS = 2;
const MAX_RPC_LINE_BYTES = 4 * 1024 * 1024;
const MAX_HANDOFF_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const ALLOWED_EFFORTS = new Set(["low", "high", "max"]);
// Must match the catalog pinned by configure-deepseek-mcp.mjs. Runtime checks
// prevent a post-install edit of the sidecar catalog from silently changing
// the official instructions or tool metadata.
const OFFICIAL_MODELS_SHA256 =
  "b459a6e438d6a9939d01fd0dbb4693f165ed732bc8e4fd58d7145d9d94bd49a4";

const TOOL = {
  name: "ask_deepseek",
  description:
    "Ask a DeepSeek V4 Flash Codex sidecar to execute the supplied task with full local file access. The sidecar uses the official DeepSeek Codex model catalog with max reasoning by default. Never include secrets.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 100_000,
        description: "The concrete task or bounded question for DeepSeek.",
      },
      context: {
        type: "string",
        maxLength: 500_000,
        description:
          "Optional parent-agent handoff: goals, disputed points, constraints, evidence, and acceptance criteria. Do not paste secrets or an unrelated full repository.",
      },
      reasoning_effort: {
        type: "string",
        enum: [...ALLOWED_EFFORTS],
        default: DEFAULT_REASONING_EFFORT,
      },
      workspace_path: {
        type: "string",
        maxLength: 4096,
        description:
          "Optional working directory for the full-access sidecar. It must be inside DEEPSEEK_ALLOWED_ROOTS; if omitted, the MCP server's configured workspace root or current directory is used.",
      },
    },
  },
  annotations: {
    title: "Ask DeepSeek Codex sidecar",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const activeRequests = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolError(id, message) {
  result(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function parseBoundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `INVALID_CONFIG: ${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function parseKeyFile(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(
      /^(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*?)\s*$/,
    );
    if (!match) {
      continue;
    }
    let value = match[1];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (/^sk-[A-Za-z0-9_-]+$/.test(value)) {
      return value;
    }
    throw new Error(
      "CONFIG_INVALID: the DeepSeek API key file contains an unsupported value.",
    );
  }
  throw new Error(
    "CONFIG_MISSING: DEEPSEEK_API_KEY was not found in the configured key file.",
  );
}

function apiKey() {
  const fromEnvironment = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnvironment) {
    if (!/^sk-[A-Za-z0-9_-]+$/.test(fromEnvironment)) {
      throw new Error(
        "CONFIG_INVALID: DEEPSEEK_API_KEY has an unsupported format.",
      );
    }
    return fromEnvironment;
  }

  const keyFile = process.env.DEEPSEEK_API_KEY_FILE;
  if (!keyFile) {
    throw new Error(
      "CONFIG_MISSING: set DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_FILE.",
    );
  }
  let text;
  try {
    text = fs.readFileSync(keyFile, "utf8");
  } catch {
    throw new Error(
      "CONFIG_MISSING: the configured DeepSeek API key file is unreadable.",
    );
  }
  return parseKeyFile(text);
}

function redact(message, key) {
  let safe = String(message ?? "DeepSeek sidecar failed.");
  if (key) {
    safe = safe.split(key).join("[REDACTED]");
  }
  return safe.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

function requiredDirectory(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`CONFIG_MISSING: ${name} is required.`);
  }
  let resolved;
  try {
    resolved = fs.realpathSync(value);
  } catch {
    throw new Error(`CONFIG_MISSING: ${name} is not an accessible directory.`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`CONFIG_INVALID: ${name} is not a directory.`);
  }
  return resolved;
}

function sidecarHome() {
  const home = requiredDirectory("DEEPSEEK_CODEX_HOME");
  for (const file of ["config.toml", "models.json"]) {
    const candidate = path.join(home, file);
    if (!fs.existsSync(candidate)) {
      throw new Error(
        `CONFIG_MISSING: DeepSeek sidecar file is missing: ${candidate}.`,
      );
    }
  }
  const modelsPath = path.join(home, "models.json");
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(modelsPath))
    .digest("hex");
  if (digest !== OFFICIAL_MODELS_SHA256) {
    throw new Error(
      `CONFIG_INVALID: DeepSeek sidecar models.json does not match the pinned official catalog (expected ${OFFICIAL_MODELS_SHA256}, got ${digest}).`,
    );
  }
  return home;
}

function codexBinary() {
  const value = process.env.DEEPSEEK_CODEX_BIN?.trim() || "codex";
  if (value.includes(path.sep) || (process.platform === "win32" && value.includes("/"))) {
    if (!fs.existsSync(value)) {
      throw new Error(`CONFIG_MISSING: DEEPSEEK_CODEX_BIN does not exist: ${value}.`);
    }
  }
  return value;
}

function allowedRoots() {
  const configured = process.env.DEEPSEEK_ALLOWED_ROOTS?.trim();
  const values = configured
    ? configured.split(path.delimiter).filter(Boolean)
    : [process.cwd()];
  const roots = [];
  for (const value of values) {
    try {
      const resolved = fs.realpathSync(value);
      if (fs.statSync(resolved).isDirectory()) {
        roots.push(resolved);
      }
    } catch {
      throw new Error(`CONFIG_INVALID: allowed workspace root is unreadable: ${value}.`);
    }
  }
  if (roots.length === 0) {
    throw new Error("CONFIG_INVALID: DEEPSEEK_ALLOWED_ROOTS contains no directory.");
  }
  return roots;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveWorkspace(value) {
  const roots = allowedRoots();
  const requested = value?.trim() || process.env.DEEPSEEK_WORKSPACE_ROOT?.trim() || process.cwd();
  const candidate = path.isAbsolute(requested)
    ? requested
    : path.resolve(process.cwd(), requested);
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    throw new Error(`INVALID_INPUT: workspace_path is not readable: ${requested}.`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error("INVALID_INPUT: workspace_path is not a directory.");
  }
  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error("INVALID_INPUT: workspace_path is outside DEEPSEEK_ALLOWED_ROOTS.");
  }
  return resolved;
}

function validateArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_INPUT: arguments must be an object.");
  }
  const allowedKeys = new Set([
    "prompt",
    "context",
    "reasoning_effort",
    "workspace_path",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("INVALID_INPUT: arguments contain unsupported fields.");
  }

  const prompt = value.prompt;
  const context = value.context ?? "";
  const reasoningEffort = value.reasoning_effort ?? DEFAULT_REASONING_EFFORT;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("INVALID_INPUT: prompt must be a non-empty string.");
  }
  if (prompt.length > 100_000) {
    throw new Error("INVALID_INPUT: prompt exceeds the character limit.");
  }
  if (typeof context !== "string" || context.length > 500_000) {
    throw new Error("INVALID_INPUT: context exceeds the character limit.");
  }
  if (
    Buffer.byteLength(prompt, "utf8") +
      Buffer.byteLength(context, "utf8") >
    MAX_HANDOFF_BYTES
  ) {
    throw new Error("INVALID_INPUT: prompt and context exceed the handoff byte limit.");
  }
  if (!ALLOWED_EFFORTS.has(reasoningEffort)) {
    throw new Error("INVALID_INPUT: reasoning_effort is unsupported.");
  }
  if (value.workspace_path !== undefined && typeof value.workspace_path !== "string") {
    throw new Error("INVALID_INPUT: workspace_path must be a string.");
  }
  return {
    prompt,
    context,
    reasoningEffort,
    workspace: resolveWorkspace(value.workspace_path),
  };
}

function buildHandoff({ prompt, context }) {
  const sections = [`Parent task:\n${prompt}`];
  if (context) {
    sections.push(`Parent-agent handoff context:\n${context}`);
  }
  return sections.join("\n\n");
}

function boundedAppend(current, chunk, limit = MAX_DIAGNOSTIC_BYTES) {
  const value = `${current}${chunk}`;
  return value.length > limit ? value.slice(-limit) : value;
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const normalized = {};
  for (const field of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (Number.isSafeInteger(value[field]) && value[field] >= 0) {
      normalized[field] = value[field];
    }
  }
  const cached = value.input_tokens_details?.cached_tokens;
  if (Number.isSafeInteger(cached) && cached >= 0) {
    normalized.cached_input_tokens = cached;
  }
  const reasoning = value.output_tokens_details?.reasoning_tokens;
  if (Number.isSafeInteger(reasoning) && reasoning >= 0) {
    normalized.reasoning_output_tokens = reasoning;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function eventText(event) {
  const item = event?.item;
  if (event?.type === "item.completed" && item) {
    if (item.type === "agent_message" || item.type === "message" || item.type === "assistant_message") {
      if (typeof item.text === "string") {
        return item.text;
      }
      if (typeof item.message === "string") {
        return item.message;
      }
      if (Array.isArray(item.content)) {
        return item.content
          .filter((part) => typeof part?.text === "string")
          .map((part) => part.text)
          .join("");
      }
    }
  }
  if (event?.type === "response.output_text.done" && typeof event.text === "string") {
    return event.text;
  }
  return "";
}

function eventUsage(event) {
  return normalizeUsage(
    event?.usage ??
      event?.response?.usage ??
      event?.item?.usage ??
      event?.turn?.usage,
  );
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.on("error", () => {
      child.kill();
    });
    return;
  }
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 2_000);
  forceTimer.unref();
}

function childEnvironment(key, home) {
  const names = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "ComSpec",
    "TMP",
    "TEMP",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "LANG",
    "LC_ALL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ];
  const environment = {};
  for (const name of names) {
    if (process.env[name] !== undefined) {
      environment[name] = process.env[name];
    }
  }
  environment.CODEX_HOME = home;
  environment.DEEPSEEK_API_KEY = key;
  return environment;
}

async function runSidecar(argumentsValue, requestId) {
  const args = validateArguments(argumentsValue);
  const key = apiKey();
  const home = sidecarHome();
  const binary = codexBinary();
  const totalTimeout = parseBoundedInteger(
    "DEEPSEEK_SIDECAR_TIMEOUT_MS",
    DEFAULT_TOTAL_TIMEOUT_MS,
    1_000,
    MAX_TOTAL_TIMEOUT_MS,
  );
  const idleTimeout = parseBoundedInteger(
    "DEEPSEEK_SIDECAR_IDLE_TIMEOUT_MS",
    DEFAULT_IDLE_TIMEOUT_MS,
    1_000,
    MAX_IDLE_TIMEOUT_MS,
  );
  const handoff = buildHandoff(args);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-codex-sidecar-"));
  const outputPath = path.join(temporaryRoot, "last-message.txt");
  const commandArguments = [
    "exec",
    "--ephemeral",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "danger-full-access",
    "--skip-git-repo-check",
    "--cd",
    args.workspace,
    "--output-last-message",
    outputPath,
    "-c",
    `model=\"${DEFAULT_MODEL}\"`,
    "-c",
    `model_reasoning_effort=\"${args.reasoningEffort}\"`,
    "-",
  ];
  const child = spawn(binary, commandArguments, {
    cwd: args.workspace,
    env: childEnvironment(key, home),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell:
      process.platform === "win32" &&
      (!path.isAbsolute(binary) || /\.(?:cmd|bat)$/i.test(binary)),
  });
  const requestKey = JSON.stringify(requestId);
  const state = {
    child,
    cancelled: false,
    timedOut: false,
    idleExpired: false,
    cancel: () => terminateProcessTree(child),
  };
  activeRequests.set(requestKey, state);

  let stdout = "";
  let stderr = "";
  let lineBuffer = "";
  let lastText = "";
  let usage;
  let eventCount = 0;
  let idleTimer;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      state.idleExpired = true;
      state.cancel();
    }, idleTimeout);
  };
  const hardTimer = setTimeout(() => {
    state.timedOut = true;
    state.cancel();
  }, totalTimeout);
  resetIdle();

  const consumeStdout = (chunk) => {
    resetIdle();
    stdout = boundedAppend(stdout, chunk, MAX_OUTPUT_BYTES);
    lineBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        const event = JSON.parse(line);
        eventCount += 1;
        const text = eventText(event);
        if (text) {
          lastText = text;
        }
        usage = eventUsage(event) ?? usage;
      } catch {
        // Codex --json should emit JSONL; ignore a diagnostic line and rely on the output file.
      }
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", consumeStdout);
  child.stderr.on("data", (chunk) => {
    resetIdle();
    stderr = boundedAppend(stderr, chunk);
  });

  const startedAt = Date.now();
  try {
    child.stdin.end(handoff, "utf8");
    const [exitCode, signal] = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, childSignal) => resolve([code, childSignal]));
    });
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    const durationMs = Date.now() - startedAt;
    if (state.cancelled || state.timedOut || state.idleExpired) {
      if (state.cancelled && !state.timedOut && !state.idleExpired) {
        throw new Error("CANCELLED: DeepSeek sidecar was cancelled.");
      }
      if (state.idleExpired) {
        throw new Error("SIDECAR_IDLE_TIMEOUT: DeepSeek Codex produced no progress.");
      }
      throw new Error("SIDECAR_TIMEOUT: DeepSeek Codex exceeded the total time limit.");
    }
    if (exitCode !== 0) {
      const detail = stderr.trim() || `exit code ${exitCode ?? "unknown"}${signal ? ` (${signal})` : ""}`;
      throw new Error(`SIDECAR_FAILED: ${detail}`);
    }
    let answer = "";
    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      if (stat.size > MAX_OUTPUT_BYTES) {
        throw new Error("BAD_RESPONSE: DeepSeek sidecar output exceeds the byte limit.");
      }
      answer = fs.readFileSync(outputPath, "utf8").trim();
    }
    if (!answer) {
      answer = lastText.trim();
    }
    if (!answer) {
      throw new Error("BAD_RESPONSE: DeepSeek sidecar returned no final report.");
    }
    answer = redact(answer, key);
    return {
      answer,
      model: DEFAULT_MODEL,
      provider: "deepseek",
      status: "completed",
      reasoning_effort: args.reasoningEffort,
      workspace: args.workspace,
      duration_ms: durationMs,
      codex_events: eventCount,
      usage,
    };
  } catch (runError) {
    if (runError instanceof Error && /^(CANCELLED|SIDECAR_|BAD_RESPONSE):/.test(runError.message)) {
      throw runError;
    }
    throw new Error(`SIDECAR_UNAVAILABLE: ${redact(runError?.message ?? "Codex sidecar failed.", key)}`);
  } finally {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    activeRequests.delete(requestKey);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

async function handle(message) {
  const id = message?.id;
  const method = message?.method;
  if (typeof method !== "string") {
    if (id !== undefined) {
      error(id, -32600, "Invalid Request");
    }
    return;
  }

  if (method === "initialize") {
    result(id, {
      protocolVersion: message?.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "ask_deepseek starts the official DeepSeek V4 Flash Codex sidecar with full local file access. The sidecar can inspect and modify files from the requested working directory and use Codex tools; it returns the result for the parent GPT agent to adjudicate. Default reasoning effort is max.",
    });
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (method === "notifications/cancelled") {
    const requestState = activeRequests.get(
      JSON.stringify(message?.params?.requestId),
    );
    if (requestState) {
      requestState.cancelled = true;
      requestState.cancel();
    }
    return;
  }
  if (method === "ping") {
    result(id, {});
    return;
  }
  if (method === "tools/list") {
    result(id, { tools: [TOOL] });
    return;
  }
  if (method === "tools/call") {
    if (message?.params?.name !== TOOL.name) {
      toolError(id, `Unknown tool: ${message?.params?.name ?? "(missing)"}`);
      return;
    }
    if (activeRequests.size >= MAX_CONCURRENT_REQUESTS) {
      toolError(id, "The DeepSeek Codex sidecar is busy. Try again shortly.");
      return;
    }
    let key;
    try {
      key = apiKey();
      const response = await runSidecar(message?.params?.arguments ?? {}, id);
      const usageNote = response.usage
        ? `\n\nUsage: ${JSON.stringify(response.usage)}`
        : "";
      result(id, {
        content: [
          {
            type: "text",
            text: `${response.answer}${usageNote}`,
          },
        ],
        structuredContent: response,
        isError: false,
      });
    } catch (toolCallError) {
      toolError(
        id,
        redact(toolCallError?.message ?? "DeepSeek sidecar failed.", key),
      );
    }
    return;
  }
  if (id !== undefined) {
    error(id, -32601, "Method not found");
  }
}

function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    error(null, -32700, "Parse error");
    return;
  }
  void handle(message);
}

process.stdin.setEncoding("utf8");
let inputBuffer = "";
let discardingOversizedLine = false;
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  while (true) {
    const newlineIndex = inputBuffer.indexOf("\n");
    if (newlineIndex === -1) {
      if (
        !discardingOversizedLine &&
        Buffer.byteLength(inputBuffer, "utf8") > MAX_RPC_LINE_BYTES
      ) {
        error(null, -32600, "Request exceeds the size limit");
        discardingOversizedLine = true;
        inputBuffer = "";
      }
      return;
    }
    const line = inputBuffer.slice(0, newlineIndex).replace(/\r$/, "");
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (discardingOversizedLine) {
      discardingOversizedLine = false;
      continue;
    }
    if (Buffer.byteLength(line, "utf8") > MAX_RPC_LINE_BYTES) {
      error(null, -32600, "Request exceeds the size limit");
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    handleLine(line);
  }
});
process.stdin.resume();
