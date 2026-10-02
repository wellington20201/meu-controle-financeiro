import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const checks=[['prévia sem gravação',app.includes("/api/cartoes/compras/preview")],['limite verificado',app.includes('ultrapassa o limite disponível')],['máximo 60 parcelas',app.includes('parcelas>60')],['fatura por mês',app.includes("/api/cartoes/:id/fatura")],['confirmação explícita',app.includes("b.confirmado!==true")],['transação para criação',app.includes("await client.query('BEGIN')") && app.includes("await client.query('COMMIT')")]];
let ok=0;for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} - ${n}`);if(v)ok++}console.log(`RESULTADO ${ok}/${checks.length}`);process.exit(ok===checks.length?0:1);
