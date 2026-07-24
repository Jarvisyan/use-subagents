#!/usr/bin/env node

import path from "node:path";
import { normalizeWorkerRequest, runWorker } from "./worker.mjs";

const workspaceRoot = path.resolve(
  process.argv[2] ?? ".tmp/deepseek-live",
);
const request = await normalizeWorkerRequest({
  workspace_root: workspaceRoot,
  task:
    "Edit README.md by adding exactly one final line: Bridge worker succeeded. Do not touch any other file.",
  reasoning_effort: "high",
  timeout_ms: 300000,
});
const result = await runWorker(request);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
