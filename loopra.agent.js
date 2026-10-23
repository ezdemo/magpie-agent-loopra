// Agent-only module: Magpie runs this in moejs, without Node or filesystem APIs.
import { policy } from "./loopra-policy.js";
export const agent = {
  id: "loopra",
  name: "Loopra",
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsbGVkYnk9InRpdGxlIGRlc2MiPg0KICA8dGl0bGUgaWQ9InRpdGxlIj5Mb29wcmE8L3RpdGxlPg0KICA8ZGVzYyBpZD0iZGVzYyI+QSBjb21wYWN0IGxldHRlciBMIGluc2lkZSBhIGJhbGFuY2VkIHJvdW5kZWQgbG9vcC48L2Rlc2M+DQogIDxkZWZzPg0KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibG9vcHJhLXJpbmciIHgxPSIyMCIgeTE9IjE4IiB4Mj0iNzgiIHkyPSI4MCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPg0KICAgICAgPHN0b3Agc3RvcC1jb2xvcj0iIzJGODBFRCIvPg0KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNUI5Q0YyIi8+DQogICAgPC9saW5lYXJHcmFkaWVudD4NCiAgPC9kZWZzPg0KICA8cmVjdCB4PSIxNiIgeT0iMTYiIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjIxIg0KICAgICAgICBmaWxsPSJub25lIiBzdHJva2U9InVybCgjbG9vcHJhLXJpbmcpIiBzdHJva2Utd2lkdGg9IjgiLz4NCiAgPHBhdGggZD0iTTQxIDM1djIwYzAgMy44NyAzLjEzIDcgNyA3aDExIg0KICAgICAgICBmaWxsPSJub25lIiBzdHJva2U9IiMxNzNBNzAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSI2Ii8+DQo8L3N2Zz4NCg==",
  bin: "loopra",
  dir: "~/.loopra",
  config: "~/.loopra/config.json",
  format: "json",
  model: "model",
  ua: ["loopra"],
  library: {
    skills: "~/.loopra/skills",
    instructions: "~/.loopra/loopra.md",
    mcp: "~/.loopra/mcp-servers.json",
    mcpFormat: "claude",
  },
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
  const displayName = typeof model.name === "string" ? model.name.trim() : "";
  return {
    name: model.id,
    ...(displayName ? { displayName } : {}),
    contextTokens: positiveInt(model.context, -1),
    maxTokens: positiveInt(model.output, DEFAULT_MAX_TOKENS),
    imageInput: model.images === true,
  };
}

function reasoningEffort(model) {
  const efforts = Array.isArray(model.efforts)
    ? model.efforts.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (policy.reasoningEffort !== "auto") {
    if (typeof policy.reasoningEffort !== "string" || !policy.reasoningEffort.trim()
        || (efforts.length && !efforts.includes(policy.reasoningEffort))) {
      throw new Error("The configured reasoningEffort is not supported by the selected Magpie model.");
    }
    return policy.reasoningEffort;
  }
  // Prefer a useful default without silently choosing the most expensive tier.
  for (const value of ["high", "medium", "low", "minimal", "none", "xhigh", "max"]) {
    if (efforts.includes(value)) return value;
  }
  // Unknown capabilities: omit the field, so Magpie restores/preserves the user's value.
  return undefined;
}

function auxiliaryModel(setting, candidates, images) {
  if (setting === "none") return "";
  if (setting === "auto") {
    const found = candidates.find((candidate) => !images || candidate.images === true);
    return found ? found.id : "";
  }
  const found = candidates.find((candidate) => candidate.id === setting);
  if (!found || (images && found.images !== true)) {
    throw new Error("The configured " + (images ? "image understanding" : "validation")
      + " model is unavailable or lacks the required capability: " + String(setting));
  }
  return found.id;
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
  const candidates = [];
  const seen = new Set();
  for (const candidate of [model, ...(Array.isArray(models) ? models : [])]) {
    if (!candidate || typeof candidate.id !== "string" || !candidate.id.trim()
        || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
    entries.push(modelEntry(candidate));
  }

  const baseUrl = gateway.v1.trim().replace(/\/+$/, "");
  const imageModel = auxiliaryModel(policy.imageUnderstandingModel, candidates, true);
  const validationModel = auxiliaryModel(policy.validationModel, candidates, false);
  const result = {
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
    imageUnderstandingModel: imageModel,
    imageUnderstandingModelChannelId: imageModel ? CHANNEL_ID : "",
    validationModel,
    validationModelChannelId: validationModel ? CHANNEL_ID : "",
  };
  const effort = reasoningEffort(model);
  if (effort !== undefined) result.reasoningEffort = effort;
  return result;
}
