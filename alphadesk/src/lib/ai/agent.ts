import 'server-only';
// Provider-agnostic research loop: model turn → validated tool calls → numbered sources → next turn.
import { CitationRegistry, stripInvalidMarkers } from './citations';
import type { LLMProvider } from './provider';
import { executeTool, type ToolContext } from './tools';
import { toolSpecs } from './tool-schemas';
import { TOOL_LABELS, type ChatStreamEvent, type Citation, type LLMMessage, type StructuredBlock, type ToolCall, type ToolResultMsg, type ToolStep } from './types';

export function systemPrompt(ctx: { ticker?: string; today: string }): string {
  return [
    'You are NidhikshDesk Research, an equity research assistant for hedge-fund analysts and PMs. You provide research and analysis only: never give personalised investment advice, buy/sell/hold recommendations, or your own price targets, and never discuss placing trades.',
    '',
    'How to work:',
    '- Use the tools to get facts. Never state a number that did not come from a tool result in this conversation.',
    '- Every tool result lists `sources` with a number `n`, and data fields named `cite`/`*Cite` hold the matching number. Cite each number or factual claim with the marker [n] right after the sentence or bullet, e.g. "Revenue grew 6.4% in FY2024 [2]." Use only numbers that appear in sources. Combine as [2, 5] when needed.',
    '- For comparisons, call compare_companies. Its comparison table and charts are shown to the user automatically below your answer, so do not redraw them as markdown tables; summarise and interpret instead.',
    '- For qualitative claims (risks, guidance, AI exposure, management commentary) call search_documents and quote short phrases with citations. Say plainly when evidence is thin or keyword-based.',
    '- If you want an extra chart, emit a fenced block with language `chart` containing JSON: {"type":"chart","chart":"bar"|"line","title":"…","xKey":"…","series":[{"key":"…","label":"…"}],"data":[{…}],"format":"pct"|"usdB"|"num"}.',
    '- End with a fenced block with language `bql` that reproduces the core data pull in BQL syntax, e.g.\n```bql\nget(SALES_REV_TURN, GROSS_MARGIN) for([\'AAPL US Equity\',\'MSFT US Equity\']) with(fpt=A, fpo=range(-5Y,0Y))\n```',
    '',
    'Style: concise, analyst-grade markdown. Start with a short ### headline, then a one-sentence bottom line, then short bulleted sections. Use tabular numbers with units (e.g. $391.0B, 45.6%, +3.1 pts). If any tool result was simulated/demo data, note that briefly at the end.',
    '',
    `Today is ${ctx.today}.${ctx.ticker ? ` The user is currently viewing ${ctx.ticker}; assume questions without a named company refer to it.` : ''}`,
  ].join('\n');
}

/** Replace `cite` / `*Cite` source-id fields with citation numbers (recursively). */
export function resolveCites(v: unknown, reg: CitationRegistry): unknown {
  if (Array.isArray(v)) return v.map((x) => resolveCites(x, reg));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/cite$/i.test(k) && typeof val === 'string') out[k] = reg.numberOf(val) ?? null;
      else out[k] = resolveCites(val, reg);
    }
    return out;
  }
  return v;
}

export interface AgentResult {
  content: string;
  citations: Citation[];
  blocks: StructuredBlock[];
  steps: ToolStep[];
  isMock: boolean;
  stopNote?: string;
}

export interface RunAgentInput {
  provider: LLMProvider;
  history: LLMMessage[];
  question: string;
  context?: { ticker?: string };
  toolCtx: ToolContext;
  signal?: AbortSignal;
  maxRounds?: number;
}

