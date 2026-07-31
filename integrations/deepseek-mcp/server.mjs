#!/usr/bin/env node

import fs from "node:fs";

const SERVER_NAME = "deepseek-responses-bridge";
const SERVER_VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_CONCURRENT_REQUESTS = 2;
const MAX_RPC_LINE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 160 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 14_100_000;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const MAX_REQUEST_TIMEOUT_MS = 14_100_000;
const MAX_IDLE_TIMEOUT_MS = 600_000;
const ALLOWED_ROLES = new Set([
  "planner",
  "challenger",
  "executor",
  "reviewer",
]);
const ALLOWED_EFFORTS = new Set(["high", "max"]);

const ROLE_PROMPTS = {
  planner:
    "You are an independent planner. Turn the request into a concise, executable plan. Surface assumptions, decisions, risks, and validation. Do not invent requirements.",
  challenger:
    "You are an independent challenger. Stress-test the proposed direction, identify hidden assumptions and counterexamples, and recommend the smallest justified correction. Prefer evidence over agreement.",
  executor:
    "You are a focused implementation consultant. Follow the supplied plan and constraints exactly. Return concrete implementation guidance, and explicitly flag anything you cannot verify. Do not silently expand scope.",
  reviewer:
    "You are an independent reviewer. Compare the supplied result with the original request and plan. Identify omissions, scope creep, regressions, and unverifiable claims. Prioritize findings by impact and give concrete evidence.",
};

