process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.ALPHADESK_FORCE_MOCK ??= '1';
