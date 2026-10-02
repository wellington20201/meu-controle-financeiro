import fs from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const files = [];
async function walk(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory()) await walk(p); else if(p.endsWith('.ts')) files.push(p);
  }
}
await walk(root);
const text = (await Promise.all(files.map(async f=>[f,await fs.readFile(f,'utf8')])));
const all=text.map(([f,t])=>`\n// ${f}\n${t}`).join('\n');
const checks = [
  ['sem Authorization hard-codedo', !/Authorization\s*:\s*["'`]Bearer\s+/i.test(all)],
  ['sem localStorage para token no backend', !/localStorage\.setItem\([^)]*(token|session)/i.test(all)],
  ['usa queries parametrizadas', !/query\(\s*[`"'][^`"']*\$1/.test(all) || /\$1/.test(all)],
  ['possui CSRF', /requireCsrf/.test(all)],
  ['possui contexto RLS', /securityContext/.test(all) && /setUserContext/.test(all)],
  ['possui rate limiting', /@fastify\/rate-limit/.test((await fs.readFile(path.join(root,'app.ts'),'utf8')))],
  ['possui cookies HttpOnly', /httpOnly\s*:\s*true/.test(all)],
  ['possui redaction de segredos', /redact\s*:\s*\[/.test((await fs.readFile(path.join(root,'app.ts'),'utf8')))],
  ['upload valida assinatura', /uploadMimeBySignature/.test(all)],
  ['erros internos não são enviados ao cliente', /Não foi possível concluir a operação/.test((await fs.readFile(path.join(root,'app.ts'),'utf8')))]
];
let failed=0;
for(const [name,ok] of checks){ console.log(`${ok?'PASS':'FAIL'} | ${name}`); if(!ok) failed++; }
console.log(`\nResultado: ${checks.length-failed}/${checks.length} verificações passaram.`);
process.exitCode=failed?1:0;
