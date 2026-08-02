#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const modelsPath = path.join(integrationRoot, "deepseek-codex", "models.json");
const officialModelsSha256 =
  "b459a6e438d6a9939d01fd0dbb4693f165ed732bc8e4fd58d7145d9d94bd49a4";
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "deepseek-config-test-"),
);

function configureArguments(configPath, keyPath, sidecarHome) {
  return [
    configurePath,
    "--config",
    configPath,
    "--node",
    process.execPath,
    "--server",
    serverPath,
    "--key-file",
    keyPath,
    "--sidecar-home",
    sidecarHome,
    "--models",
    modelsPath,
    "--codex-bin",
    process.execPath,
    "--allowed-root",
    temporaryRoot,
  ];
}

try {
  const configPath = path.join(temporaryRoot, "config.toml");
  const keyPath = path.join(temporaryRoot, "deepseek.env");
  const sidecarHome = path.join(temporaryRoot, "deepseek-sidecar");
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

  const directConfigPath = path.join(temporaryRoot, "direct-deepseek.toml");
  fs.writeFileSync(
    directConfigPath,
    'model = "deepseek-v4-flash"\nmodel_provider = "deepseek"\n',
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        configureArguments(
          directConfigPath,
          keyPath,
          path.join(temporaryRoot, "direct-sidecar"),
        ),
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    (error) =>
      /主 config\.toml 已包含 DeepSeek 直连字段/.test(
        String(error?.stderr ?? ""),
      ),
  );

  const rawResult = execFileSync(
    process.execPath,
    configureArguments(configPath, keyPath, sidecarHome),
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
  assert.match(updated, /DEEPSEEK_CODEX_HOME = /);
  assert.match(updated, /DEEPSEEK_CODEX_BIN = /);
  assert.match(updated, /DEEPSEEK_ALLOWED_ROOTS = /);
  assert.equal(updated.includes("sk-test-config-key"), false);

  const sidecarConfig = fs.readFileSync(
    path.join(sidecarHome, "config.toml"),
    "utf8",
  );
  assert.match(sidecarConfig, /^model = "deepseek-v4-flash"$/m);
  assert.match(sidecarConfig, /^model_provider = "deepseek"$/m);
  assert.match(sidecarConfig, /^preferred_auth_method = "apikey"$/m);
  assert.match(sidecarConfig, /^forced_login_method = "api"$/m);
  assert.match(sidecarConfig, /^model_reasoning_effort = "max"$/m);
  assert.match(sidecarConfig, /^wire_api = "responses"$/m);
  assert.match(sidecarConfig, /^env_key = "DEEPSEEK_API_KEY"$/m);
  assert.equal(sidecarConfig.includes("experimental_bearer_token"), false);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(sidecarHome, "models.json"), "utf8"),
    ),
    JSON.parse(fs.readFileSync(modelsPath, "utf8")),
  );
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(modelsPath)).digest("hex"),
    officialModelsSha256,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(modelsPath, "utf8")).models.map((model) => model.slug),
    ["deepseek-v4-flash", "deepseek-v4-pro"],
  );

  execFileSync(
    process.execPath,
    configureArguments(configPath, keyPath, sidecarHome),
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
