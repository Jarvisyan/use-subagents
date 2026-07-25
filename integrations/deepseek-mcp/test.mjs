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
    const rejectPending = (reason) => {
      // Snapshot entries so deletion during iteration is safe.
      for (const [id, pending] of [...this.pending]) {
        this.pending.delete(id);
        pending.reject(reason);
      }
    };
    this.child.on("error", (error) => {
      rejectPending(error);
    });
    this.child.on("exit", (code, signal) => {
      if (this.pending.size === 0) {
        return;
      }
      const safe = this.stderr
        .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
        .trim()
        .slice(0, 500);
      const detail = safe ? ` stderr: ${safe}` : "";
      rejectPending(
        new Error(
          `MCP server exited before responding (code=${code}, signal=${signal}).${detail}`,
        ),
      );
    });
    const lines = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      this.stdoutLines.push(line);
      try {
        const message = JSON.parse(line);
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.resolve(message);
        }
      } catch {
        // Malformed line — ignore; the pending timer will still fire.
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
      }, 60000);
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
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
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await once(this.child, "exit");
    }
    assert.equal(this.stderr, "");
  }
}

function writeSseEvent(response, dataLines) {
  for (const line of dataLines) {
    response.write(`${line}\r\n`);
  }
  response.write("\r\n");
}

