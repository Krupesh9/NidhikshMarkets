/* NidhikshDesk demo seed. Idempotent: wipes demo org data and recreates it. Run: npm run db:seed */
import { PrismaClient } from '@prisma/client';
import { MOCK_BY_TICKER } from '../src/lib/data/mock/universe';

const db = new PrismaClient();
const J = (v: unknown) => JSON.stringify(v);
const edgar = (t: string, form: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t}&type=${form}&dateb=&owner=include&count=40`;

async function main() {
  // reset (SQLite demo only)
  await db.comment.deleteMany();
  await db.share.deleteMany();
  await db.chatMessage.deleteMany();
  await db.chatThread.deleteMany();
  await db.researchNote.deleteMany();
  await db.basketHolding.deleteMany();
  await db.basket.deleteMany();
  await db.position.deleteMany();
  await db.portfolio.deleteMany();
  await db.savedScreen.deleteMany();
  await db.watchlist.deleteMany();
  await db.feedItem.deleteMany();
  await db.usageCounter.deleteMany();
  await db.auditLog.deleteMany();
  await db.apiCredential.deleteMany();
  await db.documentChunk.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  const org = await db.organization.create({ data: { name: 'Demo Capital', slug: 'demo-capital', seats: 5 } });
  const pm = await db.user.create({ data: { orgId: org.id, email: 'pm@nidhikshdesk.dev', name: 'Priya Mehta', role: 'ADMIN', plan: 'PRO_PLUS' } });
  const analyst = await db.user.create({ data: { orgId: org.id, email: 'analyst@nidhikshdesk.dev', name: 'Alex Chen', role: 'ANALYST', plan: 'PRO_PLUS' } });
  const intern = await db.user.create({ data: { orgId: org.id, email: 'intern@nidhikshdesk.dev', name: 'Jordan Lee', role: 'VIEWER', plan: 'FREE' } });

  for (const [u, syms] of [
    [pm, ['NVDA', 'MSFT', 'AAPL', 'LLY', 'JPM', 'AVGO', 'XOM', 'META']],
    [analyst, ['AMD', 'TSM', 'AVGO', 'EQIX', 'NEE', 'CAT']],
    [intern, ['AAPL', 'TSLA', 'AMZN']],
  ] as const) {
    await db.watchlist.create({ data: { orgId: org.id, userId: u.id, name: 'My Watchlist', symbols: J(syms) } });
  }

  const pos = (ticker: string, quantity: number, costBasis: number, targetWeight?: number) => {
    const m = MOCK_BY_TICKER[ticker];
    return { orgId: org.id, ticker, quantity, costBasis, targetWeight: targetWeight ?? null, sector: m?.sector ?? null, country: m?.country ?? 'US', openedAt: new Date(Date.now() - Math.floor(30 + Math.random() * 400) * 86400000) };
  };

  const core = await db.portfolio.create({
    data: {
      orgId: org.id, userId: pm.id, name: 'Core Long/Short', description: 'Flagship market-neutral-ish book: quality compounders long, crowded/over-earning names short.', benchmark: 'SPY',
      positions: { create: [
        pos('MSFT', 4200, 412.3, 0.10), pos('NVDA', 9500, 121.8, 0.09), pos('LLY', 1800, 780.5, 0.08), pos('JPM', 5200, 228.4, 0.07),
        pos('V', 3600, 291.2, 0.06), pos('LIN', 2100, 455.0, 0.05), pos('CAT', 1500, 352.6, 0.05), pos('NEE', 9000, 71.4, 0.04),
        pos('XOM', 6000, 109.8, 0.04), pos('PLD', 4800, 118.2, 0.03), pos('TSLA', -2500, 385.0, -0.05), pos('UNH', -1800, 520.4, -0.03), pos('KO', -6000, 71.9, -0.02),
      ] },
    },
  });
  const ai = await db.portfolio.create({
    data: {
      orgId: org.id, userId: analyst.id, name: 'AI Infrastructure', description: 'Compute, networking, power and data-center real estate exposed to AI capex.', benchmark: 'QQQ',
      positions: { create: [
        pos('NVDA', 6000, 98.4, 0.18), pos('AVGO', 3000, 168.2, 0.14), pos('TSM', 4500, 182.5, 0.12), pos('AMD', 3800, 152.0, 0.09),
        pos('MSFT', 1500, 398.6, 0.10), pos('GOOGL', 3200, 171.4, 0.09), pos('EQIX', 700, 802.1, 0.08), pos('ORCL', 2600, 168.9, 0.07),
        pos('NEE', 5000, 74.2, 0.06), pos('GE', 1600, 182.3, 0.04), pos('META', 800, 545.0, 0.03),
      ] },
    },
  });

  await db.basket.create({
    data: {
      orgId: org.id, userId: pm.id, name: 'AI Picks & Shovels', description: 'Picks-and-shovels suppliers to the AI build-out.',
      thesis: 'Hyperscaler capex keeps compounding through 2027; suppliers of compute, networking, foundry capacity and power capture durable share of spend with less end-application risk.',
      holdings: { create: [
        { orgId: org.id, ticker: 'NVDA', targetWeight: 0.22, rationale: 'Accelerator platform + software moat', sector: 'Information Technology' },
        { orgId: org.id, ticker: 'AVGO', targetWeight: 0.16, rationale: 'Custom ASICs and Ethernet networking', sector: 'Information Technology' },
        { orgId: org.id, ticker: 'TSM', targetWeight: 0.16, rationale: 'Leading-edge foundry + advanced packaging', sector: 'Information Technology' },
        { orgId: org.id, ticker: 'AMD', targetWeight: 0.10, rationale: 'Second-source accelerators', sector: 'Information Technology' },
        { orgId: org.id, ticker: 'EQIX', targetWeight: 0.10, rationale: 'Interconnection-rich data centers', sector: 'Real Estate' },
        { orgId: org.id, ticker: 'NEE', targetWeight: 0.10, rationale: 'Power for data-center load growth', sector: 'Utilities' },
        { orgId: org.id, ticker: 'GE', targetWeight: 0.08, rationale: 'Gas turbines (via Vernova exposure) / aero aftermarket', sector: 'Industrials' },
        { orgId: org.id, ticker: 'LIN', targetWeight: 0.08, rationale: 'Industrial gases for fabs', sector: 'Materials' },
      ] },
    },
  });

  const notes = [
    {
      title: 'NVDA: is data-center growth still accelerating?', authorId: pm.id, tickers: ['NVDA'],
      question: 'Is NVIDIA data-center revenue growth still accelerating, and what are the key risks into next print?',
      answerMarkdown: `**Short answer:** growth remains strong but sequential acceleration is moderating [1].\n\n- Management cited record backlog and continued supply tightness [2].\n- Consensus FY EPS has moved up over the last 30 days [3].\n- Key risks: export controls and customer concentration [1].\n\n_Research only — not investment advice._`,
      citations: [
        { id: 'mock:filing:NVDA:10-K:2025', name: 'NVDA 10-K — Risk Factors', kind: 'filing', url: edgar('NVDA', '10-K'), locator: 'Item 1A. Risk Factors', excerpt: 'Our results could be adversely affected by concentration of revenue among a limited number of large customers and by changes in global trade policy, including export controls.' },
        { id: 'mock:transcript:NVDA:latest', name: 'NVDA earnings call (simulated)', kind: 'transcript', locator: 'CEO, ¶1', excerpt: 'Demand for data center remained robust through the quarter and our backlog is the strongest in our history.' },
        { id: 'mock:estimates:NVDA', name: 'NVDA consensus estimates (simulated)', kind: 'estimate' },
      ],
      structured: { stance: 'constructive', confidence: 0.7, bullets: ['Backlog strong', 'Export-control risk'] },
    },
    {
      title: 'LLY vs NVO: GLP-1 share dynamics', authorId: analyst.id, tickers: ['LLY', 'NVO'],
      question: 'How are LLY and NVO positioned in GLP-1 obesity drugs over the next 12 months?',
      answerMarkdown: `LLY continues to gain share on supply expansion [1], while NVO guided more conservatively [2]. Watch the next PDUFA dates on the catalyst calendar.\n\n_Research only — not investment advice._`,
      citations: [
        { id: 'mock:filing:LLY:10-Q:latest', name: 'LLY 10-Q — MD&A', kind: 'filing', url: edgar('LLY', '10-Q'), locator: 'Part I, Item 2. MD&A', excerpt: 'We continue to see healthy demand in GLP-1, although visibility beyond the next two quarters remains limited.' },
        { id: 'mock:news:NVO:guidance', name: 'Reuters: Novo Nordisk trims outlook (simulated)', kind: 'news', url: 'https://example.com/news/nvo/guidance' },
      ],
      structured: { comparison: ['LLY', 'NVO'] },
    },
    {
      title: 'JPM: NII sensitivity to rate cuts', authorId: pm.id, tickers: ['JPM'],
      question: 'What is JPMorgan net interest income sensitivity to further rate cuts?',
      answerMarkdown: `Management indicated NII would decline modestly per 25bp cut, partly offset by deposit repricing and loan growth [1].\n\n_Research only — not investment advice._`,
      citations: [
        { id: 'mock:filing:JPM:10-K:2025', name: 'JPM 10-K — Market Risk', kind: 'filing', url: edgar('JPM', '10-K'), locator: 'Item 7A. Market Risk', excerpt: 'Earnings-at-risk scenarios indicate a modest decline in net interest income under parallel downward rate shocks.' },
      ],
      structured: {},
    },
  ];
  const createdNotes = [];
  for (const n of notes) {
    createdNotes.push(await db.researchNote.create({ data: { orgId: org.id, authorId: n.authorId, title: n.title, question: n.question, answerMarkdown: n.answerMarkdown, citations: J(n.citations), structured: J(n.structured), tickers: J(n.tickers) } }));
  }

  await db.savedScreen.create({
    data: {
      orgId: org.id, userId: pm.id, name: 'Quality growth at a reasonable price', description: 'Rev growth > 10%, P/E < 35, positive revisions',
      filters: J({ revenueGrowth: { min: 10 }, pe: { max: 35 }, epsRevision30d: { min: 0 } }),
      columns: J(['ticker', 'name', 'sector', 'marketCap', 'price', 'changePct', 'pe', 'revenueGrowth', 'epsRevision30d', 'sparkline']),
      sort: J([{ id: 'epsRevision30d', desc: true }]),
    },
  });
  await db.savedScreen.create({
    data: {
      orgId: org.id, userId: analyst.id, name: 'Insider buying + catalyst in 45d', description: 'Net insider buying and an upcoming catalyst',
      filters: J({ insiderBuying90d: { min: 0 }, catalystFlags: { any: ['earnings', 'fda', 'investor_day'] } }),
      columns: J(['ticker', 'name', 'sector', 'price', 'insiderBuying90d', 'nextEarnings', 'catalystFlags', 'whyNow']),
      sort: J([{ id: 'insiderBuying90d', desc: true }]),
    },
  });

  const share = await db.share.create({
    data: {
      orgId: org.id, token: 'demo-nvda-note', itemType: 'note', itemId: createdNotes[0].id, title: notes[0].title, createdById: pm.id, visibility: 'org',
      snapshot: J({ question: notes[0].question, answerMarkdown: notes[0].answerMarkdown, sources: notes[0].citations, tickers: notes[0].tickers, capturedAt: new Date().toISOString() }),
    },
  });
  await db.comment.create({ data: { orgId: org.id, shareId: share.id, authorId: analyst.id, body: 'Agree on backlog. I would add a sensitivity on gross margin if HBM pricing normalises.' } });
  await db.comment.create({ data: { orgId: org.id, shareId: share.id, authorId: pm.id, body: 'Good call — can you pull the last two transcripts and compare GM commentary?' } });

  await db.feedItem.createMany({
    data: [
      { orgId: org.id, userId: pm.id, kind: 'share', title: `Priya shared "${notes[0].title}"`, href: `/shared/${share.token}` },
      { orgId: org.id, userId: analyst.id, kind: 'comment', title: 'Alex commented on NVDA note', href: `/shared/${share.token}` },
      { orgId: org.id, userId: analyst.id, kind: 'note', title: `New note: ${notes[1].title}`, href: '/research' },
    ],
  });

  const period = new Date().toISOString().slice(0, 7);
  await db.usageCounter.create({ data: { orgId: org.id, userId: analyst.id, period, aiQueries: 37 } });
  await db.usageCounter.create({ data: { orgId: org.id, userId: pm.id, period, aiQueries: 212 } });

  console.log(`Seeded org ${org.name}: users ${[pm, analyst, intern].map((u) => u.email).join(', ')}; portfolios ${core.name}, ${ai.name}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
