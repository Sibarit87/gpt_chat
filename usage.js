function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageFromResponse(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = asCount(usage.input_tokens);
  const outputTokens = asCount(usage.output_tokens);
  const cachedTokens = asCount(usage.input_tokens_details?.cached_tokens);
  const reasoningTokens = asCount(usage.output_tokens_details?.reasoning_tokens);
  const totalTokens = asCount(usage.total_tokens) || inputTokens + outputTokens;
  if (!totalTokens && !inputTokens && !outputTokens) return null;

  return {
    responseId: response.id || null,
    inputTokens,
    cachedTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function sumUsage(calls) {
  const totals = {
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    calls: [],
  };

  for (const call of calls) {
    totals.inputTokens += call.inputTokens;
    totals.cachedTokens += call.cachedTokens;
    totals.outputTokens += call.outputTokens;
    totals.reasoningTokens += call.reasoningTokens;
    totals.totalTokens += call.totalTokens;
    totals.calls.push(call);
  }

  return totals.calls.length ? totals : null;
}

module.exports = { usageFromResponse, sumUsage };
