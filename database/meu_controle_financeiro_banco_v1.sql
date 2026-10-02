-- ============================================================
-- MEU CONTROLE FINANCEIRO
-- BANCO DE DADOS V1.0
-- PostgreSQL
--
-- Este arquivo reúne toda a estrutura inicial do banco.
-- Execute em um banco PostgreSQL novo.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USUÁRIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    nome VARCHAR(120),
    moeda VARCHAR(3) NOT NULL DEFAULT 'BRL',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_acesso TIMESTAMPTZ
);

-- ============================================================
-- 2. CONTAS
-- ============================================================

CREATE TABLE IF NOT EXISTS contas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    tipo VARCHAR(30) NOT NULL CHECK (
        tipo IN ('corrente', 'poupanca', 'carteira', 'investimento', 'outro')
    ),
    saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
    ativa BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. CATEGORIAS
-- usuario_id NULL = categoria padrão do sistema
-- ============================================================

CREATE TABLE IF NOT EXISTS categorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (
        tipo IN ('receita', 'despesa')
    ),
    icone VARCHAR(50),
    ativa BOOLEAN NOT NULL DEFAULT TRUE,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. CARTÕES
-- ============================================================

CREATE TABLE IF NOT EXISTS cartoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    banco VARCHAR(100),
    limite NUMERIC(14,2) CHECK (limite IS NULL OR limite >= 0),
    dia_fechamento INTEGER CHECK (
        dia_fechamento IS NULL OR dia_fechamento BETWEEN 1 AND 31
    ),
    dia_vencimento INTEGER CHECK (
        dia_vencimento IS NULL OR dia_vencimento BETWEEN 1 AND 31
    ),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. RECORRÊNCIAS
-- É a regra: "Internet, R$ 99,90, todo mês, dia 20"
-- ============================================================

CREATE TABLE IF NOT EXISTS recorrencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
    conta_id UUID REFERENCES contas(id) ON DELETE SET NULL,

    tipo VARCHAR(20) NOT NULL CHECK (
        tipo IN ('receita', 'despesa')
    ),

    valor NUMERIC(14,2) CHECK (valor IS NULL OR valor >= 0),
    valor_variavel BOOLEAN NOT NULL DEFAULT FALSE,

    periodicidade VARCHAR(30) NOT NULL CHECK (
        periodicidade IN (
            'semanal',
            'quinzenal',
            'mensal',
            'bimestral',
            'trimestral',
            'semestral',
            'anual',
            'personalizada'
        )
    ),

    dia_cobranca INTEGER CHECK (
        dia_cobranca IS NULL OR dia_cobranca BETWEEN 1 AND 31
    ),

    data_inicio DATE NOT NULL,
    data_fim DATE,

    gerar_automaticamente BOOLEAN NOT NULL DEFAULT TRUE,

    -- Regra definida pelo usuário:
    -- sempre pedir confirmação antes de efetivar o pagamento.
    exigir_confirmacao BOOLEAN NOT NULL DEFAULT TRUE,

    ativa BOOLEAN NOT NULL DEFAULT TRUE,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (data_fim IS NULL OR data_fim >= data_inicio),

    CHECK (
        (valor_variavel = TRUE)
        OR
        (valor IS NOT NULL)
    )
);

-- ============================================================
-- 6. LANÇAMENTOS
-- Movimentações reais do dinheiro.
-- ============================================================

CREATE TABLE IF NOT EXISTS lancamentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    conta_id UUID NOT NULL REFERENCES contas(id),
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,

    tipo VARCHAR(20) NOT NULL CHECK (
        tipo IN ('receita', 'despesa', 'transferencia')
    ),

    valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),

    descricao VARCHAR(255) NOT NULL,

    data_movimento DATE NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pago' CHECK (
        status IN ('pago', 'pendente', 'cancelado')
    ),

    forma_pagamento VARCHAR(30),

    recorrencia_id UUID REFERENCES recorrencias(id) ON DELETE SET NULL,

    cartao_id UUID REFERENCES cartoes(id) ON DELETE SET NULL,

    observacao TEXT,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. COMPRAS DE CARTÃO
-- ============================================================

