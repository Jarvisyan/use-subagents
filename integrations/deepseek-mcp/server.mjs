#!/usr/bin/env node

import {
  normalizeWorkerRequest,
  rootsAreIndependent,
  runWorker,
} from "./worker.mjs";

const SERVER_NAME = "deepseek-bridge";
const SERVER_VERSION = "0.2.0";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";
const MAX_CONCURRENT_REQUESTS = 2;
const MAX_CONCURRENT_WORKERS = 3;
const MAX_RPC_LINE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 160 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MODELS = new Set([DEFAULT_MODEL]);
const ALLOWED_ROLES = new Set([
  "planner",
  "challenger",
  "executor",
  "reviewer",
]);
const ALLOWED_EFFORTS = new Set(["high", "max"]);

const TOOL = {
  name: "ask_deepseek",
  description:
    "Send a bounded prompt and optional context to DeepSeek V4 Pro for an independent plan, challenge, implementation opinion, or review. This transmits the supplied text to DeepSeek and incurs API usage.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 20000,
        description: "The concrete question or task for DeepSeek.",
      },
      context: {
        type: "string",
        maxLength: 40000,
        description:
          "Optional context needed to answer the question. Do not include secrets.",
      },
      role: {
        type: "string",
        enum: [...ALLOWED_ROLES],
        default: "challenger",
      },
      reasoning_effort: {
        type: "string",
        enum: [...ALLOWED_EFFORTS],
        default: "high",
      },
      max_tokens: {
        type: "integer",
        minimum: 1,
        maximum: 8192,
        description:
          "Optional output budget. Defaults to 4,096 for high effort and 8,192 for max effort.",
      },
    },
  },
  annotations: {
    title: "Ask DeepSeek V4 Pro",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const WORKER_TOOL = {
  name: "run_deepseek_worker",
  description:
    "Run DeepSeek V4 Pro as the sole implementation worker in one specified workspace. It can read and edit files inside that workspace, but cannot use a terminal, network, external directories, or subagents. This sends relevant project content to DeepSeek, modifies files, and incurs API usage.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["workspace_root", "task"],
    properties: {
      workspace_root: {
        type: "string",
        description: "Absolute path to the one workspace this worker may edit.",
      },
      task: {
        type: "string",
        minLength: 1,
        maxLength: 60000,
        description:
          "A bounded implementation task with the adopted plan, scope, constraints, and acceptance criteria.",
      },
      reasoning_effort: {
        type: "string",
        enum: [...ALLOWED_EFFORTS],
        default: "high",
      },
      timeout_ms: {
        type: "integer",
        minimum: 30000,
        maximum: 900000,
        default: 600000,
      },
    },
  },
  annotations: {
    title: "Run DeepSeek implementation worker",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const WORKER_POOL_TOOL = {
  name: "run_deepseek_workers",
  description:
    "Run two or three independent DeepSeek V4 Pro implementation workers concurrently. Every job must use a distinct, non-overlapping workspace or Git worktree. Workers can edit only their own workspace and have no terminal, network, external-directory, or recursive-subagent access.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["jobs"],
    properties: {
      jobs: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["workspace_root", "task"],
          properties: {
            workspace_root: { type: "string" },
            task: { type: "string", minLength: 1, maxLength: 60000 },
            reasoning_effort: {
              type: "string",
              enum: [...ALLOWED_EFFORTS],
              default: "high",
            },
            timeout_ms: {
              type: "integer",
              minimum: 30000,
              maximum: 900000,
              default: 600000,
            },
          },
        },
      },
    },
  },
  annotations: {
    title: "Run parallel DeepSeek implementation workers",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const TOOLS = [TOOL, WORKER_TOOL, WORKER_POOL_TOOL];
const activeRequests = new Map();
const activeWorkspaceRoots = new Set();
let activeWorkerCount = 0;

function reserveWorkerSlots(count) {
  if (activeWorkerCount + count > MAX_CONCURRENT_WORKERS) {
    throw new Error(
      "WORKER_CAPACITY: the DeepSeek Worker pool is busy. Try again shortly.",
    );
  }
  activeWorkerCount += count;
}

function releaseWorkerSlots(count) {
  activeWorkerCount = Math.max(0, activeWorkerCount - count);
}

const ROLE_PROMPTS = {
  planner:
    "You are an independent planner. Turn the request into a concise, executable plan. Surface assumptions, decisions, risks, and validation. Do not invent requirements.",
  challenger:
    "You are an independent challenger. Stress-test the proposed direction, identify hidden assumptions and counterexamples, and recommend the smallest justified correction. Prefer evidence over agreement.",
  executor:
    "You are a focused implementation consultant. Follow the supplied plan and constraints exactly. Return concrete implementation guidance or code, and explicitly flag anything you cannot verify. Do not silently expand scope.",
  reviewer:
    "You are an independent reviewer. Compare the supplied result with the original request and plan. Identify omissions, scope creep, regressions, and unverifiable claims. Prioritize findings by impact and give concrete evidence.",
};

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

function validateArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Arguments must be an object.");
  }

  const allowedKeys = new Set([
    "prompt",
    "context",
    "role",
    "reasoning_effort",
    "max_tokens",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error("Arguments contain unsupported fields.");
    }
  }

  const prompt = value.prompt;
  const context = value.context ?? "";
  const role = value.role ?? "challenger";
  const reasoningEffort = value.reasoning_effort ?? "high";
  const maxTokens =
    value.max_tokens ?? (reasoningEffort === "max" ? 8192 : 4096);

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("prompt must be a non-empty string.");
  }
  if (prompt.length > 20000) {
    throw new Error("INVALID_INPUT: prompt exceeds the character limit.");
  }
  if (typeof context !== "string" || context.length > 40000) {
    throw new Error("INVALID_INPUT: context exceeds the character limit.");
  }
  if (
    Buffer.byteLength(prompt, "utf8") +
      Buffer.byteLength(context, "utf8") >
    MAX_INPUT_BYTES
  ) {
    throw new Error("INVALID_INPUT: prompt and context exceed the byte limit.");
  }
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error("role is unsupported.");
  }
  if (!ALLOWED_EFFORTS.has(reasoningEffort)) {
    throw new Error("reasoning_effort is unsupported.");
  }
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 8192
  ) {
    throw new Error("INVALID_INPUT: max_tokens is outside the allowed range.");
  }

  return { prompt, context, role, reasoningEffort, maxTokens };
}

