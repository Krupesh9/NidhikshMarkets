import 'server-only';
import { resolveKey } from '@/components/settings/keys.server';
import { getMarketData } from '@/lib/data';
import { log } from '@/lib/log';
import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { MockLLMProvider } from './mock';
import { chooseProvider, providerLabel, type LLMProvider, type ProviderChoice } from './provider';

export { runAgent } from './agent';
export type { LLMProvider } from './provider';

async function userKey(userId: string, provider: "anthropic" | "gemini"): Promise<string | null> {
  try {
    // Settings (Agent E) owns key storage: user's encrypted key first, env fallback.
    const r = await resolveKey(userId, provider);
    return r?.source === "user" ? r.key : null;
  } catch (e) {
    log.warn("ai.key_resolve_failed", { provider, err: (e as Error).message });
    return null;
  }
}

/** Resolve which provider/model this user's request will use (no secrets returned). */
export async function resolveProvider(user: { id: string } | null): Promise<ProviderChoice> {
  const [anthropic, gemini] = user ? await Promise.all([userKey(user.id, 'anthropic'), userKey(user.id, 'gemini')]) : [null, null];
  return chooseProvider({ anthropic, gemini }, process.env);
}

/** Stateless per request: user key → env key → Mock. */
export async function getProvider(user: { id: string } | null): Promise<LLMProvider> {
  const c = await resolveProvider(user);
  const label = providerLabel(c);
  if (c.id === 'anthropic' && c.apiKey) return new ClaudeProvider(c.apiKey, c.model, label);
  if (c.id === 'gemini' && c.apiKey) return new GeminiProvider(c.apiKey, c.model, label);
  const u = await getMarketData().getUniverse();
  return new MockLLMProvider(u.data, label);
}

export function publicProviderInfo(c: ProviderChoice) {
  return { provider: c.id, model: c.model, label: providerLabel(c), keySource: c.keySource, isMock: c.id === 'mock' };
}
