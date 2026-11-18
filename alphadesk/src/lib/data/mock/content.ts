import type { MockCompany } from './universe';

/** Headline / excerpt templates used to build plausible mock news, filings and transcripts. */
export const NEWS_TEMPLATES: { t: string; s: 'positive' | 'neutral' | 'negative' }[] = [
  { t: '{name} beats on revenue as {segment} demand accelerates', s: 'positive' },
  { t: '{name} raises full-year guidance; margins expand {bps} bps', s: 'positive' },
  { t: 'Analysts lift {ticker} price targets after investor day', s: 'positive' },
  { t: '{name} announces ${buyback}B buyback authorization', s: 'positive' },
  { t: '{ticker} shares slip as {segment} growth decelerates', s: 'negative' },
  { t: '{name} flags supply constraints into next quarter', s: 'negative' },
  { t: 'Regulators open review into {name} {segment} practices', s: 'negative' },
  { t: '{name} names new CFO, reiterates outlook', s: 'neutral' },
  { t: '{name} to present at upcoming industry conference', s: 'neutral' },
  { t: '{name} expands partnership to scale {segment} offering', s: 'positive' },
  { t: 'Short sellers trim positions in {ticker} ahead of earnings', s: 'neutral' },
  { t: '{ticker}: what the options market implies for the print', s: 'neutral' },
];

export const PUBLISHERS = ['Reuters', 'Bloomberg', 'The Wall Street Journal', 'Financial Times', 'Barron’s', 'CNBC', 'MarketWatch', 'Business Wire', 'PR Newswire'];

export const SEGMENT_BY_SECTOR: Record<string, string[]> = {
  'Information Technology': ['data center', 'cloud', 'AI accelerator', 'subscription software', 'enterprise'],
  'Communication Services': ['advertising', 'streaming', 'wireless', 'AI assistant'],
  'Consumer Discretionary': ['e-commerce', 'EV', 'pro customer', 'digital ordering'],
  'Consumer Staples': ['membership', 'pricing', 'beverage', 'private label'],
  Energy: ['upstream', 'LNG', 'refining', 'Permian'],
  Financials: ['net interest income', 'investment banking', 'cross-border payments', 'wealth management'],
  'Health Care': ['GLP-1', 'oncology', 'Medicare Advantage', 'robotic surgery'],
  Industrials: ['aftermarket services', 'defense', 'rail volume', 'commercial aerospace'],
  Materials: ['copper', 'gold', 'industrial gas', 'specialty chemicals'],
  'Real Estate': ['data center leasing', 'logistics', 'tower leasing'],
  Utilities: ['renewables', 'rate base', 'data center load'],
};

export function fill(t: string, m: MockCompany, extra: Record<string, string> = {}): string {
  return t
    .replaceAll('{name}', m.name.replace(/,? Inc\.|,? Incorporated| Corporation| Company|, Inc\./g, ''))
    .replaceAll('{ticker}', m.ticker)
    .replace(/\{(\w+)\}/g, (_, k) => extra[k] ?? '');
}

export const FILING_EXCERPTS: Record<string, { locator: string; text: string }[]> = {
  '10-K': [
    { locator: 'Item 1A. Risk Factors', text: 'Our results could be adversely affected by concentration of revenue among a limited number of large customers and by changes in global trade policy, including export controls.' },
    { locator: 'Item 7. MD&A — Results of Operations', text: 'Revenue increased {growth}% year over year, driven primarily by {segment} volume and favorable mix, partially offset by foreign exchange headwinds.' },
    { locator: 'Item 7. MD&A — Liquidity', text: 'We believe existing cash, cash equivalents and expected cash flows from operations will be sufficient to fund operating and capital requirements for at least the next twelve months.' },
  ],
  '10-Q': [
    { locator: 'Part I, Item 2. MD&A', text: 'Gross margin was {gm}%, compared with the prior-year period, reflecting {segment} mix and pricing actions.' },
    { locator: 'Part I, Item 2. Outlook', text: 'We continue to see healthy demand in {segment}, although visibility beyond the next two quarters remains limited.' },
  ],
  '8-K': [
    { locator: 'Item 2.02 Results of Operations', text: 'The Company issued a press release announcing financial results for the quarter, including revenue of ${rev}B.' },
    { locator: 'Item 5.02 Departure/Election of Officers', text: 'The Board appointed a new Chief Financial Officer, effective at the start of the next fiscal quarter.' },
  ],
};

export const TRANSCRIPT_LINES: { speaker: string; text: string }[] = [
  { speaker: 'CEO', text: 'Demand for {segment} remained robust through the quarter and our backlog is the strongest in our history.' },
  { speaker: 'CFO', text: 'We now expect full-year revenue growth of roughly {growth}%, with operating margin expanding modestly despite continued investment.' },
  { speaker: 'CFO', text: 'Capital returns remain a priority; we repurchased shares and increased the dividend while keeping leverage within our target range.' },
  { speaker: 'CEO', text: 'We are seeing early signs of normalization in {segment}, and we are being prudent in how we plan for the second half.' },
  { speaker: 'Analyst Q&A', text: 'On pricing, we have not seen meaningful pushback, though competitive intensity in {segment} has picked up at the low end.' },
];
