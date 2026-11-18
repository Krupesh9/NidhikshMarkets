import 'server-only';
import { GoogleGenerativeAI, type Content, type FunctionDeclaration, type Part } from '@google/generative-ai';
import { isLimitError, recordCall } from '../usage-meter';
import type { ChatOptions, LLMProvider } from './provider';
import type { LLMMessage, ProviderEvent, ToolCall, ToolSpec } from './types';

/** Convert our JSON schema to Gemini's OpenAPI subset (uppercase types, no unsupported keywords). */
function toGeminiSchema(s: unknown): unknown {
  if (!s || typeof s !== 'object') return s;
  const src = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let type = src.type;
  if (Array.isArray(type)) type = type.find((t) => t !== 'null');
  if (!type && src.anyOf) return toGeminiSchema((src.anyOf as unknown[]).find((x) => (x as { type?: string }).type !== 'null'));
  if (typeof type === 'string') out.type = type.toUpperCase();
  if (src.description) out.description = src.description;
  if (src.enum) out.enum = src.enum;
  if (src.properties) out.properties = Object.fromEntries(Object.entries(src.properties as Record<string, unknown>).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (src.required) out.required = src.required;
  if (src.items) out.items = toGeminiSchema(src.items);
  return out;
}

function toContents(messages: LLMMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', parts: [{ text: m.content }] });
    else if (m.role === 'assistant') {
      if (m.rawProvider === 'gemini' && Array.isArray(m.raw)) {
        out.push({ role: 'model', parts: m.raw as Part[] });
        continue;
      }
      const parts: Part[] = [];
      if (m.content.trim()) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: (c.input ?? {}) as object } });
      if (parts.length) out.push({ role: 'model', parts });
    } else {
      out.push({
        role: 'function',
        parts: m.results.map((r) => {
          let response: object;
          try { response = { content: JSON.parse(r.content) }; } catch { response = { content: r.content }; }
          return { functionResponse: { name: r.name, response } };
        }),
      });
    }
  }
  return out;
}

/** Gemini via @google/generative-ai (streaming + function calling). */
export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini' as const;
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string, readonly model: string, readonly label: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async *chat(messages: LLMMessage[], tools: ToolSpec[], opts: ChatOptions): AsyncIterable<ProviderEvent> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: opts.system,
      tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.inputSchema) }) as FunctionDeclaration) }],
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 8192 },
    });
    const endpoint = `generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent`;
    let res: Awaited<ReturnType<typeof model.generateContentStream>>;
    try {
      res = await model.generateContentStream({ contents: toContents(messages) }, { signal: opts.signal });
      recordCall('gemini', { ok: true, status: 200, endpoint });
    } catch (e) {
      const status = Number((e as { status?: number }).status) || 0;
      recordCall('gemini', { ok: false, status, endpoint, limitError: isLimitError('gemini', status, (e as Error).message) });
      throw e;
    }
    let text = '';
    const parts: Part[] = [];
    const calls: ToolCall[] = [];
    let finish = 'end_turn';
    for await (const chunk of res.stream) {
      const cand = chunk.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        parts.push(p);
        if (p.text && !(p as { thought?: boolean }).thought) {
          text += p.text;
          yield { type: 'text', delta: p.text };
        }
        if (p.functionCall) calls.push({ id: `gem_${calls.length}_${Date.now().toString(36)}`, name: p.functionCall.name, input: p.functionCall.args ?? {} });
      }
      if (cand?.finishReason === 'MAX_TOKENS') finish = 'max_tokens';
      if (cand?.finishReason === 'SAFETY') finish = 'refusal';
    }
    for (const c of calls) yield { type: 'tool_call', call: c };
    yield { type: 'final', stopReason: calls.length ? 'tool_use' : finish, raw: parts, text, toolCalls: calls };
  }
}
