/* Direct HTTP integration: no local AI model or provider CLI is needed.
 * Fail closed on cost: only explicit free IDs, verified zero pricing, no paid
 * model fallback or plugins, and a zero-price ceiling on the inference request.
 */
export const DEFAULT_MODEL = 'openrouter/free';
const API = 'https://openrouter.ai/api/v1';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function isFreeModel(model) {
  return model === DEFAULT_MODEL || (typeof model === 'string' &&
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free$/i.test(model));
}

const fail = stderr => ({ code: 1, text: '', stderr });
const zeroPrice = value => typeof value === 'number' ? value === 0 :
  typeof value === 'string' && /^0(?:\.0+)?(?:e[+-]?\d+)?$/i.test(value);
const verifiedFree = pricing => pricing && zeroPrice(pricing.prompt) &&
  zeroPrice(pricing.completion) && Object.values(pricing).every(zeroPrice);

function errorMessage(status) {
  if (status === 401 || status === 403) return 'OpenRouter authorization failed; check the API key and account settings.';
  if (status === 402) return 'OpenRouter declined the free request. No paid fallback was attempted.';
  if (status === 429) return 'OpenRouter free quota or provider capacity was reached. Try again later; no paid fallback was attempted.';
  if (status === 404) return 'No compatible free OpenRouter model is available with the current account settings.';
  return 'OpenRouter could not complete the free request. No paid fallback was attempted.';
}

async function readJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('response too large');
  return JSON.parse(raw);
}

// The injected fetch is a test seam. Tests never contact OpenRouter or use real keys.
export function createOpenRouterAdapter(fetchImpl = globalThis.fetch) {
  return {
    id: 'openrouter',
    async check(cfg, env) {
      if (!isFreeModel(cfg?.model || DEFAULT_MODEL)) return { ok: false, error: 'Choose openrouter/free or a model ID ending in :free. Paid models are blocked.' };
      if (!env?.OPENROUTER_API_KEY) return { ok: false, error: 'add an OpenRouter API key' };
      return { ok: true, version: 'OpenRouter API (free only)' };
    },
    async invoke({ prompt, env, model, timeoutMs = 300000 }) {
      const selected = model || DEFAULT_MODEL;
      if (!isFreeModel(selected)) return fail('Paid or automatic paid-routing models are blocked. Choose openrouter/free or an explicit :free model.');
      if (!env?.OPENROUTER_API_KEY) return fail('OpenRouter API key missing');
      const duration = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(300000, Math.floor(timeoutMs))) : 300000;
      const signal = AbortSignal.timeout(duration);
      try {
        // Public metadata only: the API key and workout prompt are not sent here.
        const catalog = await fetchImpl(API + '/models', { signal, redirect: 'error' });
        if (!catalog.ok) return fail('OpenRouter model pricing could not be verified. No AI request was sent.');
        const { data } = await readJson(catalog);
        const entry = Array.isArray(data) ? data.find(item => item.id === selected) : null;
        if (!verifiedFree(entry?.pricing)) return fail('This OpenRouter model is unavailable or its pricing is not verified as zero. No AI request was sent.');

        const response = await fetchImpl(API + '/chat/completions', {
          method: 'POST', signal, redirect: 'error',
          headers: {
            'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY,
            'Content-Type': 'application/json',
            'X-OpenRouter-Title': 'ForgeFit'
          },
          body: JSON.stringify({
            model: selected, stream: false,
            messages: [
              { role: 'system', content: 'You are the ForgeFit Coach. Follow the supplied contract exactly and return only the requested JSON. Do not provide medical advice.' },
              { role: 'user', content: prompt }
            ],
            max_completion_tokens: 8192,
            response_format: { type: 'json_object' },
            plugins: [], tools: [],
            provider: {
              allow_fallbacks: false,
              require_parameters: true,
              max_price: { prompt: 0, completion: 0, request: 0, image: 0 }
            }
          })
        });
        // Never expose raw provider errors, which can echo keys or workout data.
        if (!response.ok) return fail(errorMessage(response.status));
        const result = await readJson(response);
        if (result.error) return fail(errorMessage(Number(result.error.code)));
        const choice = result.choices?.[0];
        if (['length', 'error', 'content_filter'].includes(choice?.finish_reason)) return fail('OpenRouter returned an incomplete or blocked answer. No plan was applied.');
        const text = choice?.message?.content;
        if (typeof text !== 'string' || !text.trim()) return fail('OpenRouter returned no usable answer. No plan was applied.');
        return { code: 0, text: text.trim(), stderr: '' };
      } catch (error) {
        if (signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') return { ...fail(''), timedOut: true };
        return fail('OpenRouter could not be reached or returned an invalid response. No paid fallback was attempted.');
      }
    }
  };
}

export default createOpenRouterAdapter();
