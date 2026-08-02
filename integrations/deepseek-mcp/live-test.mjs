#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { once } from "node:events";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(directory, "server.mjs");
const required = [
  "DEEPSEEK_API_KEY_FILE",
  "DEEPSEEK_CODEX_HOME",
  "DEEPSEEK_CODEX_BIN",
];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`真实 sidecar 测试需要环境变量 ${name}。`);
  }
}

function configuredApiKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    return process.env.DEEPSEEK_API_KEY.trim();
  }
  const text = fs.readFileSync(process.env.DEEPSEEK_API_KEY_FILE, "utf8");
  const match = text.match(
    /^(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*?)\s*$/m,
  );
  if (!match) {
    throw new Error("无法从 DEEPSEEK_API_KEY_FILE 读取密钥。");
  }
  const value = match[1].trim();
  return value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

const child = spawn(process.execPath, [serverPath], {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const pending = new Map();
const lines = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
});
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}.`));
    }, 14_200_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}

try {
  await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "deepseek-live-test", version: "2.0.0" },
  });
  const workspace = process.env.DEEPSEEK_WORKSPACE_ROOT || process.cwd();
  const startedAt = Date.now();
  const response = await request(2, "tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt:
        "This is a connectivity test. Reply with exactly DEEPSEEK_HYBRID_OK and nothing else.",
      reasoning_effort: "max",
      workspace_path: workspace,
    },
  });
  assert.equal(response.result?.isError, false, "DeepSeek sidecar returned an error.");
  const structured = response.result.structuredContent;
  assert.equal(structured.provider, "deepseek");
  assert.equal(structured.model, "deepseek-v4-flash");
  assert.equal(structured.reasoning_effort, "max");
  assert.match(structured.answer, /DEEPSEEK_HYBRID_OK/);
  assert.equal(structured.answer.includes(configuredApiKey()), false);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      provider: structured.provider,
      model: structured.model,
      reasoning_effort: structured.reasoning_effort,
      status: structured.status,
      duration_ms: Date.now() - startedAt,
      sidecar_duration_ms: structured.duration_ms,
      codex_events: structured.codex_events,
      usage: structured.usage,
    })}\n`,
  );
} finally {
  child.stdin.end();
  if (child.exitCode === null && child.signalCode === null) {
    await once(child, "exit");
  }
  if (stderr.trim()) {
    throw new Error(`DeepSeek sidecar wrote diagnostics: ${stderr.trim()}`);
  }
}
