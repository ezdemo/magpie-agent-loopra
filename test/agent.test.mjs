import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { agent, connect } from "../loopra.agent.js";

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
  assert.deepEqual(channel.models, [{ name: model.id, contextTokens: 200000, maxTokens: 16000, imageInput: true }]);
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
