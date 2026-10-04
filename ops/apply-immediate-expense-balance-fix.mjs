import fs from 'node:fs';
const appPath='/src/backend/src/app.ts';
let app=fs.readFileSync(appPath,'utf8');
const oldText="b.status||'pago'";
const newText="b.tipo==='despesa'?'pago':(b.status||'pago')";
if(!app.includes(oldText)) throw new Error('transaction status expression not found');
app=app.replace(oldText,newText);
fs.writeFileSync(appPath,app);
console.log('Immediate expense balance fix applied');
