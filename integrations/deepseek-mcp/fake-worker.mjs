import fs from "node:fs";
import path from "node:path";

const argumentsList = process.argv.slice(2);
const directoryIndex = argumentsList.indexOf("--dir");
const workspace = argumentsList[directoryIndex + 1];
const target = path.join(workspace, "worker-result.txt");
fs.writeFileSync(target, "implemented by fake worker\n", "utf8");

const sessionID = "fake-session";
const events = [
  {
    type: "tool_use",
    sessionID,
    part: {
      tool: "edit",
      state: {
        status: "completed",
        title: "worker-result.txt",
        metadata: { filediff: { file: target } },
      },
    },
  },
  {
    type: "text",
    sessionID,
    part: { text: "Fake worker completed." },
  },
  {
    type: "step_finish",
    sessionID,
    part: { cost: 0.001 },
  },
];

for (const event of events) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
