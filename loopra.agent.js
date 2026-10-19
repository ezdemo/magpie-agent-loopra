// Agent-only module: Magpie runs this in moejs, without Node or filesystem APIs.
export const agent = {
  id: "loopra",
  name: "Loopra",
  bin: "loopra",
  dir: "~/.loopra",
  config: "~/.loopra/config.json",
  format: "json",
  model: "model",
  ua: ["loopra"],
  notice: "请重启 Loopra 服务以加载模型渠道配置；已有会话保留自己的模型设置，请新建会话或重新选择 Magpie 渠道和模型。",
};

const CHANNEL_ID = "magpie";
const DEFAULT_MAX_TOKENS = 32768;
const MAX_JAVA_INT = 2147483647;

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 && value <= MAX_JAVA_INT
    ? value
    : fallback;
}

function modelEntry(model) {
  return {
    name: model.id,
    contextTokens: positiveInt(model.context, -1),
    maxTokens: positiveInt(model.output, DEFAULT_MAX_TOKENS),
    imageInput: model.images === true,
  };
}

export function connect({ gateway, model, models = [] }) {
  if (!gateway || typeof gateway.v1 !== "string" || !gateway.v1.trim()
      || typeof gateway.key !== "string" || !gateway.key.trim()) {
    throw new Error("Loopra requires a Magpie gateway.v1 address and gateway.key.");
  }
  if (!model || typeof model.id !== "string" || !model.id.trim()) {
    throw new Error("Select a Magpie model before connecting Loopra.");
  }

  // The selected model may be absent from the catalog during a refresh.
  // Keep it first and preserve the complete provider/model ID accepted by Magpie.
  const entries = [];
  const seen = new Set();
  for (const candidate of [model, ...(Array.isArray(models) ? models : [])]) {
    if (!candidate || typeof candidate.id !== "string" || !candidate.id.trim()
        || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    entries.push(modelEntry(candidate));
  }

  const baseUrl = gateway.v1.trim().replace(/\/+$/, "");
  return {
    modelChannelId: CHANNEL_ID,
    modelChannels: [{
      id: CHANNEL_ID,
      name: "Magpie",
      baseUrl,
      apiKey: gateway.key,
      apiProtocol: "chat_completions",
      specialCompatibility: "",
      models: entries,
    }],
    // Legacy fields also keep older Loopra versions on the same gateway.
    // A top-level key lets Magpie detect the connection by its per-agent key.
    baseUrl,
    apiKey: gateway.key,
    apiProtocol: "chat_completions",
    specialCompatibility: "",
    availableModels: entries.map((entry) => entry.name),
  };
}
