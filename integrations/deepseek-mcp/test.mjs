#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(directory, "server.mjs");
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

async function startMockProvider() {
  const requests = [];
  const provider = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        response.statusCode = 400;
        response.end("bad json");
        return;
      }
      requests.push({
        path: request.url,
        authorization: request.headers.authorization,
        body,
      });

      if (body.input === "force-auth-error") {
        response.statusCode = 401;
        response.end(
          JSON.stringify({ error: { message: `bad key ${testKey}` } }),
        );
        return;
      }
      if (body.input === "force-invalid-json") {
        response.statusCode = 200;
        response.end("not-json");
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.write("\n");
      setTimeout(() => {
        response.end(
          JSON.stringify({
            id: "resp_test",
            object: "response",
            status: "completed",
            model: "deepseek-v4-flash",
            output: [
              {
                type: "reasoning",
                content: [{ type: "reasoning_text", text: "private" }],
              },
              {
                type: "message",
                role: "assistant",
                content: [
                  { type: "output_text", text: "Independent answer" },
                ],
              },
            ],
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              total_tokens: 18,
              input_tokens_details: { cached_tokens: 3 },
              output_tokens_details: { reasoning_tokens: 2 },
            },
          }),
        );
      }, 10);
    });
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  return {
    provider,
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function main() {
  const { provider, requests, baseUrl } = await startMockProvider();
  const client = new McpClient({
    ...process.env,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: testKey,
    DEEPSEEK_BASE_URL: baseUrl,
    DEEPSEEK_REQUEST_TIMEOUT_MS: "5000",
    DEEPSEEK_IDLE_TIMEOUT_MS: "1000",
  });
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    assert.equal(
      initialized.result.serverInfo.name,
      "deepseek-responses-bridge",
    );

    const listed = await client.request("tools/list");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["ask_deepseek"],
    );
    assert.equal(
      Object.hasOwn(listed.result.tools[0].inputSchema.properties, "max_tokens"),
      false,
    );

    const called = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: {
        prompt: "Challenge this plan",
        context: "The plan has one assumption.",
        role: "challenger",
        reasoning_effort: "max",
      },
    });
    assert.equal(called.result.isError, false);
    assert.match(called.result.content[0].text, /Independent answer/);
    assert.equal(called.result.structuredContent.model, "deepseek-v4-flash");
    assert.deepEqual(called.result.structuredContent.usage, {
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
      cached_input_tokens: 3,
      reasoning_output_tokens: 2,
    });

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.path, "/responses");
    assert.equal(request.authorization, `Bearer ${testKey}`);
    assert.equal(request.body.model, "deepseek-v4-flash");
    assert.equal(request.body.stream, false);
    assert.deepEqual(request.body.reasoning, { effort: "max" });
    assert.match(request.body.input, /Context supplied by the parent agent/);
    assert.equal(Object.hasOwn(request.body, "max_tokens"), false);
    assert.equal(Object.hasOwn(request.body, "max_output_tokens"), false);
    assert.equal(Object.hasOwn(request.body, "store"), false);

    const invalid = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: { prompt: "x", max_tokens: 10 },
    });
    assert.equal(invalid.result.isError, true);
    assert.match(invalid.result.content[0].text, /unsupported fields/);

    const authError = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: { prompt: "force-auth-error" },
    });
    assert.equal(authError.result.isError, true);
    assert.equal(authError.result.content[0].text.includes(testKey), false);
    assert.match(authError.result.content[0].text, /^AUTH_FAILED:/);

    const badJson = await client.request("tools/call", {
      name: "ask_deepseek",
      arguments: { prompt: "force-invalid-json" },
    });
    assert.equal(badJson.result.isError, true);
    assert.match(badJson.result.content[0].text, /^BAD_RESPONSE:/);
  } finally {
    await client.close();
    provider.close();
    await once(provider, "close");
  }
  process.stdout.write("DeepSeek Responses MCP offline tests passed.\n");
}

await main();