function writeSseChunk(response, chunk, extraLines = []) {
  const lines = [...extraLines, `data: ${JSON.stringify(chunk)}`];
  writeSseEvent(response, lines);
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

      const scenario = body.messages?.[1]?.content;

      if (scenario === "force-redirect") {
        response.statusCode = 307;
        response.setHeader("Location", redirectLocation);
        response.end();
        return;
      }
      if (scenario === "force-provider-error") {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            error: { message: `Rejected credential ${testKey}` },
          }),
        );
        return;
      }
      if (scenario === "wait-for-cancel") {
        response.on("close", () => {
          cancelledConnections += 1;
        });
        return;
      }

      // SSE streaming responses
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");

      if (scenario === "no-content") {
        writeSseChunk(response, {
          id: "nobody",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        writeSseEvent(response, ["data: [DONE]"]);
        response.end();
        return;
      }

      if (scenario === "invalid-sse") {
        response.write("data: this is not valid json\r\n\r\n");
        response.end();
        return;
      }

      if (scenario === "large-response") {
        const payload = "x".repeat(17 * 1024 * 1024);
        response.end(`data: ${JSON.stringify({
          id: "big",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: payload }, finish_reason: null }],
        })}\r\n\r\n`);
        return;
      }

      if (scenario === "multi-data-line") {
        // SSE event with JSON split across two data: lines at a comma
        // When joined with \n, it forms valid JSON (newline is whitespace in JSON)
        response.write(`data: {"id":"multi","model":"deepseek-v4-pro",\r\n`);
        response.write(`data: "choices":[{"index":0,"delta":{"content":"Multi-line works"},"finish_reason":null}]}\r\n`);
        response.write("\r\n");

        writeSseChunk(response, {
          id: "multi-end",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        });
        writeSseEvent(response, ["data: [DONE]"]);
        response.end();
        return;
      }

      if (scenario === "keep-alive-test") {
        // Send keep-alive comments interspersed with data
        writeSseEvent(response, [": keep-alive"]);
        writeSseChunk(response, {
          id: "ka-1",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: "Keep" }, finish_reason: null }],
        });
        writeSseEvent(response, [": keep-alive"]);
        writeSseChunk(response, {
          id: "ka-2",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: " alive" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        });
        writeSseEvent(response, ["data: [DONE]"]);
        response.end();
        return;
      }

      if (scenario === "done-without-eof") {
        writeSseChunk(response, {
          id: "done-open",
          model: "deepseek-v4-pro",
          choices: [{
            index: 0,
            delta: { content: "Done without EOF" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        });
        writeSseEvent(response, ["data: [DONE]"]);
        // Intentionally leave the response open. The client must stop at [DONE].
        return;
      }

      if (scenario === "residual-event") {
        // Final event without trailing blank line
        writeSseChunk(response, {
          id: "res-1",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: "Residual" }, finish_reason: null }],
        });
        // Write last event without trailing \r\n\r\n
        response.write(`data: ${JSON.stringify({
          id: "res-2",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: " content" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        })}\r\n`);
        response.end();
        return;
      }

      if (scenario === "utf8-split") {
        // Build full SSE response as a Buffer and split a UTF-8 multi-byte
        // character across two response.write() calls.
        // "回" = E5 9B 9E in UTF-8 (3 bytes). Split after the first byte.
        const firstChunk = {
          id: "utf8-1",
          model: "deepseek-v4-pro",
          choices: [{
            index: 0,
            delta: { content: "DeepSeek回答问题" },
            finish_reason: "stop",
          }],
        };
        const usageChunk = {
          id: "utf8-2",
          model: "deepseek-v4-pro",
          choices: [{
            index: 0,
            delta: { content: "" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
        };
        const fullBuf = Buffer.from(
          `data: ${JSON.stringify(firstChunk)}\r\n\r\n` +
            `data: ${JSON.stringify(usageChunk)}\r\n\r\n` +
            `data: [DONE]\r\n\r\n`,
          "utf8",
        );
        const marker = Buffer.from("回", "utf8");
        const markerOffset = fullBuf.indexOf(marker);
        if (markerOffset === -1) {
          // Fallback: send whole buffer unsplit.
          response.end(fullBuf);
          return;
        }
        // Split after the first byte of "回" so the receiving TextDecoder
        // must reassemble the character from two network writes.
        const splitAt = markerOffset + 1;
        response.write(fullBuf.subarray(0, splitAt));
        setImmediate(() => {
          response.write(fullBuf.subarray(splitAt));
          response.end();
        });
        return;
      }

      if (scenario === "idle-timeout") {
        // Send one chunk then go silent
        writeSseChunk(response, {
          id: "idle-1",
          model: "deepseek-v4-pro",
          choices: [{ index: 0, delta: { content: "Starting" }, finish_reason: null }],
        });
        // Don't end - the idle timeout should trigger
        return;
      }

      if (scenario === "hard-timeout") {
        // Slowly send chunks that reset idle but hard timeout catches it
        let count = 0;
        function dribble() {
          if (count >= 100) return; // safety
          count++;
          response.write(`data: ${JSON.stringify({
            id: `hard-${count}`,
            model: "deepseek-v4-pro",
            choices: [{ index: 0, delta: { content: "." }, finish_reason: null }],
          })}\r\n\r\n`);
        }
        // Send first chunk immediately
        dribble();
        // Send more every 300ms to keep idle resetting
        const interval = setInterval(dribble, 300);
        response.on("close", () => clearInterval(interval));
        return;
      }

      // Default: normal successful SSE response
      const isTruncated = scenario === "force-length";
      const finishReason = isTruncated ? "length" : "stop";
      const part1 = isTruncated ? "Partial DeepSeek" : "Mock DeepSeek";
      const part2 = isTruncated ? " answer" : " answer";

      writeSseChunk(response, {
        id: "mock-1",
        object: "chat.completion.chunk",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: part1, reasoning_content: "This must not be returned." }, finish_reason: null }],
      });

      writeSseChunk(response, {
        id: "mock-2",
        object: "chat.completion.chunk",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: part2 }, finish_reason: finishReason }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      });

      writeSseEvent(response, ["data: [DONE]"]);
      response.end();
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

  // --- No-key tests ---
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

  // Verify ask_deepseek schema does NOT expose max_tokens
  const askTool = tools.result.tools[0];
  assert.equal(askTool.name, "ask_deepseek");
  assert.equal("max_tokens" in askTool.inputSchema.properties, false,
    "max_tokens must not appear in the public schema");
  assert.equal(askTool.annotations.openWorldHint, true);
  assert.equal(askTool.annotations.readOnlyHint, false);
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

  // --- Worker isolation tests ---
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

  // --- Redirect test ---
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

  // --- Main SSE mock provider ---
  const mock = await startMockProvider(redirectLocation);
  const client = new McpClient({
    ...baseEnvironment,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: testKey,
    DEEPSEEK_BASE_URL: mock.baseUrl,
    DEEPSEEK_REQUEST_TIMEOUT_MS: "30000",
    DEEPSEEK_IDLE_TIMEOUT_MS: "10000",
  });

  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bridge-test", version: "1.0.0" },
  });
  client.notify("notifications/initialized");

  // --- Test 1: Normal SSE call ---
  const successfulCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "Make a plan",
      context: "Small context",
      role: "planner",
      reasoning_effort: "max",
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
  // max_tokens is always 384000 and stream is always true
  assert.equal(mock.requests[0].body.max_tokens, 384000);
  assert.equal(mock.requests[0].body.stream, true);
  assert.match(mock.requests[0].body.messages[0].content, /independent planner/i);
  assert.match(mock.requests[0].body.messages[1].content, /Small context/);

  // --- Test 2: max_tokens is rejected (unsupported fields) ---
  const maxTokensRejected = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "hello",
      max_tokens: 100,
    },
  });
  assert.equal(maxTokensRejected.result.isError, true);
  assert.match(
    maxTokensRejected.result.content[0].text,
    /unsupported fields/,
  );
  // Provider must NOT have been called for this rejected request
  assert.equal(mock.requests.length, 1,
    "Provider should not receive a request when max_tokens is rejected");

  // --- Test 3: Default max_tokens=384000 in request body ---
  const highEffortDefault = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "Use the high-effort default",
      reasoning_effort: "high",
    },
  });
  assert.equal(highEffortDefault.result.isError, false);
  assert.equal(mock.requests[1].body.reasoning_effort, "high");
  assert.equal(mock.requests[1].body.max_tokens, 384000);
  assert.equal(mock.requests[1].body.stream, true);

  const maxEffortDefault = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: {
      prompt: "Use the max-effort default",
      reasoning_effort: "max",
    },
  });
  assert.equal(maxEffortDefault.result.isError, false);
  assert.equal(mock.requests[2].body.reasoning_effort, "max");
  assert.equal(mock.requests[2].body.max_tokens, 384000);
  assert.equal(mock.requests[2].body.stream, true);

  // --- Test 4: Truncated (finish_reason: length) ---
  const truncatedCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "force-length" },
  });
  assert.equal(truncatedCall.result.isError, false);
  assert.equal(truncatedCall.result.structuredContent.finish_reason, "length");
  assert.equal(truncatedCall.result.structuredContent.truncated, true);
  assert.match(truncatedCall.result.content[0].text, /TRUNCATED/);
  assert.equal(mock.requests[3].body.max_tokens, 384000);

  // --- Test 5: Rejected extra field (model) ---
  const rejectedArgument = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "hello", model: "deepseek-v4-flash" },
  });
  assert.equal(rejectedArgument.result.isError, true);
  assert.match(
    rejectedArgument.result.content[0].text,
    /unsupported fields/,
  );
  assert.equal(mock.requests.length, 4, "Provider should not be called for rejected arguments");

  // --- Test 6: Role rejection does not leak secret ---
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
  assert.equal(mock.requests.length, 4);

  // --- Test 7: Provider error response ---
  const providerError = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "force-provider-error" },
  });
  assert.equal(providerError.result.isError, true);
  assert.match(providerError.result.content[0].text, /AUTH_FAILED/);
  assert.doesNotMatch(providerError.result.content[0].text, new RegExp(testKey));

  // --- Test 8: Redirect rejection ---
  const redirectedCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "force-redirect" },
  });
  assert.equal(redirectedCall.result.isError, true);
  assert.equal(redirectedRequests, 0);

  // --- Test 9: Cancellation ---
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

  // --- Test 10: No content delta in SSE ---
  const noContentCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "no-content" },
  });
  assert.equal(noContentCall.result.isError, true);
  assert.match(noContentCall.result.content[0].text, /BAD_RESPONSE/);

  // --- Test 11: Invalid SSE JSON ---
  const invalidSseCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "invalid-sse" },
  });
  assert.equal(invalidSseCall.result.isError, true);
  assert.match(invalidSseCall.result.content[0].text, /BAD_RESPONSE/);

  // --- Test 12: Final answer exceeds 16MiB limit ---
  const largeCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "large-response" },
  });
  assert.equal(largeCall.result.isError, true);
  assert.match(largeCall.result.content[0].text, /BAD_RESPONSE/);

  // --- Test 13: Multi-data-line SSE event ---
  const multiDataCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "multi-data-line" },
  });
  assert.equal(multiDataCall.result.isError, false);
  assert.match(multiDataCall.result.content[0].text, /Multi-line works/);

  // --- Test 14: Keep-alive comments ---
  const keepAliveCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "keep-alive-test" },
  });
  assert.equal(keepAliveCall.result.isError, false);
  assert.match(keepAliveCall.result.content[0].text, /Keep alive/);

  // --- Test 15: [DONE] terminates without waiting for EOF ---
  const doneWithoutEofCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "done-without-eof" },
  });
  assert.equal(doneWithoutEofCall.result.isError, false);
  assert.match(doneWithoutEofCall.result.content[0].text, /Done without EOF/);

  // --- Test 16: Residual event (no trailing blank line) ---
  const residualCall = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "residual-event" },
  });
  assert.equal(residualCall.result.isError, false);
  assert.match(residualCall.result.content[0].text, /Residual content/);

  // --- Test 17: UTF-8 split across byte boundaries ---
  const utf8Call = await client.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "utf8-split" },
  });
  assert.equal(utf8Call.result.isError, false);
  assert.doesNotMatch(
    utf8Call.result.content[0].text,
    /\uFFFD/,
    "UTF-8 byte split must not produce replacement characters",
  );
  assert.equal(
    utf8Call.result.structuredContent.answer,
    "DeepSeek回答问题",
    "Answer must equal expected Chinese text after byte-level split",
  );

  // --- Test 18: Idle timeout ---
  // Create a separate client with very short idle timeout
  const idleClient = new McpClient({
    ...baseEnvironment,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: testKey,
    DEEPSEEK_BASE_URL: mock.baseUrl,
    DEEPSEEK_REQUEST_TIMEOUT_MS: "10000",
    DEEPSEEK_IDLE_TIMEOUT_MS: "1000",
  });
  await idleClient.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "idle-test", version: "1.0.0" },
  });
  idleClient.notify("notifications/initialized");
  const idleTimeoutCall = await idleClient.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "idle-timeout" },
  });
  assert.equal(idleTimeoutCall.result.isError, true);
  assert.match(idleTimeoutCall.result.content[0].text, /UPSTREAM_IDLE_TIMEOUT/);
  await idleClient.close();

  // --- Test 19: Hard timeout ---
  const hardClient = new McpClient({
    ...baseEnvironment,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: testKey,
    DEEPSEEK_BASE_URL: mock.baseUrl,
    DEEPSEEK_REQUEST_TIMEOUT_MS: "2000",
    DEEPSEEK_IDLE_TIMEOUT_MS: "300000",
  });
  await hardClient.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hard-test", version: "1.0.0" },
  });
  hardClient.notify("notifications/initialized");
  const hardTimeoutCall = await hardClient.request("tools/call", {
    name: "ask_deepseek",
    arguments: { prompt: "hard-timeout" },
  });
  assert.equal(hardTimeoutCall.result.isError, true);
  assert.match(hardTimeoutCall.result.content[0].text, /UPSTREAM_TIMEOUT/);
  await hardClient.close();

  // --- Final assertions ---
  const allRpcOutput = client.stdoutLines.join("\n");
  assert.doesNotMatch(allRpcOutput, new RegExp(testKey));
  assert.doesNotMatch(allRpcOutput, /This must not be returned/);
  await client.close();
  await new Promise((resolve) => mock.server.close(resolve));
  await new Promise((resolve) => redirectTarget.close(resolve));

  // --- Production override rejection ---
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
