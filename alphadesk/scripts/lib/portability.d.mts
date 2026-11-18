/* eslint-disable @typescript-eslint/no-explicit-any */
export const EXPORT_VERSION: number;
export const EXPORT_MODELS: [string, string][];
export const IMPORT_ORDER: [string, string][];
export const USER_FIELDS: string[];
export function normalizePlan(p: string | null | undefined): 'FREE' | 'PRO_PLUS';
export function normalizeRole(r: string | null | undefined): 'ADMIN' | 'ANALYST' | 'VIEWER';
export function isDemoEmail(email: string | null | undefined): boolean;
export function parseAddUser(spec: string): { email: string; plan: 'FREE' | 'PRO_PLUS'; role: 'ADMIN' | 'ANALYST' | 'VIEWER' };
export function mergeSymbols(...lists: unknown[]): string[];
export function planImport(data: Record<string, any>, opts: { targetOrgId: string; ownerId: string; ownerEmail: string }): { users: Record<string, any>[]; rows: Record<string, Record<string, any>[]> };
export function adaptRow(row: Record<string, unknown>, fieldTypes: Record<string, string>): Record<string, unknown>;
export function countsOf(data: Record<string, unknown>): Record<string, number>;
