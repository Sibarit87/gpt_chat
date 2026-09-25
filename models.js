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

const DEFAULT_REASONING = "low";

const REASONING_EFFORTS = [
  { id: "none", label: "Без рассуждений", hint: "Самый быстрый ответ" },
  { id: "low", label: "Низкий", hint: "По умолчанию, бережёт минутный лимит" },
  { id: "medium", label: "Средний", hint: "Обычная тщательность модели" },
  { id: "high", label: "Высокий", hint: "Для документов и сложного разбора" },
  { id: "xhigh", label: "Очень высокий", hint: "Дольше и больше токенов в минуту" },
  { id: "max", label: "Максимум", hint: "Самый тщательный, легко заполняет лимит" },
];

const REASONING_HEADROOM = {
  none: 0,
  low: 0,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 24576,
};

const ALLOWED = new Set(MODELS.map((model) => model.id));

function resolveModel(id) {
  const value = String(id || "").trim();
  return ALLOWED.has(value) ? value : DEFAULT_MODEL;
}

function modelLabel(id) {
  return MODELS.find((model) => model.id === id)?.label || id || "";
}

function resolveReasoning(id) {
  const value = String(id || "").trim();
  return REASONING_EFFORTS.some((item) => item.id === value) ? value : DEFAULT_REASONING;
}

function modelRequest(id, reasoning) {
  const limits = LIMITS[resolveModel(id)] || LIMITS[DEFAULT_MODEL];
  const effort = resolveReasoning(reasoning);
  return {
    max_output_tokens: limits.maxOutputTokens + (REASONING_HEADROOM[effort] || 0),
    reasoning: { effort },
  };
}

module.exports = {
  DEFAULT_MODEL,
  MODELS,
  DEFAULT_REASONING,
  REASONING_EFFORTS,
  resolveModel,
  resolveReasoning,
  modelLabel,
  modelRequest,
};
