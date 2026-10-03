import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(__dirname, '../database');
const ordered = [
  'meu_controle_financeiro_banco_v1.sql',
  'v22.sql',
  'v23_security.sql',
  'v24_security_advanced.sql',
  'v25_security_hardening.sql',
  'v26_production_hardening.sql',
  'v27_rls_isolation.sql',
  'v29_privacidade_lgpd.sql',
  'v33_recorrencias_inteligentes.sql',
  'v34_notificacoes_agenda.sql',
  'v36_metas_planejamento.sql',
  'v37_investimentos.sql',
  'v39_dividas.sql',
  'v49_assistente_historico.sql',
  'v50_compatibilidade_schema.sql',
  'v51_default_account.sql'
];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } });
try {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const file of ordered) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file]);
      if (exists.rowCount) continue;
      const sql = await fs.readFile(path.join(databaseDir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      console.log(`migration applied: ${file}`);
    }
  } finally { client.release(); }
} finally { await pool.end(); }
