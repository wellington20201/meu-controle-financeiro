const API_URL = import.meta.env.VITE_API_URL ?? (window.location.hostname === 'localhost' && window.location.port === '5173' ? 'http://localhost:3333/api' : '/api');

export type User={id:string;email:string;nome:string;moeda:string;mascote_id?:string};
export type SecuritySession={id:string;criado_em:string;ultimo_acesso:string;expira_em:string;user_agent?:string;ip?:string;atual:boolean};
export type AuditEvent={evento:string;sucesso:boolean;criado_em:string;ip?:string;user_agent?:string};
export type Account={id:string;nome:string;tipo:string;saldo_inicial:number;saldo_atual:number;ativa:boolean};
export type Category={id:string;nome:string;tipo:'receita'|'despesa';icone?:string};
export type Transaction={id:string;tipo:'receita'|'despesa'|'transferencia';valor:number;descricao:string;data_movimento:string;status:string;conta_nome?:string;categoria_nome?:string;forma_pagamento?:string};
export type Recurrence={id:string;nome:string;tipo:'receita'|'despesa';valor:number;valor_variavel:boolean;periodicidade:string;ativa:boolean;conta_id:string;categoria_id?:string};
export type Payment={id:string;nome:string;conta_id:string;categoria_id?:string;tipo:'receita'|'despesa';data_prevista:string;data_pagamento?:string;valor_previsto:number|null;valor_real?:number;status:string;valor_variavel:boolean;periodicidade?:string};
export type RecurrenceSummary={proximos:Payment[];historico:{recorrencia_id:string;nome:string;tipo:string;valor_variavel:boolean;ocorrencias:number;media_real:number;minimo_real:number;maximo_real:number;variacao_acumulada:number}[]};
export type Card={id:string;nome:string;banco?:string;limite:number|null;dia_fechamento?:number;dia_vencimento?:number;comprometido:number;disponivel:number|null};
export type Goal={id:string;nome:string;valor_objetivo:number;valor_atual:number;data_limite?:string;status:string;conta_id?:string;conta_nome?:string};
export type Investment={id:string;nome:string;tipo:string;instituicao?:string;valor_investido:number;valor_atual:number;data_aplicacao?:string;data_vencimento?:string;rentabilidade?:number;conta_id?:string;conta_nome?:string};
export type InvestmentSummary={quantidade:number;investido:number;atual:number;ganho:number};
export type Debt={id:string;nome:string;credor?:string;tipo:string;valor_original:number;saldo_devedor:number;parcela_atual?:number|null;parcelas_restantes?:number|null;taxa_mensal?:number|null;data_inicio?:string;data_fim_prevista?:string;observacao?:string};
export type GoalPlanning={premissas:{media_entradas:number;media_saidas:number;capacidade_mensal_atual:number;conservador:number;acelerado:number;patrimonio_atual:number};metas:any[];patrimonio_projetado:{mes:string;patrimonio_projetado:number}[]};
export type AgendaEvent={id:string;data:string;titulo:string;tipo:string;origem:string;status:string;valor:number|null};
export type NotificationItem={id:string;categoria:string;prioridade:string;titulo:string;mensagem:string;data:string;status:string;acao:string};
export type FinancialIntelligence={periodo_meses:number;meses:any[];medias:{entradas:number;saidas:number;capacidade:number};patrimonio:{contas:number;investimentos:number;total:number;ganho_investimentos:number};metas:any[];cenarios:any[];proximos30:any[];categorias:any[];padroes:any[];notas:string[]};
export type ReportSummary={periodo_meses:number;atual:{entradas:number;saidas:number;resultado:number;quantidade:number};tendencia:{mes:string;entradas:number;saidas:number;resultado:number;quantidade:number}[];categorias:{categoria:string;total:number;quantidade:number}[];contas:any[];cartoes:any[];metas:any[]};
export type Dashboard={balance:number;month:{income:number;expense:number};trend:{mes:string;income:number;expense:number}[];categories:{categoria:string;total:number}[];accounts:Account[];upcoming:Payment[];goals:Goal[];insights:any[];intelligence?:{projected_month:{income:number;expense:number;result:number};projected_30_days_balance:number;averages:{monthly_income:number;monthly_expense:number};next_30_days:{income:number;expense:number;count:number};savings_rate:number;category_signals:{categoria:string;atual:number;media_anterior:number;variacao:number;sinal:string|null}[];notes:string[]}};

