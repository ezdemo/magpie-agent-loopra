import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { agent, connect } from "../loopra.agent.js";
import { policy } from "../loopra-policy.js";

const gateway = { url: "http://127.0.0.1:3489", v1: "http://127.0.0.1:3489/v1", key: "test-loopra-agent-key" };
const model = { id: "example/coder", name: "Example Coder", context: 200000, output: 16000, images: true };

test("package is an Agent-only plugin with an installable entry point", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.magpie.agent, "./loopra.agent.js");
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.exports, undefined);
  assert.equal(agent.config, "~/.loopra/config.json");
  assert.equal(agent.model, "model");
  assert.equal(agent.id, "loopra");
  assert.equal(agent.prefix, undefined);
});

test("current and legacy Loopra configurations use the same gateway and full model IDs", () => {
  const output = connect({ gateway, model });
  const channel = output.modelChannels.find((item) => item.id === output.modelChannelId);
  assert.equal(channel.apiProtocol, "chat_completions");
  assert.equal(channel.baseUrl + "/chat/completions", gateway.v1 + "/chat/completions");
  assert.equal(channel.apiKey, gateway.key);
  assert.equal(channel.specialCompatibility, "");
  assert.equal(output.apiKey, gateway.key);
  assert.equal(output.baseUrl, channel.baseUrl);
  assert.equal(output.apiProtocol, channel.apiProtocol);
  assert.equal(output.specialCompatibility, "");
  assert.deepEqual(output.availableModels, [model.id]);
  assert.deepEqual(channel.models, [{ name: model.id, displayName: model.name, contextTokens: 200000, maxTokens: 16000, imageInput: true }]);
  assert.equal(output.model, undefined, "Magpie itself writes agent.model");
});

test("model catalog retains provider namespaces, selects first and removes duplicates", () => {
  const models = [
    { ...model, id: "other/coder", images: false },
    { ...model, output: 1 },
    { id: "group/daily", context: 100000, output: 8000 },
    null, {}, { id: "" }, { id: " " },
  ];
  const before = structuredClone(models);
  const output = connect({ gateway, model, models });
  assert.deepEqual(output.availableModels, ["example/coder", "other/coder", "group/daily"]);
  assert.equal(output.modelChannels[0].models[0].maxTokens, 16000);
  assert.equal(output.modelChannels[0].models[1].imageInput, false);
  assert.deepEqual(models, before);
});

test("unknown or invalid limits use Loopra defaults without claiming image support", () => {
  for (const value of [undefined, null, 0, -1, 1.5, Infinity, NaN, "4096", 2147483648]) {
    const output = connect({ gateway, model: { id: "test/unknown", context: value, output: value, images: "true" } });
    assert.deepEqual(output.modelChannels[0].models[0], {
      name: "test/unknown", contextTokens: -1, maxTokens: 32768, imageInput: false,
    });
  }
});

test("display names support provider models and route groups without changing model identities", () => {
  const selected = { ...model, name: "  编程助手 / Coder  " };
  const models = [
    { ...selected, name: "Stale duplicate" },
    { id: "other/very-long-model-id", name: "编程助手 / Coder" },
    { id: "group/daily", name: "日常智能路由" },
  ];
  const before = structuredClone({ selected, models });
  const output = connect({ gateway, model: selected, models });
  assert.deepEqual(output.modelChannels[0].models.map(({ name, displayName }) => ({ name, displayName })), [
    { name: model.id, displayName: "编程助手 / Coder" },
    { name: "other/very-long-model-id", displayName: "编程助手 / Coder" },
    { name: "group/daily", displayName: "日常智能路由" },
  ]);
  assert.deepEqual(output.availableModels, [model.id, "other/very-long-model-id", "group/daily"]);
  assert.equal(output.validationModel, model.id);
  assert.equal(output.imageUnderstandingModel, model.id);
  assert.deepEqual({ selected, models }, before);
});

test("missing, blank or invalid display names leave Loopra's model ID fallback intact", () => {
  for (const name of [undefined, null, "", " \t\n ", 42, {}, ["Alias"]]) {
    const output = connect({ gateway, model: { ...model, name } });
    assert.equal(Object.hasOwn(output.modelChannels[0].models[0], "displayName"), false);
    assert.deepEqual(output.availableModels, [model.id]);
  }
});

