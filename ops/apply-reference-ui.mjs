import fs from 'node:fs';
const path='frontend/src/main.tsx';
let s=fs.readFileSync(path,'utf8');
const line="import './reference-ui.css';";
if(!s.includes(line)) s=s.replace("import './styles.css';", "import './styles.css';\n"+line);
fs.writeFileSync(path,s);
