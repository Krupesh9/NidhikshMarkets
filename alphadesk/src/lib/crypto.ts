import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM for user API keys. ENCRYPTION_KEY = 32-byte base64. */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return k;
}

export interface Sealed { ciphertext: string; iv: string; tag: string; last4: string }

export function encrypt(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), last4: plaintext.slice(-4) };
}

export function decrypt(s: Pick<Sealed, 'ciphertext' | 'iv' | 'tag'>): string {
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(s.iv, 'base64'));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.ciphertext, 'base64')), d.final()]).toString('utf8');
}

export function mask(last4: string): string {
  return `••••••••${last4}`;
}
