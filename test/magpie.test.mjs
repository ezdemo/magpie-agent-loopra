import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Optional integration suite: requires a Magpie CLI supporting Agent plugins.
// Every Magpie invocation uses its own home, config, cache and gateway address.
test("real Magpie loads the module, switches models and restores typed config", { timeout: 180000 }, () => {
  const root = process.env.MAGPIE_PLUGIN_SPEC || fileURLToPath(new URL("../", import.meta.url));
  const home = mkdtempSync(path.join(tmpdir(), "magpie-loopra-test-"));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    MAGPIE_ADDR: "127.0.0.1:34987",
    MAGPIE_NO_ACCOUNTS: "1",
    NO_COLOR: "1",
  };
  const run = (...args) => {
    const result = spawnSync(process.env.MAGPIE_BIN || "magpie", args, {
      env, cwd: home, encoding: "utf8", timeout: 30000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `magpie ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const configPath = path.join(home, ".loopra", "config.json");
  const readConfig = () => JSON.parse(readFileSync(configPath, "utf8"));
  const original = {
    model: "original/coder",
    modelChannelId: "original",
    modelChannels: [{ id: "original", name: "Original", baseUrl: "https://original.example/v1",
      apiKey: "test-original-key", apiProtocol: "responses", specialCompatibility: "opencode",
      models: [{ name: "original/coder", contextTokens: 128000, maxTokens: 8192, imageInput: true, price: { input: 2 } }] }],
    apiKey: "test-legacy-key",
    baseUrl: "https://legacy.example/v1",
    apiProtocol: "anthropic",
    specialCompatibility: "original-compat",
    availableModels: ["original/coder"],
    reasoningEffort: "high",
    validationModel: "original/reviewer",
    validationModelChannelId: "original",
    imageUnderstandingModel: "original/vision",
    imageUnderstandingModelChannelId: "original",
    workspaceDir: "/my/workspace",
    custom: { enabled: true, budget: 42, ignored: [1, 2] },
  };
  try {
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(original, null, 2));
    console.log(run("--version").trim());
    run("plugin", "add", root);
    run("provider", "add", "fixture", "chat=http://127.0.0.1:34988/v1", "key=test-fixture-key", "models=coder,vision");
    run("loopra", "fixture/coder");
    const connected = readConfig();
    assert.equal(connected.model, "fixture/coder");
    assert.equal(connected.modelChannelId, "magpie");
    assert.equal(connected.modelChannels.length, 1);
    const channel = connected.modelChannels[0];
    assert.equal(channel.baseUrl, "http://127.0.0.1:34987/v1");
    assert.equal(channel.apiProtocol, "chat_completions");
    assert.equal(channel.apiKey, connected.apiKey);
    assert.ok(channel.apiKey.length > 0 && channel.apiKey !== original.apiKey);
    assert.ok(channel.models.some((entry) => entry.name === "fixture/coder"));
    assert.ok(channel.models.some((entry) => entry.name === "fixture/vision"));
    assert.deepEqual(connected.custom, original.custom);
    assert.equal(connected.reasoningEffort, "high");
    assert.equal(connected.validationModel, "fixture/coder");
    assert.equal(connected.validationModelChannelId, "magpie");
    assert.notEqual(connected.imageUnderstandingModel, original.imageUnderstandingModel);
    assert.match(run("loopra"), /fixture\/coder/);

    run("loopra", "fixture/vision");
    assert.equal(readConfig().model, "fixture/vision");
    run("loopra", "default");
    assert.deepEqual(readConfig(), original, "disconnect restores the original channel array and all legacy fields");

    // Legacy/minimal files must lose newly introduced keys on disconnect.
    const minimal = { model: "old-model", custom: { preserve: true } };
    writeFileSync(configPath, JSON.stringify(minimal));
    run("loopra", "fixture/coder");
    run("loopra", "default");
    assert.deepEqual(readConfig(), minimal);

    // Seed only the sandbox's library, then use Magpie's actual sync/cleanup.
    const settings = path.join(home, ".config", "magpie");
    const libraryDir = path.join(settings, "library");
    const skillDir = path.join(libraryDir, "skills", "loopra-fixture");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: loopra-fixture\ndescription: A local test fixture\n---\nUse the fixture.\n");
    writeFileSync(path.join(libraryDir, "instructions.md"), "Use the shared coding conventions.");
    const promptPath = path.join(home, ".loopra", "loopra.md");
    writeFileSync(promptPath, "# My existing preferences\n");
    const mcpPath = path.join(home, ".loopra", "mcp-servers.json");
    writeFileSync(mcpPath, JSON.stringify({ servers: [{ name: "mine", type: "stdio", command: "mine", enabled: false }], custom: true }));
    const library = {
      instructions: { agents: ["loopra"] },
      mcp: [{ name: "library-fixture", transport: "stdio", command: "fixture-command", args: ["--test"], agents: ["loopra"] }],
      skills: [{ name: "loopra-fixture", agents: ["loopra"] }],
      copySkills: true,
    };
    const libraryPath = path.join(settings, "library.json");
    writeFileSync(libraryPath, JSON.stringify(library));
    run("library", "sync");
    assert.match(readFileSync(promptPath, "utf8"), /My existing preferences/);
    assert.match(readFileSync(promptPath, "utf8"), /shared coding conventions/);
    assert.match(readFileSync(path.join(home, ".loopra", "skills", "loopra-fixture", "SKILL.md"), "utf8"), /Use the fixture/);
    const syncedMcp = JSON.parse(readFileSync(mcpPath, "utf8"));
    assert.equal(syncedMcp.mcpServers["library-fixture"].command, "fixture-command");
    assert.equal(syncedMcp.servers[0].name, "mine");
    assert.equal(syncedMcp.custom, true);

    // Resource assignments are independent of the Agent model connection.
    // Untick Loopra in the library to remove only library-managed content.
    const assigned = JSON.parse(readFileSync(libraryPath, "utf8"));
    assigned.instructions.agents = [];
    assigned.mcp[0].agents = [];
    assigned.skills[0].agents = [];
    writeFileSync(libraryPath, JSON.stringify(assigned));
    run("library", "sync");
    assert.equal(readFileSync(promptPath, "utf8").trim(), "# My existing preferences");
    const cleanedMcp = JSON.parse(readFileSync(mcpPath, "utf8"));
    assert.equal(cleanedMcp.mcpServers?.["library-fixture"], undefined);
    assert.equal(cleanedMcp.servers[0].name, "mine");
    assert.throws(() => readFileSync(path.join(home, ".loopra", "skills", "loopra-fixture", "SKILL.md")), /ENOENT/);
  } finally {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(tmpdir()));
    assert.ok(path.basename(home).startsWith("magpie-loopra-test-"));
    rmSync(home, { recursive: true, force: true });
  }
});
