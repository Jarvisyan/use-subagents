#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  normalizeWorkerRequest,
  rootsAreIndependent,
  runWorker,
} from "./worker.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(directory, "server.mjs");
const fakeWorkerPath = path.join(directory, "fake-worker.mjs");
const projectRoot = path.resolve(directory, "..", "..");
const testKey = "test-secret-value-never-print";

class McpClient {
  constructor(environment) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.stdoutLines = [];
    this.child = spawn(process.execPath, [serverPath], {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    const lines = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      this.stdoutLines.push(line);
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message);
      }
    });
  }

  request(method, params = {}) {
    return this.beginRequest(method, params).response;
  }

  beginRequest(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 5000);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return { id, response };
  }

  notify(method, params = {}) {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  async close() {
    this.child.stdin.end();
    if (this.child.exitCode === null) {
      await once(this.child, "exit");
    }
    assert.equal(this.stderr, "");
  }
}

async function startMockProvider(redirectLocation) {
  const requests = [];
  let cancelledConnections = 0;
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({
        path: request.url,
        authorization: request.headers.authorization,
        body,
      });

      response.setHeader("Content-Type", "application/json");
      if (body.messages?.[1]?.content === "force-redirect") {
        response.statusCode = 307;
        response.setHeader("Location", redirectLocation);
        response.end();
        return;
      }
      if (body.messages?.[1]?.content === "force-provider-error") {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            error: { message: `Rejected credential ${testKey}` },
          }),
        );
        return;
      }
      if (body.messages?.[1]?.content === "wait-for-cancel") {
        response.on("close", () => {
          cancelledConnections += 1;
        });
        return;
      }

      response.statusCode = 200;
      const forcedLength =
        body.messages?.[1]?.content === "force-length";
      response.end(
        JSON.stringify({
          id: "mock-response",
          model: "deepseek-v4-pro",
          choices: [
            {
              finish_reason: forcedLength ? "length" : "stop",
              index: 0,
              message: {
                role: "assistant",
                content: forcedLength
                  ? "Partial DeepSeek answer"
                  : "Mock DeepSeek answer",
                reasoning_content: "This must not be returned.",
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
          },
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    requests,
    cancelledConnections: () => cancelledConnections,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function run() {
  const baseEnvironment = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    DEEPSEEK_ALLOWED_ROOTS: projectRoot,
  };

  const noKeyClient = new McpClient(baseEnvironment);
  const initialize = await noKeyClient.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bridge-test", version: "1.0.0" },
  });
  assert.equal(initialize.result.serverInfo.name, "deepseek-bridge");
  noKeyClient.notify("notifications/initialized");

  const tools = await noKeyClient.request("tools/list");
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name),
    [
      "ask_deepseek",
      "run_deepseek_worker",
      "run_deepseek_workers",
    ],
  );
  assert.equal(tools.result.tools[0].annotations.openWorldHint, true);
  assert.equal(tools.result.tools[0].annotations.readOnlyHint, false);
  assert.equal(tools.result.tools[1].annotations.readOnlyHint, false);
  assert.match(tools.result.tools[1].description, /cannot use a terminal/i);

  const missingKey = await noKeyClient.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "hello" },
  });
  assert.equal(missingKey.result.isError, true);
  assert.match(missingKey.result.content[0].text, /DEEPSEEK_API_KEY/);

  const missingWorkerKey = await noKeyClient.request("tools/call", {
    name: "run_deepseek_worker",
    arguments: {
      workspace_root: projectRoot,
      task: "Create one file.",
    },
  });
  assert.equal(missingWorkerKey.result.isError, true);
  assert.match(missingWorkerKey.result.content[0].text, /DEEPSEEK_API_KEY/);

  const conflictingWorkers = await noKeyClient.request("tools/call", {
    name: "run_deepseek_workers",
    arguments: {
      jobs: [
        { workspace_root: projectRoot, task: "First task." },
        { workspace_root: projectRoot, task: "Second task." },
      ],
    },
  });
  assert.equal(conflictingWorkers.result.isError, true);
  assert.match(conflictingWorkers.result.content[0].text, /WORKSPACE_CONFLICT/);
  await noKeyClient.close();

  const fakeWorkspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "deepseek-worker-test-"),
  );
  const previousAllowedRoots = process.env.DEEPSEEK_ALLOWED_ROOTS;
  try {
    await fs.mkdir(path.join(fakeWorkspace, ".git"));
    process.env.DEEPSEEK_ALLOWED_ROOTS = [projectRoot, fakeWorkspace].join(
      path.delimiter,
    );
    const normalized = await normalizeWorkerRequest({
      workspace_root: fakeWorkspace,
      task: "Create the requested result.",
      reasoning_effort: "high",
      timeout_ms: 30000,
    });
    assert.equal(rootsAreIndependent([fakeWorkspace, projectRoot]), true);
    assert.equal(rootsAreIndependent([fakeWorkspace, fakeWorkspace]), false);
    const workerResult = await runWorker(normalized, {
      apiKey: testKey,
      binary: process.execPath,
      argsPrefix: [fakeWorkerPath],
    });
    assert.equal(workerResult.summary, "Fake worker completed.");
    assert.deepEqual(workerResult.changed_files, [
      path.join(fakeWorkspace, "worker-result.txt"),
    ]);
    assert.equal(workerResult.estimated_cost_usd, 0.001);
    assert.equal(
      await fs.readFile(path.join(fakeWorkspace, "worker-result.txt"), "utf8"),
      "implemented by fake worker\n",
    );
    await fs.writeFile(path.join(fakeWorkspace, ".env"), "SECRET=test\n");
    await assert.rejects(
      normalizeWorkerRequest({
        workspace_root: fakeWorkspace,
        task: "Must be rejected.",
      }),
      /remove sensitive file/i,
    );
    await fs.rm(path.join(fakeWorkspace, ".env"));
    await fs.writeFile(path.join(fakeWorkspace, "opencode.json"), "{}\n");
    await assert.rejects(
      normalizeWorkerRequest({
        workspace_root: fakeWorkspace,
        task: "Must be rejected.",
      }),
      /can alter the isolated OpenCode runtime/i,
    );
  } finally {
    if (previousAllowedRoots === undefined) {
      delete process.env.DEEPSEEK_ALLOWED_ROOTS;
    } else {
      process.env.DEEPSEEK_ALLOWED_ROOTS = previousAllowedRoots;
    }
    await fs.rm(fakeWorkspace, { recursive: true, force: true });
  }

  let redirectedRequests = 0;
  const redirectTarget = http.createServer((_request, response) => {
    redirectedRequests += 1;
    response.statusCode = 200;
    response.end("{}");
  });
  redirectTarget.listen(0, "127.0.0.1");
  await once(redirectTarget, "listening");
  const redirectAddress = redirectTarget.address();
  const redirectLocation = `http://127.0.0.1:${redirectAddress.port}/capture`;

  const mock = await startMockProvider(redirectLocation);
  const client = new McpClient({
    ...baseEnvironment,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: testKey,
    DEEPSEEK_BASE_URL: mock.baseUrl,
    DEEPSEEK_REQUEST_TIMEOUT_MS: "5000",
  });

  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bridge-test", version: "1.0.0" },
  });
  client.notify("notifications/initialized");

  const successfulCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "Make a plan",
      context: "Small context",
      role: "planner",
      reasoning_effort: "max",
      max_tokens: 1234,
    },
  });
  assert.equal(successfulCall.result.isError, false);
  assert.match(successfulCall.result.content[0].text, /Mock DeepSeek answer/);
  assert.equal(successfulCall.result.structuredContent.finish_reason, "stop");
  assert.equal(successfulCall.result.structuredContent.truncated, false);
  assert.doesNotMatch(
    successfulCall.result.content[0].text,
    /This must not be returned/,
  );
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].path, "/chat/completions");
  assert.equal(mock.requests[0].authorization, `Bearer ${testKey}`);
  assert.doesNotMatch(JSON.stringify(mock.requests[0].body), new RegExp(testKey));
  assert.equal(mock.requests[0].body.model, "deepseek-v4-pro");
  assert.deepEqual(mock.requests[0].body.thinking, { type: "enabled" });
  assert.equal(mock.requests[0].body.reasoning_effort, "max");
  assert.equal(mock.requests[0].body.max_tokens, 1234);
  assert.match(mock.requests[0].body.messages[0].content, /independent planner/i);
  assert.match(mock.requests[0].body.messages[1].content, /Small context/);

  const maxEffortDefault = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "Use the max-effort default",
      reasoning_effort: "max",
    },
  });
  assert.equal(maxEffortDefault.result.isError, false);
  assert.equal(mock.requests[1].body.reasoning_effort, "max");
  assert.equal(mock.requests[1].body.max_tokens, 32768);

  const truncatedCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "force-length",
      max_tokens: 384000,
    },
  });
  assert.equal(truncatedCall.result.isError, false);
  assert.equal(truncatedCall.result.structuredContent.finish_reason, "length");
  assert.equal(truncatedCall.result.structuredContent.truncated, true);
  assert.match(truncatedCall.result.content[0].text, /TRUNCATED/);
  assert.equal(mock.requests[2].body.max_tokens, 384000);

  const rejectedArgument = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "hello", model: "deepseek-v4-flash" },
  });
  assert.equal(rejectedArgument.result.isError, true);
  assert.match(
    rejectedArgument.result.content[0].text,
    /unsupported fields/,
  );
  assert.equal(mock.requests.length, 3);

  const secretRole = "invalid-role-with-secret-material";
  const rejectedRole = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "hello", role: secretRole },
  });
  assert.equal(rejectedRole.result.isError, true);
  assert.doesNotMatch(
    rejectedRole.result.content[0].text,
    new RegExp(secretRole),
  );
  assert.equal(mock.requests.length, 3);

  const providerError = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "force-provider-error" },
  });
  assert.equal(providerError.result.isError, true);
  assert.match(providerError.result.content[0].text, /AUTH_FAILED/);
  assert.doesNotMatch(providerError.result.content[0].text, new RegExp(testKey));

  const redirectedCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "force-redirect" },
  });
  assert.equal(redirectedCall.result.isError, true);
  assert.equal(redirectedRequests, 0);

  const cancellable = client.beginRequest("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "wait-for-cancel" },
  });
  setTimeout(() => {
    client.notify("notifications/cancelled", {
      requestId: cancellable.id,
      reason: "test cancellation",
    });
  }, 50);
  const cancelledCall = await cancellable.response;
  assert.equal(cancelledCall.result.isError, true);
  assert.match(cancelledCall.result.content[0].text, /CANCELLED/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(mock.cancelledConnections(), 1);

  const allRpcOutput = client.stdoutLines.join("\n");
  assert.doesNotMatch(allRpcOutput, new RegExp(testKey));
  assert.doesNotMatch(allRpcOutput, /This must not be returned/);
  await client.close();
  await new Promise((resolve) => mock.server.close(resolve));
  await new Promise((resolve) => redirectTarget.close(resolve));

  const productionOverrideClient = new McpClient({
    ...baseEnvironment,
    DEEPSEEK_API_KEY: "test-production-shaped-key",
    DEEPSEEK_BASE_URL: mock.baseUrl,
  });
  await productionOverrideClient.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bridge-test", version: "1.0.0" },
  });
  const rejectedOverride = await productionOverrideClient.request(
    "tools/call",
    {
      name: "ask_deepseek",
      arguments: { prompt: "hello" },
    },
  );
  assert.equal(rejectedOverride.result.isError, true);
  assert.match(rejectedOverride.result.content[0].text, /INVALID_CONFIG/);
  await productionOverrideClient.close();
}

await run();
process.stdout.write("DeepSeek bridge tests passed.\n");
