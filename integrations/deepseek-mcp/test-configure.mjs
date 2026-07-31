#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(directory, "..");
const configurePath = path.join(
  integrationRoot,
  "configure-deepseek-mcp.mjs",
);
const serverPath = path.join(directory, "server.mjs");
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "deepseek-config-test-"),
);

try {
  const configPath = path.join(temporaryRoot, "config.toml");
  const keyPath = path.join(temporaryRoot, "deepseek.env");
  fs.writeFileSync(
    keyPath,
    "DEEPSEEK_API_KEY=sk-test-config-key\n",
    { mode: 0o600 },
  );
  fs.writeFileSync(
    configPath,
    [
      'model = "gpt-5.6-sol"',
      'service_tier = "priority"',
      'base_instructions = """',
      "[this line is inside a multiline string]",
      '"""',
      "",
      '[projects."/tmp/example"]',
      'trust_level = "trusted"',
      "",
      "[mcp_servers.deepseek]",
      'command = "/bin/bash"',
      'args = ["old-server"]',
      'enabled_tools = ["ask_deepseek", "run_deepseek_worker"]',
      "",
      "[mcp_servers.deepseek.env]",
      'DEEPSEEK_ALLOWED_ROOTS = "/tmp"',
      "",
      "[mcp_servers.other]",
      'url = "https://example.invalid/mcp"',
      "",
    ].join("\n"),
  );

  const rawResult = execFileSync(
    process.execPath,
    [
      configurePath,
      "--config",
      configPath,
      "--node",
      process.execPath,
      "--server",
      serverPath,
      "--key-file",
      keyPath,
    ],
    { encoding: "utf8" },
  );
  const result = JSON.parse(rawResult);
  assert.equal(result.ok, true);
  assert.equal(result.replaced_legacy_deepseek_mcp, true);
  assert.ok(result.backup);
  assert.equal(fs.existsSync(result.backup), true);

  const updated = fs.readFileSync(configPath, "utf8");
  assert.match(updated, /^model = "gpt-5\.6-sol"/m);
  assert.match(updated, /^service_tier = "priority"/m);
  assert.match(updated, /\[this line is inside a multiline string\]/);
  assert.match(updated, /^\[mcp_servers\.other\]$/m);
  assert.equal((updated.match(/^\[mcp_servers\.deepseek\]$/gm) ?? []).length, 1);
  assert.match(updated, /enabled_tools = \["ask_deepseek"\]/);
  assert.equal(updated.includes("run_deepseek_worker"), false);
  assert.match(updated, /DEEPSEEK_API_KEY_FILE = /);
  assert.equal(updated.includes("sk-test-config-key"), false);

  execFileSync(
    process.execPath,
    [
      configurePath,
      "--config",
      configPath,
      "--node",
      process.execPath,
      "--server",
      serverPath,
      "--key-file",
      keyPath,
    ],
    { encoding: "utf8" },
  );
  const reinstalled = fs.readFileSync(configPath, "utf8");
  assert.equal(
    (reinstalled.match(/^# BEGIN use-subagents deepseek-hybrid$/gm) ?? [])
      .length,
    1,
  );
  assert.equal(
    (reinstalled.match(/^\[mcp_servers\.deepseek\]$/gm) ?? []).length,
    1,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("DeepSeek MCP configuration tests passed.\n");
