#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const BEGIN_MARKER = "# BEGIN use-subagents deepseek-hybrid";
const END_MARKER = "# END use-subagents deepseek-hybrid";
// Pinned to the official DeepSeek Codex setup script snapshot fetched on 2026-08-02.
// Updating the upstream catalog is an explicit backbone update, not an incidental edit.
const OFFICIAL_MODELS_SHA256 =
  "b459a6e438d6a9939d01fd0dbb4693f165ed732bc8e4fd58d7145d9d94bd49a4";

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
  const required = [
    "--config",
    "--node",
    "--server",
    "--key-file",
    "--sidecar-home",
    "--models",
  ];
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
    sidecarHome: path.resolve(values.get("--sidecar-home")),
    models: path.resolve(values.get("--models")),
    codexBin: values.has("--codex-bin")
      ? path.resolve(values.get("--codex-bin"))
      : "codex",
    allowedRoot: values.has("--allowed-root")
      ? path.resolve(values.get("--allowed-root"))
      : undefined,
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

function validateModelsFile(modelsPath) {
  let parsed;
  let contents;
  try {
    contents = fs.readFileSync(modelsPath);
    parsed = JSON.parse(contents.toString("utf8"));
  } catch {
    fail(`DeepSeek models.json is unreadable or invalid JSON: ${modelsPath}`);
  }
  const digest = crypto.createHash("sha256").update(contents).digest("hex");
  if (digest !== OFFICIAL_MODELS_SHA256) {
    fail(
      `DeepSeek models.json does not match the pinned official Codex catalog snapshot (expected ${OFFICIAL_MODELS_SHA256}, got ${digest})`,
    );
  }
  if (!Array.isArray(parsed?.models)) {
    fail(`DeepSeek models.json must contain a models array: ${modelsPath}`);
  }
  const model = parsed.models.find(
    (candidate) => candidate?.slug === "deepseek-v4-flash",
  );
  if (!model) {
    fail(`DeepSeek models.json does not contain deepseek-v4-flash: ${modelsPath}`);
  }
  if (!parsed.models.some((candidate) => candidate?.slug === "deepseek-v4-pro")) {
    fail("DeepSeek models.json does not contain the official deepseek-v4-pro entry");
  }
  if (model.context_window !== 1_048_576 || model.max_context_window !== 1_048_576) {
    fail("DeepSeek models.json must preserve the official 1M context window metadata");
  }
  if (!model.supported_reasoning_levels?.some((level) => level?.effort === "max")) {
    fail("DeepSeek models.json must advertise the max reasoning level");
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

function directDeepSeekFields(lines) {
  const scanner = createTomlScanner();
  const findings = [];
  for (const line of lines) {
    if (scanner.atTopLevel()) {
      const trimmed = line.trim();
      const assignment = trimmed.match(
        /^(model_provider|model|model_catalog_json)\s*=\s*(["'])(.*?)\2\s*(?:#.*)?$/,
      );
      if (assignment) {
        const [, field, , value] = assignment;
        if (
          (field === "model_provider" && value === "deepseek") ||
          (field === "model" && value.startsWith("deepseek-")) ||
          (field === "model_catalog_json" && /deepseek/i.test(value))
        ) {
          findings.push(`${field}=${value}`);
        }
      }
    }
    scanner.scan(line);
  }
  return findings;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function sidecarConfig(options) {
  return [
    `model = ${tomlString("deepseek-v4-flash")}`,
    'model_provider = "deepseek"',
    'preferred_auth_method = "apikey"',
    'forced_login_method = "api"',
    'model_reasoning_effort = "max"',
    `model_catalog_json = ${tomlString(path.join(options.sidecarHome, "models.json"))}`,
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    "",
    "[model_providers.deepseek]",
    'name = "deepseek"',
    'base_url = "https://api.deepseek.com/"',
    'wire_api = "responses"',
    'env_key = "DEEPSEEK_API_KEY"',
    "",
  ].join("\n");
}

function writeAtomic(filePath, contents, mode = 0o600) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.deepseek-${process.pid}-${Date.now()}`,
  );
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", mode });
    fs.renameSync(temporary, filePath);
    if (process.platform !== "win32") {
      fs.chmodSync(filePath, mode);
    }
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

function installSidecar(options) {
  fs.mkdirSync(options.sidecarHome, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    fs.chmodSync(options.sidecarHome, 0o700);
  }
  const sourceModels = fs.readFileSync(options.models, "utf8");
  writeAtomic(path.join(options.sidecarHome, "models.json"), sourceModels, 0o600);
  writeAtomic(
    path.join(options.sidecarHome, "config.toml"),
    sidecarConfig(options),
    0o600,
  );
}

function managedBlock(options) {
  const environment = [
    "[mcp_servers.deepseek.env]",
    `DEEPSEEK_API_KEY_FILE = ${tomlString(options.keyFile)}`,
    `DEEPSEEK_CODEX_HOME = ${tomlString(options.sidecarHome)}`,
    `DEEPSEEK_CODEX_BIN = ${tomlString(options.codexBin)}`,
  ];
  if (options.allowedRoot) {
    environment.push(
      `DEEPSEEK_ALLOWED_ROOTS = ${tomlString(options.allowedRoot)}`,
    );
  }
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
    ...environment,
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
    ["DeepSeek models.json", options.models],
  ]) {
    if (!fs.existsSync(candidate)) {
      fail(`${label} does not exist: ${candidate}`);
    }
  }
  validateKeyFile(options.keyFile);
  validateModelsFile(options.models);
  if (options.allowedRoot && !fs.existsSync(options.allowedRoot)) {
    fail(`allowed workspace root does not exist: ${options.allowedRoot}`);
  }
  if (options.codexBin !== "codex" && !fs.existsSync(options.codexBin)) {
    fail(`Codex executable does not exist: ${options.codexBin}`);
  }

  const original = fs.existsSync(options.config)
    ? fs.readFileSync(options.config, "utf8")
    : "";
  const directDeepSeek = directDeepSeekFields(original.split(/\r?\n/));
  if (directDeepSeek.length > 0) {
    fail(
      `主 config.toml 已包含 DeepSeek 直连字段 (${directDeepSeek.join(", ")})。请先恢复 GPT 主配置，再安装 MCP 混合接入；安装器不会擅自删除官方直连配置。`,
    );
  }
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
        sidecar_home: options.sidecarHome,
        model_catalog: options.models,
        default_reasoning_effort: "max",
        replaces_legacy_deepseek_mcp: hadLegacyDeepSeek,
      })}\n`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(options.config), { recursive: true });
  installSidecar(options);
  let backup;
  if (fs.existsSync(options.config)) {
    backup = `${options.config}.bak-deepseek-${timestamp()}`;
    fs.copyFileSync(options.config, backup, fs.constants.COPYFILE_EXCL);
  }
  writeAtomic(options.config, updated, 0o600);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      config: options.config,
      sidecar_home: options.sidecarHome,
      model_catalog: path.join(options.sidecarHome, "models.json"),
      default_reasoning_effort: "max",
      backup,
      replaced_legacy_deepseek_mcp: hadLegacyDeepSeek,
      enabled_tools: ["ask_deepseek"],
    })}\n`,
  );
}

main();
