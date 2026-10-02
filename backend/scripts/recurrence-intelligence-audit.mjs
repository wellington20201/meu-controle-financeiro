import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const checks=[
 ['sincroniza previsoes',app.includes('syncRecurringPaymentsForUser')],
 ['janela 90 dias',app.includes('horizonDays=90')],
 ['status atrasado',app.includes("status='atrasado'")],
 ['sem lancamento automatico',app.includes("Confirmação explícita necessária")],
 ['proxima ocorrencia apos pagamento',app.includes('nextOccurrence(new Date')],
 ['resumo de recorrencias',app.includes("/api/recorrencias/resumo")],
 ['comparacao valor real',app.includes('media_real')],
 ['unique por data',fs.readFileSync(new URL('../../database/v33_recorrencias_inteligentes.sql',import.meta.url),'utf8').includes('uq_pagamentos_recorrentes_data')],
];
let ok=0;for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} - ${n}`);if(v)ok++;}if(ok!==checks.length)process.exit(1);console.log(`Auditoria V3.3: ${ok}/${checks.length} PASS`);
