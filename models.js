const DEFAULT_MODEL = "gpt-6-luna";

const MODELS = [
  { id: "gpt-6-luna", label: "GPT-6 Luna", hint: "По умолчанию · быстрее и дешевле" },
  { id: "gpt-6-sol", label: "GPT-6 Sol", hint: "Сложные задачи" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", hint: "Флагман" },
];

const ALLOWED = new Set(MODELS.map((model) => model.id));

function resolveModel(id) {
  const value = String(id || "").trim();
  return ALLOWED.has(value) ? value : DEFAULT_MODEL;
}

function modelLabel(id) {
  return MODELS.find((model) => model.id === id)?.label || id || "";
}

module.exports = {
  DEFAULT_MODEL,
  MODELS,
  resolveModel,
  modelLabel,
};
