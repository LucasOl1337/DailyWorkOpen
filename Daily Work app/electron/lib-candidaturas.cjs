const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { DatabaseSync } = require('node:sqlite')
const execFileAsync = promisify(execFile)

const PADRAO = { termos: 'Software Engineer, Full Stack, AI Engineer', area: 'ambas', modalidade: 'remoto', localidade: 'Brasil', origem: 'qualquer', senioridades: [], contratacoes: [], salarioMin: null, salarioMax: null, moeda: 'BRL', periodo: 'mes', aceitarSemSalario: true, idioma: 'auto', excluirEmpresas: [], meta: 60, minutos: 120, perfil: 'krocodile', executor: 'nativo' }
const ATIVAS = ['iniciando', 'executando']
const ESTADOS_EM_ANDAMENTO = new Set(['reservada','preenchendo','pronta','enviando','a_verificar'])
const ESTADOS_IMPEDIDOS = new Set(['aguardando_dado','aguardando_acesso'])
function erro(codigo, mensagem, status = 400) { return Object.assign(new Error(mensagem), { codigo, status }) }
function exigir(ok, mensagem, codigo = 'ENTRADA_INVALIDA') { if (!ok) throw erro(codigo, mensagem) }
function texto(v, limite = 500) { exigir(typeof v === 'string' && v.trim().length > 0 && v.length <= limite, 'Texto ausente ou extenso demais.'); return v.trim() }
function validarCampos(campos) {
  exigir(Array.isArray(campos) && campos.length <= 150, 'Respostas inválidas.')
  return campos.map(f => {
    const pergunta = texto(f.pergunta, 1000)
    exigir(!/(senha|password|one.time.password|cpf|passaporte|cart[aã]o de cr[eé]dito)/i.test(pergunta), 'Não registre credenciais ou identificadores sensíveis.')
    return { pergunta, resposta: typeof f.resposta === 'boolean' ? String(f.resposta) : texto(f.resposta, 12000), fonte: texto(f.fonte, 1000) }
  })
}
function id() { return crypto.randomUUID() }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
function diaSaoPaulo(valor) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(valor)) }
function contagemPeriodo(candidaturas, aceita) {
  const mudou = c => aceita(c.atualizadaEm || c.criadaEm)
  return {
    selecionadas: candidaturas.filter(c=>aceita(c.criadaEm)).length,
    confirmadas: candidaturas.filter(c=>c.confirmacao?.em&&aceita(c.confirmacao.em)).length,
    emAndamento: candidaturas.filter(c=>ESTADOS_EM_ANDAMENTO.has(c.estado)&&mudou(c)).length,
    impedidas: candidaturas.filter(c=>ESTADOS_IMPEDIDOS.has(c.estado)&&mudou(c)).length,
    descartadas: candidaturas.filter(c=>c.estado==='descartada'&&mudou(c)).length,
  }
}
function progressoDaMissao(candidaturas, supervisor, agora) {
  const dia=diaSaoPaulo(agora),inicio=Date.parse(supervisor?.iniciadoEm||'')
  const hoje=valor=>diaSaoPaulo(valor)===dia
  const execucao=valor=>{const ts=Date.parse(valor||'');return Number.isFinite(inicio)&&Number.isFinite(ts)&&ts>=inicio}
  const total={selecionadas:candidaturas.length,confirmadas:candidaturas.filter(c=>c.estado==='confirmada').length,emAndamento:candidaturas.filter(c=>ESTADOS_EM_ANDAMENTO.has(c.estado)).length,impedidas:candidaturas.filter(c=>ESTADOS_IMPEDIDOS.has(c.estado)).length,descartadas:candidaturas.filter(c=>c.estado==='descartada').length}
  const atividade=supervisor?.atividadeAtual&&typeof supervisor.atividadeAtual==='object'?supervisor.atividadeAtual:null
  const candidatura=atividade?.candidaturaId?candidaturas.find(c=>c.id===atividade.candidaturaId):null
  return {hoje:contagemPeriodo(candidaturas,hoje),execucao:contagemPeriodo(candidaturas,execucao),total,
    atividadeAtual:atividade?{ferramenta:String(atividade.ferramenta||''),acao:String(atividade.acao||''),em:atividade.em||supervisor.atualizadoEm,candidatura:candidatura?{id:candidatura.id,empresa:candidatura.empresa,cargo:candidatura.cargo,estado:candidatura.estado,proximaAcao:candidatura.proximaAcao}:null}:null,
    eventosRecentes:Array.isArray(supervisor?.eventosRecentes)?supervisor.eventosRecentes.slice(-12).map(e=>({ferramenta:String(e.ferramenta||''),acao:String(e.acao||''),em:e.em})):[]}
}
function salvarArquivo(p, dados) { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, dados, { mode: 0o600, flag: 'wx' }) }
function chaveVaga(entrada) {
  const u = new URL(texto(entrada, 2000))
  exigir(u.protocol === 'https:' && !u.username && !u.password, 'Use uma URL HTTPS de vaga.')
  const linkedin = u.hostname.endsWith('.linkedin.com') || u.hostname === 'linkedin.com'
  const jobId = linkedin && (u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || u.searchParams.get('currentJobId'))
  if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}`
  if (u.hostname === 'jobs.ashbyhq.com') u.pathname = u.pathname.replace(/^(\/[^/]+\/[0-9a-f-]{36})\/application\/?$/i, '$1')
  if (u.hostname === 'job-boards.greenhouse.io') u.pathname = u.pathname.replace(/^(\/[^/]+\/jobs\/\d+)\/confirmation\/?$/, '$1')
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|trk|tracking|ref|source)/i.test(key)) u.searchParams.delete(key)
  u.hash = ''; u.hostname = u.hostname.toLowerCase(); u.pathname = u.pathname.replace(/\/$/, '') || '/'; u.searchParams.sort()
  return u.toString()
}
function parseLocalidades(valor) {
  const v = (valor || '').trim()
  if (!v || /^(sem restri[cç][aã]o|qualquer|qualquer pa[ií]s|sem restri[cç][aã]o por pa[ií]s)$/i.test(v)) {
    return { brasil: false, eua: false, ue: false, semRestricao: true, outros: '' }
  }
  const partes = v.split(/[,;]/).map(s => s.trim()).filter(Boolean)
  let brasil = false, eua = false, ue = false, semRestricao = false
  const outrosList = []
  for (const p of partes) {
    if (/^(brasil|brazil)$/i.test(p)) brasil = true
    else if (/^(estados unidos|eua|usa|united states)$/i.test(p)) eua = true
    else if (/^(pa[ií]ses da uni[aã]o europ[eé]ia|pa[ií]ses da uni[aã]o europeia|uni[aã]o europ[eé]ia|uni[aã]o europeia|ue|eu|european union)$/i.test(p)) ue = true
    else if (/^(sem restri[cç][aã]o|qualquer|qualquer pa[ií]s|sem restri[cç][aã]o por pa[ií]s)$/i.test(p)) semRestricao = true
    else outrosList.push(p)
  }
  if (semRestricao || (!brasil && !eua && !ue && outrosList.length === 0)) {
    return { brasil: false, eua: false, ue: false, semRestricao: true, outros: '' }
  }
  return { brasil, eua, ue, semRestricao: false, outros: outrosList.join(', ') }
}
function serializeLocalidades(p) {
  if (p.semRestricao) return 'Sem restrição por país'
  const lista = []
  if (p.brasil) lista.push('Brasil')
  if (p.eua) lista.push('Estados Unidos')
  if (p.ue) lista.push('Países da União Europeia')
  if (p.outros && p.outros.trim()) lista.push(p.outros.trim())
  if (lista.length === 0) return 'Sem restrição por país'
  return lista.join(', ')
}
function validarConfig(entrada = {}) {
  exigir(entrada && typeof entrada === 'object' && !Array.isArray(entrada), 'Critérios inválidos.')
  const c = { ...PADRAO, ...entrada }
  for (const k of Object.keys(c)) exigir(Object.hasOwn(PADRAO, k), `Critério desconhecido: ${k}`)
  if (Array.isArray(c.localidade)) {
    c.localidade = c.localidade.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean).join(', ')
  }
  if (!c.localidade || (typeof c.localidade === 'string' && !c.localidade.trim())) {
    c.localidade = 'Sem restrição por país'
  }
  c.termos = texto(c.termos, 1000); c.localidade = texto(c.localidade, 200); c.perfil = texto(c.perfil, 80)
  exigir(['ambas','software','ai'].includes(c.area) && ['remoto','hibrido','presencial','qualquer'].includes(c.modalidade), 'Área ou modalidade inválida.')
  exigir(['qualquer','ats_externo','linkedin_easy_apply'].includes(c.origem), 'Origem da candidatura inválida.')
  exigir(['auto','pt','en'].includes(c.idioma) && ['BRL','USD','EUR'].includes(c.moeda) && ['mes','ano','hora'].includes(c.periodo), 'Idioma, moeda ou período inválido.')
  exigir(['nativo','codex'].includes(c.executor), 'Executor inválido.')
  for (const k of ['senioridades','contratacoes','excluirEmpresas']) { exigir(Array.isArray(c[k]) && c[k].length <= 50, `Lista inválida: ${k}`); c[k] = c[k].filter(v => typeof v !== 'string' || v.trim()).map(v => texto(v, 150)) }
  for (const k of ['salarioMin','salarioMax']) exigir(c[k] === null || (typeof c[k] === 'number' && Number.isFinite(c[k]) && c[k] >= 0), 'Faixa salarial inválida.')
  exigir(c.salarioMin === null || c.salarioMax === null || c.salarioMin <= c.salarioMax, 'O mínimo salarial deve ser menor ou igual ao máximo.')
  exigir(Number.isSafeInteger(c.meta) && c.meta >= 1 && Number.isInteger(c.minutos) && c.minutos >= 5 && c.minutos <= 240, 'Use uma meta diária positiva e duração de 5–240 minutos.')
  exigir(typeof c.aceitarSemSalario === 'boolean', 'Indique se aceita vagas sem salário divulgado.')
  return c
}
function normalizarPergunta(v) { return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,' ').trim().toLowerCase() }
function respostaPendente(v) { return /(^|\b)(ausente|pendente|n[aã]o dispon[ií]vel|nao disponivel|not available)/i.test(String(v||'')) }
// Perguntas presas: primeiro os campos marcados como ausentes; quando o executor só
// descreveu o impedimento em proximaAcao, extrai as perguntas do texto ("pede X, Y e Z").
function perguntasPendentes(c) {
  const marcadas=(c.campos||[]).filter(f=>respostaPendente(f.resposta)).map(f=>f.pergunta)
  if(marcadas.length)return marcadas
  const texto=String(c.proximaAcao||'')
  const entreParenteses=[...texto.matchAll(/\(([^()]{8,}\?)\)/g)].map(m=>m[1].trim())
  if(entreParenteses.length)return entreParenteses
  const pede=texto.replace(/\s*\([^()]*\)/g,'').match(/\bpede\s+(.+?)(?=\s+sem fonte|\.\s|;|$)/i)
  if(!pede)return []
  // Separa por vírgula; o " e " final só divide quando os dois lados são frases (≥2 palavras),
  // para não quebrar "SOLID e sistemas distribuídos".
  const partes=pede[1].split(/,\s*/).flatMap(parte=>{const i=parte.lastIndexOf(' e ');if(i<0)return [parte];const a=parte.slice(0,i).trim(),b=parte.slice(i+3).trim();return a.split(/\s+/).length>=2&&b.split(/\s+/).length>=2?[a,b]:[parte]})
  return partes.map(v=>v.trim()).filter(v=>v.length>=4&&v.length<=160)
}
const CAUSAS_ACESSO = [
  ['linkedin_limite', /limite di[aá]rio|daily limit|limite de candidatura simplificada|easy apply.*(limit|limite)/i, 'Limite diário de Candidatura simplificada do LinkedIn', 'Nenhuma ação sua. O agente segue por ATS externos e o LinkedIn libera de novo amanhã.', true],
  ['captcha', /captcha|verifica[cç][aã]o humana|prove you are human/i, 'CAPTCHA no destino', 'Abra a bancada (Observar agente), resolva o CAPTCHA e clique Reabrir na vaga.', false],
  ['login', /senha|password|sign in|sign-in|login|log in|sso|otp|c[oó]digo de verifica/i, 'Login ou senha exigidos por um ATS', 'Entre nesse ATS na bancada (Observar agente) com a conta profissional e clique Reabrir na vaga.', false],
  ['outro', /./, 'Bloqueio de acesso', 'Confira o motivo na vaga; se resolver na bancada, clique Reabrir.', false],
]
function causaAcesso(c) { const texto=`${c.proximaAcao||''}`; return CAUSAS_ACESSO.find(([,re])=>re.test(texto)) }
// Agrupa o que realmente depende de você: perguntas sem fonte e bloqueios de acesso, cada
// um com a ação humana concreta. Limite de plataforma entra como aviso, não como tarefa.
function pendenciasHumanas(candidaturas, agora, resolver=()=>null) {
  const dia=diaSaoPaulo(agora), recentes=candidaturas.filter(c=>diaSaoPaulo(c.atualizadaEm||c.criadaEm)===dia||ESTADOS_IMPEDIDOS.has(c.estado)&&diaSaoPaulo(c.criadaEm)===dia)
  const perguntas=new Map()
  for(const c of recentes.filter(c=>c.estado==='aguardando_dado')){
    const lista=perguntasPendentes(c)
    // Pergunta já respondida sai da lista; a vaga só reabre quando todas as dela tiverem resposta.
    const abertas=lista.filter(q=>!resolver(q)), total=lista.length
    const chaves=lista.length?abertas:[c.proximaAcao]
    for(const pergunta of chaves){const chave=normalizarPergunta(pergunta).slice(0,400);if(!chave)continue;const item=perguntas.get(chave)||{pergunta,candidaturas:[],respondivel:lista.length>0};item.candidaturas.push({id:c.id,empresa:c.empresa,cargo:c.cargo,restantes:abertas.length,total});perguntas.set(chave,item)}
  }
  const acessos=new Map()
  for(const c of recentes.filter(c=>c.estado==='aguardando_acesso')){
    const [codigo,,titulo,acao,automatica]=causaAcesso(c)
    const item=acessos.get(codigo)||{codigo,titulo,acao,automatica,candidaturas:[]}
    item.candidaturas.push({id:c.id,empresa:c.empresa,cargo:c.cargo,motivo:c.proximaAcao});acessos.set(codigo,item)
  }
  return {perguntas:[...perguntas.values()].sort((a,b)=>b.candidaturas.length-a.candidaturas.length),acessos:[...acessos.values()]}
}
const DIAGNOSTICOS = [
  ['REINICIO', /coordenador n[aã]o est[aá] respondendo|DailyWork (foi )?reiniciad|processo do executor terminou/i, 'O DailyWork reiniciou no meio da rodada', 'Nada a corrigir. A agenda retoma sozinha; se preferir, clique Retomar missão.', true],
  ['CONTROLE', /CONTROLE_HUMANO|controle da bancada|bancada está com você|devolu[cç][aã]o do controle/i, 'A bancada está com você', 'Devolva o controle no painel da bancada ou volte ao workspace 1–5. Observar só acompanha; Assumir é que pausa o agente. A missão segue depois da devolução.', false],
  ['CHROMIUM', /chromium|conex[aã]o (ausente|do navegador)|DevToolsActivePort|connectOverCDP|NAVEGADOR_INDISPONIVEL|CHROMIUM_/i, 'Chromium da bancada indisponível', 'Clique Observar agente para abrir a bancada dailywork-candidaturas e confira se o Chromium está aberto. A missão continua sozinha quando a conexão volta.', false],
  ['SEM_PROGRESSO', /sem progresso/i, 'O agente rodou ciclos sem registrar ação', 'Abra Critérios e diagnóstico técnico, leia o checkpoint e clique Retomar missão. Se a busca estiver esgotada, troque a busca e inicie uma nova missão.', false],
  ['PRAZO', /janela|prazo|limite de ciclos|TEMPO_ESGOTADO/i, 'A janela de tempo da missão terminou', 'Clique Retomar missão para abrir nova janela, ou Executar agora até completar a meta.', false],
  ['MODELO', /9router|grok|modelo|provedor|LIMITE_|rate limit|token/i, 'O provedor de IA falhou', 'Confira o 9Router e o modelo em Agente; depois clique Retomar missão.', false],
  ['EXECUTOR', /codex/i, 'Executor indisponível', 'Use o executor nativo em Retomar missão.', false],
]
function diagnosticoDaMissao(m, supervisor, candidaturas=[]) {
  if(ATIVAS.includes(m.estado)){
    if(supervisor?.estado==='aguardando_controle')return {codigo:'CONTROLE',titulo:'Aguardando a devolução da bancada',acao:'Devolva o controle no painel da bancada ou volte ao workspace 1–5. Nenhuma chamada ao modelo até o agente recuperar o controle.',automatica:true}
    if(supervisor?.estado==='aguardando_conexao')return {codigo:'CHROMIUM',titulo:'Aguardando o Chromium da bancada',acao:'Clique Observar agente e confira o Chromium da bancada. Nenhuma chamada ao modelo até a conexão voltar.',automatica:true}
    if(supervisor?.fontesEsgotadas?.linkedinEasyApply)return {codigo:'LINKEDIN_ESGOTADO',titulo:'LinkedIn Easy Apply esgotado por hoje',acao:'Nenhuma ação sua. O agente segue por vagas com formulário externo e ATS.',automatica:true}
    return null
  }
  if(['concluida','encerrada','pausada'].includes(m.estado))return null
  const motivo=m.motivo||supervisor?.erro||''
  const codigo=m.interrupcao?.codigo||''
  if(/COORDENADOR|PROCESSO_TERMINOU/.test(codigo)||DIAGNOSTICOS[0][1].test(motivo))return {codigo:'REINICIO',titulo:DIAGNOSTICOS[0][2],acao:DIAGNOSTICOS[0][3],automatica:true,motivo}
  if(/CONTROLE_HUMANO/.test(codigo)||DIAGNOSTICOS[1][1].test(motivo))return {codigo:'CONTROLE',titulo:DIAGNOSTICOS[1][2],acao:DIAGNOSTICOS[1][3],automatica:false,motivo}
  if(/CHROMIUM_|BANCADA_INDISPONIVEL|NAVEGADOR_INDISPONIVEL/.test(codigo)||DIAGNOSTICOS[2][1].test(motivo))return {codigo:'CHROMIUM',titulo:DIAGNOSTICOS[2][2],acao:DIAGNOSTICOS[2][3],automatica:false,motivo}
  // Um guard genérico de falta de progresso não deve esconder o bloqueio que
  // realmente parou a fila. Mostre primeiro a ação humana concreta da vaga.
  const acessoHumano=candidaturas
    .filter(c=>c.estado==='aguardando_acesso')
    .map(c=>causaAcesso(c))
    .find(causa=>causa&&!causa[4])
  if(acessoHumano){const [causaCodigo,,titulo,acao]=acessoHumano;return {codigo:'ACESSO',causa:causaCodigo,titulo,acao,automatica:false,motivo}}
  for(const [c,re,titulo,acao,automatica] of DIAGNOSTICOS.slice(3))if(re.test(codigo)||re.test(motivo))return {codigo:c,titulo,acao,automatica,motivo}
  const impedidas=candidaturas.filter(c=>ESTADOS_IMPEDIDOS.has(c.estado)).length
  return {codigo:'OUTRO',titulo:m.estado==='interrompida'?'Rodada interrompida':'Missão parada',acao:impedidas?`Há ${impedidas} vaga(s) impedidas listadas abaixo com a ação necessária. Depois clique Retomar missão ou inicie uma nova busca.`:'Clique Retomar missão para continuar de onde parou, ou troque a busca e inicie uma nova missão.',automatica:false,motivo}
}
function criarRespostasRecorrentes(privateDir) {
  const arquivo=path.join(privateDir,'respostas-recorrentes.json')
  const ler=()=>{try{const v=JSON.parse(fs.readFileSync(arquivo,'utf8'));return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{return {}}}
  return {
    arquivo,
    listar(){return Object.values(ler()).sort((a,b)=>Date.parse(b.em)-Date.parse(a.em))},
    gravar(pergunta,resposta){
      const p=texto(pergunta,1000),r=typeof resposta==='boolean'?String(resposta):texto(resposta,4000)
      exigir(!/(senha|password|one.time.password|cpf|passaporte|cart[aã]o de cr[eé]dito)/i.test(p),'Não registre credenciais ou identificadores sensíveis.')
      const chave=normalizarPergunta(p);exigir(chave.length>=3,'Pergunta curta demais.')
      const todas=ler();todas[chave]={pergunta:p,resposta:r,em:new Date().toISOString()}
      fs.mkdirSync(privateDir,{recursive:true,mode:0o700});fs.writeFileSync(arquivo+'.tmp',JSON.stringify(todas,null,2),{mode:0o600});fs.renameSync(arquivo+'.tmp',arquivo)
      return todas[chave]
    },
    remover(pergunta){const todas=ler();delete todas[normalizarPergunta(pergunta)];fs.writeFileSync(arquivo,JSON.stringify(todas,null,2),{mode:0o600})},
    resolver(pergunta){
      const chave=normalizarPergunta(pergunta);if(!chave)return null
      const todas=ler();const exata=todas[chave]
      const achada=exata||Object.values(todas).find(v=>{const k=normalizarPergunta(v.pergunta);return k.length>=12&&chave.length>=12&&(chave.includes(k)||k.includes(chave))})
      return achada?{valor:achada.resposta,resposta:achada.resposta,pergunta:achada.pergunta,fonte:`Resposta recorrente informada pelo titular em ${diaSaoPaulo(achada.em)}`,justificativa:'Resposta fixa do titular para esta pergunta.',confianca:'alta'}:null
    },
  }
}
function criarServicoCandidaturas(opcoes = {}) {
  const repoRoot = opcoes.repoRoot || path.resolve(__dirname, '../..')
  const privateDir = opcoes.privateDir || path.join(repoRoot, 'LucasOL/Private/candidaturas')
  const now = opcoes.now || (() => new Date().toISOString())
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 }); fs.chmodSync(privateDir, 0o700)
  const banco = path.join(privateDir, 'estado.sqlite')
  const db = new DatabaseSync(banco); fs.chmodSync(banco, 0o600)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS preferencias (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS missoes (id TEXT PRIMARY KEY, estado TEXT NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS unica_ativa ON missoes((1)) WHERE estado IN ('iniciando','executando');
    CREATE TABLE IF NOT EXISTS candidaturas (id TEXT PRIMARY KEY, missao_id TEXT NOT NULL REFERENCES missoes(id), chave TEXT UNIQUE NOT NULL, estado TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS aliases (chave TEXT PRIMARY KEY, candidatura_id TEXT NOT NULL REFERENCES candidaturas(id));
    CREATE TABLE IF NOT EXISTS evidencias (id TEXT PRIMARY KEY, candidatura_id TEXT NOT NULL REFERENCES candidaturas(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, missao_id TEXT NOT NULL, candidatura_id TEXT, tipo TEXT NOT NULL, data TEXT NOT NULL);`)
  function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r=fn(); db.exec('COMMIT'); return r } catch(e) { db.exec('ROLLBACK'); throw e } }
  function ler(tabela, identificador) { const row=db.prepare(`SELECT data FROM ${tabela} WHERE id=?`).get(identificador); if(!row)throw erro('NAO_ENCONTRADO','Registro não encontrado.',404); return JSON.parse(row.data) }
  function gravar(tabela, v) { db.prepare(`UPDATE ${tabela} SET estado=?, data=? WHERE id=?`).run(v.estado,JSON.stringify(v),v.id); return v }
  function evento(missaoId, candidaturaId, tipo, dados={}) { db.prepare('INSERT INTO eventos(missao_id,candidatura_id,tipo,data) VALUES(?,?,?,?)').run(missaoId,candidaturaId,tipo,JSON.stringify({em:now(),...dados})) }
  function config() { const row=db.prepare('SELECT data FROM preferencias WHERE id=1').get(); return row ? {...PADRAO,...JSON.parse(row.data)} : {...PADRAO} }
  function lista(tabela) { return db.prepare(`SELECT data FROM ${tabela} ORDER BY rowid DESC LIMIT 500`).all().map(r=>JSON.parse(r.data)) }
  function listarCandidaturas() { return db.prepare("SELECT c.data,(SELECT e.data FROM eventos e WHERE e.candidatura_id=c.id ORDER BY e.id DESC LIMIT 1) AS ultimo FROM candidaturas c ORDER BY c.rowid DESC LIMIT 500").all().map(r=>{const c=JSON.parse(r.data);try{c.atualizadaEm=JSON.parse(r.ultimo).em}catch{}return c}) }
  function obter(identificador) { const c=ler('candidaturas',identificador); return {...c,evidencias:db.prepare('SELECT data FROM evidencias WHERE candidatura_id=? ORDER BY rowid').all(identificador).map(r=>JSON.parse(r.data)),eventos:db.prepare('SELECT tipo,data FROM eventos WHERE candidatura_id=? ORDER BY id').all(identificador).map(r=>({tipo:r.tipo,...JSON.parse(r.data)}))} }
  function missao(identificador) { const m=ler('missoes',identificador); return {...m,candidaturas:db.prepare('SELECT data FROM candidaturas WHERE missao_id=? ORDER BY rowid').all(identificador).map(r=>JSON.parse(r.data)),eventos:db.prepare('SELECT tipo,data FROM eventos WHERE missao_id=? ORDER BY id').all(identificador).map(r=>({tipo:r.tipo,...JSON.parse(r.data)}))} }
  function autorizar(missaoId) { const m=ler('missoes',missaoId); if(m.agenda)require('./agenda/guarda.cjs').conferir(m.agenda); exigir(ATIVAS.includes(m.estado),'A missão está pausada ou encerrada.','MISSAO_PAUSADA'); exigir(Date.parse(now()) < Date.parse(m.limite),'A janela desta missão terminou.','TEMPO_ESGOTADO'); exigir(m.confirmadas < m.criterios.meta,'Meta de confirmações atingida.','META_ATINGIDA'); return m }
  function iniciar(entrada={}) {
    exigir(!opcoes.desabilitarExecucao,'Envios não estão habilitados no ambiente de captura.','EXECUCAO_DESABILITADA')
    reconciliar()
    const criterios=validarConfig(entrada.criterios || config())
    const m=tx(()=>{exigir(!db.prepare("SELECT id FROM missoes WHERE estado IN ('iniciando','executando')").get(),'Já existe uma missão em andamento.','MISSAO_ATIVA');const v={id:id(),estado:'iniciando',agenda:entrada.agenda||null,criterios,criadaEm:now(),limite:new Date(Date.parse(now())+criterios.minutos*60000).toISOString(),confirmadas:0,motivo:null,execucao:null};db.prepare('INSERT INTO missoes VALUES(?,?,?)').run(v.id,v.estado,JSON.stringify(v));evento(v.id,null,'missao_criada',{criterios});return v})
    return disparar(m)
  }
  function disparar(m) {
    try { const launch=opcoes.launch || require('./candidaturas/executor.cjs').lancarMissao; const processo=launch({missao:m,repoRoot,privateDir}); return tx(()=>{const atual=ler('missoes',m.id);atual.execucao=processo; if(atual.estado==='iniciando')atual.estado='executando';return gravar('missoes',atual)}) }
    catch(e) { return tx(()=>{m.estado='bloqueada';m.motivo=e.message;evento(m.id,null,'executor_indisponivel',{motivo:e.message});return gravar('missoes',m)}) }
  }
  function controlar({id:identificador,acao,motivo,executor,agenda,minutos,metaAdicional,limite}) {
    if(executor!==undefined)exigir(acao==='retomar'&&['nativo','codex'].includes(executor),'Executor inválido para esta ação.')
    if(acao==='retomar')exigir(!opcoes.desabilitarExecucao,'Envios não estão habilitados no ambiente de captura.','EXECUCAO_DESABILITADA')
    reconciliar()
    let reiniciar=false
    let m=tx(()=>{const atual=ler('missoes',identificador);exigir(['pausar','retomar','encerrar','completar_meta'].includes(acao),'Ação inválida.');if(acao==='completar_meta'){
      exigir(Number.isSafeInteger(metaAdicional)&&metaAdicional>0,'Não há saldo diário para executar.','META_ATINGIDA')
      const alvo=atual.confirmadas+metaAdicional
      exigir(alvo>atual.confirmadas,'A missão já atingiu a meta.','META_ATINGIDA')
      if(agenda)atual.agenda=agenda
      atual.criterios.meta=Math.max(atual.criterios.meta,alvo)
      if(limite!==undefined){const fim=Date.parse(limite);exigir(Number.isFinite(fim)&&fim>Date.parse(now()),'Prazo contínuo inválido.');atual.limite=new Date(Math.max(Date.parse(atual.limite),fim)).toISOString()}
      atual.motivo=null;atual.interrupcao=null
      if(!ATIVAS.includes(atual.estado)){exigir(!db.prepare("SELECT id FROM missoes WHERE estado IN ('iniciando','executando')").get(),'Outra missão está ativa.');atual.estado='iniciando';reiniciar=true}
      evento(atual.id,null,'meta_diaria_continuada',{meta:atual.criterios.meta,limite:atual.limite})
    }else{
      if(acao==='pausar'&&['encerrada','concluida'].includes(atual.estado))return atual
      exigir(atual.estado!=='concluida','A missão já atingiu a meta.')
      if(acao==='retomar'){exigir(!ATIVAS.includes(atual.estado),'A missão já está em andamento.');exigir(!db.prepare("SELECT id FROM missoes WHERE estado IN ('iniciando','executando')").get(),'Outra missão está ativa.');if(executor){evento(atual.id,null,'executor_alterado',{anterior:atual.criterios.executor,executor});atual.criterios.executor=executor}if(agenda){atual.agenda=agenda;if(Number.isInteger(minutos)&&minutos>=5&&minutos<=240)atual.criterios.minutos=minutos;if(Number.isInteger(metaAdicional)&&metaAdicional>0)atual.criterios.meta=atual.confirmadas+metaAdicional}atual.estado='iniciando';atual.limite=new Date(Date.parse(now())+atual.criterios.minutos*60000).toISOString();atual.motivo=null;atual.interrupcao=null;reiniciar=true}else{atual.estado=acao==='pausar'?'pausada':'encerrada';atual.motivo=acao==='pausar'?'Pausada pelo usuário.':'Encerrada pelo usuário.'}evento(atual.id,null,acao)
    }return gravar('missoes',atual)})
    if(reiniciar)return disparar(m)
    if(acao==='completar_meta')return m
    ;(opcoes.stop || require('./candidaturas/executor.cjs').pararMissao)(m.execucao)
    if(motivo){m.motivo=texto(motivo,2000);gravar('missoes',m)}
    return m
  }
  function assumir({id:identificador,threadId}) {
    exigir(!opcoes.desabilitarExecucao,'Envios não estão habilitados no ambiente de captura.','EXECUCAO_DESABILITADA')
    const tarefa=texto(threadId,100)
    reconciliar()
    return tx(()=>{
      const m=ler('missoes',identificador)
      exigir(!ATIVAS.includes(m.estado),'Pause o executor atual antes de transferir a execução.','MISSAO_ATIVA')
      exigir(!db.prepare("SELECT id FROM missoes WHERE estado IN ('iniciando','executando')").get(),'Outra missão está ativa.','MISSAO_ATIVA')
      exigir(m.estado!=='concluida'&&m.confirmadas<m.criterios.meta,'Meta de confirmações atingida.','META_ATINGIDA')
      exigir(!m.execucao?.pid||require('./candidaturas/executor.cjs').inicioProcesso(m.execucao.pid)!==m.execucao.inicio,'O processo anterior ainda está ativo.','EXECUTOR_ATIVO')
      evento(m.id,null,'execucao_assumida',{threadId:tarefa,execucaoAnterior:m.execucao})
      m.execucao={tipo:'sessao-codex',threadId:tarefa};m.estado='executando';m.motivo=null
      m.limite=new Date(Date.parse(now())+m.criterios.minutos*60000).toISOString()
      return gravar('missoes',m)
    })
  }
  function reorientar({id:missaoId,criterios}) {
    const preferencias=validarConfig({...config(),...criterios})
    return tx(()=>{
      const m=ler('missoes',missaoId)
      exigir(!['concluida','encerrada'].includes(m.estado),'Esta missão terminou. Salve os critérios para uma nova rodada.')
      const anterior=m.criterios
      // Change the next search, preserving the execution budget, deadline and
      // criteria snapshots already stored on individual applications.
      m.criterios={...preferencias,meta:anterior.meta,minutos:anterior.minutos,perfil:anterior.perfil,executor:anterior.executor}
      m.revisaoBusca=(m.revisaoBusca||0)+1
      db.prepare('INSERT INTO preferencias VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(preferencias))
      evento(m.id,null,'busca_reorientada',{anterior,criterios:m.criterios,revisao:m.revisaoBusca})
      return gravar('missoes',m)
    })
  }
  function executorEstado({missaoId,estado,motivo,codigo}) { return tx(()=>{const m=ler('missoes',missaoId);exigir(['executando','bloqueada','interrompida','finalizada'].includes(estado),'Estado inválido.');if(!ATIVAS.includes(m.estado))return m;m.estado=m.confirmadas>=m.criterios.meta?'concluida':estado;m.motivo=motivo ? texto(motivo,2000):null;m.interrupcao=estado==='executando'?null:{codigo:codigo?texto(codigo,80):null,em:now()};evento(m.id,null,'executor_estado',{estado:m.estado,motivo:m.motivo,codigo:m.interrupcao?.codigo||null});return gravar('missoes',m)}) }
  function reservar(entrada) { return tx(()=>{
    const m=autorizar(entrada.missaoId), chave=chaveVaga(entrada.url)
    const existente=db.prepare('SELECT candidatura_id FROM aliases WHERE chave=?').get(chave) || db.prepare('SELECT id AS candidatura_id FROM candidaturas WHERE chave=?').get(chave)
    exigir(!existente,'Esta vaga já possui candidatura ou reserva no histórico.','DUPLICADA')
    const empresa=texto(entrada.empresa,200), cargo=texto(entrada.cargo,250), q=entrada.qualificacao
    exigir(!m.criterios.excluirEmpresas.some(e=>empresa.toLowerCase().includes(e.toLowerCase())),'Empresa excluída pelos critérios.')
    exigir(q && typeof q==='object','A reserva exige qualificacao com ativa, elegivel, requisitosAtendidos, modalidade e motivo.')
    exigir(q.ativa===true,'qualificacao.ativa deve ser o booleano true; explique a evidência em qualificacao.motivo.')
    exigir(q.elegivel===true,'qualificacao.elegivel deve ser o booleano true; explique a elegibilidade em qualificacao.motivo.')
    exigir(q.requisitosAtendidos===true,'qualificacao.requisitosAtendidos deve ser o booleano true; coloque a lista de requisitos em qualificacao.motivo.')
    exigir(m.criterios.modalidade==='qualquer' || q.modalidade===m.criterios.modalidade,'Modalidade incompatível.')
    for(const [f,l]of [['senioridade','senioridades'],['contratacao','contratacoes']])if(m.criterios[l].length)exigir(m.criterios[l].includes(q[f]),`Critério incompatível: ${f}.`)
    if(q.salario){exigir(q.salario.moeda===m.criterios.moeda && q.salario.periodo===m.criterios.periodo,'Moeda/período do salário exigem conferência.');exigir(Number.isFinite(q.salario.valor)&&q.salario.valor>=0,'Salário inválido.');exigir(m.criterios.salarioMin===null||q.salario.valor>=m.criterios.salarioMin,'Salário abaixo do mínimo.');exigir(m.criterios.salarioMax===null||q.salario.valor<=m.criterios.salarioMax,'Salário fora da faixa.')}else exigir(m.criterios.aceitarSemSalario,'Salário não divulgado; os critérios exigem informação salarial.')
    exigir(['software','ai'].includes(entrada.foco) && (m.criterios.area==='ambas'||m.criterios.area===entrada.foco),'Foco incompatível com a missão.')
    const idioma=m.criterios.idioma==='auto'?entrada.idioma:m.criterios.idioma;exigir(['pt','en'].includes(idioma),'Idioma de currículo inválido.')
    const nome=`${entrada.foco==='ai'?'ai':'software'}-engineer-${idioma}.pdf`,origem=path.join(repoRoot,'LucasOL/Portfolio/curriculos/ativos',nome)
    exigir(fs.existsSync(origem),'Currículo oficial não encontrado.','CV_INDISPONIVEL')
    const pdf=fs.readFileSync(origem);exigir(pdf.subarray(0,5).toString()==='%PDF-','Currículo oficial inválido.')
    const identificador=id(),pasta=path.join(privateDir,'candidaturas',identificador);salvarArquivo(path.join(pasta,nome),pdf);fs.mkdirSync(path.join(pasta,'entrada'),{mode:0o700})
    const c={id:identificador,missaoId:m.id,url:chave,empresa,cargo,estado:'reservada',foco:entrada.foco,idioma,criadaEm:now(),qualificacao:{...q,motivo:texto(q.motivo,3000)},criterios:m.criterios,cv:{nome,sha256:hash(pdf),caminho:path.join(pasta,nome)},campos:[],intencaoEm:null,confirmacao:null,proximaAcao:'Preencher e revisar o formulário.',pastaEntrada:path.join(pasta,'entrada')}
    db.prepare('INSERT INTO candidaturas VALUES(?,?,?,?,?)').run(c.id,m.id,chave,c.estado,JSON.stringify(c));db.prepare('INSERT INTO aliases VALUES(?,?)').run(chave,c.id);evento(m.id,c.id,'reservada',{url:chave,cv:c.cv});return c
  }) }
  function atualizar(entrada) { return tx(()=>{
    const c=ler('candidaturas',entrada.id);autorizar(c.missaoId);exigir(!c.intencaoEm&&!['confirmada','a_verificar','enviando'].includes(c.estado),'Este estado exige conferência, não novo preenchimento.','ESTADO_INVALIDO')
    exigir(['preenchendo','pronta','aguardando_dado','aguardando_acesso','descartada'].includes(entrada.estado),'Estado de formulário inválido.')
    if(entrada.campos)c.campos=validarCampos(entrada.campos)
    if(entrada.alias){const alias=chaveVaga(entrada.alias), anterior=db.prepare('SELECT candidatura_id FROM aliases WHERE chave=?').get(alias);exigir(!anterior||anterior.candidatura_id===c.id,'O destino já está associado a outra candidatura.','DUPLICADA');db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?)').run(alias,c.id)}
    if(entrada.estado==='pronta')exigir(c.campos.length>0&&entrada.anexo===c.cv.nome,'Revise respostas e confirme o nome do PDF anexado.')
    c.estado=entrada.estado;c.proximaAcao=texto(entrada.proximaAcao,2000);c.atualizadaEm=now();evento(c.missaoId,c.id,c.estado,{campos:c.campos,proximaAcao:c.proximaAcao});return gravar('candidaturas',c)
  }) }
  function associarDestino({id:identificador,url}) { return tx(()=>{
    const c=ler('candidaturas',identificador),chave=chaveVaga(url)
    const anterior=db.prepare('SELECT candidatura_id FROM aliases WHERE chave=?').get(chave)
    exigir(!anterior||anterior.candidatura_id===c.id,'O destino já está associado a outra candidatura.','DUPLICADA')
    if(anterior)return c
    autorizar(c.missaoId)
    db.prepare('INSERT INTO aliases VALUES(?,?)').run(chave,c.id)
    evento(c.missaoId,c.id,'destino_associado',{url:chave})
    return c
  }) }
  function complementar({id:identificador,campos}) { return tx(()=>{
    const c=ler('candidaturas',identificador);autorizar(c.missaoId)
    exigir(c.estado==='enviando'&&c.intencaoEm,'Complemento exige inscrição iniciada ainda sem confirmação.','ESTADO_INVALIDO')
    const novos=validarCampos(campos),perguntas=new Set(c.campos.map(f=>f.pergunta))
    exigir(novos.length>0&&c.campos.length+novos.length<=150,'Respostas inválidas.')
    for(const f of novos){exigir(!perguntas.has(f.pergunta),'Não substitua respostas já registradas.');perguntas.add(f.pergunta)}
    c.campos.push(...novos);c.atualizadaEm=now()
    evento(c.missaoId,c.id,'respostas_complementares',{campos:novos})
    return gravar('candidaturas',c)
  }) }
  function intencao({id:identificador}) { return tx(()=>{const c=ler('candidaturas',identificador);autorizar(c.missaoId);exigir(c.estado==='pronta'&&!c.intencaoEm,'Envio já iniciado ou formulário não revisado.','ENVIO_NAO_PERMITIDO');c.estado='enviando';c.intencaoEm=now();c.proximaAcao='Conferir a confirmação no destino antes de repetir qualquer envio.';evento(c.missaoId,c.id,'intencao_envio',{em:c.intencaoEm});return gravar('candidaturas',c)}) }
  function captura(entrada) {
    const c=ler('candidaturas',entrada.id);exigir(['vaga','revisao','confirmacao','falha'].includes(entrada.etapa),'Etapa de captura inválida.')
    const nome=texto(entrada.arquivo,150);exigir(path.basename(nome)===nome&&/\.(png|jpe?g)$/i.test(nome),'Informe somente um nome PNG ou JPEG da pasta de entrada.')
    const origem=path.join(c.pastaEntrada,nome);exigir(fs.existsSync(origem)&&!fs.lstatSync(origem).isSymbolicLink()&&fs.realpathSync(origem).startsWith(fs.realpathSync(c.pastaEntrada)+path.sep),'Captura fora da pasta permitida.')
    const stat=fs.statSync(origem);exigir(stat.isFile()&&stat.size>64&&stat.size<=12*1024*1024,'Captura inválida ou acima de 12 MB.')
    const bytes=fs.readFileSync(origem)
    const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0
    const jpeg=bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))&&bytes.subarray(-2).equals(Buffer.from('ffd9','hex'))
    exigir(png||jpeg,'A captura deve ser PNG ou JPEG válida.')
    const url=chaveVaga(entrada.url),alias=db.prepare('SELECT candidatura_id FROM aliases WHERE chave=?').get(url)
    exigir(alias?.candidatura_id===c.id,'Associe a URL do formulário à vaga antes de registrar a evidência.')
    const e={id:id(),candidaturaId:c.id,etapa:entrada.etapa,url,em:now(),texto:texto(entrada.texto,10000),sha256:hash(bytes),extensao:png?'png':'jpg',mimeType:png?'image/png':'image/jpeg'}
    salvarArquivo(caminhoEvidencia(e),bytes)
    return tx(()=>{db.prepare('INSERT INTO evidencias VALUES(?,?,?)').run(e.id,c.id,JSON.stringify(e));evento(c.missaoId,c.id,'captura',{evidenciaId:e.id,etapa:e.etapa});return e})
  }
  function resultado(entrada) { return tx(()=>{
    const c=ler('candidaturas',entrada.id);if(c.estado==='confirmada')return c
    exigir(c.intencaoEm&&['enviando','a_verificar'].includes(c.estado),'Não existe intenção de envio pendente.','ESTADO_INVALIDO')
    exigir(['confirmada','a_verificar','nao_enviada'].includes(entrada.estado),'Resultado inválido.')
    if(entrada.estado==='confirmada'){
      const e=ler('evidencias',entrada.evidenciaId);exigir(e.candidaturaId===c.id&&e.etapa==='confirmacao'&&e.em>=c.intencaoEm,'Confirmação exige captura posterior ao envio e vinculada à vaga.','PROVA_AUSENTE')
      const arquivo=caminhoEvidencia(e);exigir(fs.existsSync(arquivo)&&!fs.lstatSync(arquivo).isSymbolicLink(),'Arquivo da evidência não encontrado ou inválido.')
      exigir(hash(fs.readFileSync(arquivo))===e.sha256,'O arquivo da evidência foi alterado.')
      c.confirmacao={evidenciaId:e.id,em:now(),texto:e.texto,url:e.url};c.proximaAcao='Acompanhar retorno da empresa.'
      const m=ler('missoes',c.missaoId);m.confirmadas++;if(m.confirmadas>=m.criterios.meta){m.estado='concluida';m.motivo='Meta de candidaturas comprovadas atingida.'}gravar('missoes',m)
    }else{c.proximaAcao=texto(entrada.motivo,2000);if(entrada.estado==='nao_enviada'){exigir(entrada.evidenciaId,'Anexe a prova de que o envio não ocorreu antes de liberar uma retomada.');const e=ler('evidencias',entrada.evidenciaId);exigir(e.candidaturaId===c.id&&e.etapa==='falha'&&e.em>=c.intencaoEm,'Prova de não envio inválida.');c.intencaoEm=null}}
    c.estado=entrada.estado==='nao_enviada'?'preenchendo':entrada.estado;evento(c.missaoId,c.id,'resultado',{estado:c.estado,confirmacao:c.confirmacao,proximaAcao:c.proximaAcao});return gravar('candidaturas',c)
  }) }
  function caminhoEvidencia(e){exigir(!e.extensao||['png','jpg'].includes(e.extensao),'Formato de evidência inválido.');return path.join(privateDir,'evidencias',e.id+'.'+(e.extensao||'png'))}
  function evidencia(identificador) {const e=ler('evidencias',identificador),arquivo=caminhoEvidencia(e);exigir(!fs.lstatSync(arquivo).isSymbolicLink(),'Evidência inválida.');const bytes=fs.readFileSync(arquivo);exigir(hash(bytes)===e.sha256,'O arquivo da evidência foi alterado.');return {...e,dataUrl:'data:'+(e.mimeType||'image/png')+';base64,'+bytes.toString('base64')}}
  function reconciliar(){for(const m of lista('missoes'))if(ATIVAS.includes(m.estado)&&m.execucao?.pid&&m.execucao.inicio){const inicio=require('./candidaturas/executor.cjs').inicioProcesso(m.execucao.pid);if(inicio!==m.execucao.inicio)executorEstado({missaoId:m.id,estado:'interrompida',codigo:'PROCESSO_TERMINOU',motivo:'O processo do executor terminou. Progresso preservado; confira os envios pendentes antes de retomar.'})}}
  function estado() {
    reconciliar()
    const todas=listarCandidaturas(),agora=now()
    const missoes=lista('missoes').map(m=>{
      let supervisor=null
      if(m.execucao?.tipo==='nativo')try{const p=JSON.parse(fs.readFileSync(path.join(privateDir,'missoes',m.id,'supervisor.json'),'utf8'));supervisor={estado:p.estado,modelo:p.modelo,provider:p.provider,ciclos:p.ciclos,acoes:p.acoes,tokensEntrada:p.tokensEntrada,tokensSaida:p.tokensSaida,ultimaAcao:p.ultimaAcao,iniciadoEm:p.iniciadoEm,atualizadoEm:p.atualizadoEm,erro:p.erro,atividadeAtual:p.atividadeAtual,eventosRecentes:p.eventosRecentes,fontesEsgotadas:p.fontesEsgotadas||null,checkpoint:typeof p.checkpoint==='string'?p.checkpoint.slice(0,1200):''}}catch{}
      const proprias=todas.filter(c=>c.missaoId===m.id)
      return {...m,...(supervisor?{supervisor}:{}),progresso:progressoDaMissao(proprias,supervisor,agora),atencao:diagnosticoDaMissao(m,supervisor,proprias)}
    })
    const pendencias=pendenciasHumanas(todas,agora,q=>respostas.resolver(q))
    // Presets clicáveis por pergunta, a partir do preset canônico já autorizado.
    try{const {criarPreset}=require('./candidaturas/nativo.cjs'),{sugerirRespostas}=require('./candidaturas/sugestoes.cjs');let dados='';try{dados=fs.readFileSync(path.join(repoRoot,'LucasOL/Portfolio/privacidade/dados-candidatura-canonicos.local.md'),'utf8')}catch{}
      const preset=criarPreset(dados,config(),respostas);for(const p of pendencias.perguntas)p.sugestoes=sugerirRespostas(p.pergunta,preset)}catch{}
    return {preferencias:config(),missoes,candidaturas:todas,pendencias,respostas:respostas.listar()}
  }
  async function observar() {
    try {
      const r=opcoes.mostrarBancada
        ? await opcoes.mostrarBancada()
        : JSON.parse((await execFileAsync(path.join(opcoes.home||os.homedir(),'.agents/bin/agent-bench'),['view','dailywork-candidaturas'],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024})).stdout)
      return {nome:'dailywork-candidaturas',workspace:Number.isInteger(r?.workspace)?r.workspace:null,viewerAtivo:Boolean(r?.viewer_pid||r?.launched)}
    } catch(e) {
      throw erro('BANCADA_INDISPONIVEL',String(e.stderr||e.message||'Não foi possível mostrar a bancada.').slice(0,500),503)
    }
  }
  // Desligamento supervisionado do app: a missão fica interrompida com código de reinício,
  // o worker é encerrado limpo e a agenda retoma quando o DailyWork voltar.
  function interromperPorReinicio() {
    const afetadas=[]
    for(const m of lista('missoes'))if(ATIVAS.includes(m.estado)){
      executorEstado({missaoId:m.id,estado:'interrompida',codigo:'DAILYWORK_REINICIADO',motivo:'O DailyWork foi reiniciado durante a rodada; a agenda retoma a missão automaticamente.'})
      try{(opcoes.stop || require('./candidaturas/executor.cjs').pararMissao)(m.execucao)}catch{}
      afetadas.push(m.id)
    }
    return afetadas
  }
  const respostas=criarRespostasRecorrentes(privateDir)
  // Uma pergunta respondida pelo titular vale para todos os formulários seguintes e
  // libera as candidaturas que só esperavam por ela.
  function responder({pergunta,resposta}) {
    const registro=respostas.gravar(pergunta,resposta)
    const reabertas=[]
    tx(()=>{for(const c of listarCandidaturas()){
      if(c.estado!=='aguardando_dado')continue
      const pendentes=perguntasPendentes(c)
      if(!pendentes.length||!pendentes.every(q=>respostas.resolver(q)))continue
      const atual=ler('candidaturas',c.id)
      atual.campos=atual.campos.map(f=>{const r=respostas.resolver(f.pergunta);return r&&respostaPendente(f.resposta)?{...f,resposta:r.resposta,fonte:r.fonte}:f})
      atual.estado='preenchendo';atual.proximaAcao='Pendência respondida pelo titular: reabrir o formulário e usar as respostas recorrentes.';atual.atualizadaEm=now()
      evento(atual.missaoId,atual.id,'reaberta',{motivo:'resposta_recorrente',pergunta:registro.pergunta});gravar('candidaturas',atual);reabertas.push(atual.id)
    }})
    return {resposta:registro,reabertas}
  }
  function reabrir({id:identificador,proximaAcao}) { return tx(()=>{
    const c=ler('candidaturas',identificador)
    const missaoAtual=ler('missoes',c.missaoId)
    const missaoEncerrada=['concluida','encerrada'].includes(missaoAtual.estado)
    const impedida=['aguardando_dado','aguardando_acesso','descartada'].includes(c.estado)
    const formularioSalvo=['reservada','preenchendo','pronta'].includes(c.estado)
    exigir(impedida||(missaoEncerrada&&formularioSalvo),'Somente candidaturas impedidas, descartadas ou formulários salvos de uma missão encerrada podem ser reabertos.','ESTADO_INVALIDO')
    // Uma vaga presa numa missão já terminada volta para a missão mais recente ainda viva.
    if(missaoEncerrada){const viva=lista('missoes').find(m=>!['concluida','encerrada'].includes(m.estado));if(viva){db.prepare('UPDATE candidaturas SET missao_id=? WHERE id=?').run(viva.id,c.id);evento(viva.id,c.id,'transferida',{de:c.missaoId});c.missaoId=viva.id}}
    // Uma reserva ainda não teve o formulário observado. Preserve esse estado
    // para que o executor capture a primeira página antes de preencher.
    if(c.estado!=='reservada')c.estado='preenchendo'
    c.proximaAcao=proximaAcao?texto(proximaAcao,2000):'Reaberta pelo titular: conferir a vaga e retomar o formulário.';c.atualizadaEm=now()
    evento(c.missaoId,c.id,'reaberta',{motivo:'manual'});return gravar('candidaturas',c)
  }) }
  function reiniciar(entrada={}) {
    exigir(!opcoes.desabilitarExecucao,'Envios não estão habilitados no ambiente de captura.','EXECUCAO_DESABILITADA')
    reconciliar()
    const encerradas=[]
    for(const m of lista('missoes'))if(!['concluida','encerrada'].includes(m.estado)){api.controlar({id:m.id,acao:'encerrar',motivo:'Encerrada para iniciar nova missão com outra busca.'});encerradas.push(m.id)}
    const criterios=validarConfig({...config(),...(entrada.criterios||{})})
    api.configurar(criterios)
    const nova=api.iniciar({criterios})
    return {...nova,encerradas}
  }
  const api={privateDir,estado,observar,responder,reabrir,reiniciar,interromperPorReinicio,configurar:entrada=>{const c=validarConfig(entrada);db.prepare('INSERT INTO preferencias VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(c));return c},iniciar,controlar,reorientar,assumir,missao,obter,reservar,atualizar,associarDestino,complementar,intencao,captura,resultado,evidencia,executorEstado,autorizar:entrada=>autorizar(entrada.missaoId),close:()=>db.close()}
  return api
}
module.exports={criarServicoCandidaturas,validarConfig,chaveVaga,progressoDaMissao,diagnosticoDaMissao,pendenciasHumanas,criarRespostasRecorrentes,normalizarPergunta,PADRAO,parseLocalidades,serializeLocalidades}
