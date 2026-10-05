import fs from 'node:fs';

const file = '/src/backend/src/app.ts';
let s = fs.readFileSync(file, 'utf8');

const oldCards = "SELECT id,nome,limite,comprometido,disponivel FROM cartoes WHERE usuario_id=$1 AND ativo=true ORDER BY nome";
const newCards = "SELECT c.id,c.nome,c.limite,COALESCE((SELECT SUM(p.valor) FROM compras_cartao cc JOIN parcelas_cartao p ON p.compra_id=cc.id WHERE cc.cartao_id=c.id AND p.status='aberta'),0) AS comprometido,CASE WHEN c.limite IS NULL THEN NULL ELSE c.limite-COALESCE((SELECT SUM(p.valor) FROM compras_cartao cc JOIN parcelas_cartao p ON p.compra_id=cc.id WHERE cc.cartao_id=c.id AND p.status='aberta'),0) END AS disponivel FROM cartoes c WHERE c.usuario_id=$1 AND c.ativo=true ORDER BY c.nome";
if (s.includes(oldCards)) s = s.replaceAll(oldCards, newCards);

s = s.replaceAll(
  "SELECT * FROM memoria_financeira WHERE usuario_id=$1 ORDER BY ocorrencias DESC",
  "SELECT * FROM memoria_financeira WHERE usuario_id=$1 ORDER BY quantidade_ocorrencias DESC"
);
s = s.replaceAll(
  "ocorrencias:x.ocorrencias,media:n(x.media_valor)",
  "ocorrencias:x.quantidade_ocorrencias,media:n(x.media_valor)"
);

fs.writeFileSync(file, s);
console.log('API schema final fix applied');
