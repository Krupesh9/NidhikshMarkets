// LLM provider interface + pure selection logic (client-safe; no SDK imports here).
import type { LLMMessage, ProviderEvent, ProviderId, ToolSpec } from './types';

export interface ChatOptions {
  system: string;
  /** stream text deltas as they arrive (default true). Non-streaming providers may yield one text event. */
  stream?: boolean;
  signal?: AbortSignal;
  maxTokens?: number;
  /** page context (e.g. current ticker) — used by the mock provider's intent parser */
  context?: { ticker?: string };
}

/** Stateless per request: construct one per chat call with the resolved key. */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  /** e.g. "Claude (your key)" */
  readonly label: string;
  /** One model turn: yields text deltas, then tool calls, then a final event. */
  chat(messages: LLMMessage[], tools: ToolSpec[], opts: ChatOptions): AsyncIterable<ProviderEvent>;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

export interface ProviderChoice {
  id: ProviderId;
  model: string;
  apiKey?: string;
  keySource: 'user' | 'env' | 'none';
}

/**
 * Selection order: user's own key (Anthropic, then Gemini) → server env key (Anthropic, then Gemini) → Mock.
 * `AI_PROVIDER=mock|anthropic|gemini` in env forces a provider when its key is available (mock always is).
 */
export function chooseProvider(userKeys: { anthropic?: string | null; gemini?: string | null }, env: Record<string, string | undefined>): ProviderChoice {
  const claudeModel = env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  const geminiModel = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const candidates: ProviderChoice[] = [];
  if (userKeys.anthropic) candidates.push({ id: 'anthropic', model: claudeModel, apiKey: userKeys.anthropic, keySource: 'user' });
  if (userKeys.gemini) candidates.push({ id: 'gemini', model: geminiModel, apiKey: userKeys.gemini, keySource: 'user' });
  if (env.ANTHROPIC_API_KEY?.trim()) candidates.push({ id: 'anthropic', model: claudeModel, apiKey: env.ANTHROPIC_API_KEY.trim(), keySource: 'env' });
  if (env.GEMINI_API_KEY?.trim()) candidates.push({ id: 'gemini', model: geminiModel, apiKey: env.GEMINI_API_KEY.trim(), keySource: 'env' });
  const mock: ProviderChoice = { id: 'mock', model: 'nidhiksh-mock-analyst-1', keySource: 'none' };
  const forced = env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === 'mock') return mock;
  if (forced === 'anthropic' || forced === 'gemini') return candidates.find((c) => c.id === forced) ?? candidates[0] ?? mock;
  return candidates[0] ?? mock;
}

export function providerLabel(c: Pick<ProviderChoice, 'id' | 'keySource'>): string {
  const name = c.id === 'anthropic' ? 'Claude' : c.id === 'gemini' ? 'Gemini' : 'Mock analyst';
  return c.keySource === 'user' ? `${name} (your key)` : c.keySource === 'env' ? `${name} (workspace key)` : `${name} (demo, no API key)`;
}
