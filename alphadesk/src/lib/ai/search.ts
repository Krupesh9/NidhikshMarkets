// Keyword / TF-IDF ranking over document chunks (pure). Used by search_documents when the
// DocumentChunk table has no embeddings yet. Phase two: pgvector cosine similarity.

export interface Chunk {
  id: string;
  ticker?: string | null;
  title: string;
  text: string;
  url?: string | null;
  kind: 'filing' | 'transcript' | 'news' | 'note' | string;
  locator?: string;
  date?: string | null;
}

const STOP = new Set(
  'a an and are as at be but by for from has have in into is it its of on or our over than that the their this to was we were will with what which who how does do did about vs versus compare last years year'.split(' '),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9\-.%$]*/g) ?? [])
    .map((t) => t.replace(/[.]+$/, ''))
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export interface Ranked extends Chunk {
  score: number;
  matched: string[];
}

/** Rank chunks by TF-IDF against the query (+ small boosts for exact phrases and recency). */
export function rankChunks(query: string, chunks: Chunk[], limit = 6): Ranked[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => tokenize(`${c.title} ${c.text}`));
  const N = docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));
  const ql = query.toLowerCase();

  const out: Ranked[] = [];
  chunks.forEach((c, i) => {
    const d = docs[i];
    if (!d.length) return;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    const matched: string[] = [];
    for (const t of q) {
      const f = tf.get(t);
      if (f) {
        score += (f / d.length) * idf(t) * 10;
        matched.push(t);
      }
    }
    if (!matched.length) return;
    // coverage boost: chunks matching more distinct query terms win
    score *= 1 + matched.length / q.length;
    if (ql.length > 6 && `${c.title} ${c.text}`.toLowerCase().includes(ql)) score *= 1.5;
    out.push({ ...c, score: Math.round(score * 1000) / 1000, matched });
  });
  return out.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? '')).slice(0, limit);
}
