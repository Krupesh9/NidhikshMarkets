import type { InsiderTxn } from './types';

/**
 * Minimal SEC Form 4 parser (ownershipDocument XML). Only open-market and economically meaningful codes are kept:
 * P = open-market purchase → Buy, S = open-market sale → Sell, M/X = option exercise, G = gift.
 * Awards (A), tax withholding (F) and other administrative codes are skipped so they don't read as trades.
 */
const CODE: Record<string, InsiderTxn['type']> = { P: 'Buy', S: 'Sell', M: 'Option Exercise', X: 'Option Exercise', G: 'Gift' };

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
const val = (xml: string, name: string) => tag(tag(xml, name) || '', 'value').trim() || tag(xml, name).trim();
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function parseForm4(xml: string, ticker: string, filingUrl: string, accession: string): InsiderTxn[] {
  const owner = tag(xml, 'reportingOwner');
  const rawName = decode(tag(owner, 'rptOwnerName').trim());
  // SEC names are "LAST FIRST MIDDLE"; show "First Middle Last".
  const parts = rawName.split(/\s+/);
  const insider = parts.length > 1 ? titleCase([...parts.slice(1), parts[0]].join(' ')) : titleCase(rawName);
  const rel = tag(owner, 'reportingOwnerRelationship');
  const title = decode(tag(rel, 'officerTitle').trim()) || (tag(rel, 'isDirector').trim() === '1' || tag(rel, 'isDirector').trim() === 'true' ? 'Director' : tag(rel, 'isTenPercentOwner').trim() === '1' ? '10% owner' : 'Insider');
  const out: InsiderTxn[] = [];
  const txns = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) ?? [];
  txns.forEach((t, i) => {
    const code = tag(tag(t, 'transactionCoding'), 'transactionCode').trim();
    const type = CODE[code];
    if (!type) return;
    const shares = Number(val(t, 'transactionShares')) || 0;
    const price = Number(val(t, 'transactionPricePerShare')) || 0;
    out.push({
      id: `sec4:${accession}:${i}`, ticker, insider, title, date: val(t, 'transactionDate').slice(0, 10), type,
      shares, price, value: shares * price, sharesOwnedAfter: Number(val(t, 'sharesOwnedFollowingTransaction')) || 0, filingUrl,
    });
  });
  return out;
}
