// Shared pure Coach protocol; does not import the single-process job queue or any CLI SDK.
import fs from 'node:fs';
import path from 'node:path';
import { extractJSON, validatePlan, validateReview, contractOK } from './validate.js';
import { CONTRACT } from './payload.js';

const parts = new Map();
const promptPart = name => {
  if (!parts.has(name)) {
    const local = new URL(`./prompts/${name}`, import.meta.url);
    // Netlify bundles JS into the entry module, but included files retain repo-relative paths.
    const file = fs.existsSync(local) ? local : path.join(process.cwd(), 'api', 'coach', 'prompts', name);
    parts.set(name, fs.readFileSync(file, 'utf8'));
  }
  return parts.get(name);
};
export function buildPrompt(kind, payload, repair) {
  const task = kind === 'review' ? 'review.md' : payload.refine ? 'refine.md' : 'create.md';
  let result = promptPart('common.md') + '\n\n---\n\n' + promptPart(task) +
    '\n\n---\n\n## Payload\n\n```json\n' + JSON.stringify(payload, null, 1) + '\n```\n';
  if (repair) result += '\n\n---\n\n' + promptPart('repair.md')
    .replace('{{PREVIOUS}}', String(repair.previous || '').slice(0, 4000))
    .replace('{{ERRORS}}', repair.errors.map(e => '- ' + e).join('\n'));
  return result;
}
export function validateAnswer(kind, payload, response) {
  if (response.timedOut) return { ok: false, errorClass: 'timeout' };
  if (response.code !== 0) return { ok: false, errorClass: /auth|api key|401|403/i.test(response.stderr || '') ? 'auth' : 'provider', detail: response.stderr };
  const parsed = extractJSON(response.text);
  if (parsed.error) return { ok: false, repairable: true, errors: [parsed.error], raw: response.text, errorClass: 'unusable' };
  if (!contractOK(parsed.value)) return { ok: false, repairable: true, errors: [`coach_contract must be ${CONTRACT}`], raw: response.text, errorClass: 'unusable' };
  const checked = kind === 'review' ? validateReview(parsed.value, payload.plan)
    : validatePlan(parsed.value, { workingWeights: payload.history?.workingWeights, daysPerWeek: payload.coachProfile?.daysPerWeek });
  if (!checked.ok) return { ok: false, repairable: true, errors: checked.errors, raw: response.text, errorClass: 'unusable' };
  return { ok: true, nochange: !!checked.nochange, result: checked.proposal || { bundle: checked.bundle, summary: checked.bundle?.summary } };
}
export function hashPlan(plan) {
  const canon = JSON.stringify({
    routines: (plan?.routines || []).map(r => [r.id, r.name, r.prog, (r.ex || []).map(e =>
      [e.id, e.mode, e.sets, e.reps, e.sec, e.min, e.speed, e.weight, e.prog, e.inc, e.repsMin, e.sg].join(':')
    )]),
    week: Object.keys(plan?.week || {}).sort().map(k => k + '=' + plan.week[k])
  });
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < canon.length; i++) {
    const c = canon.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | i & 7), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
