// Shared AI types. Client-safe (types + pure constants only).
import type { SourceRef } from '@/lib/data/types';

export type ProviderId = 'anthropic' | 'gemini' | 'mock';

/** A source registered in a conversation turn, numbered for `[n]` citation markers. */
export interface Citation extends SourceRef {
  n: number;
}

// ---- Structured output blocks rendered inline in the conversation ----

export interface TableBlock {
  type: 'table';
  title?: string;
  columns: { key: string; label: string; numeric?: boolean; format?: 'pct' | 'usd' | 'usdB' | 'x' | 'num' | 'text' }[];
  rows: Record<string, string | number | null>[];
  /** citation numbers backing the table */
  cites?: number[];
  note?: string;
}

export interface ChartBlock {
  type: 'chart';
  chart: 'bar' | 'line';
  title?: string;
  /** x-axis key in each data row */
  xKey: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number | null>[];
  format?: 'pct' | 'usdB' | 'num';
  cites?: number[];
}

export interface BqlBlock {
  type: 'bql';
  title?: string;
  query: string;
  /** Excel / BQL formula hint */
  excel?: string;
}

export type StructuredBlock = TableBlock | ChartBlock | BqlBlock;

// ---- Provider-neutral conversation format ----

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultMsg {
  id: string;
  name: string;
  /** JSON string returned to the model */
  content: string;
  isError?: boolean;
}

export type LLMMessage =
  | { role: 'user'; content: string }
  /** `raw` = provider-native content (e.g. Claude content blocks incl. thinking) replayed unchanged on the next turn */
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; raw?: unknown; rawProvider?: ProviderId }
  | { role: 'tool'; results: ToolResultMsg[] };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the input object */
  inputSchema: Record<string, unknown>;
}

/** Events a provider yields for one model turn. */
export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'final'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'error' | string; raw?: unknown; text: string; toolCalls: ToolCall[]; note?: string };

// ---- Wire protocol: SSE events from POST /api/ai/chat ----

export interface UsageInfo {
  used: number;
  /** null = unlimited */
  limit: number | null;
  remaining: number | null;
}

export type ChatStreamEvent =
  | { type: 'meta'; threadId: string; provider: ProviderId; model: string; userMessageId?: string }
  | { type: 'status'; label: string }
  | { type: 'tool'; id: string; name: string; label: string; status: 'start' | 'done' | 'error'; summary?: string }
  | { type: 'text'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'block'; block: StructuredBlock }
  | { type: 'done'; messageId: string | null; content: string; citations: Citation[]; blocks: StructuredBlock[]; isMock: boolean; usage: UsageInfo; provider: ProviderId; model: string }
  | { type: 'error'; code: string; message: string; upgradeTo?: string };

export interface ToolStep {
  id: string;
  name: string;
  label: string;
  status: 'start' | 'done' | 'error';
  summary?: string;
}

/** Shape stored in ChatMessage.structured for assistant messages. */
export interface StoredStructured {
  blocks?: StructuredBlock[];
  isMock?: boolean;
  steps?: ToolStep[];
  question?: string;
}

export const DISCLAIMER = 'Research only — not investment advice.';

export const TOOL_LABELS: Record<string, string> = {
  get_company_snapshot: 'Pulling company snapshot',
  get_financials: 'Reading 10-K financials',
  compare_companies: 'Building comparison table',
  run_screen: 'Running screen',
  get_news: 'Scanning news',
  search_documents: 'Searching filings & transcripts',
  portfolio_risk: 'Checking portfolio risk',
};
