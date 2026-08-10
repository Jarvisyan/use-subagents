#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(directory, "server.mjs");
const modelsPath = path.resolve(directory, "..", "deepseek-codex", "models.json");
const testKey = "sk-test-secret-never-print";

class McpClient {
  constructor(environment) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.child = spawn(process.execPath, [serverPath], {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    const rejectPending = (reason) => {
      for (const [id, pending] of [...this.pending]) {
        this.pending.delete(id);
        pending.reject(reason);
      }
    };
    this.child.on("error", rejectPending);
    this.child.on("exit", (code, signal) => {
      if (this.pending.size > 0) {
        rejectPending(
          new Error(`MCP server exited early (code=${code}, signal=${signal}).`),
        );
      }
    });
    const lines = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message);
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return response;
  }

  async close() {
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await once(this.child, "exit");
    }
    assert.equal(this.stderr, "");
  }
}

const fakeCodexSource = `#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);
if (process.env.CODEX_HOME) {
  fs.writeFileSync(process.env.CODEX_HOME + "/fake-invoked", "yes");
}
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
}
const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
const checks = {
  exec: args[0] === "exec",
  ephemeral: args.includes("--ephemeral"),
  json: args.includes("--json"),
  full_access: args.includes("--sandbox") && args.includes("danger-full-access"),
  no_ignore_rules: !args.includes("--ignore-rules"),
  isolated_config: !args.includes("mcp_servers.deepseek.enabled=false"),
  isolated_environment: Boolean(process.env.CODEX_HOME) &&
    !process.env.DEEPSEEK_CODEX_HOME &&
    !process.env.DEEPSEEK_CODEX_BIN &&
    !process.env.DEEPSEEK_ALLOWED_ROOTS &&
    !process.env.DEEPSEEK_API_KEY_FILE,
  flash: args.includes("model=\\\"deepseek-v4-flash\\\""),
  max: args.includes("model_reasoning_effort=\\\"max\\\""),
  no_output_cap: !args.some((argument) => /max_(?:tokens|output_tokens)/.test(argument)),
};
const allChecks = Object.values(checks).every(Boolean);
const handoffPresent = input.includes("Parent task:\\nChallenge this plan") &&
  input.includes("Parent-agent handoff context:\\nThe plan has one assumption.") &&
  !input.includes("full-access sidecar") &&
  !input.includes("challenger");
if (!outputPath) {
  process.stderr.write("missing output path");
  process.exit(2);
}
  fs.writeFileSync(
    outputPath,
    JSON.stringify({
      marker: "FAKE_SIDECAR_OK",
      echoed_input_secret: "sk-test-secret-never-print",
      all_checks: allChecks,
    checks,
    handoff_present: handoffPresent,
  }),
);
process.stdout.write(JSON.stringify({
  type: "item.completed",
  item: { type: "agent_message", text: "event fallback must not win" },
}) + "\\n");
process.stdout.write(JSON.stringify({
  type: "response.completed",
  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
}) + "\\n");
`;