/** Runs the tool loop, yielding wire events; returns the final assembled answer. */
export async function* runAgent(input: RunAgentInput): AsyncGenerator<ChatStreamEvent, AgentResult> {
  const { provider, signal } = input;
  const reg = new CitationRegistry();
  const specs = toolSpecs();
  const system = systemPrompt({ ticker: input.context?.ticker, today: new Date().toISOString().slice(0, 10) });
  const messages: LLMMessage[] = [...input.history, { role: 'user', content: input.question }];
  const blocks: StructuredBlock[] = [];
  const steps: ToolStep[] = [];
  let text = '';
  let isMock = provider.id === 'mock';
  let stopNote: string | undefined;
  const maxRounds = input.maxRounds ?? 6;

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) break;
    if (round > 0 && text && !text.endsWith('\n')) {
      text += '\n\n';
      yield { type: 'text', delta: '\n\n' };
    }
    let turnText = '';
    let calls: ToolCall[] = [];
    let raw: unknown;
    for await (const ev of provider.chat(messages, specs, { system, signal, context: input.context, stream: true })) {
      if (ev.type === 'text') {
        turnText += ev.delta;
        text += ev.delta;
        yield { type: 'text', delta: ev.delta };
      } else if (ev.type === 'final') {
        calls = ev.toolCalls;
        raw = ev.raw;
        if (ev.note) stopNote = ev.note;
      }
    }
    messages.push({ role: 'assistant', content: turnText, toolCalls: calls, raw, rawProvider: provider.id });
    if (!calls.length) break;

    if (round === maxRounds - 1) {
      stopNote = 'Stopped after the maximum number of research steps.';
      break;
    }

    const prepared = calls.map((c) => {
      const step: ToolStep = { id: c.id, name: c.name, label: labelFor(c), status: 'start' };
      steps.push(step);
      return { c, step };
    });
    for (const { c, step } of prepared) yield { type: 'tool', id: c.id, name: c.name, label: step.label, status: 'start' };

    // Run tools concurrently; collect their events in a per-request buffer and flush in order.
    const buf: ChatStreamEvent[] = [];
    const results: ToolResultMsg[] = await Promise.all(
      prepared.map(async ({ c, step }) => {
        const out = await executeTool(c.name, c.input, input.toolCtx);
        isMock ||= out.isMock;
        for (const s of out.sources) reg.add(s);
        for (const b of out.blocks ?? []) {
          const resolved = { ...b.block, cites: [...new Set(b.citeIds.map((id) => reg.numberOf(id)).filter((n): n is number => n != null))] } as StructuredBlock;
          blocks.push(resolved);
          buf.push({ type: 'block', block: resolved });
        }
        step.status = out.ok ? 'done' : 'error';
        step.summary = out.summary;
        buf.push({ type: 'tool', id: c.id, name: c.name, label: step.label, status: step.status, summary: out.summary });
        const data = resolveCites(out.data, reg);
        const sources = out.sources.map((s) => ({ n: reg.numberOf(s.id), name: s.name, kind: s.kind, locator: s.locator, excerpt: s.excerpt ? s.excerpt.slice(0, 400) : undefined }));
        return { id: c.id, name: c.name, content: JSON.stringify({ ...(data as object), sources }), isError: !out.ok };
      }),
    );
    for (const ev of buf) yield ev;
    yield { type: 'citations', citations: reg.all };
    messages.push({ role: 'tool', results });
  }

  const valid = new Set(reg.all.map((c) => c.n));
  return { content: stripInvalidMarkers(text, valid).trim(), citations: reg.all, blocks, steps, isMock, stopNote };
}


function labelFor(c: ToolCall): string {
  const i = (c.input ?? {}) as Record<string, unknown>;
  switch (c.name) {
    case 'get_financials': return `Reading ${i.ticker ?? ''} ${i.period === 'quarterly' ? '10-Q' : '10-K'} financials…`;
    case 'compare_companies': return `Comparing ${Array.isArray(i.tickers) ? (i.tickers as string[]).join(', ') : ''}…`;
    case 'get_company_snapshot': return `Pulling ${i.ticker ?? ''} snapshot…`;
    case 'search_documents': return `Searching filings & transcripts${Array.isArray(i.tickers) && i.tickers.length ? ` for ${(i.tickers as string[]).slice(0, 4).join(', ')}` : ''}…`;
    case 'get_news': return `Scanning ${i.ticker ? `${i.ticker} ` : ''}news…`;
    case 'run_screen': return 'Running screen…';
    case 'portfolio_risk': return 'Checking portfolio risk…';
    default: return `${TOOL_LABELS[c.name] ?? c.name}…`;
  }
}