let csrfToken:string|null=null;
async function csrf(){if(csrfToken)return csrfToken;const r=await fetch(`${API_URL}/auth/csrf`,{credentials:'include'});if(!r.ok)throw new Error('Não foi possível preparar a sessão segura');const data=await r.json();csrfToken=data.token;return csrfToken;}
async function request<T>(path:string,options:RequestInit={}){const method=(options.method??'GET').toUpperCase();const headers=new Headers(options.headers);if(method!=='GET'&&method!=='HEAD')headers.set('Content-Type','application/json');if(method!=='GET'&&method!=='HEAD'&&!path.startsWith('/auth/login')&&!path.startsWith('/auth/register'))headers.set('X-CSRF-Token',await csrf());const r=await fetch(`${API_URL}${path}`,{...options,headers,credentials:'include'});if(r.status===401){csrfToken=null;}if(!r.ok){let msg=`Erro ${r.status}`;try{msg=(await r.json()).message??msg}catch{}throw new Error(msg)}return r.json() as Promise<T>}
async function requestBlob(path:string,body?:any){const headers=new Headers();headers.set('Content-Type','application/json');headers.set('X-CSRF-Token',await csrf());const r=await fetch(`${API_URL}${path}`,{method:'POST',headers,body:JSON.stringify(body??{}),credentials:'include'});if(!r.ok){let msg=`Erro ${r.status}`;try{msg=(await r.json()).message??msg}catch{}throw new Error(msg)}return r.blob();}
const post=(path:string,d?:any)=>request<any>(path,{method:'POST',body:d===undefined?undefined:JSON.stringify(d)});
export const api={
 register:async(d:any)=>{csrfToken=null;return post('/auth/register',d)},
 login:async(d:any)=>{csrfToken=null;return post('/auth/login',d)},
 verifyMfaLogin:(d:any)=>post('/auth/mfa/verify',d),
 logout:async()=>{const r=await post('/auth/logout');csrfToken=null;return r},
 me:()=>request<User>('/auth/me'),
 sessions:()=>request<SecuritySession[]>('/auth/sessoes'),
 revokeSession:(id:string)=>request(`/auth/sessoes/${id}`,{method:'DELETE'}),
 revokeOtherSessions:()=>post('/auth/sessoes/revogar-outras'),
 mfaStatus:()=>request<any>('/auth/mfa'),
 startMfa:(password:string)=>post('/auth/mfa/iniciar',{password}),
 confirmMfa:(code:string)=>post('/auth/mfa/confirmar',{code}),
 disableMfa:(d:any)=>post('/auth/mfa/desativar',d),
 changePassword:(d:any)=>post('/auth/senha',d),
 audit:()=>request<AuditEvent[]>('/auth/auditoria'),
 exportData:(d:any)=>requestBlob('/auth/exportar-dados',d),
 deleteAccount:(d:any)=>post('/auth/excluir-conta',d),
 privacy:()=>request<any>('/privacidade'),
 acceptPrivacy:(d:any)=>post('/privacidade/consentimento',d),
 privacyRequest:(d:any)=>post('/privacidade/solicitacoes',d),
 recoverPassword:(email:string)=>post('/auth/recuperar-senha',{email}),
 resetPassword:(d:any)=>post('/auth/redefinir-senha',d),
 setMascot:(mascote_id:string)=>request<User>('/auth/mascote',{method:'PATCH',body:JSON.stringify({mascote_id})}),
 dashboard:()=>request<Dashboard>('/dashboard'),reports:(meses=12)=>request<ReportSummary>(`/relatorios/resumo?meses=${meses}`),intelligence:()=>request<FinancialIntelligence>('/inteligencia/resumo'),accounts:()=>request<Account[]>('/contas'),categories:()=>request<Category[]>('/categorias'),transactions:()=>request<Transaction[]>('/lancamentos'),launchSuggestions:(q:string,tipo:string)=>request<any>(`/lancamentos/sugestoes?q=${encodeURIComponent(q)}&tipo=${encodeURIComponent(tipo)}`),createTransaction:(d:any)=>post('/lancamentos',d),
 recurrences:()=>request<Recurrence[]>('/recorrencias'),recurrenceSummary:()=>request<RecurrenceSummary>('/recorrencias/resumo'),createRecurrence:(d:any)=>post('/recorrencias',d),payments:()=>request<Payment[]>('/pagamentos'),confirmPayment:(id:string,d:any)=>post(`/pagamentos/${id}/confirmar`,d),
 createAccount:(d:any)=>post('/contas',d),updateAccount:(id:string,d:any)=>request<Account>(`/contas/${id}`,{method:'PATCH',body:JSON.stringify(d)}),
 cards:()=>request<Card[]>('/cartoes'),createCard:(d:any)=>post('/cartoes',d),cardPurchases:(id:string)=>request<any[]>(`/cartoes/${id}/compras`),cardInvoice:(id:string,mes:string)=>request<any>(`/cartoes/${id}/fatura?mes=${encodeURIComponent(mes)}`),previewCardPurchase:(d:any)=>post('/cartoes/compras/preview',d),createCardPurchase:(d:any)=>post('/cartoes/compras',d),
 investments:()=>request<Investment[]>('/investimentos'),investmentSummary:()=>request<InvestmentSummary>('/investimentos/resumo'),debts:()=>request<Debt[]>('/dividas'),debtSummary:()=>request<any>('/dividas/resumo'),createDebt:(d:any)=>post('/dividas',d),updateDebt:(id:string,d:any)=>request<Debt>(`/dividas/${id}`,{method:'PATCH',body:JSON.stringify(d)}),deleteDebt:(id:string,d:any)=>request(`/dividas/${id}`,{method:'DELETE',body:JSON.stringify(d)}),createInvestment:(d:any)=>post('/investimentos',d),updateInvestment:(id:string,d:any)=>request<Investment>(`/investimentos/${id}`,{method:'PATCH',body:JSON.stringify(d)}),deleteInvestment:(id:string,d:any)=>request(`/investimentos/${id}`,{method:'DELETE',body:JSON.stringify(d)}),goals:()=>request<Goal[]>('/metas'),goalPlanning:()=>request<GoalPlanning>('/metas/planejamento'),createGoal:(d:any)=>post('/metas',d),contributeGoal:(id:string,d:any)=>post(`/metas/${id}/aportar`,d),
 uploadDocument:async(file:File,pagamentoId?:string)=>{const token=await csrf();const fd=new FormData();fd.append('file',file);if(pagamentoId)fd.append('pagamento_id',pagamentoId);const r=await fetch(`${API_URL}/anexos/upload`,{method:'POST',headers:{'X-CSRF-Token':token},body:fd,credentials:'include'});if(!r.ok){let msg=`Erro ${r.status}`;try{msg=(await r.json()).message??msg}catch{}throw new Error(msg)}return r.json()},analyzeDocument:(id:string)=>request<any>(`/documentos/analise/${id}`), insights:()=>request<{suggestions:any[]}>('/insights'),memory:()=>request<any[]>('/memoria'),
 agenda:(inicio:string,fim:string)=>request<{inicio:string;fim:string;eventos:AgendaEvent[]}>(`/agenda?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`),
 notifications:()=>request<{total:number;notificacoes:NotificationItem[]}>('/notificacoes'),
 notificationPreferences:()=>request<any>('/notificacoes/preferencias'),
 saveNotificationPreferences:(d:any)=>request<any>('/notificacoes/preferencias',{method:'PATCH',body:JSON.stringify(d)}),
 assistantInsights:()=>request<any>('/assistente/insights'),assistantHistory:()=>request<any>('/assistente/historico'),assistantAsk:(pergunta:string)=>post<any>('/assistente/perguntar',{pergunta})
};