async function main() {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "deepseek-sidecar-test-"),
  );
  const sidecarHome = path.join(temporaryRoot, "sidecar");
  const workspace = path.join(temporaryRoot, "test-workspace");
  fs.mkdirSync(sidecarHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(sidecarHome, "config.toml"),
    'model = "deepseek-v4-flash"\n',
  );
  fs.copyFileSync(modelsPath, path.join(sidecarHome, "models.json"));

  const fakeCodexMjs = path.join(temporaryRoot, "fake-codex.mjs");
  fs.writeFileSync(fakeCodexMjs, fakeCodexSource, { encoding: "utf8" });
  let fakeCodex = fakeCodexMjs;
  if (process.platform === "win32") {
    const wrapper = path.join(temporaryRoot, "fake-codex.cmd");
    fs.writeFileSync(
      wrapper,
      `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`,
    );
    fakeCodex = wrapper;
  } else {
    fs.chmodSync(fakeCodexMjs, 0o755);
  }

  const environment = { ...process.env };
  delete environment.DEEPSEEK_API_KEY_FILE;
  environment.NODE_ENV = "test";
  environment.DEEPSEEK_API_KEY = testKey;
  environment.DEEPSEEK_CODEX_HOME = sidecarHome;
  environment.DEEPSEEK_CODEX_BIN = fakeCodex;
  environment.DEEPSEEK_ALLOWED_ROOTS = workspace;
  environment.DEEPSEEK_SIDECAR_TIMEOUT_MS = "5000";
  environment.DEEPSEEK_SIDECAR_IDLE_TIMEOUT_MS = "1000";

  const client = new McpClient(environment);
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    assert.equal(
      initialized.result.serverInfo.name,
      "deepseek-codex-sidecar",
    );

    const listed = await client.request("tools/list");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["ask_deepseek"],
    );
    assert.deepEqual(
      listed.result.tools[0].inputSchema.properties.reasoning_effort.enum,
      ["low", "high", "max"],
    );
    assert.equal(listed.result.tools[0].annotations.readOnlyHint, false);
    assert.equal(listed.result.tools[0].annotations.destructiveHint, true);
    assert.equal(listed.result.tools[0].annotations.openWorldHint, true);
    assert.equal(
      Object.hasOwn(listed.result.tools[0].inputSchema.properties, "max_tokens"),
      false,
    );

    const called = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: {
        prompt: "Challenge this plan",
        context: "The plan has one assumption.",
        workspace_path: workspace,
      },
    });
    assert.equal(called.result.isError, false);
    assert.match(called.result.content[0].text, /FAKE_SIDECAR_OK/);
    assert.equal(called.result.structuredContent.model, "deepseek-v4-flash");
    assert.equal(called.result.structuredContent.provider, "deepseek");
    assert.equal(called.result.structuredContent.reasoning_effort, "max");
    assert.equal(called.result.structuredContent.workspace, workspace);
    assert.deepEqual(called.result.structuredContent.usage, {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    });
    assert.equal(called.result.structuredContent.codex_events, 2);
    assert.equal(called.result.content[0].text.includes(testKey), false);
    assert.equal(called.result.structuredContent.answer.includes(testKey), false);

    const invalidSidecarHome = path.join(temporaryRoot, "invalid-sidecar");
    fs.mkdirSync(invalidSidecarHome, { recursive: true });
    fs.copyFileSync(path.join(sidecarHome, "config.toml"), path.join(invalidSidecarHome, "config.toml"));
    fs.copyFileSync(modelsPath, path.join(invalidSidecarHome, "models.json"));
    const invalidClient = new McpClient({
      ...environment,
      DEEPSEEK_CODEX_HOME: invalidSidecarHome,
      DEEPSEEK_SIDECAR_TIMEOUT_MS: "not-an-integer",
    });
    try {
      await invalidClient.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "invalid-timeout-test", version: "1.0.0" },
      });
      const invalidTimeout = await invalidClient.request("tools/call", {
        name: "ask_deepseek",
        arguments: { prompt: "x", workspace_path: workspace },
      });
      assert.equal(invalidTimeout.result.isError, true);
      assert.match(
        invalidTimeout.result.content[0].text,
        /DEEPSEEK_SIDECAR_TIMEOUT_MS/,
      );
      assert.equal(
        fs.existsSync(path.join(invalidSidecarHome, "fake-invoked")),
        false,
      );
    } finally {
      await invalidClient.close();
    }

    const invalidField = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: { prompt: "x", max_tokens: 10 },
    });
    assert.equal(invalidField.result.isError, true);
    assert.match(invalidField.result.content[0].text, /unsupported fields/);

    const removedRole = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: { prompt: "x", role: "challenger" },
    });
    assert.equal(removedRole.result.isError, true);
    assert.match(removedRole.result.content[0].text, /unsupported fields/);

    const outsideWorkspace = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: { prompt: "x", workspace_path: temporaryRoot },
    });
    assert.equal(outsideWorkspace.result.isError, true);
    assert.match(outsideWorkspace.result.content[0].text, /outside DEEPSEEK_ALLOWED_ROOTS/);
  } finally {
    await client.close();
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
  process.stdout.write("DeepSeek Codex sidecar MCP offline tests passed.\n");
}

await main();
