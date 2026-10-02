import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const app=fs.readFileSync(path.join(root,'src/app.ts'),'utf8');
const auth=fs.readFileSync(path.join(root,'src/auth.ts'),'utf8');
const checks=[
  ['SQL usa parâmetros', /\$1|\$2|\$3/.test(app)],
  ['Não há token JWT em localStorage no backend', !/localStorage\.setItem\([^,]*token/i.test(app+auth)],
  ['Cookie de sessão HttpOnly', /httpOnly:\s*true/.test(auth)],
  ['CSRF obrigatório', /CSRF_INVALID/.test(app)],
  ['Upload usa assinatura de arquivo', /uploadMimeBySignature/.test(app)],
  ['Upload gera nome no servidor', /randomUUID\(\)/.test(app)],
  ['Upload usa caminho controlado', /path\.resolve\(env\.UPLOAD_DIR/.test(app)],
  ['Arquivos não são públicos por padrão', /private-uploads/.test(fs.readFileSync(path.join(root,'.env.example'),'utf8'))],
];
let failed=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} - ${name}`);if(!ok)failed++;}
process.exitCode=failed?1:0;
