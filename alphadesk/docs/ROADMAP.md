# NidhikshDesk — Roadmap

Phase One (shipped): local, research-only demo. The five features, plan gating with mock billing, a composite data
chain with mock fallback, AI with citations, and in-process cache, rate limiting and jobs behind interfaces.
Every item below goes behind an interface that already exists, so feature code doesn't change.

## Phase two: production data platform
- **Storage behind the repos:** Postgres 16 as the system of record, using `prisma/postgres/schema.prisma` and the
  repos' JSON adapter. **pgvector** for filing, transcript and note embeddings (`DocumentChunk.embedding`) to power
  retrieval in AI research. **TimescaleDB** hypertables for daily and intraday bars. **ClickHouse** for screener and
  analytics scans across the whole universe. All of this sits behind the repositories and `MarketDataProvider`.
- **Redis** for the `Cache` and `RateLimiter` interfaces, which gives shared state across instances.
- **Jobs:** BullMQ on Redis behind `JobQueue`. Scheduled refreshes, filing ingestion and chunking, embeddings and
  alert evaluation. Priority queues for Pro Plus "priority refresh".
- **Streaming:** Kafka or Redpanda topics for prices, news and filings. **SSE** to the browser for quotes, the feed and
  alerts (AI already streams over SSE). **WebSockets** for collaborative comments and presence.
- **Billing:** **Stripe Checkout** for upgrades and the **Customer Portal** for plan, payment method and invoices.
  Webhooks will update `User.plan` and seats, replacing the demo plan toggle.
- **Auth:** real email magic links (SMTP or Resend), SSO (SAML/OIDC) and SCIM for the Pro Plus team tier.

## Phase three: scale and trust
- **Kubernetes** with a separate stateless web tier and an autoscaled **worker tier** (ingestion, embeddings, AI
  batch). Horizontal pod autoscaling on queue depth.
- **Multi-region:** read replicas and edge caching of reference data, with region-pinned tenant data for residency.
- **SOC 2 Type II:** centralized audit export, key rotation with KMS envelope encryption (replacing a single
  `ENCRYPTION_KEY`), access reviews, a vendor inventory and a formal incident response process.
- **Native mobile** (iOS and Android): watchlists, alerts, the research feed and AI chat. Still read-only research.
- **Plugin marketplace:** third-party data providers and AI tools packaged as `MarketDataProvider` and `ToolSpec`
  plugins, with per-org enablement, sandboxed execution and usage-based revenue share.

## Explicitly still out of scope
Order routing, broker integration, execution and anything that turns research into advice.
