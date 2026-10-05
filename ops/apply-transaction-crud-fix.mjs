import fs from 'node:fs';

const file='/src/backend/src/app.ts';
let s=fs.readFileSync(file,'utf8');

// New launches are already confirmed by the submit action; the previous API guard
// made the existing frontend unable to create anything because it did not send
// an internal `confirmado` flag.
s=s.replace("if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});if(!b.conta_id||!b.descricao||!b.valor||!b.data_movimento||!['receita','despesa'].includes(b.tipo))", "if(!b.conta_id||!b.descricao||!b.valor||!b.data_movimento||!['receita','despesa'].includes(b.tipo))");

const marker="  app.get('/api/lancamentos/sugestoes',async(req:any)=>{";
if(!s.includes("app.patch('/api/lancamentos/:id'")){
  const routes=`  app.patch('/api/lancamentos/:id',async(req:any,rep)=>{\n    const id=userId(req); const txId=String((req.params as any).id||''); const b=req.body||{};\n    const current=await query(\`SELECT * FROM lancamentos WHERE id=$1 AND usuario_id=$2\`,[txId,id]);\n    if(!current.rowCount)return rep.code(404).send({message:'Lançamento não encontrado'});\n    if(b.conta_id){const own=await query(\`SELECT id FROM contas WHERE id=$1 AND usuario_id=$2 AND ativa=true\`,[b.conta_id,id]);if(!own.rowCount)return rep.code(404).send({message:'Conta não encontrada'});}\n    if(b.categoria_id){const cat=await query(\`SELECT id FROM categorias WHERE id=$1 AND ativa=true AND (usuario_id=$2 OR usuario_id IS NULL)\`,[b.categoria_id,id]);if(!cat.rowCount)return rep.code(404).send({message:'Categoria não encontrada'});}\n    const x=current.rows[0]; const tipo=['receita','despesa','transferencia'].includes(b.tipo)?b.tipo:x.tipo; const valor=b.valor!==undefined?money(b.valor):n(x.valor);\n    if(valor<=0)return rep.code(400).send({message:'O valor precisa ser maior que zero.'});\n    const r=await query(\`UPDATE lancamentos SET conta_id=COALESCE($1,conta_id),categoria_id=CASE WHEN $2::text IS NULL THEN categoria_id ELSE $2::uuid END,tipo=$3,valor=$4,descricao=COALESCE($5,descricao),data_movimento=COALESCE($6::date,data_movimento),status=COALESCE($7,status),forma_pagamento=COALESCE($8,forma_pagamento),observacao=COALESCE($9,observacao),atualizado_em=now() WHERE id=$10 AND usuario_id=$11 RETURNING *\`,[b.conta_id||null,b.categoria_id===undefined?null:(b.categoria_id||null),tipo,valor,b.descricao||null,b.data_movimento||null,b.status||null,b.forma_pagamento||null,b.observacao||null,txId,id]);\n    await audit(req,'LANCAMENTO_EDITADO',true,id,{lancamento_id:txId}); return r.rows[0];\n  });\n  app.delete('/api/lancamentos/:id',async(req:any,rep)=>{\n    const id=userId(req); const txId=String((req.params as any).id||''); const r=await query(\`DELETE FROM lancamentos WHERE id=$1 AND usuario_id=$2 RETURNING id,descricao,valor\`,[txId,id]);\n    if(!r.rowCount)return rep.code(404).send({message:'Lançamento não encontrado'}); await audit(req,'LANCAMENTO_EXCLUIDO',true,id,{lancamento_id:txId,valor:r.rows[0].valor}); return {ok:true,id:txId};\n  });\n\n`;
  if(!s.includes(marker))throw new Error('lancamentos suggestions marker not found');
  s=s.replace(marker,routes+marker);
}

// Investment editing/deletion is confirmed in the UI, so the API should not
// require a second hidden confirmation flag that the frontend does not send.
const invStart=s.indexOf("  app.get('/api/investimentos'");
if(invStart>=0){
  const invEnd=s.indexOf("\n\n  //",invStart);
  if(invEnd>invStart){
    let block=s.slice(invStart,invEnd);
    block=block.replace("if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});",'');
    s=s.slice(0,invStart)+block+s.slice(invEnd);
  }
}

fs.writeFileSync(file,s);
console.log('transaction CRUD backend patch applied');
