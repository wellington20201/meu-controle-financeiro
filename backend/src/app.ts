import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { query, pool, securityContext, setUserContext } from './db.js';
import crypto from 'node:crypto';
import { authenticate, clearSessionCookie, createSession, decryptSecret, encryptSecret, hashPassword, base32Encode, randomToken, requireCsrf, setSessionCookie, sha256, verifyPassword, verifyTotp } from './auth.js';
import { env } from './config.js';

const webRoot = path.resolve(process.env.WEB_ROOT ?? './public');

const mascotes = ['bento','nico','luna','tito','pip'];
const periodicidades = ['semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','personalizada'];

const n=(v:any)=>Number(v||0);
const money=(v:any)=>Math.round(n(v)*100)/100;
const brl=(v:any)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n(v));
const dateOnly=(d:any)=>d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10);
const addPeriod=(base:Date,period:string)=>{const d=new Date(base); if(period==='semanal') d.setDate(d.getDate()+7); else if(period==='quinzenal') d.setDate(d.getDate()+14); else if(period==='mensal') d.setMonth(d.getMonth()+1); else if(period==='bimestral') d.setMonth(d.getMonth()+2); else if(period==='trimestral') d.setMonth(d.getMonth()+3); else if(period==='semestral') d.setMonth(d.getMonth()+6); else if(period==='anual') d.setFullYear(d.getFullYear()+1); else d.setDate(d.getDate()+30); return d;};
const clampDay=(year:number,month:number,day:number)=>{const last=new Date(year,month+1,0).getDate();return Math.min(Math.max(1,day||1),last)};
const nextOccurrence=(base:Date,r:any)=>{let d=addPeriod(base,r.periodicidade); if(['mensal','bimestral','trimestral','semestral','anual'].includes(r.periodicidade)&&r.dia_cobranca){const day=clampDay(d.getFullYear(),d.getMonth(),Number(r.dia_cobranca)); d=new Date(d.getFullYear(),d.getMonth(),day);} return d;};
async function syncRecurringPaymentsForUser(userId:string, horizonDays=90){
  const recs=await query(`SELECT * FROM recorrencias WHERE usuario_id=$1 AND ativa=true AND gerar_automaticamente=true`,[userId]);
  const today=new Date(); today.setHours(12,0,0,0); const horizon=new Date(today); horizon.setDate(horizon.getDate()+horizonDays);
  for(const r of recs.rows){
    let last=await query(`SELECT data_prevista FROM pagamentos_recorrentes WHERE recorrencia_id=$1 ORDER BY data_prevista DESC LIMIT 1`,[r.id]);
    let current=last.rowCount?new Date(`${dateOnly(last.rows[0].data_prevista)}T12:00:00`):new Date(`${dateOnly(r.data_inicio)}T12:00:00`);
    if(!last.rowCount){
      if(current<today){ while(current<today) current=nextOccurrence(current,r); }
    }
    while(current<=horizon && (!r.data_fim || current<=new Date(`${dateOnly(r.data_fim)}T12:00:00`))){
      const expected=r.valor_variavel?null:n(r.valor);
      await query(`INSERT INTO pagamentos_recorrentes(recorrencia_id,data_prevista,valor_previsto,status) VALUES($1,$2,$3,'previsto') ON CONFLICT (recorrencia_id,data_prevista) DO NOTHING`,[r.id,dateOnly(current),expected]);
      current=nextOccurrence(current,r);
    }
  }
  await query(`UPDATE pagamentos_recorrentes pr SET status='atrasado',atualizado_em=now() FROM recorrencias r WHERE pr.recorrencia_id=r.id AND r.usuario_id=$1 AND pr.status IN ('previsto','pendente') AND pr.data_prevista<CURRENT_DATE`,[userId]);
}

const uploadMimeBySignature=(buf:Buffer)=>{
  if(buf.subarray(0,5).toString('ascii')==='%PDF-') return 'application/pdf';
  if(buf.length>=3 && buf[0]===0xff && buf[1]===0xd8 && buf[2]===0xff) return 'image/jpeg';
  if(buf.length>=8 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(buf.length>=12 && buf.subarray(0,4).toString('ascii')==='RIFF' && buf.subarray(8,12).toString('ascii')==='WEBP') return 'image/webp';
  return null;
};
const safeOriginalName=(name:string)=>{ const base=path.basename(String(name||'arquivo')).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120); return base || 'arquivo'; };
const extensionForMime=(mime:string)=>({ 'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp' } as Record<string,string>)[mime]||'';

