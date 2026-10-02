-- V3.6 — Metas e Planejamento Financeiro Inteligente
-- Safe to run multiple times.
ALTER TABLE metas ADD COLUMN IF NOT EXISTS conta_id UUID REFERENCES contas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_metas_conta ON metas(conta_id);
