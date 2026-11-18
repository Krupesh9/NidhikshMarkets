import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ChatOptions, LLMProvider } from './provider';
import type { LLMMessage, ProviderEvent, ToolCall, ToolSpec } from './types';
import { meteredFetch } from '../usage-meter';

function toClaudeMessages(messages: LLMMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      if (m.rawProvider === 'anthropic' && Array.isArray(m.raw)) {
        // replay content blocks unchanged (keeps thinking blocks valid across the tool loop)
        out.push({ role: 'assistant', content: m.raw as BetaContentBlockParam[] });
        continue;
      }
      const blocks: BetaContentBlockParam[] = [];
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: (c.input ?? {}) as Record<string, unknown> });
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
      });
    }
  }
  return out;
}

function toClaudeTools(tools: ToolSpec[]): BetaToolUnion[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as { type: 'object'; [k: string]: unknown },
    // stream large inputs as generated; inputs are zod-validated in executeTool before running
    eager_input_streaming: true,
  }));
}

/** Claude via the official Anthropic SDK (streaming, adaptive thinking, server-side refusal fallback). */
export class ClaudeProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string, readonly model: string, readonly label: string) {
    // every HTTP request (incl. SDK retries) is counted by the usage meter; behaviour is plain fetch
    this.client = new Anthropic({ apiKey, maxRetries: 2, fetch: (input, init) => meteredFetch('anthropic', input, init) });
  }

  async *chat(messages: LLMMessage[], tools: ToolSpec[], opts: ChatOptions): AsyncIterable<ProviderEvent> {
    let attempts = 0;
    while (true) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: opts.maxTokens ?? 64000,
          system: opts.system,
          messages: toClaudeMessages(messages),
          tools: toClaudeTools(tools),
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: opts.signal },
      );
      let streamedText = '';
      let message: BetaMessage;
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            streamedText += ev.delta.text;
            if (opts.stream !== false) yield { type: 'text', delta: ev.delta.text };
          }
        }
        message = await stream.finalMessage();
      } catch (err) {
        // Retry once or twice only for unparseable eager tool input / dropped connections, and only if nothing was shown yet.
        if (err instanceof Anthropic.APIError || streamedText || attempts++ >= 2 || opts.signal?.aborted) throw err;
        continue;
      }

      if (opts.stream === false && streamedText) yield { type: 'text', delta: streamedText };
      if (message.stop_reason === 'refusal') {
        yield { type: 'final', stopReason: 'refusal', raw: message.content, text: streamedText, toolCalls: [], note: 'The model declined this request.' };
        return;
      }
      const calls: ToolCall[] = message.content
        .filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      if (message.stop_reason === 'max_tokens' && calls.length) {
        // tool input may be truncated; don't run it
        yield { type: 'final', stopReason: 'max_tokens', raw: message.content, text: streamedText, toolCalls: [], note: 'Response was cut off (max tokens).' };
        return;
      }
      for (const c of calls) yield { type: 'tool_call', call: c };
      yield { type: 'final', stopReason: message.stop_reason ?? 'end_turn', raw: message.content, text: streamedText, toolCalls: calls };
      return;
    }
  }
}