export async function buildApp(){
  const app=Fastify({
    logger:{
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie','*.password','*.senha','*.senha_hash','*.token','*.challenge_token','*.dev_token','*.mfa_secret_enc','*.csrf_token']
    },
    trustProxy:env.TRUST_PROXY,
    bodyLimit: 256 * 1024
  });
  await app.register(cookie);
  await app.register((await import('@fastify/multipart')).default, { limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10 } });
  await app.register(helmet,{hidePoweredBy:true,referrerPolicy:{policy:'no-referrer'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],objectSrc:["'none'"],baseUri:["'self'"],frameAncestors:["'none'"],formAction:["'self'"],imgSrc:["'self'","data:","https:"],styleSrc:["'self'","'unsafe-inline'"],scriptSrc:["'self'"],connectSrc:["'self'","https:"]}}});
  await app.register(rateLimit,{global:true,max:120,timeWindow:'1 minute',hook:'onRequest'});
  const origins=env.CORS_ORIGIN.split(',').map(x=>x.trim()).filter(Boolean);
  await app.register(cors,{origin:origins.length===1?origins[0]:origins,credentials:true,methods:['GET','HEAD','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token']});

  app.setErrorHandler((error,req,rep)=>{
    req.log.error({err:error},'request_failed');
    if((error as any).message==='UNAUTHORIZED') return rep.code(401).send({message:'Sessão inválida ou expirada'});
    if((error as any).message==='CSRF_INVALID') return rep.code(403).send({message:'Validação de segurança inválida. Atualize a página e tente novamente.'});
    if((error as any).code==='23505') return rep.code(409).send({message:'Esse dado já está cadastrado.'});
    return rep.code(500).send({message:'Não foi possível concluir a operação'});
  });

  const publicPaths=new Set(['/api/auth/register','/api/auth/login','/api/auth/mfa/verify','/api/auth/recuperar-senha','/api/auth/redefinir-senha','/health','/health/database']);
  app.addHook('preHandler',async(req,rep)=>{
    const requestPath=req.url.split('?')[0];
    if(publicPaths.has(requestPath) || requestPath.startsWith('/api/')===false || req.method==='OPTIONS') return;
    await authenticate(req,rep);
    await requireCsrf(req);
    securityContext.enterWith({ userId: (req as any).userId });
  });

  const audit=async(req:any,event:string,success=true,userId:string|null=null,details:any={})=>{
    try{await query(`INSERT INTO auditoria_seguranca(usuario_id,evento,sucesso,ip,user_agent,detalhes) VALUES($1,$2,$3,$4,$5,$6)`,[userId??req.userId??null,event,success,req.ip??null,req.headers['user-agent']?.slice(0,500)??null,details])}catch(e){req.log.error({err:e},'audit_write_failed')}
  };
  const passwordError=(password:string)=>{
    if(typeof password!=='string'||password.length<12)return 'A senha precisa ter pelo menos 12 caracteres.';
    if(password.length>128)return 'A senha não pode ter mais de 128 caracteres.';
    return null;
  };
  const userId=(req:any)=>req.userId as string;

  app.get('/health',async()=>({ok:true,service:'meu-controle-financeiro',version:'3.4'}));
  app.get('/health/database',async()=>{await query('SELECT 1');return {ok:true,database:true}});

  app.post('/api/auth/register',{config:{rateLimit:{max:5,timeWindow:'10 minutes'}}},async(req:any,rep)=>{
    const {email,password,nome,aceite_privacidade,versao_privacidade}=req.body||{};
    const emailNorm=String(email||'').toLowerCase().trim();
    if(aceite_privacidade!==true || String(versao_privacidade||'')!=='1.0') return rep.code(400).send({message:'É necessário aceitar a Política de Privacidade atual para criar a conta.'});
    const pwErr=passwordError(password);
    if(!emailNorm||!password) return rep.code(400).send({message:'E-mail e senha são obrigatórios'});
    if(pwErr) return rep.code(400).send({message:pwErr});
    const hash=await hashPassword(password);
    const client=await pool.connect();
    let createdUser:any;
    try{
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO usuarios(email,senha_hash,nome,mascote_id) VALUES($1,$2,$3,'bento') RETURNING id,email,nome,moeda,mascote_id`,[emailNorm,hash,nome||null]);
      createdUser=r.rows[0];
      await client.query(`SELECT set_config('app.user_id',$1,true)`,[createdUser.id]);
      await client.query(`INSERT INTO consentimentos_privacidade(usuario_id,versao_politica,tipo,aceito,ip,user_agent) VALUES($1,'1.0','politica_privacidade',true,$2,$3)`,[createdUser.id,req.ip??null,req.headers['user-agent']?.slice(0,500)??null]);
      await client.query(`INSERT INTO auditoria_seguranca(usuario_id,evento,sucesso,ip,user_agent,detalhes) VALUES($1,'CONTA_CRIADA',true,$2,$3,$4)`,[createdUser.id,req.ip??null,req.headers['user-agent']?.slice(0,500)??null,{}]);
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}
    const session=await createSession(createdUser.id,req); setSessionCookie(rep,session.token);
    return rep.code(201).send({user:createdUser});
  });

  app.post('/api/auth/login',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async(req:any,rep)=>{
    const {email,password}=req.body||{}; const emailNorm=String(email||'').toLowerCase().trim();
    const r=await query(`SELECT * FROM usuarios WHERE email=$1 AND ativo=true`,[emailNorm]);
    if(!r.rowCount || !(await verifyPassword(r.rows[0].senha_hash,password||''))){ await audit(req,'LOGIN_FALHOU',false,null,{email:emailNorm}); return rep.code(401).send({message:'E-mail ou senha inválidos'}); }
    await query(`DELETE FROM sessoes WHERE expira_em<=NOW() OR revogado_em<NOW()-INTERVAL '30 days'`);
    await query(`DELETE FROM desafios_mfa_login WHERE expira_em<=NOW()`);
    if(r.rows[0].mfa_enabled){
      const challenge=randomToken(32);
      await query(`INSERT INTO desafios_mfa_login(usuario_id,token_hash,expira_em) VALUES($1,$2,NOW()+INTERVAL '5 minutes')`,[r.rows[0].id,sha256(challenge)]);
      await audit(req,'MFA_SOLICITADO',true,r.rows[0].id);
      return rep.code(202).send({mfa_required:true,challenge_token:challenge,user:{id:r.rows[0].id,email:r.rows[0].email,nome:r.rows[0].nome,moeda:r.rows[0].moeda,mascote_id:r.rows[0].mascote_id}});
    }
    await query(`UPDATE usuarios SET ultimo_acesso=now() WHERE id=$1`,[r.rows[0].id]);
    const session=await createSession(r.rows[0].id,req); setSessionCookie(rep,session.token);
    await audit(req,'LOGIN_REALIZADO',true,r.rows[0].id);
    return {user:{id:r.rows[0].id,email:r.rows[0].email,nome:r.rows[0].nome,moeda:r.rows[0].moeda,mascote_id:r.rows[0].mascote_id}};
  });

  app.post('/api/auth/mfa/verify',{config:{rateLimit:{max:8,timeWindow:'5 minutes'}}},async(req:any,rep)=>{
    const challenge=String(req.body?.challenge_token||''); const code=String(req.body?.code||'');
    if(!challenge||!code)return rep.code(400).send({message:'Código de autenticação obrigatório'});
    const r=await query(`SELECT d.id,d.usuario_id,d.tentativas,u.mfa_secret_enc,u.email,u.nome,u.moeda,u.mascote_id FROM desafios_mfa_login d JOIN usuarios u ON u.id=d.usuario_id WHERE d.token_hash=$1 AND d.expira_em>NOW() AND u.ativo=true`,[sha256(challenge)]);
    if(!r.rowCount)return rep.code(401).send({message:'Desafio expirado. Entre novamente.'});
    if(r.rows[0].tentativas>=5){await query(`DELETE FROM desafios_mfa_login WHERE id=$1`,[r.rows[0].id]);return rep.code(429).send({message:'Muitas tentativas. Entre novamente.'});}
    await query(`UPDATE desafios_mfa_login SET tentativas=tentativas+1 WHERE id=$1`,[r.rows[0].id]);
    let secret=''; try{secret=decryptSecret(r.rows[0].mfa_secret_enc||'')}catch{}
    if(!secret||!verifyTotp(secret,code))return rep.code(401).send({message:'Código de autenticação inválido'});
    await query(`DELETE FROM desafios_mfa_login WHERE id=$1`,[r.rows[0].id]);
    await query(`UPDATE usuarios SET ultimo_acesso=now() WHERE id=$1`,[r.rows[0].usuario_id]);
    const session=await createSession(r.rows[0].usuario_id,req); setSessionCookie(rep,session.token);
    await audit(req,'LOGIN_REALIZADO_MFA',true,r.rows[0].usuario_id);
    return {user:{id:r.rows[0].usuario_id,email:r.rows[0].email,nome:r.rows[0].nome,moeda:r.rows[0].moeda,mascote_id:r.rows[0].mascote_id}};
  });

  app.get('/api/auth/mfa',async(req:any)=>{const r=await query(`SELECT mfa_enabled,mfa_confirmado_em FROM usuarios WHERE id=$1`,[userId(req)]);return r.rows[0]});
  app.post('/api/auth/mfa/iniciar',{config:{rateLimit:{max:3,timeWindow:'10 minutes'}}},async(req:any,rep)=>{
    const id=userId(req); const current=await query(`SELECT email,nome,mfa_enabled,senha_hash FROM usuarios WHERE id=$1`,[id]);
    if(current.rows[0]?.mfa_enabled)return rep.code(409).send({message:'A autenticação em dois fatores já está ativa.'});
    if(!env.MFA_ENCRYPTION_KEY)return rep.code(503).send({message:'MFA ainda não foi configurado no servidor.'});
    if(!(await verifyPassword(current.rows[0].senha_hash,String(req.body?.password||''))))return rep.code(401).send({message:'Senha atual inválida'});
    const secret=base32Encode(crypto.randomBytes(20));
    await query(`UPDATE usuarios SET mfa_secret_enc=$1 WHERE id=$2`,[encryptSecret(secret),id]);
    const label=encodeURIComponent(`Meu Controle:${current.rows[0].email}`);
    const issuer=encodeURIComponent('Meu Controle Financeiro');
    await audit(req,'MFA_CONFIGURACAO_INICIADA',true,id);
    return {secret,otpauth_uri:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`};
  });
  app.post('/api/auth/mfa/confirmar',{config:{rateLimit:{max:6,timeWindow:'10 minutes'}}},async(req:any,rep)=>{
    const id=userId(req),code=String(req.body?.code||'');
    const r=await query(`SELECT mfa_secret_enc,mfa_enabled FROM usuarios WHERE id=$1`,[id]);
    if(r.rows[0]?.mfa_enabled)return rep.code(409).send({message:'MFA já está ativo.'});
    let secret='';try{secret=decryptSecret(r.rows[0]?.mfa_secret_enc||'')}catch{}
    if(!secret||!verifyTotp(secret,code))return rep.code(400).send({message:'Código inválido. Confira o aplicativo autenticador e tente novamente.'});
    await query(`UPDATE usuarios SET mfa_enabled=true,mfa_confirmado_em=NOW() WHERE id=$1`,[id]);
    await audit(req,'MFA_ATIVADO',true,id); return {ok:true,mfa_enabled:true};
  });
  app.post('/api/auth/mfa/desativar',{config:{rateLimit:{max:4,timeWindow:'10 minutes'}}},async(req:any,rep)=>{
    const id=userId(req),password=String(req.body?.password||''),code=String(req.body?.code||'');
    const r=await query(`SELECT senha_hash,mfa_secret_enc,mfa_enabled FROM usuarios WHERE id=$1`,[id]);
    if(!r.rows[0]||!(await verifyPassword(r.rows[0].senha_hash,password)))return rep.code(401).send({message:'Senha atual inválida'});
    let secret='';try{secret=decryptSecret(r.rows[0].mfa_secret_enc||'')}catch{}
    if(r.rows[0].mfa_enabled && (!secret||!verifyTotp(secret,code)))return rep.code(401).send({message:'Código de autenticação inválido'});
    await query(`UPDATE usuarios SET mfa_enabled=false,mfa_secret_enc=NULL,mfa_confirmado_em=NULL WHERE id=$1`,[id]);
    await audit(req,'MFA_DESATIVADO',true,id); return {ok:true,mfa_enabled:false};
  });
  app.post('/api/auth/senha',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(req:any,rep)=>{
    const id=userId(req),current=String(req.body?.senha_atual||''),next=String(req.body?.nova_senha||''),code=String(req.body?.codigo_mfa||'');
    if(next.length<12||next.length>128)return rep.code(400).send({message:'A nova senha precisa ter entre 12 e 128 caracteres.'});
    const r=await query(`SELECT senha_hash,mfa_enabled,mfa_secret_enc FROM usuarios WHERE id=$1`,[id]);
    if(!r.rows[0]||!(await verifyPassword(r.rows[0].senha_hash,current)))return rep.code(401).send({message:'Senha atual inválida'});
    if(r.rows[0].mfa_enabled){let secret='';try{secret=decryptSecret(r.rows[0].mfa_secret_enc||'')}catch{}if(!secret||!verifyTotp(secret,code))return rep.code(401).send({message:'Código MFA obrigatório'});}
    await query(`UPDATE usuarios SET senha_hash=$1,atualizado_em=NOW() WHERE id=$2`,[await hashPassword(next),id]);
    const other=await query(`UPDATE sessoes SET revogado_em=NOW() WHERE usuario_id=$1 AND id<>$2 AND revogado_em IS NULL`,[id,req.sessionId]);
    await audit(req,'SENHA_ALTERADA',true,id,{outras_sessoes_revogadas:other.rowCount});
    return {ok:true};
  });
  app.get('/api/auth/auditoria',async(req:any)=>{return (await query(`SELECT evento,sucesso,criado_em,ip,user_agent FROM auditoria_seguranca WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 50`,[userId(req)])).rows});
  const PRIVACY_VERSION='1.0';
  app.get('/api/privacidade',async(req:any)=>{
    const id=userId(req);
    const [c,s]=await Promise.all([
      query(`SELECT versao_politica,tipo,aceito,aceito_em FROM consentimentos_privacidade WHERE usuario_id=$1 ORDER BY aceito_em DESC LIMIT 20`,[id]),
      query(`SELECT id,tipo,descricao,status,criada_em,atualizada_em,concluida_em FROM solicitacoes_privacidade WHERE usuario_id=$1 ORDER BY criada_em DESC LIMIT 20`,[id])
    ]);
    return {versao_atual:PRIVACY_VERSION,politica:{titulo:'Política de Privacidade — Meu Controle Financeiro',versao:PRIVACY_VERSION,resumo:'O sistema coleta apenas os dados necessários para autenticação, organização financeira, segurança, auditoria e funcionamento das funcionalidades solicitadas pelo usuário. Dados não são vendidos. Arquivos enviados permanecem privados e vinculados à conta.',dados_principais:['identificação e contato da conta','lançamentos, contas, cartões, metas e investimentos inseridos pelo usuário','dados técnicos de sessão e segurança','anexos enviados pelo usuário quando utilizados'],direitos_disponiveis:['acesso','correção','portabilidade','eliminação, quando aplicável'],observacao:'Este resumo é informativo e não substitui uma política jurídica revisada para o ambiente de produção.'},consentimentos:c.rows,solicitacoes:s.rows};
  });
  app.post('/api/privacidade/consentimento',{config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async(req:any,rep)=>{
    const id=userId(req); const tipo=String(req.body?.tipo||'politica_privacidade'); const aceito=req.body?.aceito===true; const versao=String(req.body?.versao||PRIVACY_VERSION);
    if(tipo!=='politica_privacidade' || versao!==PRIVACY_VERSION || !aceito)return rep.code(400).send({message:'Consentimento inválido.'});
    await query(`INSERT INTO consentimentos_privacidade(usuario_id,versao_politica,tipo,aceito,ip,user_agent) VALUES($1,$2,$3,true,$4,$5)`,[id,versao,tipo,req.ip??null,req.headers['user-agent']?.slice(0,500)??null]);
    await audit(req,'CONSENTIMENTO_PRIVACIDADE_REGISTRADO',true,id,{versao});
    return {ok:true,versao};
  });
  app.post('/api/privacidade/solicitacoes',{config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(req:any,rep)=>{
    const id=userId(req),tipo=String(req.body?.tipo||''),descricao=String(req.body?.descricao||'').trim().slice(0,2000);
    if(!['acesso','correcao','portabilidade','eliminacao','outro'].includes(tipo))return rep.code(400).send({message:'Tipo de solicitação inválido.'});
    const r=await query(`INSERT INTO solicitacoes_privacidade(usuario_id,tipo,descricao) VALUES($1,$2,$3) RETURNING id,tipo,descricao,status,criada_em`,[id,tipo,descricao||null]);
    await audit(req,'SOLICITACAO_PRIVACIDADE_CRIADA',true,id,{tipo});
    return rep.code(201).send(r.rows[0]);
  });
  app.post('/api/auth/exportar-dados',{config:{rateLimit:{max:3,timeWindow:'1 hour'}}},async(req:any,rep)=>{
    const id=userId(req),password=String(req.body?.password||''),code=String(req.body?.codigo_mfa||'');
    const check=await query(`SELECT senha_hash,mfa_enabled,mfa_secret_enc FROM usuarios WHERE id=$1`,[id]);
    if(!check.rows[0]||!(await verifyPassword(check.rows[0].senha_hash,password)))return rep.code(401).send({message:'Senha atual inválida'});
    if(check.rows[0].mfa_enabled){let secret='';try{secret=decryptSecret(check.rows[0].mfa_secret_enc||'')}catch{}if(!secret||!verifyTotp(secret,code))return rep.code(401).send({message:'Código MFA obrigatório'});}
    const [u,a,c,l,r,p,cc,g,m,t]=await Promise.all([
      query(`SELECT id,email,nome,moeda,mascote_id,criado_em,atualizado_em,ultimo_acesso FROM usuarios WHERE id=$1`,[id]),
      query(`SELECT * FROM contas WHERE usuario_id=$1`,[id]), query(`SELECT * FROM categorias WHERE usuario_id=$1`,[id]), query(`SELECT * FROM lancamentos WHERE usuario_id=$1`,[id]),
      query(`SELECT * FROM recorrencias WHERE usuario_id=$1`,[id]), query(`SELECT pr.* FROM pagamentos_recorrentes pr JOIN recorrencias rr ON rr.id=pr.recorrencia_id WHERE rr.usuario_id=$1`,[id]),
      query(`SELECT * FROM compras_cartao WHERE usuario_id=$1`,[id]), query(`SELECT * FROM metas WHERE usuario_id=$1`,[id]), query(`SELECT * FROM memoria_financeira WHERE usuario_id=$1`,[id]), query(`SELECT * FROM transferencias WHERE usuario_id=$1`,[id])
    ]);
    await audit(req,'DADOS_EXPORTADOS',true,id); return rep.header('Content-Disposition','attachment; filename="meu-controle-financeiro-dados.json"').send({exportado_em:new Date().toISOString(),usuario:u.rows[0],contas:a.rows,categorias:c.rows,lancamentos:l.rows,recorrencias:r.rows,pagamentos_recorrentes:p.rows,compras_cartao:cc.rows,metas:g.rows,memoria_financeira:m.rows,transferencias:t.rows});
  });

  app.post('/api/auth/excluir-conta',{config:{rateLimit:{max:2,timeWindow:'1 hour'}}},async(req:any,rep)=>{
    const id=userId(req),password=String(req.body?.password||''),code=String(req.body?.codigo_mfa||''),confirm=String(req.body?.confirmacao||'');
    if(confirm!=='EXCLUIR MINHA CONTA')return rep.code(400).send({message:'Digite exatamente “EXCLUIR MINHA CONTA” para confirmar.'});
    const r=await query(`SELECT senha_hash,mfa_enabled,mfa_secret_enc FROM usuarios WHERE id=$1`,[id]);
    if(!r.rows[0]||!(await verifyPassword(r.rows[0].senha_hash,password)))return rep.code(401).send({message:'Senha atual inválida'});
    if(r.rows[0].mfa_enabled){let secret='';try{secret=decryptSecret(r.rows[0].mfa_secret_enc||'')}catch{}if(!secret||!verifyTotp(secret,code))return rep.code(401).send({message:'Código MFA obrigatório'});}
    await audit(req,'CONTA_EXCLUSA',true,id);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await setUserContext(client, id);
      const attachmentRows=await client.query(`SELECT caminho_arquivo FROM anexos WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM anexos WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM pagamentos_recorrentes WHERE recorrencia_id IN (SELECT id FROM recorrencias WHERE usuario_id=$1)`,[id]);
      await client.query(`DELETE FROM transferencias WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM lancamentos WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM compras_cartao WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM metas WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM investimentos WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM memoria_financeira WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM recorrencias WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM cartoes WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM contas WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM categorias WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM consentimentos_privacidade WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM solicitacoes_privacidade WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM tokens_seguranca WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM desafios_mfa_login WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM sessoes WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM auditoria_seguranca WHERE usuario_id=$1`,[id]);
      await client.query(`DELETE FROM usuarios WHERE id=$1`,[id]);
      await client.query('COMMIT');
      const root=path.resolve(env.UPLOAD_DIR);
      for(const row of attachmentRows.rows){const filePath=path.resolve(root,row.caminho_arquivo);if(filePath.startsWith(root+path.sep))await fs.rm(filePath,{force:true});}
      await fs.rm(path.join(root,id),{recursive:true,force:true});
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    clearSessionCookie(rep); return {ok:true};
  });
  app.post('/api/auth/recuperar-senha',{config:{rateLimit:{max:4,timeWindow:'15 minutes'}}},async(req:any)=>{
    const email=String(req.body?.email||'').toLowerCase().trim(); const r=await query(`SELECT id,email FROM usuarios WHERE email=$1 AND ativo=true`,[email]);
    let devToken:any=undefined;
    if(r.rowCount){const token=randomToken(32);await query(`DELETE FROM tokens_seguranca WHERE usuario_id=$1 AND tipo='recuperacao_senha' AND usado_em IS NULL`,[r.rows[0].id]);await query(`INSERT INTO tokens_seguranca(usuario_id,tipo,token_hash,expira_em) VALUES($1,'recuperacao_senha',$2,NOW()+($3 || ' minutes')::interval)`,[r.rows[0].id,sha256(token),env.PASSWORD_RESET_MINUTES]);const link=`${env.FRONTEND_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;if(env.EMAIL_WEBHOOK_URL){try{await fetch(env.EMAIL_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:r.rows[0].email,type:'recuperacao_senha',link,expires_minutes:env.PASSWORD_RESET_MINUTES})})}catch(err){req.log.error({err},'email_webhook_failed')}}if(env.NODE_ENV!=='production')devToken=token;await audit(req,'RECUPERACAO_SENHA_SOLICITADA',true,r.rows[0].id);}
    return {ok:true,message:'Se o e-mail estiver cadastrado, você receberá as instruções para recuperar a senha.',...(devToken?{dev_token:devToken}: {})};
  });
  app.post('/api/auth/redefinir-senha',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(req:any,rep)=>{
    const token=String(req.body?.token||''),next=String(req.body?.nova_senha||'');if(next.length<12||next.length>128)return rep.code(400).send({message:'A nova senha precisa ter entre 12 e 128 caracteres.'});
    const r=await query(`SELECT id,usuario_id FROM tokens_seguranca WHERE token_hash=$1 AND tipo='recuperacao_senha' AND usado_em IS NULL AND expira_em>NOW()`,[sha256(token)]);if(!r.rowCount)return rep.code(400).send({message:'Link inválido ou expirado.'});
    await query(`UPDATE usuarios SET senha_hash=$1,atualizado_em=NOW() WHERE id=$2`,[await hashPassword(next),r.rows[0].usuario_id]);await query(`UPDATE tokens_seguranca SET usado_em=NOW() WHERE id=$1`,[r.rows[0].id]);await query(`UPDATE sessoes SET revogado_em=NOW() WHERE usuario_id=$1`,[r.rows[0].usuario_id]);await audit(req,'SENHA_REDEFINIDA',true,r.rows[0].usuario_id);return {ok:true};
  });

  app.get('/api/auth/csrf',async(req:any)=>{ const raw=randomToken(32); await query(`UPDATE sessoes SET csrf_token_hash=$1 WHERE id=$2`,[sha256(raw),req.sessionId]); req.csrfHash=sha256(raw); return {token:raw}; });
  app.post('/api/auth/logout',async(req:any,rep)=>{await query(`UPDATE sessoes SET revogado_em=NOW() WHERE id=$1`,[req.sessionId]);await audit(req,'SESSAO_ENCERRADA',true,userId(req));clearSessionCookie(rep);return {ok:true};});
  app.get('/api/auth/sessoes',async(req:any)=>{return (await query(`SELECT id,criado_em,ultimo_acesso,expira_em,user_agent,ip,CASE WHEN id=$2 THEN true ELSE false END AS atual FROM sessoes WHERE usuario_id=$1 AND revogado_em IS NULL AND expira_em>NOW() ORDER BY ultimo_acesso DESC`,[userId(req),req.sessionId])).rows});
  app.delete('/api/auth/sessoes/:id',async(req:any,rep)=>{const r=await query(`UPDATE sessoes SET revogado_em=NOW() WHERE id=$1 AND usuario_id=$2 AND id<>$3 RETURNING id`,[req.params.id,userId(req),req.sessionId]);if(!r.rowCount)return rep.code(404).send({message:'Sessão não encontrada'});await audit(req,'SESSAO_REVOGADA',true,userId(req),{sessao_id:req.params.id});return {ok:true};});
  app.post('/api/auth/sessoes/revogar-outras',async(req:any)=>{const r=await query(`UPDATE sessoes SET revogado_em=NOW() WHERE usuario_id=$1 AND id<>$2 AND revogado_em IS NULL`,[userId(req),req.sessionId]);await audit(req,'OUTRAS_SESSOES_REVOGADAS',true,userId(req),{quantidade:r.rowCount});return {ok:true,quantidade:r.rowCount};});
  app.get('/api/auth/me',async(req:any)=>{const r=await query(`SELECT id,email,nome,moeda,mascote_id,ultimo_acesso FROM usuarios WHERE id=$1`,[userId(req)]);return r.rows[0]});
  app.patch('/api/auth/mascote',async(req:any,rep)=>{const id=userId(req), value=req.body?.mascote_id;if(!mascotes.includes(value)) return rep.code(400).send({message:'Mascote inválido'});const r=await query(`UPDATE usuarios SET mascote_id=$1,atualizado_em=now() WHERE id=$2 RETURNING id,email,nome,moeda,mascote_id,ultimo_acesso`,[value,id]);await audit(req,'MASCOTE_ALTERADO',true,id,{mascote_id:value});return r.rows[0]});

  // Contas e lançamentos
  app.get('/api/contas',async(req:any)=>{
    const id=userId(req);
    return (await query(`
      SELECT c.*, COALESCE(SUM(CASE WHEN l.status='pago' AND l.tipo='receita' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.status='pago' AND l.tipo='despesa' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END),0) AS saldo_atual
      FROM contas c LEFT JOIN lancamentos l ON l.conta_id=c.id
      WHERE c.usuario_id=$1 GROUP BY c.id ORDER BY c.ativa DESC,c.nome`,[id])).rows.map(x=>({...x,saldo_inicial:n(x.saldo_inicial),saldo_atual:money(n(x.saldo_inicial)+n(x.saldo_atual))}));
  });
  app.post('/api/contas',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(!b.nome)return rep.code(400).send({message:'Nome da conta é obrigatório'});const r=await query(`INSERT INTO contas(usuario_id,nome,tipo,saldo_inicial) VALUES($1,$2,$3,$4) RETURNING *`,[id,b.nome,b.tipo||'corrente',n(b.saldo_inicial)]);return rep.code(201).send(r.rows[0])});
  app.patch('/api/contas/:id',async(req:any)=>{const id=userId(req),b=req.body||{};const r=await query(`UPDATE contas SET nome=COALESCE($1,nome),tipo=COALESCE($2,tipo),ativa=COALESCE($3,ativa),atualizado_em=now() WHERE id=$4 AND usuario_id=$5 RETURNING *`,[b.nome,b.tipo,b.ativa,req.params.id,id]);return r.rows[0]});
  app.delete('/api/contas/:id',async(req:any)=>{const id=userId(req);await query(`UPDATE contas SET ativa=false,atualizado_em=now() WHERE id=$1 AND usuario_id=$2`,[req.params.id,id]);return {ok:true}});

  app.get('/api/categorias',async(req:any)=>{const id=userId(req);return (await query(`SELECT * FROM categorias WHERE ativa=true AND (usuario_id=$1 OR usuario_id IS NULL) ORDER BY tipo,nome`,[id])).rows});
  app.get('/api/lancamentos',async(req:any)=>{const id=userId(req);const r=await query(`SELECT l.*,c.nome AS conta_nome,cat.nome AS categoria_nome FROM lancamentos l JOIN contas c ON c.id=l.conta_id LEFT JOIN categorias cat ON cat.id=l.categoria_id WHERE l.usuario_id=$1 ORDER BY data_movimento DESC,criado_em DESC`,[id]);return r.rows});
  app.patch('/api/lancamentos/:id',async(req:any,rep)=>{
    const id=userId(req); const txId=String((req.params as any).id||''); const b=req.body||{};
    const current=await query(`SELECT * FROM lancamentos WHERE id=$1 AND usuario_id=$2`,[txId,id]);
    if(!current.rowCount) return rep.code(404).send({message:'Lançamento não encontrado'});
    if(b.conta_id){const own=await query(`SELECT id FROM contas WHERE id=$1 AND usuario_id=$2 AND ativa=true`,[b.conta_id,id]);if(!own.rowCount)return rep.code(404).send({message:'Conta não encontrada'});}
    if(b.categoria_id){const cat=await query(`SELECT id FROM categorias WHERE id=$1 AND ativa=true AND (usuario_id=$2 OR usuario_id IS NULL)`,[b.categoria_id,id]);if(!cat.rowCount)return rep.code(404).send({message:'Categoria não encontrada'});}
    const x=current.rows[0]; const tipo=['receita','despesa','transferencia'].includes(b.tipo)?b.tipo:x.tipo; const valor=b.valor!==undefined?money(b.valor):n(x.valor);
    if(valor<=0)return rep.code(400).send({message:'O valor precisa ser maior que zero.'});
    const r=await query(`UPDATE lancamentos SET conta_id=COALESCE($1,conta_id),categoria_id=CASE WHEN $2::text IS NULL THEN categoria_id ELSE $2::uuid END,tipo=$3,valor=$4,descricao=COALESCE($5,descricao),data_movimento=COALESCE($6::date,data_movimento),status=COALESCE($7,status),forma_pagamento=COALESCE($8,forma_pagamento),observacao=COALESCE($9,observacao),atualizado_em=now() WHERE id=$10 AND usuario_id=$11 RETURNING *`,[b.conta_id||null,b.categoria_id===undefined?null:(b.categoria_id||null),tipo,valor,b.descricao||null,b.data_movimento||null,b.status||null,b.forma_pagamento||null,b.observacao||null,txId,id]);
    await audit(req,'LANCAMENTO_EDITADO',true,id,{lancamento_id:txId}); return r.rows[0];
  });
  app.delete('/api/lancamentos/:id',async(req:any,rep)=>{
    const id=userId(req); const txId=String((req.params as any).id||''); const r=await query(`DELETE FROM lancamentos WHERE id=$1 AND usuario_id=$2 RETURNING id,descricao,valor`,[txId,id]);
    if(!r.rowCount)return rep.code(404).send({message:'Lançamento não encontrado'}); await audit(req,'LANCAMENTO_EXCLUIDO',true,id,{lancamento_id:txId,valor:r.rows[0].valor}); return {ok:true,id:txId};
  });

  app.get('/api/lancamentos/sugestoes',async(req:any)=>{
    const id=userId(req);
    const q=String((req.query as any)?.q||'').trim();
    const tipo=String((req.query as any)?.tipo||'despesa');
    if(q.length<2) return {suggestions:[]};
    const normalized=q.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,255);
    const exact=await query(`
      SELECT m.descricao_normalizada,m.categoria_id,m.quantidade_ocorrencias,m.valor_medio,m.valor_minimo,m.valor_maximo,m.frequencia_estimada,m.recorrencia_detectada,m.confianca,
             c.nome AS categoria_nome
      FROM memoria_financeira m
      LEFT JOIN categorias c ON c.id=m.categoria_id
      WHERE m.usuario_id=$1 AND m.descricao_normalizada ILIKE $2
      ORDER BY m.quantidade_ocorrencias DESC,m.confianca DESC NULLS LAST
      LIMIT 5`,[id,`%${normalized}%`]);
    const heuristics:[RegExp,string][]=[
      [/supermercado|mercado|hipermercado|atacadao|sacolao|hortifruti/,'Alimentação'],
      [/aluguel|condominio|condomínio|iptu/,'Moradia'],
      [/uber|99|combustivel|combustível|gasolina|estacionamento|onibus|ônibus/,'Transporte'],
      [/farmacia|farmácia|medico|médico|dentista|consulta/,'Saúde'],
      [/faculdade|curso|escola|mensalidade|livro/,'Educação'],
      [/netflix|spotify|prime|streaming|academia|gym/,'Assinaturas'],
      [/cinema|bar|restaurante|viagem|lazer/,'Lazer'],
      [/salario|salário|freelance|pix recebido|pagamento recebido/,'Salário']
    ];
    const suggestions:any[]=exact.rows.map((r:any)=>({
      origem:'memoria',descricao:r.descricao_normalizada,categoria_id:r.categoria_id,categoria_nome:r.categoria_nome,
      valor_medio:r.valor_medio?Number(r.valor_medio):null,valor_minimo:r.valor_minimo?Number(r.valor_minimo):null,valor_maximo:r.valor_maximo?Number(r.valor_maximo):null,
      frequencia:r.frequencia_estimada,recorrencia_detectada:r.recorrencia_detectada,confianca:r.confianca?Number(r.confianca):null,
      ocorrencias:r.quantidade_ocorrencias
    }));
    if(!suggestions.length){
      const hit=heuristics.find(([rx])=>rx.test(normalized));
      if(hit){
        const c=await query(`SELECT id,nome FROM categorias WHERE ativa=true AND tipo=$2 AND (usuario_id=$1 OR usuario_id IS NULL) AND lower(nome)=lower($3) ORDER BY usuario_id NULLS LAST LIMIT 1`,[id,tipo,hit[1]]);
        if(c.rowCount)suggestions.push({origem:'heuristica',descricao:q,categoria_id:c.rows[0].id,categoria_nome:c.rows[0].nome,confianca:65,ocorrencias:0});
      }
    }
    return {suggestions};
  });

  app.post('/api/lancamentos',async(req:any,rep)=>{
    const id=userId(req),b=req.body||{};
    if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});if(!b.conta_id||!b.descricao||!b.valor||!b.data_movimento||!['receita','despesa'].includes(b.tipo)) return rep.code(400).send({message:'Preencha os dados do lançamento'});
    const own=await query(`SELECT c.id FROM contas c WHERE c.id=$1 AND c.usuario_id=$2 AND c.ativa=true`,[b.conta_id,id]);
    if(!own.rowCount) return rep.code(404).send({message:'Conta não encontrada'});
    if(b.categoria_id){const cat=await query(`SELECT id FROM categorias WHERE id=$1 AND ativa=true AND (usuario_id=$2 OR usuario_id IS NULL)`,[b.categoria_id,id]);if(!cat.rowCount)return rep.code(404).send({message:'Categoria não encontrada'});}
    const r=await query(`INSERT INTO lancamentos(usuario_id,conta_id,categoria_id,tipo,valor,descricao,data_movimento,status,forma_pagamento,observacao) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,b.conta_id,b.categoria_id||null,b.tipo,n(b.valor),b.descricao,b.data_movimento,b.status||'pago',b.forma_pagamento||null,b.observacao||null]);
    await audit(req,'LANCAMENTO_CRIADO',true,id,{lancamento_id:r.rows[0].id,tipo:b.tipo,valor:n(b.valor)});
    return rep.code(201).send(r.rows[0]);
  });

  // Dashboard: saldo real, mês atual, tendência de 6 meses, categorias e compromissos.
  app.get('/api/relatorios/resumo',async(req:any)=>{
    const id=userId(req);
    const meses=Math.min(Math.max(Number(req.query?.meses||12),3),24);
    const [trend,cats,accounts,cards,goals,stats]=await Promise.all([
      query(`SELECT to_char(date_trunc('month',data_movimento),'YYYY-MM') mes, COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) entradas, COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) saidas, COUNT(*) qtd FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND forma_pagamento <> 'transferencia' AND data_movimento >= date_trunc('month',CURRENT_DATE)-($2::int-1)*interval '1 month' GROUP BY 1 ORDER BY 1`,[id,meses]),
      query(`SELECT COALESCE(cat.nome,'Sem categoria') categoria, COALESCE(SUM(l.valor),0) total, COUNT(*) qtd FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id WHERE l.usuario_id=$1 AND l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' AND data_movimento >= date_trunc('month',CURRENT_DATE)-interval '11 months' GROUP BY 1 ORDER BY total DESC`,[id]),
      query(`SELECT c.id,c.nome,c.tipo,c.saldo_inicial,COALESCE(SUM(CASE WHEN l.status='pago' AND l.tipo='receita' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.status='pago' AND l.tipo='despesa' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END),0)+c.saldo_inicial saldo_atual FROM contas c LEFT JOIN lancamentos l ON l.conta_id=c.id WHERE c.usuario_id=$1 AND c.ativa=true GROUP BY c.id ORDER BY saldo_atual DESC`,[id]),
      query(`SELECT id,nome,limite,comprometido,disponivel FROM cartoes WHERE usuario_id=$1 AND ativo=true ORDER BY nome`,[id]),
      query(`SELECT id,nome,valor_objetivo,valor_atual,data_limite,status FROM metas WHERE usuario_id=$1 ORDER BY data_limite NULLS LAST,nome`,[id]),
      query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) saidas,COUNT(*) qtd FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND forma_pagamento <> 'transferencia' AND date_trunc('month',data_movimento)=date_trunc('month',CURRENT_DATE)`,[id])
    ]);
    const current=stats.rows[0]; const entradas=Number(current.entradas||0), saidas=Number(current.saidas||0);
    return {periodo_meses:meses, atual:{entradas,saidas,resultado:entradas-saidas,quantidade:Number(current.qtd||0)}, tendencia:trend.rows.map(r=>({...r,entradas:Number(r.entradas||0),saidas:Number(r.saidas||0),resultado:Number(r.entradas||0)-Number(r.saidas||0),quantidade:Number(r.qtd||0)})), categorias:cats.rows.map(r=>({...r,total:Number(r.total||0),quantidade:Number(r.qtd||0)})), contas:accounts.rows.map(r=>({...r,saldo_atual:Number(r.saldo_atual||0)})), cartoes:cards.rows.map(r=>({...r,limite:r.limite==null?null:Number(r.limite),comprometido:Number(r.comprometido||0),disponivel:r.disponivel==null?null:Number(r.disponivel)})), metas:goals.rows.map(r=>({...r,valor_objetivo:Number(r.valor_objetivo||0),valor_atual:Number(r.valor_atual||0)}))};
  });

  app.get('/api/inteligencia/resumo',async(req:any)=>{
    const id=userId(req);
    const [months,accounts,investments,goals,upcoming,categories,memory]=await Promise.all([
      query(`SELECT to_char(date_trunc('month',data_movimento),'YYYY-MM') mes,COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) saidas FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND forma_pagamento <> 'transferencia' AND data_movimento>=date_trunc('month',CURRENT_DATE)-interval '5 months' GROUP BY 1 ORDER BY 1`,[id]),
      query(`SELECT COALESCE(SUM(saldo_atual),0) total FROM (SELECT c.saldo_inicial+COALESCE(SUM(CASE WHEN l.status='pago' AND l.tipo='receita' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.status='pago' AND l.tipo='despesa' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END),0) saldo_atual FROM contas c LEFT JOIN lancamentos l ON l.conta_id=c.id WHERE c.usuario_id=$1 AND c.ativa=true AND c.tipo <> 'investimento' GROUP BY c.id) x`,[id]),
      query(`SELECT COALESCE(SUM(valor_atual),0) total,COALESCE(SUM(valor_atual-valor_investido),0) ganho FROM investimentos WHERE usuario_id=$1 AND ativo=true`,[id]),
      query(`SELECT id,nome,valor_objetivo,valor_atual,data_limite,status FROM metas WHERE usuario_id=$1 AND status='ativa' ORDER BY data_limite NULLS LAST,nome`,[id]),
      query(`SELECT pr.data_prevista,r.nome,r.tipo,COALESCE(pr.valor_previsto,0) valor,pr.status FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') AND pr.data_prevista>=CURRENT_DATE AND pr.data_prevista<CURRENT_DATE+interval '30 days' ORDER BY pr.data_prevista LIMIT 20`,[id]),
      query(`SELECT COALESCE(c.nome,'Sem categoria') categoria,SUM(l.valor) total FROM lancamentos l LEFT JOIN categorias c ON c.id=l.categoria_id WHERE l.usuario_id=$1 AND l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' AND l.data_movimento>=date_trunc('month',CURRENT_DATE)-interval '5 months' GROUP BY 1 ORDER BY total DESC LIMIT 8`,[id]),
      query(`SELECT descricao_normalizada,ocorrencias,media_valor,recorrencia_detectada,confianca FROM memoria_financeira WHERE usuario_id=$1 ORDER BY confianca DESC,ocorrencias DESC LIMIT 8`,[id])
    ]);
    const ms=months.rows.map(r=>({mes:r.mes,entradas:Number(r.entradas||0),saidas:Number(r.saidas||0),resultado:Number(r.entradas||0)-Number(r.saidas||0)}));
    const avgIn=ms.length?ms.reduce((a,r)=>a+r.entradas,0)/ms.length:0, avgOut=ms.length?ms.reduce((a,r)=>a+r.saidas,0)/ms.length:0;
    const capacidade=Math.max(0,avgIn-avgOut), patrimonio=Number(accounts.rows[0]?.total||0)+Number(investments.rows[0]?.total||0);
    const metaInsights=goals.rows.map(g=>{const restante=Math.max(0,Number(g.valor_objetivo)-Number(g.valor_atual));const meses=g.data_limite?Math.max(1,(new Date(g.data_limite).getTime()-Date.now())/(30.44*86400000)):null;return {...g,restante,aporte_necessario:meses?restante/meses:null};});
    const cenarios=[{nome:'Conservador',aporte:capacidade*.7},{nome:'Atual',aporte:capacidade},{nome:'Acelerado',aporte:capacidade*1.3}];
    const notas:any[]=[]; if(capacidade>0)notas.push(`Sua capacidade média estimada de poupança é de R$ ${capacidade.toFixed(2)} por mês.`); else notas.push('Os últimos meses não mostram capacidade média positiva de poupança.'); if(Number(investments.rows[0]?.ganho||0)>0)notas.push('Seus investimentos apresentam resultado acumulado positivo com base nos valores registrados.'); if(upcoming.rows.length)notas.push(`${upcoming.rows.length} compromisso(s) financeiro(s) estão previstos para os próximos 30 dias.`);
    return {periodo_meses:ms.length,meses:ms,medias:{entradas:avgIn,saidas:avgOut,capacidade},patrimonio:{contas:patrimonio-Number(investments.rows[0]?.total||0),investimentos:Number(investments.rows[0]?.total||0),total:patrimonio,ganho_investimentos:Number(investments.rows[0]?.ganho||0)},metas:metaInsights,cenarios:cenarios.map(c=>({...c,patrimonio_12_meses:patrimonio+c.aporte*12})),proximos30:upcoming.rows.map(r=>({...r,valor:Number(r.valor||0)})),categorias:categories.rows.map(r=>({...r,total:Number(r.total||0)})),padroes:memory.rows.map(r=>({...r,media_valor:Number(r.media_valor||0),confianca:Number(r.confianca||0)})),notas};
  });

  app.get('/api/dashboard',async(req:any)=>{
    const id=userId(req);
    const [totals,month,trend,categories,accounts,upcoming,goals,insights,recentMonths,upcoming30Days,categoryCurrent,categoryAverages]=await Promise.all([
      query(`SELECT COALESCE(SUM(c.saldo_inicial),0)+COALESCE(SUM(CASE WHEN l.tipo='receita' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END),0) saldo FROM contas c LEFT JOIN lancamentos l ON l.conta_id=c.id WHERE c.usuario_id=$1 AND c.ativa=true`,[id]),
      query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) expense FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND forma_pagamento <> 'transferencia' AND date_trunc('month',data_movimento)=date_trunc('month',CURRENT_DATE)`,[id]),
      query(`SELECT to_char(date_trunc('month',data_movimento),'YYYY-MM') mes,COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) expense FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND forma_pagamento <> 'transferencia' AND data_movimento>=date_trunc('month',CURRENT_DATE)-interval '5 months' GROUP BY 1 ORDER BY 1`,[id]),
      query(`SELECT COALESCE(cat.nome,'Sem categoria') categoria,COALESCE(SUM(l.valor),0) total FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id WHERE l.usuario_id=$1 AND l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' AND date_trunc('month',l.data_movimento)=date_trunc('month',CURRENT_DATE) GROUP BY 1 ORDER BY total DESC LIMIT 6`,[id]),
      query(`SELECT c.id,c.nome,c.tipo,c.saldo_inicial,COALESCE(SUM(CASE WHEN l.status='pago' AND l.tipo='receita' AND l.forma_pagamento <> 'transferencia' THEN l.valor WHEN l.status='pago' AND l.tipo='despesa' AND l.forma_pagamento <> 'transferencia' THEN -l.valor ELSE 0 END),0)+c.saldo_inicial saldo_atual FROM contas c LEFT JOIN lancamentos l ON l.conta_id=c.id WHERE c.usuario_id=$1 AND c.ativa=true GROUP BY c.id ORDER BY c.nome`,[id]),
      query(`SELECT pr.*,r.nome,r.tipo,r.valor_variavel FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') ORDER BY pr.data_prevista LIMIT 6`,[id]),
      query(`SELECT * FROM metas WHERE usuario_id=$1 AND status='ativa' ORDER BY data_limite NULLS LAST LIMIT 3`,[id]),
      query(`SELECT * FROM memoria_financeira WHERE usuario_id=$1 AND recorrencia_detectada=true ORDER BY confianca DESC LIMIT 3`,[id]),
      query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) expense,COUNT(*) qtd FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND forma_pagamento <> 'transferencia' AND data_movimento>=date_trunc('month',CURRENT_DATE)-interval '2 months' AND data_movimento<date_trunc('month',CURRENT_DATE)`,[id]),
      query(`SELECT COALESCE(SUM(CASE WHEN r.tipo='receita' THEN pr.valor_previsto ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN r.tipo='despesa' THEN pr.valor_previsto ELSE 0 END),0) expense,COUNT(*) qtd FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') AND pr.data_prevista>=CURRENT_DATE AND pr.data_prevista<CURRENT_DATE+INTERVAL '30 days'`,[id]),
      query(`SELECT COALESCE(cat.nome,'Sem categoria') categoria,COALESCE(SUM(l.valor),0) atual FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id WHERE l.usuario_id=$1 AND l.tipo='despesa' AND l.status='pago' AND l.forma_pagamento <> 'transferencia' AND date_trunc('month',l.data_movimento)=date_trunc('month',CURRENT_DATE) GROUP BY 1 ORDER BY atual DESC LIMIT 8`,[id]),
      query(`SELECT COALESCE(cat.nome,'Sem categoria') categoria,AVG(m.total) media FROM (SELECT categoria_id,date_trunc('month',data_movimento) mes,SUM(valor) total FROM lancamentos WHERE usuario_id=$1 AND tipo='despesa' AND status='pago' AND forma_pagamento <> 'transferencia' AND date_trunc('month',data_movimento)>=date_trunc('month',CURRENT_DATE)-interval '3 months' AND date_trunc('month',data_movimento)<date_trunc('month',CURRENT_DATE) GROUP BY categoria_id,date_trunc('month',data_movimento)) m LEFT JOIN categorias cat ON cat.id=m.categoria_id GROUP BY cat.nome`,[id])
    ]);
    const recent=recentMonths.rows[0]; const upcoming30=upcoming30Days.rows[0];
    const avgMonthlyIncome=money(n(recent.income)/2),avgMonthlyExpense=money(n(recent.expense)/2);
    const currentIncome=n(month.rows[0].income), currentExpense=n(month.rows[0].expense);
    const dayOfMonth=new Date().getDate(); const daysInMonth=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
    const projectedMonthIncome=dayOfMonth>0?money(currentIncome/dayOfMonth*daysInMonth):currentIncome;
    const projectedMonthExpense=dayOfMonth>0?money(currentExpense/dayOfMonth*daysInMonth):currentExpense;
    const projected30dBalance=money(n(totals.rows[0].saldo)+n(upcoming30.income)-n(upcoming30.expense)+(avgMonthlyIncome-avgMonthlyExpense));
    const categoryAvg=new Map<string,number>(categoryAverages.rows.map((x:any)=>[x.categoria,money(x.media)]));
    const categorySignals=categoryCurrent.rows.map((x:any)=>{const avg=categoryAvg.get(x.categoria)||0; const ratio=avg>0?n(x.atual)/avg:0; return {categoria:x.categoria,atual:money(x.atual),media_anterior:avg,variacao:money(n(x.atual)-avg),sinal:avg>50&&ratio>=1.2?'acima_da_media':null};}).filter((x:any)=>x.sinal).slice(0,3);
    const savingsRate=currentIncome>0?money((currentIncome-currentExpense)/currentIncome*100):0;
    const intelligence={
      projected_month:{income:projectedMonthIncome,expense:projectedMonthExpense,result:money(projectedMonthIncome-projectedMonthExpense)},
      projected_30_days_balance:projected30dBalance,
      averages:{monthly_income:avgMonthlyIncome,monthly_expense:avgMonthlyExpense},
      next_30_days:{income:money(upcoming30.income),expense:money(upcoming30.expense),count:Number(upcoming30.qtd||0)},
      savings_rate:savingsRate,
      category_signals:categorySignals,
      notes:[
        currentIncome>0?`Até agora, as entradas deste mês cobrem ${money(currentExpense/currentIncome*100)}% das saídas.`:'Ainda não há entradas pagas registradas neste mês.',
        n(upcoming30.expense)>0?`Há ${`R$ ${money(n(upcoming30.expense)).toFixed(2).replace('.',',')}`} em compromissos previstos para os próximos 30 dias.`:'Não há compromissos recorrentes previstos para os próximos 30 dias.'
      ]
    };
    return {balance:money(totals.rows[0].saldo),month:{income:money(month.rows[0].income),expense:money(month.rows[0].expense)},trend:trend.rows.map(x=>({...x,income:money(x.income),expense:money(x.expense)})),categories:categories.rows.map(x=>({...x,total:money(x.total)})),accounts:accounts.rows.map(x=>({...x,saldo_atual:money(x.saldo_atual)})),upcoming:upcoming.rows,goals:goals.rows.map(x=>({...x,valor_objetivo:n(x.valor_objetivo),valor_atual:n(x.valor_atual)})),insights:insights.rows,intelligence};
  });

  // Recorrências
  app.get('/api/recorrencias',async(req:any)=>{const id=userId(req);await syncRecurringPaymentsForUser(id);return (await query(`SELECT * FROM recorrencias WHERE usuario_id=$1 ORDER BY ativa DESC,nome`,[id])).rows});
  app.post('/api/recorrencias',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});if(!periodicidades.includes(b.periodicidade))return rep.code(400).send({message:'Periodicidade inválida'});if(!b.conta_id||!b.nome||!['receita','despesa'].includes(b.tipo)||n(b.valor)<=0)return rep.code(400).send({message:'Dados da recorrência inválidos'});const own=await query(`SELECT id FROM contas WHERE id=$1 AND usuario_id=$2 AND ativa=true`,[b.conta_id,id]);if(!own.rowCount)return rep.code(404).send({message:'Conta não encontrada'});if(b.categoria_id){const cat=await query(`SELECT id FROM categorias WHERE id=$1 AND ativa=true AND (usuario_id=$2 OR usuario_id IS NULL)`,[b.categoria_id,id]);if(!cat.rowCount)return rep.code(404).send({message:'Categoria não encontrada'});}const r=await query(`INSERT INTO recorrencias(usuario_id,nome,categoria_id,conta_id,tipo,valor,valor_variavel,periodicidade,dia_cobranca,data_inicio,data_fim,gerar_automaticamente,exigir_confirmacao) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,[id,b.nome,b.categoria_id||null,b.conta_id,b.tipo,n(b.valor),b.valor_variavel??false,b.periodicidade,b.dia_cobranca||null,b.data_inicio,b.data_fim||null,b.gerar_automaticamente??true]);return rep.code(201).send(r.rows[0])});
  app.patch('/api/recorrencias/:id',async(req:any)=>{const id=userId(req),b=req.body||{};const r=await query(`UPDATE recorrencias SET nome=COALESCE($1,nome),valor=COALESCE($2,valor),valor_variavel=COALESCE($3,valor_variavel),periodicidade=COALESCE($4,periodicidade),ativa=COALESCE($5,ativa),exigir_confirmacao=true,atualizado_em=now() WHERE id=$6 AND usuario_id=$7 RETURNING *`,[b.nome,b.valor,b.valor_variavel,b.periodicidade,b.ativa,req.params.id,id]);return r.rows[0]});
  app.delete('/api/recorrencias/:id',async(req:any)=>{const id=userId(req);await query(`UPDATE recorrencias SET ativa=false,atualizado_em=now() WHERE id=$1 AND usuario_id=$2`,[req.params.id,id]);return {ok:true}});
  app.get('/api/pagamentos',async(req:any)=>{const id=userId(req);await syncRecurringPaymentsForUser(id);return (await query(`SELECT pr.*,r.nome,r.conta_id,r.categoria_id,r.tipo,r.valor_variavel,r.valor AS valor_recorrencia,r.periodicidade,r.dia_cobranca FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 ORDER BY pr.data_prevista`,[id])).rows});
  app.get('/api/recorrencias/resumo',async(req:any)=>{const id=userId(req);await syncRecurringPaymentsForUser(id);const upcoming=await query(`SELECT pr.*,r.nome,r.tipo,r.valor_variavel,r.periodicidade,r.dia_cobranca FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') AND pr.data_prevista<=CURRENT_DATE+INTERVAL '90 days' ORDER BY pr.data_prevista LIMIT 30`,[id]);const history=await query(`SELECT r.id recorrencia_id,r.nome,r.tipo,r.valor_variavel,COUNT(pr.id) FILTER(WHERE pr.status='pago') ocorrencias,COALESCE(AVG(pr.valor_real) FILTER(WHERE pr.status='pago'),0) media_real,COALESCE(MIN(pr.valor_real) FILTER(WHERE pr.status='pago'),0) minimo_real,COALESCE(MAX(pr.valor_real) FILTER(WHERE pr.status='pago'),0) maximo_real,COALESCE(SUM(CASE WHEN pr.status='pago' AND pr.valor_real IS NOT NULL THEN pr.valor_real-pr.valor_previsto ELSE 0 END),0) variacao_acumulada FROM recorrencias r LEFT JOIN pagamentos_recorrentes pr ON pr.recorrencia_id=r.id WHERE r.usuario_id=$1 GROUP BY r.id ORDER BY r.nome`,[id]);return {proximos:upcoming.rows.map(x=>({...x,valor_previsto:x.valor_previsto===null?null:money(x.valor_previsto)})),historico:history.rows.map(x=>({...x,ocorrencias:Number(x.ocorrencias||0),media_real:money(x.media_real),minimo_real:money(x.minimo_real),maximo_real:money(x.maximo_real),variacao_acumulada:money(x.variacao_acumulada)}))};});

  app.post('/api/pagamentos/:id/confirmar',async(req:any,rep)=>{
    const id=userId(req),client=await pool.connect();
    try{await client.query('BEGIN');await setUserContext(client,id);const p=await client.query(`SELECT pr.*,r.usuario_id,r.conta_id,r.categoria_id,r.tipo,r.nome FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE pr.id=$1 AND r.usuario_id=$2 FOR UPDATE`,[req.params.id,id]);if(!p.rowCount)return rep.code(404).send({message:'Pagamento não encontrado'});const row=p.rows[0];if(row.status==='pago'&&row.lancamento_id)return rep.code(409).send({message:'Pagamento já confirmado'});if(req.body?.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const valor=n(req.body?.valor_real??row.valor_previsto);const data=req.body?.data_pagamento??dateOnly(row.data_prevista);const lanc=await client.query(`INSERT INTO lancamentos(usuario_id,conta_id,categoria_id,tipo,valor,descricao,data_movimento,status,forma_pagamento,observacao,recorrencia_id) VALUES($1,$2,$3,$4,$5,$6,$7,'pago',$8,$9,$10) RETURNING *`,[id,row.conta_id,row.categoria_id,row.tipo,valor,row.nome,data,req.body?.forma_pagamento||'debito','Pagamento recorrente confirmado',row.recorrencia_id]);await client.query(`UPDATE pagamentos_recorrentes SET status='pago',data_pagamento=$1,valor_real=$2,lancamento_id=$3,atualizado_em=now() WHERE id=$4`,[data,valor,lanc.rows[0].id,row.id]);const rr=await client.query(`SELECT * FROM recorrencias WHERE id=$1`,[row.recorrencia_id]);if(rr.rowCount&&rr.rows[0].ativa&&rr.rows[0].gerar_automaticamente){const next=nextOccurrence(new Date(`${dateOnly(data)}T12:00:00`),rr.rows[0]);if(!rr.rows[0].data_fim||next<=new Date(`${dateOnly(rr.rows[0].data_fim)}T12:00:00`)){await client.query(`INSERT INTO pagamentos_recorrentes(recorrencia_id,data_prevista,valor_previsto,status) VALUES($1,$2,$3,'previsto') ON CONFLICT (recorrencia_id,data_prevista) DO NOTHING`,[row.recorrencia_id,dateOnly(next),rr.rows[0].valor_variavel?null:n(rr.rows[0].valor)]);}}await client.query('COMMIT');await audit(req,'PAGAMENTO_RECORRENTE_CONFIRMADO',true,id,{pagamento_id:row.id,lancamento_id:lanc.rows[0].id,valor});return {ok:true,lancamento:lanc.rows[0]};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  });

  // Transferências internas: não entram em receitas/despesas.
  app.post('/api/transferencias',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(n(b.valor)<=0||b.conta_origem_id===b.conta_destino_id)return rep.code(400).send({message:'Transferência inválida'});const client=await pool.connect();try{await client.query('BEGIN');await setUserContext(client,id);const own=await client.query(`SELECT id FROM contas WHERE id=ANY($1::uuid[]) AND usuario_id=$2 AND ativa=true`,[[b.conta_origem_id,b.conta_destino_id],id]);if(own.rowCount!==2){await client.query('ROLLBACK');return rep.code(404).send({message:'Conta de origem ou destino não encontrada'});}const t=await client.query(`INSERT INTO transferencias(usuario_id,conta_origem_id,conta_destino_id,valor,data_transferencia,observacao) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[id,b.conta_origem_id,b.conta_destino_id,n(b.valor),b.data_transferencia,b.observacao||null]);await client.query(`INSERT INTO lancamentos(usuario_id,conta_id,tipo,valor,descricao,data_movimento,status,forma_pagamento) VALUES($1,$2,'despesa',$3,$4,$5,'pago','transferencia'),($1,$6,'receita',$3,$4,$5,'pago','transferencia')`,[id,b.conta_origem_id,n(b.valor),b.observacao||'Transferência',b.data_transferencia,b.conta_destino_id]);await client.query('COMMIT');return rep.code(201).send(t.rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});

  // Cartões: compra só entra após confirmação explícita. Parcelas representam compromisso futuro.
  app.get('/api/cartoes',async(req:any)=>{const id=userId(req);return (await query(`SELECT c.*,COALESCE(SUM(CASE WHEN p.status='aberta' THEN p.valor ELSE 0 END),0) comprometido FROM cartoes c LEFT JOIN compras_cartao cc ON cc.cartao_id=c.id LEFT JOIN parcelas_cartao p ON p.compra_id=cc.id WHERE c.usuario_id=$1 AND c.ativo=true GROUP BY c.id ORDER BY c.nome`,[id])).rows.map(x=>({...x,limite:n(x.limite),comprometido:money(x.comprometido),disponivel:x.limite==null?null:money(n(x.limite)-n(x.comprometido))}))});
  app.post('/api/cartoes',async(req:any,rep)=>{const id=userId(req),b=req.body||{};const r=await query(`INSERT INTO cartoes(usuario_id,nome,banco,limite,dia_fechamento,dia_vencimento) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[id,b.nome,b.banco||null,b.limite===''?null:n(b.limite),b.dia_fechamento||null,b.dia_vencimento||null]);return rep.code(201).send(r.rows[0])});
  app.get('/api/cartoes/:id/compras',async(req:any)=>{const id=userId(req);return (await query(`SELECT cc.*,COALESCE(json_agg(json_build_object('id',p.id,'numero',p.numero,'total_parcelas',p.total_parcelas,'valor',p.valor,'data_vencimento',p.data_vencimento,'status',p.status) ORDER BY p.numero) FILTER (WHERE p.id IS NOT NULL),'[]') parcelas FROM compras_cartao cc JOIN cartoes c ON c.id=cc.cartao_id LEFT JOIN parcelas_cartao p ON p.compra_id=cc.id WHERE cc.cartao_id=$1 AND c.usuario_id=$2 GROUP BY cc.id ORDER BY cc.data_compra DESC`,[req.params.id,id])).rows});
  // V3.2: prévia de compra de cartão. Não grava nada e não cria compromisso.
  app.post('/api/cartoes/compras/preview',async(req:any,rep)=>{
    const id=userId(req),b=req.body||{};const total=n(b.valor_total),parcelas=Math.max(1,Math.floor(n(b.numero_parcelas||1)));
    if(!b.cartao_id||!b.data_compra||total<=0||parcelas>60)return rep.code(400).send({message:'Dados da compra inválidos'});
    const c=await query(`SELECT * FROM cartoes WHERE id=$1 AND usuario_id=$2 AND ativo=true`,[b.cartao_id,id]);
    if(!c.rowCount)return rep.code(404).send({message:'Cartão não encontrado'});const card=c.rows[0];
    const committed=await query(`SELECT COALESCE(SUM(p.valor),0) total FROM parcelas_cartao p JOIN compras_cartao cc ON cc.id=p.compra_id WHERE cc.cartao_id=$1 AND p.status='aberta'`,[card.id]);
    const current=n(committed.rows[0].total),available=card.limite===null?null:n(card.limite)-current;
    if(available!==null&&total>available)return rep.code(409).send({message:'Compra ultrapassa o limite disponível',disponivel:money(available)});
    const base=Math.round((total/parcelas)*100)/100;const first=new Date(`${b.data_compra}T12:00:00`);const preview:any[]=[];
    for(let i=1;i<=parcelas;i++){const due=new Date(first);due.setMonth(due.getMonth()+i);if(card.dia_vencimento)due.setDate(Math.min(card.dia_vencimento,28));const value=i===parcelas?money(total-base*(parcelas-1)):base;preview.push({numero:i,total_parcelas:parcelas,valor:value,data_vencimento:due.toISOString().slice(0,10)});}
    return {cartao:{id:card.id,nome:card.nome,limite:card.limite===null?null:n(card.limite),comprometido:money(current),disponivel:available===null?null:money(available-total)},compra:{descricao:b.descricao||'',valor_total:money(total),numero_parcelas:parcelas,data_compra:b.data_compra},parcelas:preview,cria_compromisso:true};
  });

  // V3.2: visão de fatura por competência, sem transformar transferência em despesa.
  app.get('/api/cartoes/:id/fatura',async(req:any,rep)=>{const id=userId(req),mes=String(req.query?.mes||'').match(/^\d{4}-\d{2}$/)?.[0];if(!mes)return rep.code(400).send({message:'Informe mes no formato YYYY-MM'});const r=await query(`SELECT p.id,p.numero,p.total_parcelas,p.valor,p.data_vencimento,p.status,cc.id compra_id,cc.descricao,cc.valor_total,cc.data_compra FROM parcelas_cartao p JOIN compras_cartao cc ON cc.id=p.compra_id JOIN cartoes c ON c.id=cc.cartao_id WHERE c.id=$1 AND c.usuario_id=$2 AND to_char(p.data_vencimento,'YYYY-MM')=$3 ORDER BY p.data_vencimento,p.numero`,[req.params.id,id,mes]);const total=r.rows.reduce((a,x)=>a+n(x.valor),0);return {mes,cartao_id:req.params.id,total:money(total),parcelas:r.rows.map(x=>({...x,valor:money(x.valor),valor_total:money(x.valor_total)}))};});

  app.post('/api/cartoes/compras',async(req:any,rep)=>{
    const id=userId(req),b=req.body||{};
    if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});
    const parcelas=Math.max(1,Math.floor(n(b.numero_parcelas||1))),total=n(b.valor_total);if(total<=0)return rep.code(400).send({message:'Valor inválido'});
    const client=await pool.connect();try{await client.query('BEGIN');await setUserContext(client,id);const c=await client.query(`SELECT * FROM cartoes WHERE id=$1 AND usuario_id=$2 AND ativo=true FOR UPDATE`,[b.cartao_id,id]);if(!c.rowCount)return rep.code(404).send({message:'Cartão não encontrado'});const card=c.rows[0];if(b.categoria_id){const cat=await client.query(`SELECT id FROM categorias WHERE id=$1 AND ativa=true AND (usuario_id=$2 OR usuario_id IS NULL)`,[b.categoria_id,id]);if(!cat.rowCount)return rep.code(404).send({message:'Categoria não encontrada'});}const comprometido=await client.query(`SELECT COALESCE(SUM(p.valor),0) total FROM parcelas_cartao p JOIN compras_cartao cc ON cc.id=p.compra_id WHERE cc.cartao_id=$1 AND p.status='aberta'`,[card.id]);if(card.limite!==null&&n(comprometido.rows[0].total)+total>n(card.limite))return rep.code(409).send({message:'Compra ultrapassa o limite disponível'});const compra=await client.query(`INSERT INTO compras_cartao(usuario_id,cartao_id,categoria_id,descricao,valor_total,numero_parcelas,data_compra) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,b.cartao_id,b.categoria_id||null,b.descricao,total,parcelas,b.data_compra]);const valorParcela=Math.round((total/parcelas)*100)/100;const first=new Date(`${b.data_compra}T12:00:00`);for(let i=1;i<=parcelas;i++){const due=new Date(first);due.setMonth(due.getMonth()+i);if(card.dia_vencimento)due.setDate(Math.min(card.dia_vencimento,28));const value=i===parcelas?money(total-valorParcela*(parcelas-1)):valorParcela;await client.query(`INSERT INTO parcelas_cartao(compra_id,numero,total_parcelas,valor,data_vencimento) VALUES($1,$2,$3,$4,$5)`,[compra.rows[0].id,i,parcelas,value,due.toISOString().slice(0,10)])}await client.query('COMMIT');await audit(req,'COMPRA_CARTAO_CRIADA',true,id,{compra_id:compra.rows[0].id,valor_total:total,parcelas});return rep.code(201).send(compra.rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  });

  // Metas — V3.6: planejamento, cenários e vínculo opcional com conta.
  app.get('/api/investimentos',async(req:any)=>{const id=userId(req);return (await query(`SELECT i.*,c.nome AS conta_nome FROM investimentos i LEFT JOIN contas c ON c.id=i.conta_id AND c.usuario_id=i.usuario_id WHERE i.usuario_id=$1 AND i.ativo=true ORDER BY i.nome`,[id])).rows});
  app.post('/api/investimentos',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(!b.nome||!b.tipo)return rep.code(400).send({message:'Nome e tipo são obrigatórios'});if(b.conta_id){const own=await query(`SELECT id FROM contas WHERE id=$1 AND usuario_id=$2 AND ativa=true`,[b.conta_id,id]);if(!own.rowCount)return rep.code(404).send({message:'Conta não encontrada'});}const v=n(b.valor_investido),a=n(b.valor_atual||v);const r=await query(`INSERT INTO investimentos(usuario_id,conta_id,nome,tipo,instituicao,valor_investido,valor_atual,data_aplicacao,data_vencimento,rentabilidade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,b.conta_id||null,b.nome,b.tipo,b.instituicao||null,v,a,b.data_aplicacao||null,b.data_vencimento||null,b.rentabilidade??null]);return rep.code(201).send(r.rows[0])});
  app.patch('/api/investimentos/:id',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const r=await query(`UPDATE investimentos SET valor_atual=COALESCE($1,valor_atual),rentabilidade=COALESCE($2,rentabilidade),atualizado_em=now() WHERE id=$3 AND usuario_id=$4 AND ativo=true RETURNING *`,[b.valor_atual,b.rentabilidade,req.params.id,id]);if(!r.rowCount)return rep.code(404).send({message:'Investimento não encontrado'});return r.rows[0]});
  app.delete('/api/investimentos/:id',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const r=await query(`UPDATE investimentos SET ativo=false,atualizado_em=now() WHERE id=$1 AND usuario_id=$2 RETURNING id`,[req.params.id,id]);if(!r.rowCount)return rep.code(404).send({message:'Investimento não encontrado'});return {ok:true}});
  app.get('/api/investimentos/resumo',async(req:any)=>{const id=userId(req);const r=await query(`SELECT COUNT(*)::int AS quantidade,COALESCE(SUM(valor_investido),0) AS investido,COALESCE(SUM(valor_atual),0) AS atual,COALESCE(SUM(valor_atual-valor_investido),0) AS ganho FROM investimentos WHERE usuario_id=$1 AND ativo=true`,[id]);return r.rows[0]});
  app.get('/api/metas',async(req:any)=>{const id=userId(req);return (await query(`SELECT m.*,c.nome AS conta_nome FROM metas m LEFT JOIN contas c ON c.id=m.conta_id AND c.usuario_id=m.usuario_id WHERE m.usuario_id=$1 AND m.status<>'cancelada' ORDER BY m.status='ativa' DESC,m.data_limite NULLS LAST,m.nome`,[id])).rows});
  app.post('/api/metas',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(!b.nome||n(b.valor_objetivo)<=0)return rep.code(400).send({message:'Nome e valor objetivo são obrigatórios'});if(b.conta_id){const own=await query(`SELECT id FROM contas WHERE id=$1 AND usuario_id=$2 AND ativa=true`,[b.conta_id,id]);if(!own.rowCount)return rep.code(404).send({message:'Conta não encontrada'});}const r=await query(`INSERT INTO metas(usuario_id,nome,valor_objetivo,valor_atual,data_limite,conta_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[id,b.nome,n(b.valor_objetivo),n(b.valor_atual),b.data_limite||null,b.conta_id||null]);return rep.code(201).send(r.rows[0])});
  app.patch('/api/metas/:id',async(req:any)=>{const id=userId(req),b=req.body||{};if(b.conta_id){const own=await query(`SELECT id FROM contas WHERE id=$1 AND usuario_id=$2 AND ativa=true`,[b.conta_id,id]);if(!own.rowCount)throw new Error('Conta não encontrada');}const r=await query(`UPDATE metas SET nome=COALESCE($1,nome),valor_objetivo=COALESCE($2,valor_objetivo),data_limite=COALESCE($3,data_limite),status=COALESCE($4,status),conta_id=COALESCE($5,conta_id),atualizado_em=now() WHERE id=$6 AND usuario_id=$7 RETURNING *`,[b.nome,b.valor_objetivo,b.data_limite,b.status,b.conta_id,req.params.id,id]);return r.rows[0]});
  app.post('/api/metas/:id/aportar',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const valor=n(b.valor);if(valor<=0)return rep.code(400).send({message:'Valor inválido'});const r=await query(`UPDATE metas SET valor_atual=LEAST(valor_objetivo,valor_atual+$1),status=CASE WHEN valor_atual+$1>=valor_objetivo THEN 'concluida' ELSE status END,atualizado_em=now() WHERE id=$2 AND usuario_id=$3 RETURNING *`,[valor,req.params.id,id]);return r.rows[0]});

  app.get('/api/metas/planejamento',async(req:any)=>{
    const id=userId(req);
    const [goals,months,balances]=await Promise.all([
      query(`SELECT m.*,c.nome AS conta_nome FROM metas m LEFT JOIN contas c ON c.id=m.conta_id AND c.usuario_id=m.usuario_id WHERE m.usuario_id=$1 AND m.status='ativa' ORDER BY m.data_limite NULLS LAST,m.nome`,[id]),
      query(`SELECT to_char(date_trunc('month',data_movimento),'YYYY-MM') mes,COALESCE(SUM(CASE WHEN tipo='receita' AND forma_pagamento <> 'transferencia' AND status='pago' THEN valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN tipo='despesa' AND forma_pagamento <> 'transferencia' AND status='pago' THEN valor ELSE 0 END),0) saidas FROM lancamentos WHERE usuario_id=$1 AND data_movimento >= CURRENT_DATE - INTERVAL '6 months' GROUP BY 1 ORDER BY 1 DESC`,[id]),
      query(`SELECT COALESCE(SUM(saldo_inicial),0)+COALESCE((SELECT SUM(CASE WHEN l.tipo='receita' THEN l.valor WHEN l.tipo='despesa' THEN -l.valor ELSE 0 END) FROM lancamentos l WHERE l.usuario_id=$1 AND l.status='pago' AND l.forma_pagamento <> 'transferencia'),0) patrimonio FROM contas WHERE usuario_id=$1 AND ativa=true`,[id])
    ]);
    const vals=months.rows;
    const avgIncome=vals.length?vals.reduce((a,r)=>a+n(r.entradas),0)/vals.length:0;
    const avgExpense=vals.length?vals.reduce((a,r)=>a+n(r.saidas),0)/vals.length:0;
    const currentCapacity=Math.max(0,avgIncome-avgExpense);
    const conservative=Math.max(0,currentCapacity*0.7), accelerated=Math.max(0,currentCapacity*1.3);
    const today=new Date();
    const monthsBetween=(a:Date,b:Date)=>Math.max(0,(b.getFullYear()-a.getFullYear())*12+b.getMonth()-a.getMonth()+(b.getDate()>a.getDate()?1:0));
    const dateAfterMonths=(base:Date,months:number)=>{const d=new Date(base);d.setMonth(d.getMonth()+Math.max(0,months));return d.toISOString().slice(0,10)};
    const dateDiffMonths=(goal:any)=>goal.data_limite?Math.max(0,monthsBetween(today,new Date(`${String(goal.data_limite).slice(0,10)}T12:00:00`))):null;
    const enriched=goals.rows.map(g=>{const remaining=Math.max(0,n(g.valor_objetivo)-n(g.valor_atual));const monthsToDeadline=dateDiffMonths(g);const required=monthsToDeadline&&monthsToDeadline>0?remaining/monthsToDeadline:null;const scenario=(cap:number)=>cap>0?dateAfterMonths(today,Math.ceil(remaining/cap)):null;return {...g,valor_objetivo:n(g.valor_objetivo),valor_atual:n(g.valor_atual),restante:remaining,meses_ate_prazo:monthsToDeadline,aporte_mensal_necessario:required,cenarios:{conservador:scenario(conservative),atual:scenario(currentCapacity),acelerado:scenario(accelerated)},capacidade_mensal_atual:currentCapacity,impacto_despesas_recorrentes:avgExpense};});
    const months12=Array.from({length:12},(_,i)=>{const d=new Date(today.getFullYear(),today.getMonth()+i+1,1);return {mes:d.toISOString().slice(0,7),patrimonio_projetado:n(balances.rows[0]?.patrimonio)+currentCapacity*(i+1)}});
    return {premissas:{media_entradas:avgIncome,media_saidas:avgExpense,capacidade_mensal_atual:currentCapacity,conservador:conservative,acelerado:accelerated,patrimonio_atual:n(balances.rows[0]?.patrimonio)},metas:enriched,patrimonio_projetado:months12};
  });

  // Dívidas e empréstimos — V3.9
  app.get('/api/dividas',async(req:any)=>{const id=userId(req);const r=await query(`SELECT * FROM dividas WHERE usuario_id=$1 AND ativa=true ORDER BY data_fim_prevista NULLS LAST,nome`,[id]);return r.rows.map((x:any)=>({...x,valor_original:Number(x.valor_original),saldo_devedor:Number(x.saldo_devedor),parcela_atual:x.parcela_atual===null?null:Number(x.parcela_atual),taxa_mensal:x.taxa_mensal===null?null:Number(x.taxa_mensal)}))});
  app.get('/api/dividas/resumo',async(req:any)=>{const id=userId(req);const r=await query(`SELECT COUNT(*)::int quantidade,COALESCE(SUM(saldo_devedor),0) saldo,COALESCE(SUM(parcela_atual),0) parcelas_mensais FROM dividas WHERE usuario_id=$1 AND ativa=true`,[id]);return {quantidade:Number(r.rows[0].quantidade),saldo:Number(r.rows[0].saldo),parcelas_mensais:Number(r.rows[0].parcelas_mensais)}});
  app.post('/api/dividas',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(!b.nome||b.valor_original===undefined||b.saldo_devedor===undefined)return rep.code(400).send({message:'Nome, valor original e saldo devedor são obrigatórios'});if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const r=await query(`INSERT INTO dividas(usuario_id,nome,credor,tipo,valor_original,saldo_devedor,parcela_atual,parcelas_restantes,taxa_mensal,data_inicio,data_fim_prevista,observacao) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[id,b.nome,b.credor||null,b.tipo||'outro',n(b.valor_original),n(b.saldo_devedor),b.parcela_atual==null?null:n(b.parcela_atual),b.parcelas_restantes==null?null:Number(b.parcelas_restantes),b.taxa_mensal==null?null:n(b.taxa_mensal),b.data_inicio||null,b.data_fim_prevista||null,b.observacao||null]);return rep.code(201).send(r.rows[0])});
  app.patch('/api/dividas/:id',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const r=await query(`UPDATE dividas SET saldo_devedor=COALESCE($1,saldo_devedor),parcela_atual=COALESCE($2,parcela_atual),parcelas_restantes=COALESCE($3,parcelas_restantes),observacao=COALESCE($4,observacao),atualizado_em=now() WHERE id=$5 AND usuario_id=$6 AND ativa=true RETURNING *`,[b.saldo_devedor==null?null:n(b.saldo_devedor),b.parcela_atual==null?null:n(b.parcela_atual),b.parcelas_restantes==null?null:Number(b.parcelas_restantes),b.observacao??null,req.params.id,id]);if(!r.rowCount)return rep.code(404).send({message:'Dívida não encontrada'});return r.rows[0]});
  app.delete('/api/dividas/:id',async(req:any,rep)=>{const id=userId(req),b=req.body||{};if(b.confirmado!==true)return rep.code(400).send({message:'Confirmação explícita necessária'});const r=await query(`UPDATE dividas SET ativa=false,atualizado_em=now() WHERE id=$1 AND usuario_id=$2 RETURNING id`,[req.params.id,id]);if(!r.rowCount)return rep.code(404).send({message:'Dívida não encontrada'});return {ok:true}});

  // Memória e insights
  app.get('/api/memoria',async(req:any)=>{const id=userId(req);return (await query(`SELECT * FROM memoria_financeira WHERE usuario_id=$1 ORDER BY ocorrencias DESC`,[id])).rows});
  app.get('/api/insights',async(req:any)=>{const id=userId(req);const r=await query(`SELECT * FROM memoria_financeira WHERE usuario_id=$1 AND recorrencia_detectada=true ORDER BY confianca DESC LIMIT 10`,[id]);return {suggestions:r.rows.map(x=>({id:x.id,descricao:x.descricao_normalizada,ocorrencias:x.ocorrencias,media:n(x.media_valor),confianca:n(x.confianca),mensagem:`Percebi um padrão em ${x.quantidade_ocorrencias} lançamentos semelhantes. Vale conferir se isso pode virar uma conta recorrente?`}))}});

  // Anexos V2.5: upload real em armazenamento privado, nome gerado pelo servidor, validação por assinatura e acesso autorizado.
  app.get('/api/documentos/analise/:id',async(req:any,rep)=>{
    const id=userId(req);
    const r=await query(`SELECT id,nome_arquivo,tipo_mime,caminho_arquivo,tamanho_bytes,criado_em FROM anexos WHERE id=$1 AND usuario_id=$2`,[req.params.id,id]);
    if(!r.rowCount)return rep.code(404).send({message:'Documento não encontrado'});
    const row=r.rows[0];
    const full=path.join(env.UPLOAD_DIR,row.caminho_arquivo);
    let text='';
    if(row.tipo_mime==='application/pdf'){try{text=(await fs.readFile(full)).toString('latin1').replace(/[^\x20-\x7EÀ-ÿ\n]/g,' '); }catch{}}
    const moneyMatches=[...text.matchAll(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/g)].map(m=>Number(m[1].replace(/\./g,'').replace(',','.'))).filter(v=>v>0&&v<100000000);
    const dates=[...text.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)].map(m=>m[1]);
    const uniqueMoney=[...new Set(moneyMatches.map(v=>v.toFixed(2)))].map(Number);
    return {id:row.id,nome_arquivo:row.nome_arquivo,tipo_mime:row.tipo_mime,status:row.tipo_mime==='application/pdf'?(text.trim()?'analisado_parcial':'aguardando_ocr'):'aguardando_ocr',valores_encontrados:uniqueMoney.slice(0,20),datas_encontradas:[...new Set(dates)].slice(0,20),observacao:'Os dados encontrados são apenas sugestões. Nenhum lançamento é criado automaticamente e toda confirmação financeira permanece manual.'};
  });
  app.get('/api/anexos/pagamento/:pagamentoId',async(req:any)=>{const id=userId(req);return (await query(`SELECT id,nome_arquivo,tipo_mime,tamanho_bytes,criado_em FROM anexos WHERE pagamento_id=$1 AND usuario_id=$2 ORDER BY criado_em DESC`,[req.params.pagamentoId,id])).rows});
  app.post('/api/anexos/upload',{config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async(req:any,rep)=>{
    const id=userId(req);
    const data=await req.file();
    if(!data)return rep.code(400).send({message:'Arquivo não enviado'});
    const pagamentoId=String(data.fields?.pagamento_id?.value||'');
    if(!pagamentoId)return rep.code(400).send({message:'Pagamento não informado'});
    const own=await query(`SELECT pr.id FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE pr.id=$1 AND r.usuario_id=$2`,[pagamentoId,id]);
    if(!own.rowCount)return rep.code(404).send({message:'Pagamento não encontrado'});
    const chunks:Buffer[]=[];let total=0;
    for await(const chunk of data.file){ total+=chunk.length; if(total>env.MAX_UPLOAD_BYTES)return rep.code(413).send({message:'Anexo excede o limite permitido'}); chunks.push(chunk); }
    const buffer=Buffer.concat(chunks);
    const detected=uploadMimeBySignature(buffer);
    const allowed=['application/pdf','image/jpeg','image/png','image/webp'];
    if(!detected||!allowed.includes(detected)||detected!==data.mimetype){return rep.code(400).send({message:'Tipo de arquivo inválido ou assinatura do arquivo não corresponde ao MIME informado'});}
    const storageRoot=path.resolve(env.UPLOAD_DIR);
    const userDir=path.join(storageRoot,id);
    await fs.mkdir(userDir,{recursive:true,mode:0o700});
    const storageName=`${crypto.randomUUID()}${extensionForMime(detected)}`;
    const absolutePath=path.join(userDir,storageName);
    await fs.writeFile(absolutePath,buffer,{flag:'wx',mode:0o600});
    const original=safeOriginalName(data.filename);
    try{
      const r=await query(`INSERT INTO anexos(usuario_id,pagamento_id,nome_arquivo,tipo_mime,caminho_arquivo,tamanho_bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,nome_arquivo,tipo_mime,tamanho_bytes,criado_em`,[id,pagamentoId,original,detected,`${id}/${storageName}`,buffer.length]);
      await audit(req,'ANEXO_ENVIADO',true,id,{anexo_id:r.rows[0].id,mime:detected,tamanho:buffer.length});
      return rep.code(201).send(r.rows[0]);
    }catch(e){await fs.rm(absolutePath,{force:true});throw e}
  });
  app.get('/api/anexos/:id/download',async(req:any,rep)=>{
    const id=userId(req);
    const r=await query(`SELECT id,nome_arquivo,tipo_mime,caminho_arquivo,tamanho_bytes FROM anexos WHERE id=$1 AND usuario_id=$2`,[req.params.id,id]);
    if(!r.rowCount)return rep.code(404).send({message:'Anexo não encontrado'});
    const storageRoot=path.resolve(env.UPLOAD_DIR);
    const absolute=path.resolve(storageRoot,r.rows[0].caminho_arquivo);
    if(!absolute.startsWith(storageRoot+path.sep))return rep.code(403).send({message:'Acesso ao arquivo bloqueado'});
    try{const stat=await fs.stat(absolute);if(!stat.isFile())throw new Error('NOT_FILE');const data=await fs.readFile(absolute);await audit(req,'ANEXO_ACESSADO',true,id,{anexo_id:r.rows[0].id});return rep.header('Content-Type',r.rows[0].tipo_mime).header('Content-Length',String(data.length)).header('Content-Disposition',`attachment; filename="${safeOriginalName(r.rows[0].nome_arquivo)}"`).send(data)}catch{ return rep.code(404).send({message:'Arquivo não disponível'}) }
  });
  app.delete('/api/anexos/:id',{config:{rateLimit:{max:20,timeWindow:'1 hour'}}},async(req:any,rep)=>{
    const id=userId(req);const r=await query(`DELETE FROM anexos WHERE id=$1 AND usuario_id=$2 RETURNING caminho_arquivo`,[req.params.id,id]);if(!r.rowCount)return rep.code(404).send({message:'Anexo não encontrado'});
    const absolute=path.resolve(env.UPLOAD_DIR,r.rows[0].caminho_arquivo);const root=path.resolve(env.UPLOAD_DIR);if(absolute.startsWith(root+path.sep))await fs.rm(absolute,{force:true});await audit(req,'ANEXO_REMOVIDO',true,id,{anexo_id:req.params.id});return {ok:true};
  });
  // Compatibilidade: não aceita mais caminhos arbitrários enviados pelo cliente.
  app.post('/api/anexos',async(req:any,rep)=>rep.code(410).send({message:'Use o endpoint seguro /api/anexos/upload para enviar arquivos.'}));

  // V3.4: agenda financeira e notificações inteligentes (informativas; não criam compromissos).
  app.get('/api/agenda',async(req:any)=>{
    const id=userId(req);
    const start=String(req.query?.inicio||new Date().toISOString().slice(0,10));
    const end=String(req.query?.fim||(()=>{const d=new Date();d.setDate(d.getDate()+30);return d.toISOString().slice(0,10)})());
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)) return {eventos:[]};
    await syncRecurringPaymentsForUser(id,120);
    const [payments,cards,goals]=await Promise.all([
      query(`SELECT pr.id,pr.data_prevista,pr.valor_previsto,pr.status,r.nome,r.tipo,'recorrencia' origem FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.data_prevista BETWEEN $2 AND $3 ORDER BY pr.data_prevista`,[id,start,end]),
      query(`SELECT c.id,c.nome,c.dia_vencimento,c.dia_fechamento FROM cartoes c WHERE c.usuario_id=$1 AND c.ativo=true`,[id]),
      query(`SELECT id,nome,data_limite,valor_objetivo,valor_atual,status FROM metas WHERE usuario_id=$1 AND data_limite BETWEEN $2 AND $3 AND status<>'cancelada'`,[id,start,end])
    ]);
    const events:any[]=[];
    for(const x of payments.rows) events.push({id:x.id,data:x.data_prevista,titulo:x.nome,tipo:x.tipo==='receita'?'entrada':'saida',origem:x.origem,status:x.status,valor:x.valor_previsto===null?null:money(x.valor_previsto)});
    const base=new Date(`${start}T12:00:00`), finish=new Date(`${end}T12:00:00`);
    for(const c of cards.rows){ if(!c.dia_vencimento) continue; let d=new Date(base); while(d<=finish){ const day=Math.min(Number(c.dia_vencimento),28); if(d.getDate()===day) events.push({id:`fatura-${c.id}-${dateOnly(d)}`,data:dateOnly(d),titulo:`Fatura — ${c.nome}`,tipo:'cartao',origem:'cartao',status:'previsto',valor:null}); d.setDate(d.getDate()+1); } }
    for(const g of goals.rows) events.push({id:g.id,data:dateOnly(g.data_limite),titulo:`Meta — ${g.nome}`,tipo:'meta',origem:'meta',status:g.status,valor:money(Math.max(0,n(g.valor_objetivo)-n(g.valor_atual)))});
    return {inicio:start,fim:end,eventos:events.sort((a,b)=>String(a.data).localeCompare(String(b.data)))};
  });

  app.get('/api/notificacoes',async(req:any)=>{
    const id=userId(req); await syncRecurringPaymentsForUser(id,30);
    const rows=await query(`SELECT pr.id,pr.data_prevista,pr.valor_previsto,pr.status,r.nome,r.tipo FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') AND pr.data_prevista<=CURRENT_DATE+INTERVAL '7 days' ORDER BY pr.data_prevista LIMIT 30`,[id]);
    const notifications=rows.rows.map(x=>{const due=new Date(`${dateOnly(x.data_prevista)}T12:00:00`);const today=new Date();today.setHours(12,0,0,0);const diff=Math.round((due.getTime()-today.getTime())/86400000);const overdue=diff<0;return {id:`pagamento-${x.id}`,categoria:overdue?'vencida':'vencimento',prioridade:overdue?'alta':diff<=1?'alta':'normal',titulo:overdue?`${x.nome} está vencida`:`${x.nome} vence ${diff===0?'hoje':diff===1?'amanhã':`em ${diff} dias`}`,mensagem:x.valor_previsto===null?'O valor é variável e precisa ser confirmado.':`Valor previsto: ${brl(x.valor_previsto)}.`,data:x.data_prevista,status:x.status,acao:'revisar_pagamento'};});
    return {total:notifications.length,notificacoes:notifications};
  });

  app.get('/api/notificacoes/preferencias',async(req:any)=>{
    const id=userId(req); const r=await query(`SELECT * FROM preferencias_notificacao WHERE usuario_id=$1`,[id]);
    return r.rows[0]||{contas_vencimento:true,contas_vencidas:true,faturas:true,metas:true,antecedencia_dias:3};
  });
  app.patch('/api/notificacoes/preferencias',async(req:any,rep)=>{
    const id=userId(req),b=req.body||{}; const dias=Math.min(30,Math.max(0,Math.floor(n(b.antecedencia_dias??3))));
    const r=await query(`INSERT INTO preferencias_notificacao(usuario_id,contas_vencimento,contas_vencidas,faturas,metas,antecedencia_dias) VALUES($1,COALESCE($2,true),COALESCE($3,true),COALESCE($4,true),COALESCE($5,true),$6) ON CONFLICT(usuario_id) DO UPDATE SET contas_vencimento=EXCLUDED.contas_vencimento,contas_vencidas=EXCLUDED.contas_vencidas,faturas=EXCLUDED.faturas,metas=EXCLUDED.metas,antecedencia_dias=EXCLUDED.antecedencia_dias,atualizado_em=now() RETURNING *`,[id,b.contas_vencimento,b.contas_vencidas,b.faturas,b.metas,dias]);
    await audit(req,'PREFERENCIAS_NOTIFICACAO_ATUALIZADAS',true,id); return r.rows[0];
  });

  // V4.9: histórico persistente do assistente. Somente consulta; nenhuma ação financeira.
  app.get('/api/assistente/historico',async(req:any)=>{
    const id=userId(req);
    const r=await query(`SELECT id,pergunta,resposta,tipo,criado_em FROM assistente_historico WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 30`,[id]);
    return {historico:r.rows};
  });

  // V4.7: assistente financeiro amplo. Somente consulta/cálculo; nenhuma ação financeira.
  // V4.8: explicações inteligentes e recomendações contextuais. Somente leitura.
  app.get('/api/assistente/insights',async(req:any,rep)=>{
    const id=userId(req);
    const [cur,prev,cats,commit,goals]=await Promise.all([
      query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) saidas FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND data_movimento>=date_trunc('month',CURRENT_DATE) AND forma_pagamento<>'transferencia'`,[id]),
      query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) saidas FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND data_movimento>=date_trunc('month',CURRENT_DATE)-interval '1 month' AND data_movimento<date_trunc('month',CURRENT_DATE) AND forma_pagamento<>'transferencia'`,[id]),
      query(`SELECT COALESCE(c.nome,'Sem categoria') categoria,COALESCE(SUM(l.valor),0) atual,COALESCE(SUM(CASE WHEN l.data_movimento<date_trunc('month',CURRENT_DATE) THEN l.valor ELSE 0 END),0) historico FROM lancamentos l LEFT JOIN categorias c ON c.id=l.categoria_id WHERE l.usuario_id=$1 AND l.tipo='despesa' AND l.status='pago' AND l.data_movimento>=date_trunc('month',CURRENT_DATE)-interval '3 months' AND l.forma_pagamento<>'transferencia' GROUP BY c.nome ORDER BY atual DESC LIMIT 10`,[id]),
      query(`SELECT COUNT(*) quantidade,COALESCE(SUM(valor_previsto),0) total FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') AND pr.data_prevista BETWEEN CURRENT_DATE AND CURRENT_DATE+interval '30 days'`,[id]),
      query(`SELECT nome,valor_objetivo,valor_atual,data_limite FROM metas WHERE usuario_id=$1 AND status<>'cancelada' ORDER BY data_limite NULLS LAST LIMIT 8`,[id])
    ]);
    const ce=n(cur.rows[0].entradas),cs=n(cur.rows[0].saidas),pe=n(prev.rows[0].entradas),ps=n(prev.rows[0].saidas);
    const insights:any[]=[]; const recommendations:any[]=[];
    const pct=(a:number,b:number)=>b?((a-b)/b)*100:null;
    if(ps>0){const d=pct(cs,ps); if(d!==null && Math.abs(d)>=10) insights.push({tipo:'explicacao',titulo:'As despesas mudaram',texto:`As saídas deste mês estão ${Math.abs(d).toFixed(0)}% ${d>0?'acima':'abaixo'} das do mês passado.`,base:'comparação mensal'});}
    if(pe>0){const d=pct(ce,pe); if(d!==null && Math.abs(d)>=10) insights.push({tipo:'explicacao',titulo:'As entradas mudaram',texto:`As entradas deste mês estão ${Math.abs(d).toFixed(0)}% ${d>0?'acima':'abaixo'} das do mês passado.`,base:'comparação mensal'});}
    const top=cats.rows.filter((x:any)=>n(x.atual)>0).slice(0,3); if(top.length) insights.push({tipo:'padrao',titulo:'Onde seus gastos estão concentrados',texto:`As maiores categorias registradas no período recente são ${top.map((x:any)=>`${x.categoria} (${brl(n(x.atual))})`).join(', ')}.`,base:'últimos 3 meses'});
    if(cs>ce) recommendations.push({titulo:'Acompanhe o resultado do mês',texto:`Até agora, as saídas registradas superam as entradas em ${brl(cs-ce)}. Vale revisar os próximos compromissos antes de assumir novas despesas.`,acao:'revisar compromissos',segura:true});
    else recommendations.push({titulo:'Observe sua capacidade atual',texto:`O resultado registrado deste mês é ${brl(ce-cs)}. Você pode usar esse número como referência para acompanhar suas metas.`,acao:'acompanhar metas',segura:true});
    const qtd=Number(commit.rows[0].quantidade||0),total=n(commit.rows[0].total); if(qtd) recommendations.push({titulo:'Próximos compromissos',texto:`Há ${qtd} compromisso(s) registrado(s) nos próximos 30 dias, somando aproximadamente ${brl(total)}.`,acao:'abrir agenda',segura:true});
    const meta=goals.rows.find((g:any)=>g.data_limite && n(g.valor_objetivo)>n(g.valor_atual)); if(meta) {const restante=Math.max(0,n(meta.valor_objetivo)-n(meta.valor_atual)); recommendations.push({titulo:'Uma meta merece atenção',texto:`A meta “${meta.nome}” ainda tem ${brl(restante)} a alcançar.`,acao:'abrir metas',segura:true});}
    const result={insights,recommendations,periodo:'mês atual comparado ao mês anterior e padrões recentes',limites:['Somente análise e sugestão.','Nenhuma recomendação movimenta dinheiro.','Os dados podem estar incompletos se o usuário não registrar todas as movimentações.'],gerado_em:new Date().toISOString()};
    await audit(req,'ASSISTENTE_INSIGHTS',true,id,{quantidade_insights:insights.length,quantidade_recomendacoes:recommendations.length});
    return result;
  });

  app.post('/api/assistente/perguntar',async(req:any,rep)=>{
    const id=userId(req), pergunta=String(req.body?.pergunta||'').trim();
    if(!pergunta) return rep.code(400).send({message:'Pergunta não informada'});
    const q=pergunta.toLowerCase();
    const monthsMatch=q.match(/(\d+)\s*mes/); const meses=Math.min(24,Math.max(1,Number(monthsMatch?.[1]||3)));
    const isCategory=/(categoria|aliment|moradia|transporte|lazer|compras|saúde|saude|educa)/.test(q);
    const isMonthly=/(mês|mes|mensal|meses|evolu|históric|historico|compar)/.test(q);
    const isSavings=/(guardar|poupar|econom|sobra|resultado|capacidade)/.test(q);
    const isPatrimonio=/(patrim|quanto tenho|total.*financeir)/.test(q);
    const isMeta=/(meta|objetivo)/.test(q);
    const isCommitment=/(próxim|proxim|venc|comprom)/.test(q);
    const isDebt=/(dívida|divida|devedor|financiamento|empréstimo|emprestimo)/.test(q);
    const isCard=/(cartão|cartao|fatura|parcel)/.test(q);
    let resposta='Posso analisar seus gastos, receitas, evolução, patrimônio, metas, cartões, dívidas e compromissos usando apenas os dados registrados. Se algo não estiver cadastrado, eu aviso.';
    let dados:any={tipo:'orientacao'};
    if(isCategory){
      const r=await query(`SELECT COALESCE(c.nome,'Sem categoria') categoria,COALESCE(SUM(l.valor),0) total,COUNT(*) quantidade FROM lancamentos l LEFT JOIN categorias c ON c.id=l.categoria_id WHERE l.usuario_id=$1 AND l.tipo='despesa' AND l.status='pago' AND l.data_movimento>=CURRENT_DATE-($2::int*INTERVAL '1 month') AND l.forma_pagamento<>'transferencia' GROUP BY c.nome ORDER BY total DESC LIMIT 10`,[id,meses]);
      if(!r.rowCount) resposta=`Não encontrei despesas pagas registradas nos últimos ${meses} meses.`; else {const total=r.rows.reduce((a,x)=>a+n(x.total),0); const linhas=r.rows.map((x,i)=>`${i+1}. ${x.categoria}: ${brl(n(x.total))} (${Number(x.quantidade)} lançamento(s))`).join(' · '); resposta=`Nos últimos ${meses} meses, suas despesas registradas somam ${brl(total)}. As principais categorias são: ${linhas}.`; dados={tipo:'categorias',periodo_meses:meses,total,categorias:r.rows.map(x=>({categoria:x.categoria,total:n(x.total),quantidade:Number(x.quantidade)}))};}
    } else if(isMonthly){
      const r=await query(`SELECT TO_CHAR(DATE_TRUNC('month',l.data_movimento),'YYYY-MM') mes,COALESCE(SUM(CASE WHEN l.tipo='receita' THEN l.valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN l.tipo='despesa' THEN l.valor ELSE 0 END),0) saidas FROM lancamentos l WHERE l.usuario_id=$1 AND l.status='pago' AND l.data_movimento>=CURRENT_DATE-($2::int*INTERVAL '1 month') AND l.forma_pagamento<>'transferencia' GROUP BY 1 ORDER BY 1`,[id,meses]);
      if(!r.rowCount) resposta=`Não encontrei lançamentos pagos suficientes para montar a evolução dos últimos ${meses} meses.`; else {const totalE=r.rows.reduce((a,x)=>a+n(x.entradas),0),totalS=r.rows.reduce((a,x)=>a+n(x.saidas),0); resposta=`Nos últimos ${meses} meses, foram registradas ${brl(totalE)} em entradas e ${brl(totalS)} em saídas, resultando em ${brl(totalE-totalS)}. A média mensal ficou em ${brl((totalE-totalS)/r.rowCount)} de resultado.`; dados={tipo:'evolucao_mensal',periodo_meses:meses,entradas:totalE,saidas:totalS,resultado:totalE-totalS,meses:r.rows.map(x=>({mes:x.mes,entradas:n(x.entradas),saidas:n(x.saidas),resultado:n(x.entradas)-n(x.saidas)}))};}
    } else if(isSavings){
      const r=await query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) entradas,COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) saidas FROM lancamentos WHERE usuario_id=$1 AND status='pago' AND data_movimento>=CURRENT_DATE-INTERVAL '3 months' AND forma_pagamento<>'transferencia'`,[id]); const e=n(r.rows[0].entradas),s=n(r.rows[0].saidas),res=e-s; resposta=`Nos últimos 3 meses, suas entradas registradas foram ${brl(e)} e suas saídas ${brl(s)}. O resultado acumulado foi ${brl(res)}, com média de ${brl(res/3)} por mês.`; dados={tipo:'capacidade_poupanca',periodo_meses:3,entradas:e,saidas:s,resultado:res,media_mensal:res/3};
    } else if(isPatrimonio){
      const [a,i,d]=await Promise.all([query(`SELECT COALESCE(SUM(saldo_atual),0) total FROM contas WHERE usuario_id=$1 AND ativa=true`,[id]),query(`SELECT COALESCE(SUM(valor_atual),0) total FROM investimentos WHERE usuario_id=$1 AND ativo=true`,[id]),query(`SELECT COALESCE(SUM(saldo_devedor),0) total FROM dividas WHERE usuario_id=$1 AND ativa=true`,[id])]); const contas=n(a.rows[0].total),invest=n(i.rows[0].total),div=n(d.rows[0].total),total=contas+invest-div; resposta=`Seu patrimônio líquido registrado é ${brl(total)}: ${brl(contas)} em contas + ${brl(invest)} em investimentos − ${brl(div)} em dívidas.`; dados={tipo:'patrimonio_liquido',contas,investimentos:invest,dividas:div,total};
    } else if(isMeta){
      const r=await query(`SELECT nome,valor_objetivo,valor_atual,data_limite,status FROM metas WHERE usuario_id=$1 AND status<>'cancelada' ORDER BY data_limite NULLS LAST LIMIT 10`,[id]); if(!r.rowCount) resposta='Você ainda não tem metas ativas registradas.'; else {resposta=r.rows.map(g=>{const rest=Math.max(0,n(g.valor_objetivo)-n(g.valor_atual));return `“${g.nome}”: ${brl(n(g.valor_atual))} de ${brl(n(g.valor_objetivo))}, faltam ${brl(rest)}${g.data_limite?` até ${String(g.data_limite).slice(0,10)}`:''}.`;}).join(' '); dados={tipo:'metas',metas:r.rows.map(g=>({nome:g.nome,objetivo:n(g.valor_objetivo),atual:n(g.valor_atual),restante:Math.max(0,n(g.valor_objetivo)-n(g.valor_atual)),data_limite:g.data_limite,status:g.status}))};}
    } else if(isCommitment){
      const r=await query(`SELECT r.nome,pr.data_prevista,pr.valor_previsto,pr.status FROM pagamentos_recorrentes pr JOIN recorrencias r ON r.id=pr.recorrencia_id WHERE r.usuario_id=$1 AND pr.status IN ('previsto','pendente','atrasado') AND pr.data_prevista BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '30 days' ORDER BY pr.data_prevista LIMIT 20`,[id]); resposta=r.rowCount?`Há ${r.rowCount} compromisso(s) registrado(s) nos próximos 30 dias. ${r.rows.slice(0,5).map(x=>`“${x.nome}” em ${String(x.data_prevista).slice(0,10)}${x.valor_previsto!=null?` (${brl(x.valor_previsto)})`:''}`).join('; ')}.`:'Não encontrei compromissos recorrentes registrados para os próximos 30 dias.'; dados={tipo:'compromissos',quantidade:r.rowCount,itens:r.rows};
    } else if(isDebt){
      const r=await query(`SELECT COALESCE(SUM(saldo_devedor),0) saldo,COALESCE(SUM(parcela_mensal),0) parcela,COUNT(*) quantidade FROM dividas WHERE usuario_id=$1 AND ativa=true`,[id]); const saldo=n(r.rows[0].saldo),parcela=n(r.rows[0].parcela),qtd=Number(r.rows[0].quantidade); resposta=qtd?`Você tem ${qtd} dívida(s) ativa(s), com ${brl(saldo)} de saldo devedor registrado e ${brl(parcela)} em parcelas mensais informadas.`:'Você não tem dívidas ativas registradas.'; dados={tipo:'dividas',quantidade:qtd,saldo_devedor:saldo,parcelas_mensais:parcela};
    } else if(isCard){
      const r=await query(`SELECT c.nome,c.limite,COALESCE(SUM(cc.valor_total),0) compras FROM cartoes c LEFT JOIN compras_cartao cc ON cc.cartao_id=c.id WHERE c.usuario_id=$1 AND c.ativo=true GROUP BY c.id ORDER BY compras DESC`,[id]); resposta=r.rowCount?`Encontrei ${r.rowCount} cartão(ões) ativo(s). ${r.rows.map(x=>`“${x.nome}”: ${brl(n(x.compras))} em compras registradas${x.limite!=null?`, limite informado ${brl(x.limite)}`:''}`).join('; ')}.`:'Você não tem cartões ativos registrados.'; dados={tipo:'cartoes',cartoes:r.rows.map(x=>({nome:x.nome,limite:x.limite===null?null:n(x.limite),compras:n(x.compras)}))};
    }
    await query(`INSERT INTO assistente_historico(usuario_id,pergunta,resposta,tipo) VALUES($1,$2,$3,$4)`,[id,pergunta,resposta,dados.tipo]);
    await audit(req,'ASSISTENTE_CONSULTA',true,id,{tipo:dados.tipo,periodo_meses:dados.periodo_meses||null});
    return {pergunta,resposta,dados,limites:['Somente consulta, cálculo e explicação.','Não conecta bancos, não efetua pagamentos e não movimenta dinheiro.','As respostas usam somente registros disponíveis para este usuário.','Se os registros estiverem incompletos, a resposta pode não representar toda a realidade financeira.'],gerado_em:new Date().toISOString()};
  });

  // V5.2: quando publicado como aplicação única, o backend também entrega o PWA.
  // Rotas /api/* continuam exclusivamente no backend; qualquer outra rota pública
  // tenta servir um arquivo do frontend e, para rotas do SPA, devolve index.html.
  try {
    await fs.access(webRoot);
    app.get('/*', async (req:any, rep:any) => {
      const requestPath = decodeURIComponent(String(req.url).split('?')[0] || '/');
      const relative = requestPath.replace(/^\/+/, '');
      const candidate = path.resolve(webRoot, relative || 'index.html');
      if (!candidate.startsWith(webRoot + path.sep) && candidate !== webRoot) return rep.code(400).send({message:'Caminho inválido'});
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          const ext = path.extname(candidate).toLowerCase();
          const types:any={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json'};
          rep.type(types[ext] || 'application/octet-stream');
          if (candidate.includes(path.sep+'assets'+path.sep)) rep.header('Cache-Control','public, max-age=604800, immutable');
          return rep.send(await fs.readFile(candidate));
        }
      } catch {}
      const index=path.join(webRoot,'index.html');
      try { rep.type('text/html; charset=utf-8'); return rep.send(await fs.readFile(index)); }
      catch { return rep.code(404).send({message:'Recurso não encontrado'}); }
    });
  } catch {
    // Em desenvolvimento, o frontend continua sendo servido pelo Vite.
  }

  return app;
}
