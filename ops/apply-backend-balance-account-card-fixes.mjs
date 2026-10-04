import fs from 'node:fs';

const appPath='/src/backend/src/app.ts';
let app=fs.readFileSync(appPath,'utf8');

// Corrige o saldo do dashboard sem JOIN que multiplique o saldo inicial.
const oldDashboard="query(`SELECT COALESCE(SUM(c.saldo_inicial),0)+COALESCE(SUM(CASE WHEN l.tipo='receita' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END),0) saldo FROM contas c LEFT JOIN lancamentos l ON l.conta_id=c.id WHERE c.usuario_id=$1 AND c.ativa=true`,[id])";
const fixedDashboard="query(`SELECT COALESCE(SUM(c.saldo_inicial),0)+COALESCE((SELECT SUM(CASE WHEN l.tipo='receita' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END) FROM lancamentos l WHERE l.usuario_id=$1 AND l.conta_id IN (SELECT id FROM contas WHERE usuario_id=$1 AND ativa=true)),0) saldo FROM contas c WHERE c.usuario_id=$1 AND c.ativa=true`,[id])";

if(app.includes(oldDashboard)) app=app.replace(oldDashboard,fixedDashboard);

const alreadyFixed="COALESCE((SELECT SUM(CASE WHEN l.tipo='receita' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END) FROM lancamentos l WHERE l.usuario_id=$1 AND l.conta_id IN (SELECT id FROM contas WHERE usuario_id=$1 AND ativa=true)),0) saldo";
if(!app.includes(alreadyFixed)) throw new Error('dashboard balance query not found after normalization');

fs.writeFileSync(appPath,app);
console.log('Backend dashboard balance fix applied');
