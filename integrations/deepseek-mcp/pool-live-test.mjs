#!/usr/bin/env node

import path from "node:path";
import {
  normalizeWorkerRequest,
  rootsAreIndependent,
  runWorker,
} from "./worker.mjs";

const roots = [
  path.resolve(process.argv[2] ?? ".tmp/deepseek-pool-a"),
  path.resolve(process.argv[3] ?? ".tmp/deepseek-pool-b"),
];
const requests = await Promise.all(
  roots.map((workspace_root, index) =>
    normalizeWorkerRequest({
      workspace_root,
      task: `Edit README.md by adding exactly one final line: Parallel worker ${index + 1} succeeded. Do not touch any other file.`,
      reasoning_effort: "high",
      timeout_ms: 300000,
    }),
  ),
);
if (!rootsAreIndependent(requests.map((request) => request.workspaceRoot))) {
  throw new Error("Live-test workspaces must be independent.");
}
const results = await Promise.all(requests.map((request) => runWorker(request)));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
