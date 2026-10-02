import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/app.ts', import.meta.url),'utf8');
const checks=[
 ['agenda route',app.includes("app.get('/api/agenda'")],
 ['notifications route',app.includes("app.get('/api/notificacoes'")],
 ['notification preferences',app.includes("app.patch('/api/notificacoes/preferencias'")],
 ['no automatic financial write in notification block',!app.slice(app.indexOf("app.get('/api/notificacoes'"),app.indexOf("return app;")).includes("INSERT INTO lancamentos")],
 ['explicit user context',app.includes('const id=userId(req)')],
 ['version 3.4',app.includes("version:'3.4'")]
];
let ok=0; for(const [name,pass] of checks){console.log(`${pass?'PASS':'FAIL'} ${name}`); if(pass)ok++;}
process.exit(ok===checks.length?0:1);