const TOOL = {
  name: "ask_deepseek",
  description:
    "Ask DeepSeek V4 Flash for an independent text-only plan, challenge, implementation opinion, or review. The supplied prompt/context is transmitted to DeepSeek and incurs API usage. Never include secrets.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 20_000,
        description: "The concrete question or bounded task for DeepSeek.",
      },
      context: {
        type: "string",
        maxLength: 40_000,
        description:
          "Optional context required to answer. Do not include credentials or unrelated private data.",
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
    },
  },
  annotations: {
    title: "Ask DeepSeek V4 Flash",
    readOnlyHint: true,
    destructiveHint: false,
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

function baseUrl(key) {
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
    throw new Error("INVALID_CONFIG: DEEPSEEK_BASE_URL is invalid.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  const safeTestEndpoint =
    process.env.NODE_ENV === "test" &&
    key.startsWith("sk-test-") &&
    parsed.protocol === "http:" &&
    loopbackHosts.has(parsed.hostname) &&
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.pathname === "/" || parsed.pathname === "");
  if (!safeTestEndpoint) {
    throw new Error(
      "INVALID_CONFIG: provider URL overrides are restricted to loopback tests.",
    );
  }
  return configured;
}

function redact(message, key) {
  let safe = String(message ?? "DeepSeek request failed.");
  if (key) {
    safe = safe.split(key).join("[REDACTED]");
  }
  return safe.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

function validateArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_INPUT: arguments must be an object.");
  }
  const allowedKeys = new Set([
    "prompt",
    "context",
    "role",
    "reasoning_effort",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("INVALID_INPUT: arguments contain unsupported fields.");
  }

  const prompt = value.prompt;
  const context = value.context ?? "";
  const role = value.role ?? "challenger";
  const reasoningEffort = value.reasoning_effort ?? "high";
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("INVALID_INPUT: prompt must be a non-empty string.");
  }
  if (prompt.length > 20_000) {
    throw new Error("INVALID_INPUT: prompt exceeds the character limit.");
  }
  if (typeof context !== "string" || context.length > 40_000) {
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
    throw new Error("INVALID_INPUT: role is unsupported.");
  }
  if (!ALLOWED_EFFORTS.has(reasoningEffort)) {
    throw new Error("INVALID_INPUT: reasoning_effort is unsupported.");
  }
  return { prompt, context, role, reasoningEffort };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }
  const parts = [];
  if (!Array.isArray(payload?.output)) {
    return "";
  }
  for (const item of payload.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (
        (content?.type === "output_text" || content?.type === "text") &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
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

async function readBoundedBody(response, controller, resetIdle) {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8", { fatal: false });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      resetIdle();
      bytes += value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
        controller.abort();
        throw new Error("BAD_RESPONSE: DeepSeek response exceeds the byte limit.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

async function askDeepSeek(rawArguments, requestId) {
  const { prompt, context, role, reasoningEffort } =
    validateArguments(rawArguments);
  const key = apiKey();
  const controller = new AbortController();
  const requestKey = JSON.stringify(requestId);
  const requestState = { controller, cancelled: false };
  activeRequests.set(requestKey, requestState);

  const requestTimeout = parseBoundedInteger(
    "DEEPSEEK_REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
    1_000,
    MAX_REQUEST_TIMEOUT_MS,
  );
  const idleTimeout = parseBoundedInteger(
    "DEEPSEEK_IDLE_TIMEOUT_MS",
    DEFAULT_IDLE_TIMEOUT_MS,
    1_000,
    MAX_IDLE_TIMEOUT_MS,
  );
  let hardExpired = false;
  let idleExpired = false;
  let idleTimer;
  const hardTimer = setTimeout(() => {
    hardExpired = true;
    controller.abort();
  }, requestTimeout);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleExpired = true;
      controller.abort();
    }, idleTimeout);
  };
  resetIdle();

  const input = context
    ? `${prompt}\n\nContext supplied by the parent agent:\n${context}`
    : prompt;
  try {
    const response = await fetch(`${baseUrl(key)}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        instructions: ROLE_PROMPTS[role],
        input,
        reasoning: { effort: reasoningEffort },
        stream: false,
      }),
      signal: controller.signal,
    });
    resetIdle();
    const rawBody = await readBoundedBody(response, controller, resetIdle);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("AUTH_FAILED: DeepSeek rejected the credential.");
      }
      if (response.status === 429) {
        throw new Error("RATE_LIMITED: DeepSeek rejected the request.");
      }
      if (response.status >= 500) {
        throw new Error("UPSTREAM_UNAVAILABLE: DeepSeek is unavailable.");
      }
      throw new Error(
        `UPSTREAM_ERROR: DeepSeek rejected the request with HTTP ${response.status}.`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error("BAD_RESPONSE: DeepSeek returned invalid JSON.");
    }
    const answer = extractOutputText(payload);
    if (!answer) {
      throw new Error("BAD_RESPONSE: DeepSeek returned no final answer.");
    }
    return {
      answer,
      model:
        typeof payload.model === "string" ? payload.model : DEFAULT_MODEL,
      response_id: typeof payload.id === "string" ? payload.id : undefined,
      status:
        typeof payload.status === "string" ? payload.status : "completed",
      incomplete_reason:
        typeof payload.incomplete_details?.reason === "string"
          ? payload.incomplete_details.reason
          : undefined,
      usage: normalizeUsage(payload.usage),
    };
  } catch (requestError) {
    if (requestState.cancelled) {
      throw new Error("CANCELLED: DeepSeek request was cancelled.");
    }
    if (idleExpired) {
      throw new Error("UPSTREAM_IDLE_TIMEOUT: DeepSeek response became idle.");
    }
    if (hardExpired) {
      throw new Error("UPSTREAM_TIMEOUT: DeepSeek request timed out.");
    }
    if (
      /^(AUTH_FAILED|RATE_LIMITED|UPSTREAM_|BAD_RESPONSE|INVALID_CONFIG|CONFIG_):/.test(
        requestError?.message ?? "",
      )
    ) {
      throw requestError;
    }
    throw new Error(
      "UPSTREAM_UNAVAILABLE: no valid DeepSeek response was received.",
    );
  } finally {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    activeRequests.delete(requestKey);
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
        "ask_deepseek sends bounded text to DeepSeek V4 Flash through the official Responses API. Treat it as external evidence, never transmit secrets, and let the parent GPT agent adjudicate the result.",
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
      requestState.controller.abort();
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
      toolError(id, "The DeepSeek bridge is busy. Try again shortly.");
      return;
    }
    let key;
    try {
      key = apiKey();
      const response = await askDeepSeek(
        message?.params?.arguments ?? {},
        id,
      );
      const statusNote =
        response.status === "completed"
          ? ""
          : `\n\n[DeepSeek status: ${response.status}${
              response.incomplete_reason
                ? `; reason: ${response.incomplete_reason}`
                : ""
            }. Treat this answer as incomplete evidence.]`;
      const usageNote = response.usage
        ? `\n\nUsage: ${JSON.stringify(response.usage)}`
        : "";
      result(id, {
        content: [
          {
            type: "text",
            text: `${response.answer}${statusNote}${usageNote}`,
          },
        ],
        structuredContent: response,
        isError: false,
      });
    } catch (toolCallError) {
      toolError(
        id,
        redact(toolCallError?.message ?? "DeepSeek request failed.", key),
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
process.stdin.resume();