CREATE TABLE IF NOT EXISTS compras_cartao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cartao_id UUID NOT NULL REFERENCES cartoes(id) ON DELETE CASCADE,
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,

    descricao VARCHAR(255) NOT NULL,

    valor_total NUMERIC(14,2) NOT NULL CHECK (valor_total > 0),

    numero_parcelas INTEGER NOT NULL DEFAULT 1 CHECK (numero_parcelas >= 1),

    data_compra DATE NOT NULL,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. PAGAMENTOS RECORRENTES
-- É cada ocorrência da regra.
-- ============================================================

CREATE TABLE IF NOT EXISTS pagamentos_recorrentes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    recorrencia_id UUID NOT NULL
        REFERENCES recorrencias(id)
        ON DELETE CASCADE,

    data_prevista DATE NOT NULL,

    data_pagamento DATE,

    valor_previsto NUMERIC(14,2) CHECK (
        valor_previsto IS NULL OR valor_previsto >= 0
    ),

    valor_real NUMERIC(14,2) CHECK (
        valor_real IS NULL OR valor_real >= 0
    ),

    status VARCHAR(20) NOT NULL DEFAULT 'previsto' CHECK (
        status IN (
            'previsto',
            'pendente',
            'pago',
            'atrasado',
            'cancelado'
        )
    ),

    lancamento_id UUID REFERENCES lancamentos(id) ON DELETE SET NULL,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (recorrencia_id, data_prevista)
);

-- ============================================================
-- 9. ANEXOS
-- PDF, fotos e imagens das contas.
-- O arquivo físico ficará em armazenamento de arquivos;
-- esta tabela guarda os metadados e a referência.
-- ============================================================

CREATE TABLE IF NOT EXISTS anexos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

    pagamento_id UUID REFERENCES pagamentos_recorrentes(id) ON DELETE CASCADE,

    nome_arquivo TEXT NOT NULL,
    tipo_arquivo VARCHAR(100),
    caminho_arquivo TEXT NOT NULL,
    tamanho_bytes BIGINT,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. METAS
-- ============================================================

CREATE TABLE IF NOT EXISTS metas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

    nome VARCHAR(150) NOT NULL,

    valor_objetivo NUMERIC(14,2) NOT NULL CHECK (valor_objetivo > 0),

    valor_atual NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor_atual >= 0),

    data_limite DATE,

    status VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (
        status IN ('ativa', 'concluida', 'pausada', 'cancelada')
    ),

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. INVESTIMENTOS
-- ============================================================

CREATE TABLE IF NOT EXISTS investimentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

    conta_id UUID REFERENCES contas(id) ON DELETE SET NULL,

    nome VARCHAR(150) NOT NULL,

    tipo VARCHAR(50) NOT NULL,

    instituicao VARCHAR(100),

    valor_investido NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor_investido >= 0),

    valor_atual NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor_atual >= 0),

    data_aplicacao DATE,
    data_vencimento DATE,

    rentabilidade NUMERIC(10,4),

    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        data_vencimento IS NULL
        OR data_aplicacao IS NULL
        OR data_vencimento >= data_aplicacao
    )
);

-- ============================================================
-- 12. TRANSFERÊNCIAS
-- Transferência não é receita nem despesa.
-- ============================================================

CREATE TABLE IF NOT EXISTS transferencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

    conta_origem_id UUID NOT NULL REFERENCES contas(id),
    conta_destino_id UUID NOT NULL REFERENCES contas(id),

    valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),

    data_transferencia DATE NOT NULL,

    observacao TEXT,

    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (conta_origem_id <> conta_destino_id)
);

-- ============================================================
-- 13. MEMÓRIA FINANCEIRA
-- Informações derivadas do histórico.
-- ============================================================

CREATE TABLE IF NOT EXISTS memoria_financeira (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

    descricao_normalizada VARCHAR(255) NOT NULL,

    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,

    quantidade_ocorrencias INTEGER NOT NULL DEFAULT 0
        CHECK (quantidade_ocorrencias >= 0),

    valor_medio NUMERIC(14,2),
    valor_minimo NUMERIC(14,2),
    valor_maximo NUMERIC(14,2),

    frequencia_estimada VARCHAR(30),

    ultimo_lancamento DATE,

    recorrencia_detectada BOOLEAN NOT NULL DEFAULT FALSE,

    confianca NUMERIC(5,2) CHECK (
        confianca IS NULL OR confianca BETWEEN 0 AND 100
    ),

    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (usuario_id, descricao_normalizada)
);

