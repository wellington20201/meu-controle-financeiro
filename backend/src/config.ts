import 'dotenv/config';

const bool = (v: string | undefined, fallback: boolean) => v === undefined ? fallback : ['1','true','yes','on'].includes(v.toLowerCase());

export const env = {
  PORT: Number(process.env.PORT ?? 3333),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  SESSION_DAYS: Number(process.env.SESSION_DAYS ?? 7),
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  COOKIE_SAME_SITE: (process.env.COOKIE_SAME_SITE ?? (process.env.NODE_ENV === 'production' ? 'lax' : 'lax')) as 'lax'|'strict'|'none',
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || undefined,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  TRUST_PROXY: bool(process.env.TRUST_PROXY, false),
  MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? '',
  PASSWORD_RESET_MINUTES: Number(process.env.PASSWORD_RESET_MINUTES ?? 30),
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL ?? '',
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? './private-uploads',
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES ?? 10485760),
  DB_SSL: bool(process.env.DB_SSL, process.env.NODE_ENV === 'production'),
  DB_SSL_REJECT_UNAUTHORIZED: bool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
  DB_SSL_CA: process.env.DB_SSL_CA || undefined,
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX ?? 10),
  DB_IDLE_TIMEOUT_MS: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
  DB_CONNECTION_TIMEOUT_MS: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
  BACKUP_RETENTION_DAYS: Number(process.env.BACKUP_RETENTION_DAYS ?? 30)
};

if (!env.DATABASE_URL) console.warn('DATABASE_URL não configurada.');
if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) console.warn('COOKIE_SECURE deve ser true em produção.');
if (env.NODE_ENV === 'production' && !/^[0-9a-fA-F]{64}$/.test(env.MFA_ENCRYPTION_KEY)) console.warn('MFA_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais em produção.');
