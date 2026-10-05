import fs from 'node:fs';

const file = '/src/frontend/src/main.tsx';
let s = fs.readFileSync(file, 'utf8');

// The existing stability patch can rebuild pages around PageHeader/ConfirmModal,
// but older frontend variants may only contain Header. Resolve that dependency
// in a way that is independent of Header's exact prop signature.
if (!s.includes('const PageHeader=Header;')) {
  const marker = 'function ErrorBox';
  if (!s.includes(marker)) throw new Error('Header/ErrorBox marker not found');
  s = s.replace(marker, 'const PageHeader=Header;\n\n' + marker);
}

if (!s.includes('function ConfirmModal(')) {
  const marker = 'const PageHeader=Header;';
  const confirm = `\nfunction ConfirmModal({title,text,onClose,onConfirm}:{title:string;text:string;onClose:()=>void;onConfirm:()=>void}){return <Modal onClose={onClose}><span className="v6-eyebrow">CONFIRMAÇÃO</span><h2>{title}</h2><p className="v6-muted">{text}</p><div className="v6-form-actions"><button type="button" className="v6-secondary" onClick={onClose}>Cancelar</button><button type="button" className="v6-primary" onClick={onConfirm}>Excluir <Trash2 size={16}/></button></div></Modal>}\n`;
  if (!s.includes(marker)) throw new Error('PageHeader marker not found after alias insertion');
  s = s.replace(marker, marker + confirm);
}

fs.writeFileSync(file, s);
console.log('frontend final stability fix applied');
