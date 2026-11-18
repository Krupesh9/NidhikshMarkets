import type { SourceRef } from '@/lib/data/types';

export interface Scope { orgId: string; userId: string }

export interface PositionDTO { id: string; portfolioId: string; ticker: string; quantity: number; costBasis: number; targetWeight: number | null; sector: string | null; country: string | null; openedAt: Date | null }
export interface PortfolioDTO { id: string; orgId: string; userId: string; name: string; description: string | null; benchmark: string; baseCurrency: string; createdAt: Date; updatedAt: Date; positions: PositionDTO[] }
export interface BasketHoldingDTO { id: string; ticker: string; targetWeight: number; rationale: string | null; sector: string | null }
export interface BasketDTO { id: string; orgId: string; userId: string; name: string; description: string | null; thesis: string | null; createdAt: Date; updatedAt: Date; holdings: BasketHoldingDTO[] }

export interface SavedScreenDTO { id: string; orgId: string; userId: string; name: string; description: string | null; filters: Record<string, unknown>; columns: string[]; sort: { id: string; desc: boolean }[]; createdAt: Date; updatedAt: Date }

export interface ResearchNoteDTO { id: string; orgId: string; authorId: string; title: string; question: string; answerMarkdown: string; citations: SourceRef[]; structured: Record<string, unknown>; tickers: string[]; threadId: string | null; createdAt: Date; updatedAt: Date }
export interface ChatMessageDTO { id: string; threadId: string; role: string; content: string; citations: SourceRef[]; toolCalls: unknown[]; structured: Record<string, unknown>; provider: string | null; model: string | null; createdAt: Date }
export interface ChatThreadDTO { id: string; orgId: string; userId: string; title: string; tickers: string[]; context: Record<string, unknown>; createdAt: Date; updatedAt: Date; messages?: ChatMessageDTO[] }

export type ShareItemType = 'note' | 'screen' | 'portfolio' | 'basket' | 'thread';
export interface CommentDTO { id: string; shareId: string; authorId: string; authorName?: string; body: string; createdAt: Date }
export interface ShareDTO { id: string; orgId: string; token: string; itemType: ShareItemType; itemId: string; title: string; snapshot: Record<string, unknown>; createdById: string; createdByName?: string; visibility: 'org' | 'link'; expiresAt: Date | null; createdAt: Date; comments?: CommentDTO[] }
