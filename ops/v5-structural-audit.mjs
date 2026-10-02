import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const checks = [
  ['version', read('VERSION').trim() === '5.0'],
  ['frontend version', /"version":\s*"5\.0\.0"/.test(read('frontend/package.json'))],
  ['backend version', /"version":\s*"5\.0\.0"/.test(read('backend/package.json'))],
  ['assistant icon import', /MessageCircle/.test(read('frontend/src/main.tsx'))],
  ['mascot-aware intelligence', /IntelligencePage\(\{mascot\}/.test(read('frontend/src/main.tsx')) && /mascot\.emoji/.test(read('frontend/src/main.tsx'))],
  ['assistant history endpoint', /\/api\/assistente\/historico/.test(read('backend/src/app.ts'))],
  ['assistant ask endpoint', /\/api\/assistente\/perguntar/.test(read('backend/src/app.ts'))],
  ['scope no banking', /Open Finance/.test(read('README.md')) && /Não há:/.test(read('README.md'))],
  ['V5 audit doc', fs.existsSync(path.join(root,'docs/AUDITORIA_V5_0.md'))]
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failed++; }
console.log(`\nResultado: ${checks.length-failed}/${checks.length} checks aprovados.`);
process.exitCode = failed ? 1 : 0;
