import fs from 'node:fs';
const api=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const frontend=fs.readFileSync(new URL('../../frontend/src/main.tsx',import.meta.url),'utf8');
const checks=[
 ['suggestion_endpoint',api.includes("/api/lancamentos/sugestoes")],
 ['memory_query',api.includes('memoria_financeira')],
 ['user_isolation',api.includes('m.usuario_id=$1')],
 ['explicit_apply_button',frontend.includes('Aplicar')],
 ['explicit_confirmation',frontend.includes('confirmado:true')],
 ['no_auto_commit',frontend.includes('if(!confirmed)')],
 ['average_value_support',frontend.includes('suggestion.valor_medio')],
 ['heuristic_fallback',api.includes('heuristics')]
];
let failed=0; for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failed++;}
process.exit(failed?1:0);
