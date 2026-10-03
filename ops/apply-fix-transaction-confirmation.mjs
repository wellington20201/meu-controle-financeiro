import fs from 'node:fs';
const path='/src/frontend/src/main.tsx';
let s=fs.readFileSync(path,'utf8');
const blocked="if(!confirmed){setError('Confirme antes de registrar esta movimentação.');return}";
if(s.includes(blocked)) s=s.replace(blocked,'');
const oldMoney="valor:Number(valor.replace(',','.'))";
const newMoney="valor:(()=>{const raw=String(valor).trim().replace(/\\s/g,'').replace(/\\./g,'').replace(',','.');const parsed=Number(raw);return Number.isFinite(parsed)?parsed:0})()";
if(s.includes(oldMoney)) s=s.replace(oldMoney,newMoney);
fs.writeFileSync(path,s);