function baseUrl(apiKey) {
  const configured = (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (configured === DEFAULT_BASE_URL) {
    return configured;
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("INVALID_CONFIG: the test provider URL is invalid.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  const isSafeTestEndpoint =
    process.env.NODE_ENV === "test" &&
    apiKey.startsWith("test-") &&
    parsed.protocol === "http:" &&
    loopbackHosts.has(parsed.hostname) &&
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.pathname === "/" || parsed.pathname === "");
  if (!isSafeTestEndpoint) {
    throw new Error(
      "INVALID_CONFIG: provider URL overrides are restricted to local tests.",
    );
  }
  return parsed.origin;
}

function timeoutMs() {
  const parsed = Number.parseInt(
    process.env.DEEPSEEK_REQUEST_TIMEOUT_MS ?? "240000",
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 300000) {
    return 240000;
  }
  return parsed;
}

function redact(value, secret) {
  let safe = String(value ?? "");
  if (secret) {
    safe = safe.split(secret).join("[REDACTED]");
  }
  safe = safe.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]");
  return safe.slice(0, 500);
}

async function readJsonWithLimit(response, controller) {
  if (!response.body) {
    throw new Error("BAD_RESPONSE: DeepSeek returned an empty response.");
  }
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "0",
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    controller.abort();
    throw new Error("BAD_RESPONSE: DeepSeek response exceeded the size limit.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
      controller.abort();
      throw new Error(
        "BAD_RESPONSE: DeepSeek response exceeded the size limit.",
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function askDeepSeek(args, requestId) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error(
      "CONFIG_MISSING: DEEPSEEK_API_KEY is unavailable. Set it locally and restart Codex.",
    );
  }

  const { prompt, context, role, reasoningEffort, maxTokens } =
    validateArguments(args);
  const userContent = context
    ? `${prompt}\n\nContext supplied by the caller:\n${context}`
    : prompt;
  const controller = new AbortController();
  const requestState = { controller, cancelled: false };
  const requestKey = JSON.stringify(requestId);
  activeRequests.set(requestKey, requestState);
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(`${baseUrl(apiKey)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: ROLE_PROMPTS[role] },
          { role: "user", content: userContent },
        ],
        thinking: { type: "enabled" },
        reasoning_effort: reasoningEffort,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new Error("AUTH_FAILED: DeepSeek rejected the credential.");
      }
      if (response.status === 429) {
        throw new Error("RATE_LIMITED: DeepSeek rejected the request.");
      }
      if (response.status >= 500) {
        throw new Error("UPSTREAM_UNAVAILABLE: DeepSeek is unavailable.");
      }
      throw new Error("UPSTREAM_ERROR: DeepSeek rejected the request.");
    }

    let body;
    try {
      body = await readJsonWithLimit(response, controller);
    } catch (responseError) {
      if (
        responseError?.message?.startsWith("BAD_RESPONSE:")
      ) {
        throw responseError;
      }
      throw new Error("BAD_RESPONSE: DeepSeek returned invalid JSON.");
    }

    const answer = body?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || answer.length === 0) {
      throw new Error("BAD_RESPONSE: DeepSeek returned no final answer.");
    }

    const usage = body?.usage;
    return {
      answer,
      model:
        typeof body?.model === "string" && ALLOWED_MODELS.has(body.model)
          ? body.model
          : DEFAULT_MODEL,
      usage: normalizeUsage(usage),
    };
  } catch (requestError) {
    if (
      requestError?.name === "AbortError" ||
      controller.signal.aborted
    ) {
      throw new Error(
        requestState.cancelled
          ? "CANCELLED: DeepSeek request was cancelled."
          : "UPSTREAM_TIMEOUT: DeepSeek request timed out.",
      );
    }
    if (
      /^(AUTH_FAILED|RATE_LIMITED|UPSTREAM_|BAD_RESPONSE|INVALID_CONFIG):/.test(
        requestError?.message ?? "",
      )
    ) {
      throw requestError;
    }
    throw new Error(
      "UPSTREAM_UNAVAILABLE: no valid DeepSeek response was received.",
    );
  } finally {
    clearTimeout(timer);
    activeRequests.delete(requestKey);
  }
}

async function executeWorker(args, requestId) {
  const request = await normalizeWorkerRequest(args);
  const candidateRoots = [...activeWorkspaceRoots, request.workspaceRoot];
  if (!rootsAreIndependent(candidateRoots)) {
    throw new Error(
      "WORKSPACE_CONFLICT: another DeepSeek Worker is already using this or an overlapping workspace.",
    );
  }
  reserveWorkerSlots(1);
  activeWorkspaceRoots.add(request.workspaceRoot);
  const controller = new AbortController();
  const requestKey = JSON.stringify(requestId);
  activeRequests.set(requestKey, { controller, cancelled: false });
  try {
    return await runWorker(request, { controller });
  } finally {
    activeRequests.delete(requestKey);
    activeWorkspaceRoots.delete(request.workspaceRoot);
    releaseWorkerSlots(1);
  }
}

async function executeWorkerPool(args, requestId) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    Object.keys(args).some((key) => key !== "jobs") ||
    !Array.isArray(args.jobs) ||
    args.jobs.length < 2 ||
    args.jobs.length > 3
  ) {
    throw new Error(
      "INVALID_INPUT: jobs must contain two or three worker requests.",
    );
  }
  const requests = await Promise.all(
    args.jobs.map((job) => normalizeWorkerRequest(job)),
  );
  if (!rootsAreIndependent(requests.map((request) => request.workspaceRoot))) {
    throw new Error(
      "WORKSPACE_CONFLICT: parallel workers require distinct, non-overlapping workspaces.",
    );
  }
  const roots = requests.map((request) => request.workspaceRoot);
  if (!rootsAreIndependent([...activeWorkspaceRoots, ...roots])) {
    throw new Error(
      "WORKSPACE_CONFLICT: another DeepSeek Worker is already using one of these or an overlapping workspace.",
    );
  }
  reserveWorkerSlots(roots.length);
  for (const root of roots) {
    activeWorkspaceRoots.add(root);
  }

  const controller = new AbortController();
  const requestKey = JSON.stringify(requestId);
  activeRequests.set(requestKey, { controller, cancelled: false });
  try {
    const workers = requests.map((request) =>
      runWorker(request, { controller }),
    );
    try {
      return await Promise.all(workers);
    } catch (poolError) {
      controller.abort();
      await Promise.allSettled(workers);
      throw poolError;
    }
  } finally {
    activeRequests.delete(requestKey);
    for (const root of roots) {
      activeWorkspaceRoots.delete(root);
    }
    releaseWorkerSlots(roots.length);
  }
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const fields = [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
  ];
  const normalized = {};
  for (const field of fields) {
    const tokenCount = value[field];
    if (
      !Number.isSafeInteger(tokenCount) ||
      tokenCount < 0
    ) {
      return undefined;
    }
    normalized[field] = tokenCount;
  }
  return normalized;
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
        "ask_deepseek is a text-only external opinion. run_deepseek_worker is a workspace-constrained DeepSeek implementation agent. run_deepseek_workers permits parallel execution only across distinct workspaces. Never send secrets.",
    });
    return;
  }

  if (
    method === "notifications/initialized"
  ) {
    return;
  }

  if (method === "notifications/cancelled") {
    const requestKey = JSON.stringify(message?.params?.requestId);
    const requestState = activeRequests.get(requestKey);
    if (requestState) {
      requestState.cancelled = true;
      requestState.controller.abort();
    }
    return;
  }

  if (method === "ping") {
    result(id, {});
    return;
  }

  if (method === "tools/list") {
    result(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = message?.params?.name;
    if (!TOOLS.some((candidate) => candidate.name === toolName)) {
      toolError(id, `Unknown tool: ${message?.params?.name ?? "(missing)"}`);
      return;
    }
    if (activeRequests.size >= MAX_CONCURRENT_REQUESTS) {
      toolError(id, "The DeepSeek bridge is busy. Try again shortly.");
      return;
    }
    try {
      const toolArguments = message?.params?.arguments ?? {};
      if (toolName === WORKER_TOOL.name) {
        const response = await executeWorker(toolArguments, id);
        result(id, {
          content: [{ type: "text", text: response.summary }],
          structuredContent: response,
          isError: false,
        });
        return;
      }
      if (toolName === WORKER_POOL_TOOL.name) {
        const response = await executeWorkerPool(toolArguments, id);
        result(id, {
          content: response.map((worker, index) => ({
            type: "text",
            text: `Worker ${index + 1}: ${worker.summary}`,
          })),
          structuredContent: { workers: response },
          isError: false,
        });
        return;
      }

      const response = await askDeepSeek(toolArguments, id);
      const usage = response.usage
        ? `\n\nUsage: ${JSON.stringify(response.usage)}`
        : "";
      result(id, {
        content: [
          {
            type: "text",
            text: `${response.answer}${usage}`,
          },
        ],
        structuredContent: response,
        isError: false,
      });
    } catch (toolCallError) {
      toolError(
        id,
        redact(toolCallError?.message ?? "DeepSeek request failed.", process.env.DEEPSEEK_API_KEY),
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
    if (!line.trim()) {
      continue;
    }
    if (Buffer.byteLength(line, "utf8") > MAX_RPC_LINE_BYTES) {
      error(null, -32600, "Request exceeds the size limit");
      continue;
    }
    handleLine(line);
  }
});
