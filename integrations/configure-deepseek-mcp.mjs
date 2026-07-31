#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const BEGIN_MARKER = "# BEGIN use-subagents deepseek-hybrid";
const END_MARKER = "# END use-subagents deepseek-hybrid";

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const values = new Map();
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!current.startsWith("--")) {
      fail(`unexpected argument: ${current}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${current} requires a value`);
    }
    values.set(current, value);
    index += 1;
  }
  const required = ["--config", "--node", "--server", "--key-file"];
  for (const option of required) {
    if (!values.has(option)) {
      fail(`missing required option ${option}`);
    }
  }
  return {
    config: path.resolve(values.get("--config")),
    node: path.resolve(values.get("--node")),
    server: path.resolve(values.get("--server")),
    keyFile: path.resolve(values.get("--key-file")),
    dryRun,
  };
}

function validateKeyFile(keyFile) {
  let text;
  try {
    text = fs.readFileSync(keyFile, "utf8");
  } catch {
    fail(`DeepSeek key file is unreadable: ${keyFile}`);
  }
  const assignment = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(?:export\s+)?DEEPSEEK_API_KEY\s*=/.test(line));
  if (!assignment) {
    fail(`DEEPSEEK_API_KEY is missing from ${keyFile}`);
  }
  let value = assignment.replace(
    /^(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*/,
    "",
  );
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (!/^sk-[A-Za-z0-9_-]+$/.test(value)) {
    fail(`DeepSeek key in ${keyFile} has an unsupported format`);
  }
}

function removeManagedBlock(lines) {
  const output = [];
  let inside = false;
  let foundBegin = false;
  for (const line of lines) {
    if (line.trim() === BEGIN_MARKER) {
      if (inside) {
        fail("nested DeepSeek managed markers were found in config.toml");
      }
      inside = true;
      foundBegin = true;
      continue;
    }
    if (line.trim() === END_MARKER) {
      if (!inside) {
        fail("an unmatched DeepSeek end marker was found in config.toml");
      }
      inside = false;
      continue;
    }
    if (!inside) {
      output.push(line);
    }
  }
  if (inside || (foundBegin && !lines.some((line) => line.trim() === END_MARKER))) {
    fail("the DeepSeek managed block in config.toml is incomplete");
  }
  return output;
}

function createTomlScanner() {
  let multiline = "";
  let bracketDepth = 0;
  return {
    atTopLevel() {
      return multiline === "" && bracketDepth === 0;
    },
    scan(line) {
      let index = 0;
      let inlineString = "";
      while (index < line.length) {
        const character = line[index];
        const three = line.slice(index, index + 3);
        if (multiline) {
          const terminator = multiline === "basic" ? '\"\"\"' : "'''";
          if (three === terminator) {
            multiline = "";
            index += 3;
            continue;
          }
          if (multiline === "basic" && character === "\\") {
            index += 2;
            continue;
          }
          index += 1;
          continue;
        }
        if (inlineString) {
          if (inlineString === "basic" && character === "\\") {
            index += 2;
            continue;
          }
          if (
            (inlineString === "basic" && character === '"') ||
            (inlineString === "literal" && character === "'")
          ) {
            inlineString = "";
          }
          index += 1;
          continue;
        }
        if (three === '\"\"\"') {
          multiline = "basic";
          index += 3;
          continue;
        }
        if (three === "'''") {
          multiline = "literal";
          index += 3;
          continue;
        }
        if (character === "#") {
          break;
        }
        if (character === '"') {
          inlineString = "basic";
        } else if (character === "'") {
          inlineString = "literal";
        } else if (character === "[") {
          bracketDepth += 1;
        } else if (character === "]" && bracketDepth > 0) {
          bracketDepth -= 1;
        }
        index += 1;
      }
    },
  };
}

function sectionName(line) {
  const match = line.trim().match(/^\[([^\]]+)\](?:\s*#.*)?$/);
  if (!match) {
    return undefined;
  }
  return match[1].replaceAll('"', "").replaceAll("'", "").trim();
}

function removeLegacyDeepSeekSections(lines) {
  const scanner = createTomlScanner();
  const output = [];
  let skip = false;
  for (const line of lines) {
    if (scanner.atTopLevel()) {
      const name = sectionName(line);
      if (name !== undefined) {
        skip =
          name === "mcp_servers.deepseek" ||
          name.startsWith("mcp_servers.deepseek.");
      }
    }
    if (!skip) {
      output.push(line);
    }
    scanner.scan(line);
  }
  return output;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function managedBlock(options) {
  return [
    BEGIN_MARKER,
    "[mcp_servers.deepseek]",
    `command = ${tomlString(options.node)}`,
    `args = [${tomlString(options.server)}]`,
    'enabled_tools = ["ask_deepseek"]',
    "startup_timeout_sec = 10",
    "tool_timeout_sec = 14400",
    'default_tools_approval_mode = "approve"',
    "enabled = true",
    "",
    "[mcp_servers.deepseek.env]",
    `DEEPSEEK_API_KEY_FILE = ${tomlString(options.keyFile)}`,
    END_MARKER,
  ];
}

function timestamp() {
  const date = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    pad(date.getMilliseconds(), 3),
  ].join("");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  for (const [label, candidate] of [
    ["Node executable", options.node],
    ["MCP server", options.server],
  ]) {
    if (!fs.existsSync(candidate)) {
      fail(`${label} does not exist: ${candidate}`);
    }
  }
  validateKeyFile(options.keyFile);

  const original = fs.existsSync(options.config)
    ? fs.readFileSync(options.config, "utf8")
    : "";
  const hadLegacyDeepSeek = /^\s*\[mcp_servers\.deepseek\]/m.test(original);
  let lines = original.split(/\r?\n/);
  lines = removeManagedBlock(lines);
  lines = removeLegacyDeepSeekSections(lines);
  while (lines.length > 0 && lines.at(-1).trim() === "") {
    lines.pop();
  }
  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(...managedBlock(options), "");
  const updated = lines.join("\n");

  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        dry_run: true,
        config: options.config,
        replaces_legacy_deepseek_mcp: hadLegacyDeepSeek,
      })}\n`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(options.config), { recursive: true });
  let backup;
  if (fs.existsSync(options.config)) {
    backup = `${options.config}.bak-deepseek-${timestamp()}`;
    fs.copyFileSync(options.config, backup, fs.constants.COPYFILE_EXCL);
  }
  const temporary = path.join(
    path.dirname(options.config),
    `.${path.basename(options.config)}.deepseek-${process.pid}-${Date.now()}`,
  );
  try {
    fs.writeFileSync(temporary, updated, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, options.config);
    if (process.platform !== "win32") {
      fs.chmodSync(options.config, 0o600);
    }
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      config: options.config,
      backup,
      replaced_legacy_deepseek_mcp: hadLegacyDeepSeek,
      enabled_tools: ["ask_deepseek"],
    })}\n`,
  );
}

main();