-- ============================================================
-- 14. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_contas_usuario
    ON contas(usuario_id);

CREATE INDEX IF NOT EXISTS idx_categorias_usuario
    ON categorias(usuario_id);

CREATE INDEX IF NOT EXISTS idx_lancamentos_usuario
    ON lancamentos(usuario_id);

CREATE INDEX IF NOT EXISTS idx_lancamentos_data
    ON lancamentos(data_movimento);

CREATE INDEX IF NOT EXISTS idx_lancamentos_conta
    ON lancamentos(conta_id);

CREATE INDEX IF NOT EXISTS idx_lancamentos_categoria
    ON lancamentos(categoria_id);

CREATE INDEX IF NOT EXISTS idx_lancamentos_recorrencia
    ON lancamentos(recorrencia_id);

CREATE INDEX IF NOT EXISTS idx_recorrencias_usuario
    ON recorrencias(usuario_id);

CREATE INDEX IF NOT EXISTS idx_pagamentos_data
    ON pagamentos_recorrentes(data_prevista);

CREATE INDEX IF NOT EXISTS idx_pagamentos_status
    ON pagamentos_recorrentes(status);

CREATE INDEX IF NOT EXISTS idx_pagamentos_recorrencia
    ON pagamentos_recorrentes(recorrencia_id);

CREATE INDEX IF NOT EXISTS idx_anexos_usuario
    ON anexos(usuario_id);

CREATE INDEX IF NOT EXISTS idx_anexos_pagamento
    ON anexos(pagamento_id);

CREATE INDEX IF NOT EXISTS idx_cartoes_usuario
    ON cartoes(usuario_id);

CREATE INDEX IF NOT EXISTS idx_compras_cartao
    ON compras_cartao(cartao_id);

CREATE INDEX IF NOT EXISTS idx_investimentos_usuario
    ON investimentos(usuario_id);

CREATE INDEX IF NOT EXISTS idx_metas_usuario
    ON metas(usuario_id);

CREATE INDEX IF NOT EXISTS idx_transferencias_usuario
    ON transferencias(usuario_id);

CREATE INDEX IF NOT EXISTS idx_memoria_usuario
    ON memoria_financeira(usuario_id);

-- ============================================================
-- 15. CATEGORIAS PADRÃO
-- usuario_id NULL = disponíveis para todos os usuários.
-- ============================================================

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Salário', 'receita', 'wallet'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Salário' AND tipo = 'receita'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Freelance', 'receita', 'briefcase'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Freelance' AND tipo = 'receita'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Rendimentos', 'receita', 'trending-up'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Rendimentos' AND tipo = 'receita'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Outros', 'receita', 'plus-circle'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Outros' AND tipo = 'receita'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Alimentação', 'despesa', 'utensils'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Alimentação' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Moradia', 'despesa', 'home'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Moradia' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Transporte', 'despesa', 'car'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Transporte' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Saúde', 'despesa', 'heart'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Saúde' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Educação', 'despesa', 'book'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Educação' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Lazer', 'despesa', 'gamepad'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Lazer' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Compras', 'despesa', 'shopping-bag'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Compras' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Assinaturas', 'despesa', 'repeat'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Assinaturas' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Serviços', 'despesa', 'settings'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Serviços' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Impostos', 'despesa', 'file-text'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Impostos' AND tipo = 'despesa'
);

INSERT INTO categorias (nome, tipo, icone)
SELECT 'Outros', 'despesa', 'plus-circle'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias
    WHERE usuario_id IS NULL AND nome = 'Outros' AND tipo = 'despesa'
);

COMMIT;

-- ============================================================
-- FIM DO BANCO V1.0
--
-- Observação:
-- O backend deverá controlar:
-- 1. autenticação;
-- 2. confirmação de pagamentos;
-- 3. geração das ocorrências recorrentes;
-- 4. atualização da memória financeira;
-- 5. cálculo de saldo;
-- 6. leitura de anexos;
-- 7. notificações.
-- ============================================================
