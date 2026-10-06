// Run the real browser store and Coach request functions against an injected API handler.
// No browser credentials, network, AI provider or cloud database are used by these tests.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { CONSENT_VERSION } from '../netlify/consent.js';
// Minimal get/set test harness; frontend tests separately run these methods with Zustand.
// Keep the API test suite independent of an installed frontend/node_modules directory.
const createStore = init => {
  let state;
  const get = () => state, set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  state = init(set, get);
  return { getState: get };
};
const source = file => fs.readFileSync(new URL('../../frontend/src/' + file, import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export \{ hasData \}/gm, '').replace(/^export /gm, '');

export function browserStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
export function browserClient({ storage, api }) {
  const context = vm.createContext({ localStorage: storage, api, create: createStore, crypto,
    localTZ: () => 'UTC', registerCustom: () => {}, DEMO: false, MOBILE: false, DEMO_SEEDED: 'test', CONSENT_VERSION,
    setTimeout: () => 1, clearTimeout: () => {}, document: new EventTarget(), window: new EventTarget() });
  vm.runInContext(source('store/useStore.js') + '\nglobalThis.client = useStore;', context);
  vm.runInContext(source('lib/coach-api.js') + '\nglobalThis.coachClient = { requestReview, requestPlan, refinePlan, forgetCoach };', context);
  return { store: context.client, coach: context.coachClient };
}
