import fs from 'node:fs';
const path='/src/frontend/src/main.tsx';
let s=fs.readFileSync(path,'utf8');
const blocked="if(!confirmed){setError('Confirme antes de registrar esta movimentação.');return}";
if(s.includes(blocked)) s=s.replace(blocked,'');
fs.writeFileSync(path,s);