test("catalog refresh updates display names and removes cleared aliases", () => {
  for (const name of ["Old name", "新展示名", ""]) {
    const output = connect({ gateway, model: { ...model, name } });
    assert.equal(output.modelChannels[0].models[0].displayName, name || undefined);
    assert.deepEqual(output.availableModels, [model.id]);
  }
});

test("catalog refresh replaces stale models and handles missing catalogs", () => {
  const first = connect({ gateway, model, models: [{ id: "old/model" }] });
  const refreshed = connect({ gateway, model: { id: "new/model" }, models: null });
  assert.deepEqual(first.availableModels, ["example/coder", "old/model"]);
  assert.deepEqual(refreshed.availableModels, ["new/model"]);
  assert.equal(refreshed.modelChannelId, first.modelChannelId);
});

test("normalizes a trailing slash and accepts remote HTTPS gateways", () => {
  const output = connect({ gateway: { ...gateway, v1: "https://gateway.example/proxy/v1/// " }, model });
  assert.equal(output.baseUrl, "https://gateway.example/proxy/v1");
});

test("rejects incomplete inputs before Magpie writes any configuration", () => {
  for (const badGateway of [undefined, {}, { v1: gateway.v1 }, { ...gateway, key: " " }, { ...gateway, v1: 7 }]) {
    assert.throws(() => connect({ gateway: badGateway, model }), /gateway/);
  }
  for (const badModel of [undefined, {}, { id: "" }, { id: " " }]) {
    assert.throws(() => connect({ gateway, model: badModel }), /Select a Magpie model/);
  }
});

test("library targets match Loopra's existing instruction, skill and MCP readers", () => {
  assert.deepEqual(agent.library, {
    skills: "~/.loopra/skills", instructions: "~/.loopra/loopra.md",
    mcp: "~/.loopra/mcp-servers.json", mcpFormat: "claude",
  });
});

test("automatic effort selects a supported default and leaves unknown capabilities untouched", () => {
  for (const [efforts, expected] of [
    [["low", "medium", "high", "xhigh"], "high"],
    [["low", "medium"], "medium"], [["xhigh"], "xhigh"],
    [["none"], "none"], [["max"], "max"], [[], undefined], [null, undefined],
    [["future-effort"], undefined],
  ]) {
    const output = connect({ gateway, model: { ...model, efforts } });
    assert.equal(output.reasoningEffort, expected);
    if (expected === undefined) assert.equal(Object.hasOwn(output, "reasoningEffort"), false);
  }
});

test("auxiliary defaults reuse the selected model and find an image-capable fallback", () => {
  const selected = { id: "example/text", images: false };
  const output = connect({ gateway, model: selected, models: [selected, model] });
  assert.equal(output.validationModel, selected.id);
  assert.equal(output.validationModelChannelId, output.modelChannelId);
  assert.equal(output.imageUnderstandingModel, model.id);
  assert.equal(output.imageUnderstandingModelChannelId, output.modelChannelId);
  const noVision = connect({ gateway, model: selected });
  assert.equal(noVision.imageUnderstandingModel, "");
  assert.equal(noVision.imageUnderstandingModelChannelId, "");
  assert.equal(connect({ gateway, model }).imageUnderstandingModel, model.id);
});

test("local policy can select or disable auxiliaries and rejects unavailable models", () => {
  const original = { ...policy };
  try {
    policy.validationModel = "other/reviewer";
    policy.imageUnderstandingModel = "other/vision";
    const models = [{ id: "other/reviewer" }, { id: "other/vision", images: true }];
    const output = connect({ gateway, model, models });
    assert.equal(output.validationModel, "other/reviewer");
    assert.equal(output.imageUnderstandingModel, "other/vision");
    assert.throws(() => connect({ gateway, model }), /unavailable/);
    policy.validationModel = "none";
    policy.imageUnderstandingModel = "none";
    const disabled = connect({ gateway, model });
    assert.equal(disabled.validationModel, "");
    assert.equal(disabled.validationModelChannelId, "");
    assert.equal(disabled.imageUnderstandingModel, "");
    assert.equal(disabled.imageUnderstandingModelChannelId, "");
    policy.reasoningEffort = "medium";
    assert.equal(connect({ gateway, model: { ...model, efforts: ["medium", "high"] } }).reasoningEffort, "medium");
    assert.throws(() => connect({ gateway, model: { ...model, efforts: ["high"] } }), /not supported/);
  } finally {
    Object.assign(policy, original);
  }
});
