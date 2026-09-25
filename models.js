const DEFAULT_MODEL = "gpt-6-luna";

const MODELS = [
  { id: "gpt-6-luna", label: "GPT-6 Luna", hint: "По умолчанию · быстрее и дешевле" },
  { id: "gpt-6-sol", label: "GPT-6 Sol", hint: "Сложные задачи" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", hint: "Флагман" },
];

const LIMITS = {
  "gpt-6-luna": { maxOutputTokens: 8192 },
  "gpt-6-sol": { maxOutputTokens: 16384 },
  "gpt-6-astra": { maxOutputTokens: 16384 },
};

const ALLOWED = new Set(MODELS.map((model) => model.id));

function resolveModel(id) {
  const value = String(id || "").trim();
  return ALLOWED.has(value) ? value : DEFAULT_MODEL;
}

function modelLabel(id) {
  return MODELS.find((model) => model.id === id)?.label || id || "";
}

function modelRequest(id) {
  const limits = LIMITS[resolveModel(id)] || LIMITS[DEFAULT_MODEL];
  return {
    max_output_tokens: limits.maxOutputTokens,
    reasoning: { effort: "low" },
  };
}

module.exports = {
  DEFAULT_MODEL,
  MODELS,
  resolveModel,
  modelLabel,
  modelRequest,
};
