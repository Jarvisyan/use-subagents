#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(directory, "server.mjs");
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
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
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
    clientInfo: { name: "deepseek-live-test", version: "1.0.0" },
  });
  const response = await request(2, "tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt:
        "This is a connectivity test. Reply with exactly DEEPSEEK_HYBRID_OK and nothing else.",
      role: "reviewer",
      reasoning_effort: "high",
    },
  });
  assert.equal(response.result?.isError, false, response.result?.content?.[0]?.text);
  const structured = response.result.structuredContent;
  assert.equal(structured.model, "deepseek-v4-flash");
  assert.match(structured.answer, /DEEPSEEK_HYBRID_OK/);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      model: structured.model,
      status: structured.status,
      usage: structured.usage,
    })}\n`,
  );
} finally {
  child.stdin.end();
  if (child.exitCode === null && child.signalCode === null) {
    await once(child, "exit");
  }
  assert.equal(stderr, "");
}
