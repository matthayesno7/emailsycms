import { createHash, randomBytes } from 'crypto';

export function newApiKey() {
  const key = 'esy_' + randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}
