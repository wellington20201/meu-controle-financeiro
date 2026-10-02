import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from './config.js';

const ssl = env.DB_SSL ? {
  rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
  ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA } : {})
} : undefined;

export type SecurityContext = { userId?: string };
export const securityContext = new AsyncLocalStorage<SecurityContext>();

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  application_name: 'meu-controle-financeiro'
});

pool.on('error', (err) => {
  console.error('[db] pool error', { name: err.name, code: (err as any).code });
});

export async function query<T = any>(text: string, params: any[] = []) {
  const userId = securityContext.getStore()?.userId;
  if (!userId) return pool.query<T>(text, params);

  // Every authenticated query gets its own short transaction so PostgreSQL RLS
  // can consume a transaction-local app.user_id without leaking context across
  // pooled connections.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const result = await client.query<T>(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function setUserContext(client: pg.PoolClient, userId: string) {
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
}
