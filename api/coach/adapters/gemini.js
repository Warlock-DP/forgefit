import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-3.7-flash';

export default {
  id: 'gemini',
  async check(_cfg, env) {
    if (!env.GEMINI_API_KEY) return { ok: false, error: 'add a Gemini API key' };
    return { ok: true, version: 'Google GenAI SDK' };
  },
  async invoke({ prompt, env, model, timeoutMs }) {
    if (!env.GEMINI_API_KEY) return { code: 1, text: '', stderr: 'Gemini API key missing' };
    try {
      const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: timeoutMs } });
      const response = await ai.models.generateContent({
        model: model || DEFAULT_MODEL,
        contents: prompt,
        config: {
          systemInstruction: 'You are the ForgeFit Coach. Follow the supplied contract exactly and return only the requested JSON.',
          responseMimeType: 'application/json'
        }
      });
      return { code: 0, text: String(response.text || '').trim(), stderr: '' };
    } catch (error) {
      if (/timed? out|timeout/i.test(error?.message || '')) return { code: 1, text: '', stderr: '', timedOut: true };
      return { code: 1, text: '', stderr: error?.message || String(error) };
    }
  }
};
