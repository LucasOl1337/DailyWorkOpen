const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const TIPOS = ['planejamento', 'pesquisa', 'campanha', 'candidaturas', 'producao', 'publicacao', 'publicacao_agendada', 'coleta', 'balanco']
const TERMINAIS = ['concluida', 'sem_trabalho', 'cancelada', 'expirada']
const falha = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo, status: 409 })
function local(ms, fuso = 'America/Sao_Paulo') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, semana: new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay() }
}
function instante(dia, hora, fuso) {
  const alvo = Date.parse(`${dia}T${hora}:00Z`)
  let ms = alvo
  for (let i = 0; i < 3; i++) { const l = local(ms, fuso); ms += alvo - Date.parse(`${l.dia}T${l.hora}:00Z`) }
  return ms
}
function validar(r) {
  if (!r || !/^[a-z0-9:_-]{1,120}$/.test(r.id) || !TIPOS.includes(r.tipo) || !/^[a-z0-9:_-]{1,120}$/.test(r.modulo)) throw falha('CONFIG_INVALIDA', 'Rotina inválida.')
  local(Date.now(), r.fuso)
  if (!Array.isArray(r.horarios) || r.horarios.length > 48 || r.horarios.some(h => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))) throw falha('CONFIG_INVALIDA', 'Horários devem usar HH:MM.')
  if (!Array.isArray(r.dias) || !r.dias.length || r.dias.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw falha('CONFIG_INVALIDA', 'Selecione os dias da semana.')
  for (const k of ['metaDiaria', 'quantidade', 'minutos', 'tentativas']) if (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 10000) throw falha('CONFIG_INVALIDA', `Valor inválido: ${k}.`)
  if (!r.minutos || !r.quantidade || r.tentativas > 3 || typeof r.ativa !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.fim)) throw falha('CONFIG_INVALIDA', 'Confira duração, quantidade, tentativas e fim da janela.')
  if (r.intervalo !== null && (!Number.isInteger(r.intervalo) || r.intervalo < 1 || r.intervalo > 1440)) throw falha('CONFIG_INVALIDA', 'Intervalo deve ter 1–1440 minutos.')
  if (!r.intervalo && !r.horarios.length) throw falha('CONFIG_INVALIDA', 'Informe pelo menos um horário.')
  for(const k of ['perfilId','executor'])if(typeof r[k]!=='string'||r[k].length>150)throw falha('CONFIG_INVALIDA','Perfil ou executor inválido.')
  for(const k of ['fontes','contas','idiomas'])if(!Array.isArray(r[k])||r[k].length>100||r[k].some(v=>typeof v!=='string'||v.length>200))throw falha('CONFIG_INVALIDA','Lista inválida: '+k)
  if(r.tipo==='candidaturas'&&(r.minutos<5||r.minutos>240||r.quantidade>1000||!['nativo','codex'].includes(r.executor)))throw falha('CONFIG_INVALIDA','Candidaturas: duração de 5–240 minutos, até 1.000 por rodada e executor nativo ou codex.')
  if(['campanha','pesquisa'].includes(r.tipo)&&!require('../automacoes/executores.cjs').listarExecutores().some(e=>e.id===r.executor))throw falha('CONFIG_INVALIDA','Executor de campanha desconhecido.')
  if(r.tipo==='producao'&&(r.quantidade>20||!r.contas.length||r.contas.some(c=>!['linkedin','x','github','reddit'].includes(c))||!r.idiomas.length||r.idiomas.some(i=>!['pt-BR','en'].includes(i))||!Number.isInteger(r.estoqueAlvo)||r.estoqueAlvo<0))throw falha('CONFIG_INVALIDA','Confira quantidade (1–20), estoque, contas e idiomas da produção.')
  // Old clients/configuration may still carry a token budget. It is obsolete.
  const { tokens, ...rotina } = r
  return rotina
}
function criarAgenda({ arquivo, adaptadores = {}, rotinas = [], now = Date.now, onUpdate = () => {}, onError = console.error }) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(arquivo)
  fs.chmodSync(arquivo, 0o600)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS coordenador(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rotinas(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ocorrencias(id TEXT PRIMARY KEY, rotina TEXT NOT NULL, dia TEXT NOT NULL, recurso TEXT NOT NULL, estado TEXT NOT NULL, prevista INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS recurso_ativo ON ocorrencias(recurso) WHERE estado='executando';
    CREATE INDEX IF NOT EXISTS ocorrencias_dia ON ocorrencias(dia,prevista);
    CREATE TABLE IF NOT EXISTS instrucoes(escopo TEXT NOT NULL,dia TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(escopo,dia));
    CREATE TABLE IF NOT EXISTS pausas(escopo TEXT PRIMARY KEY,dia TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eventos(id INTEGER PRIMARY KEY,ocorrencia TEXT,em TEXT,data TEXT);
    CREATE TABLE IF NOT EXISTS contextos(chave TEXT PRIMARY KEY,data TEXT NOT NULL);`)
  // Remove only the obsolete budget; occurrence usage remains available for reporting.
  db.exec("UPDATE rotinas SET data=json_remove(data,'$.tokens') WHERE json_type(data,'$.tokens') IS NOT NULL")
  let timer, tickAtivo = null, fechado = false, ultimaVerificacao = null
  const emCurso = new Set()
  const dono=crypto.randomUUID()
  const inicioProcesso=pid=>{try{return fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19]}catch{return null}}
  function adquirir(){
    db.exec('BEGIN IMMEDIATE')
    try{const row=db.prepare('SELECT data FROM coordenador WHERE id=1').get();const outro=row&&JSON.parse(row.data)
      if(outro&&outro.dono!==dono&&inicioProcesso(outro.pid)===outro.inicio&&outro.inicio){db.exec('COMMIT');return false}
      db.prepare('INSERT OR REPLACE INTO coordenador VALUES(1,?)').run(JSON.stringify({dono,pid:process.pid,inicio:inicioProcesso(process.pid),em:now()}));db.exec('COMMIT');return true
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  const todas = () => db.prepare('SELECT data FROM rotinas ORDER BY id').all().map(r => JSON.parse(r.data))
  const rotina = id => { const r = db.prepare('SELECT data FROM rotinas WHERE id=?').get(id); if (!r) throw falha('NAO_ENCONTRADO', 'Rotina não encontrada.'); return JSON.parse(r.data) }
  const obter = id => { const o = db.prepare('SELECT data FROM ocorrencias WHERE id=?').get(id); if (!o) throw falha('NAO_ENCONTRADO', 'Atividade não encontrada.'); return JSON.parse(o.data) }
  function evento(o, dados) { db.prepare('INSERT INTO eventos(ocorrencia,em,data) VALUES(?,?,?)').run(o?.id || null, new Date(now()).toISOString(), JSON.stringify(dados)) }
  function salvar(o) { o.atualizadaEm = now(); db.prepare("UPDATE ocorrencias SET estado=?,prevista=?,data=json_set(?, '$.tokens', MAX(COALESCE(json_extract(data,'$.tokens'),0),?)) WHERE id=?").run(o.estado,o.prevista,JSON.stringify(o),o.tokens||0,o.id); const salvo=obter(o.id);onUpdate(salvo);return salvo }
  function importar(novas){for (const r of novas) db.prepare('INSERT OR IGNORE INTO rotinas VALUES(?,?)').run(r.id, JSON.stringify(validar({ ...r, revisao: 1 })))}
  importar(rotinas)
  function configurar({ id, revisao, ...patch }) {
    const atual = rotina(id)
    if (atual.revisao !== revisao) throw falha('CONFLITO', 'A configuração mudou. Atualize antes de salvar.')
    const permitidos = ['ativa','dias','horarios','intervalo','fuso','fim','metaDiaria','quantidade','minutos','tentativas','perfilId','executor','fontes','contas','idiomas','estoqueAlvo']
    if (Object.keys(patch).some(k => !permitidos.includes(k))) throw falha('CONFIG_INVALIDA', 'Campo de configuração desconhecido.')
    const r = validar({ ...atual, ...patch, revisao: revisao + 1 })
    const gravada=db.prepare("UPDATE rotinas SET data=? WHERE id=? AND json_extract(data,'$.revisao')=?").run(JSON.stringify(r), id, revisao)
    if(!gravada.changes)throw falha('CONFLITO','A configuração mudou. Atualize antes de salvar.')
    // Schedule edits supersede only untouched future occurrences; running work keeps its identity.
    if (['horarios','dias','intervalo','fuso'].some(k => JSON.stringify(atual[k])!==JSON.stringify(r[k]))) for (const o of listarOcorrencias()) if (o.rotina === id && o.estado === 'agendada' && o.prevista > now() && !o.manual && (!r.dias.includes(new Date(o.dia+'T12:00:00Z').getUTCDay()) || r.fuso!==atual.fuso || !r.horarios.includes(local(o.prevista,r.fuso).hora))) salvar({ ...o, estado: 'cancelada', mensagem: 'Substituída pela configuração da rotina.' })
    evento(null, { tipo: 'configuracao', rotina: id, revisao: r.revisao }); return r
  }
  function listarOcorrencias(dia) { return db.prepare(`SELECT data FROM ocorrencias ${dia ? 'WHERE dia=?' : ''} ORDER BY prevista DESC LIMIT 2000`).all(...(dia ? [dia] : [])).map(r => JSON.parse(r.data)) }
  function orientacoes(escopo, dia) {
    return db.prepare("SELECT data FROM instrucoes WHERE dia=? AND escopo IN ('todos',?) ORDER BY escopo='todos' DESC").all(dia, escopo).map(r => JSON.parse(r.data))
  }
  function revisaoInstrucao(escopo, dia) { return orientacoes(escopo, dia).map(i => `${i.escopo}:${i.revisao}`).join('|') }
  function pausada(r, dia) { return Boolean(db.prepare("SELECT 1 FROM pausas WHERE escopo IN ('todos',?,?) AND dia IN (?, '*')").get(r.modulo, r.id, dia)) }
  function instruir({ escopo, texto, dia, revisao }) {
    if (escopo !== 'todos' && !todas().some(r => r.modulo === escopo)) throw falha('ESCOPO_INVALIDO', 'Módulo desconhecido.')
    if (typeof texto !== 'string' || texto.length > 12000) throw falha('INSTRUCAO_INVALIDA', 'Use até 12 mil caracteres.')
    dia ||= local(now()).dia
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw falha('DATA_INVALIDA', 'Dia inválido.')
    const anterior = db.prepare('SELECT data FROM instrucoes WHERE escopo=? AND dia=?').get(escopo, dia)
    const v = anterior ? JSON.parse(anterior.data) : { revisao: 0 }
    if (revisao !== undefined && revisao !== v.revisao) throw falha('CONFLITO', 'As orientações mudaram. Releia antes de salvar.')
    const instrucao = { escopo, dia, texto: texto.trim(), revisao: v.revisao + 1, atualizadaEm: now() }
    db.prepare('INSERT OR REPLACE INTO instrucoes VALUES(?,?,?)').run(escopo, dia, JSON.stringify(instrucao))
    evento(null, { tipo: 'orientacao', escopo, dia, revisao: instrucao.revisao }); return instrucao
  }
  function inserir(r, dia, prevista, extra = false) {
    const id = extra ? crypto.randomUUID() : crypto.createHash('sha256').update(`${r.id}|${dia}|${prevista}`).digest('hex').slice(0, 32)
    const o = { id, rotina: r.id, modulo: r.modulo, tipo: r.tipo, nome: r.nome, dia, prevista, recurso: r.recurso, estado: 'agendada', tentativas: 0, tokens: 0, realizado: 0, manual: extra, referencia: null, mensagem: '', atualizadaEm: now() }
    db.prepare('INSERT OR IGNORE INTO ocorrencias VALUES(?,?,?,?,?,?,?)').run(id,r.id,dia,r.recurso,o.estado,prevista,JSON.stringify(o))
    const existente=obter(id)
    if(existente.estado==='cancelada'&&existente.mensagem==='Substituída pela configuração da rotina.'&&prevista>now())return salvar({...existente,estado:'agendada',mensagem:''})
    return existente
  }
  function materializar() {
    for (const r of todas()) {
      const l = local(now(), r.fuso)
      if (!r.ativa || !r.dias.includes(l.semana)) continue
      const horarios = r.intervalo ? [Math.floor((Number(l.hora.slice(0,2))*60+Number(l.hora.slice(3)))/r.intervalo)*r.intervalo].map(m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`) : r.horarios
      for (const h of horarios) inserir(r, l.dia, instante(l.dia,h,r.fuso))
    }
  }
  function uso(r, dia) { const os = listarOcorrencias(dia).filter(o => o.rotina === r.id); return { realizado: os.reduce((n,o) => n+(o.realizado||0),0), tokens: os.reduce((n,o) => n+(o.tokens||0),0) } }
  function autorizar(id) {
    const o = obter(id), r = rotina(o.rotina), l = local(now(), r.fuso)
    if (o.estado !== 'executando' || (!r.ativa && !o.avulsa) || pausada(r,l.dia)) throw falha('AGENDA_PAUSADA', 'A rotina está pausada.')
    // A human-triggered extra round is valid until its own duration expires,
    // even when the recurring window has already closed for the day.
    if (o.dia !== l.dia || (!o.manual && l.hora > r.fim) || (!o.ateMeta && now() > o.iniciadaEm + r.minutos*60000)) throw falha('JANELA_ENCERRADA', 'A janela desta atividade terminou.')
    if (o.instrucaoRevisao !== revisaoInstrucao(r.modulo,o.dia)) throw falha('ORIENTACAO_ALTERADA', 'Novas orientações recebidas; preparando a próxima etapa.')
    return { ocorrencia: o, rotina: r, orientacoes: orientacoes(r.modulo,o.dia) }
  }
  function replanejar(origem,plano){
    const r=rotina(origem.rotina)
    for(const ajuste of (Array.isArray(plano.ajustes)?plano.ajustes:[]).slice(0,30)){
      if(!todas().some(v=>v.id===ajuste.rotinaId))continue
      const alvo=rotina(ajuste.rotinaId)
      if(r.tipo!=='planejamento'&&alvo.modulo!==r.modulo)continue
      if(typeof ajuste.horario!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(ajuste.horario))continue
      const prevista=instante(origem.dia,ajuste.horario,alvo.fuso)
      if(prevista<=now()||ajuste.horario>alvo.fim)continue
      const o=listarOcorrencias(origem.dia).find(v=>v.rotina===alvo.id&&v.estado==='agendada'&&!v.manual&&v.prevista>now())
      if(o){salvar({...o,prevista,mensagem:'Horário ajustado pelo planejamento do dia.'});evento(o,{tipo:'replanejada',origem:origem.id})}
    }
  }
  function resultado(id, v) {
    const o = obter(id)
    if (o.estado !== 'executando') return o
    // Progresso real zera a contagem de falhas seguidas: uma rodada que rendeu não
    // deve ficar bloqueada por tropeços antigos.
    const progrediu = Number.isFinite(v.realizado) && v.realizado > (o.realizado || 0)
    return salvar({ ...o, ...v, ...(progrediu ? { falhas: 0 } : {}), estado: v.estado || 'executando' })
  }
  function tratarErro(id, e) {
    const o = obter(id), r = rotina(o.rotina)
    if (o.estado !== 'executando') return
    const codigo = e.codigo || e.code || 'EXECUCAO_FALHOU'
    const transit = /TIMEOUT|ECONN|ENET|EAI_AGAIN|NAVEGADOR|CHROMIUM_CONEXAO_AUSENTE|BANCADA_INDISPONIVEL|CONTROLE_HUMANO|EXECUTOR_FALHOU|INTERROMPIDA|ORIENTACAO_ALTERADA|LIMITE_9ROUTER|9ROUTER_INDISPONIVEL|FALHA_9ROUTER|REINICIO_DAILYWORK/.test(codigo)
    // Reinício do DailyWork não é falha da rotina: retoma logo e não consome tentativas.
    const reinicio = codigo === 'REINICIO_DAILYWORK'
    const falhas = reinicio ? (o.falhas || 0) : (o.falhas || 0) + 1
    const novamente = transit && (reinicio || falhas <= r.tentativas)
    salvar({ ...o, falhas, estado: novamente ? 'aguardando' : 'bloqueada', codigo, mensagem: e.message, ...(novamente ? {referencia:null, realizadoBase:o.realizado||0, referenciasAnteriores:[...(o.referenciasAnteriores||[]),o.referencia].filter(Boolean)}:{}), tentarEm: novamente ? now()+(reinicio ? 20000 : [60000,300000,900000][Math.min(2,falhas-1)]) : null })
    evento(o,{tipo:'falha',codigo,tentativa:o.tentativas,falhas}); if (!novamente) onError({ codigo, mensagem: e.message, modulo: r.modulo })
  }
  async function executarOcorrencia(o, r) {
    const a = adaptadores[r.tipo]
    emCurso.add(o.id)
    try {
      const ctx = { ...autorizar(o.id), arquivo, rotinas:todas().map(r=>({id:r.id,modulo:r.modulo,horarios:r.horarios})), aplicarPlano: plano=>replanejar(o,plano), autorizar: () => autorizar(o.id), checkpoint: v => resultado(o.id,v), saldo: Math.max(0,r.metaDiaria-uso(r,o.dia).realizado), contexto: (chave, valor) => {
        if (valor !== undefined) db.prepare('INSERT OR REPLACE INTO contextos VALUES(?,?)').run(chave,JSON.stringify(valor))
        const row=db.prepare('SELECT data FROM contextos WHERE chave=?').get(chave);return row?JSON.parse(row.data):null
      } }
      if (!a) throw falha('ADAPTADOR_AUSENTE','Executor desta rotina indisponível.')
      const v = await require('./consumo.cjs').contexto.run({id:o.id,arquivo}, () => o.referencia ? a.consultar(ctx) : a.iniciar(ctx))
      if (v) { resultado(o.id,v); if(v.estado==='bloqueada')onError({codigo:'ATIVIDADE_BLOQUEADA',mensagem:v.mensagem,modulo:r.modulo}) }
    } catch (e) { tratarErro(o.id,e) } finally { emCurso.delete(o.id) }
  }
  async function ciclo() {
    if(!adquirir())return
    ultimaVerificacao=now()
    materializar()
    for (let o of listarOcorrencias().reverse()) {
      const r = rotina(o.rotina), l = local(now(),r.fuso)
      if (TERMINAIS.includes(o.estado)) continue
      if (o.estado === 'executando') {
        if (emCurso.has(o.id)) continue
        try { autorizar(o.id) } catch(e) {
          try { await adaptadores[r.tipo]?.cancelar?.(o) } catch(e) { onError(e) }
          if (e.codigo === 'ORIENTACAO_ALTERADA') { salvar({...o,estado:'aguardando',referencia:null,tentarEm:now(),mensagem:e.message}); continue }
          salvar({...o,estado:e.codigo==='AGENDA_PAUSADA'?'pausada':'bloqueada',mensagem:e.message});continue
        }
        void executarOcorrencia(o,r); continue
      }
      if (o.dia < l.dia || (!o.manual && o.dia === l.dia && l.hora > r.fim)) { salvar({...o,estado:'expirada',mensagem:'Janela encerrada; sem acumular disparos atrasados.'}); continue }
      if (!['agendada','aguardando'].includes(o.estado) || (!r.ativa && !o.avulsa) || pausada(r,l.dia) || o.prevista>now() || (o.tentarEm||0)>now()) continue
      if (r.dependencia) {
        const dep=listarOcorrencias(o.dia).filter(v=>v.rotina===r.dependencia&&v.prevista<=now())
        if (!dep.some(v=>TERMINAIS.slice(0,2).includes(v.estado))) { if(o.mensagem!=='Aguardando etapa anterior.')salvar({...o,mensagem:'Aguardando etapa anterior.'});continue }
      }
      const u=uso(r,o.dia)
      if (r.metaDiaria && u.realizado>=r.metaDiaria) { salvar({...o,estado:'sem_trabalho',mensagem:'Meta diária atingida.'}); continue }
      o={...o,estado:'executando',codigo:null,iniciadaEm:now(),tentativas:o.tentativas+1,instrucaoRevisao:revisaoInstrucao(r.modulo,o.dia),mensagem:'Preparando execução',tentarEm:null}
      try {
        const claim=db.prepare("UPDATE ocorrencias SET estado='executando',data=? WHERE id=? AND estado IN ('agendada','aguardando')").run(JSON.stringify(o),o.id)
        if(!claim.changes)continue
      } catch(e) { if(e.code?.includes('SQLITE') && /UNIQUE/.test(e.message))continue; throw e }
      evento(o,{tipo:'inicio',tentativa:o.tentativas});void executarOcorrencia(o,r)
    }
  }
  function tick() { if(fechado)return Promise.resolve(); if(!tickAtivo)tickAtivo=ciclo().finally(()=>{tickAtivo=null});return tickAtivo }
  async function controlar({ id, modulo, acao, prevista, horario }) {
    if (modulo) {
      if(!todas().some(r=>r.modulo===modulo)&&modulo!=='todos')throw falha('ESCOPO_INVALIDO','Módulo desconhecido.')
      if(!['pausar_hoje','retomar'].includes(acao))throw falha('ACAO_INVALIDA','Ação inválida.')
      if(acao==='pausar_hoje')db.prepare('INSERT OR REPLACE INTO pausas VALUES(?,?)').run(modulo,local(now()).dia)
      else db.prepare('DELETE FROM pausas WHERE escopo=?').run(modulo)
      for(const o of listarOcorrencias(local(now()).dia).filter(o=>modulo==='todos'||o.modulo===modulo)){
        if(acao==='pausar_hoje'&&o.estado==='executando'){salvar({...o,estado:'pausada',mensagem:'Pausada por você.'});await adaptadores[o.tipo]?.cancelar?.(o)}
        if(acao==='retomar'&&o.estado==='pausada')salvar({...o,estado:'agendada',retomadaSolicitada:true})
      }
      return estado({modulo})
    }
    const o=obter(id)
    if(horario!==undefined){
      if(typeof horario!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(horario))throw falha('DATA_INVALIDA','Use um horário HH:MM.')
      prevista=instante(o.dia,horario,rotina(o.rotina).fuso)
    }
    if(!['retomar','cancelar','reagendar'].includes(acao))throw falha('ACAO_INVALIDA','Ação inválida.')
    if(TERMINAIS.includes(o.estado))throw falha('ESTADO_INVALIDO','O resultado desta atividade já foi encerrado.')
    if(acao==='reagendar'&&(!Number.isFinite(prevista)||prevista<now()||local(prevista,rotina(o.rotina).fuso).dia!==o.dia))throw falha('DATA_INVALIDA','Escolha um horário futuro no mesmo dia.')
    if(o.estado==='executando'){salvar({...o,estado:'pausada',mensagem:'Interrompendo a execução antes de aplicar a alteração.'});await adaptadores[o.tipo]?.cancelar?.(o)}
    salvar({...obter(o.id),estado:acao==='cancelar'?'cancelada':'agendada',retomadaSolicitada:acao==='retomar',manual:true,prevista:prevista||now(),tentarEm:null,falhas:0,codigo:acao==='cancelar'?o.codigo:null,mensagem:acao==='cancelar'?'Cancelada por você.':''})
    return obter(id)
  }
  function retomarApenasRotina(r) {
    // Um lote manual não retoma outros módulos que o humano deixou pausados.
    const abrangentes=db.prepare("SELECT escopo,dia FROM pausas WHERE escopo IN ('todos',?)").all(r.modulo)
    for(const pausa of abrangentes)for(const outra of todas()){
      if(outra.id!==r.id&&(pausa.escopo==='todos'||outra.modulo===r.modulo))db.prepare('INSERT OR IGNORE INTO pausas VALUES(?,?)').run(outra.id,pausa.dia)
    }
    db.prepare("DELETE FROM pausas WHERE escopo IN ('todos',?,?)").run(r.modulo,r.id)
  }
  function executar({ rotinaId, entrada, avulsa = false }) {
    const r=rotina(rotinaId),dia=local(now(),r.fuso).dia
    if(pausada(r,dia)){if(avulsa)retomarApenasRotina(r);else db.prepare("DELETE FROM pausas WHERE escopo IN ('todos',?,?)").run(r.modulo,r.id)}
    if(!r.ativa&&!avulsa){r.ativa=true;db.prepare("UPDATE rotinas SET data=? WHERE id=?").run(JSON.stringify(r),r.id)}
    const ativo=listarOcorrencias(dia).find(o=>o.recurso===r.recurso&&o.estado==='executando')
    if(ativo)return ativo
    const pendente=listarOcorrencias(dia).find(o=>o.rotina===r.id&&['agendada','aguardando'].includes(o.estado)&&o.prevista<=now())
    const o=pendente ? salvar({...pendente,prevista:now(),tentarEm:null,falhas:0,manual:true}) : inserir(r,dia,now(),true)
    if(entrada||avulsa)salvar({...o,entrada,avulsa})
    return obter(o.id)
  }
  function manual({rotinaId,avulsa=false},fn){
    if(!adquirir())throw falha('COORDENADOR_OCUPADO','Outro processo está executando a agenda. Use a API do DailyWork ativo.')
    const r=rotina(rotinaId),dia=local(now(),r.fuso).dia
    if(pausada(r,dia)){if(avulsa)retomarApenasRotina(r);else db.prepare("DELETE FROM pausas WHERE escopo IN ('todos',?,?)").run(r.modulo,r.id)}
    if(!r.ativa&&!avulsa){r.ativa=true;db.prepare("UPDATE rotinas SET data=? WHERE id=?").run(JSON.stringify(r),r.id)}
    const u=uso(r,dia)
    // A meta protege a rotina recorrente. Uma ação avulsa e explicitamente
    // acionada pelo usuário (por exemplo, disparar um alvo específico) precisa
    // continuar disponível para validar ou concluir a fila do produto.
    if(!avulsa&&r.metaDiaria&&u.realizado>=r.metaDiaria)throw falha('META_ATINGIDA','Meta diária atingida. Aumente a meta no menu para enviar mais.')
    if(listarOcorrencias(dia).some(o=>o.recurso===r.recurso&&o.estado==='executando'))throw falha('RECURSO_OCUPADO','Já existe uma execução neste recurso.')
    const novo=executar({rotinaId,avulsa})
    const o={...novo,estado:'executando',iniciadaEm:now(),tentativas:novo.tentativas+1,instrucaoRevisao:revisaoInstrucao(r.modulo,dia)}
    salvar(o);autorizar(o.id);emCurso.add(o.id)
    const agenda={id:o.id,arquivo,briefing:orientacoes(r.modulo,dia).map(i=>i.texto).join('\n')}
    const concluir=v=>{resultado(o.id,v.registro);emCurso.delete(o.id);return v.resposta}
    try{
      const v=fn({agenda,rotina:r,saldo:r.metaDiaria?Math.max(0,r.metaDiaria-u.realizado):r.quantidade})
      return v&&typeof v.then==='function'?v.then(concluir,e=>{emCurso.delete(o.id);tratarErro(o.id,e);throw e}):concluir(v)
    }catch(e){emCurso.delete(o.id);tratarErro(o.id,e);throw e}
  }
  function estender({rotinaId}){
    if(!adquirir())throw falha('COORDENADOR_OCUPADO','Outro processo está executando a agenda. Use a API do DailyWork ativo.')
    const r=rotina(rotinaId),dia=local(now(),r.fuso).dia
    if(pausada(r,dia))db.prepare("DELETE FROM pausas WHERE escopo IN ('todos',?,?)").run(r.modulo,r.id)
    if(!r.ativa){r.ativa=true;db.prepare("UPDATE rotinas SET data=? WHERE id=?").run(JSON.stringify(r),r.id)}
    const u=uso(r,dia)
    if(r.metaDiaria&&u.realizado>=r.metaDiaria)throw falha('META_ATINGIDA','Meta diária atingida.')
    let o=listarOcorrencias(dia).find(v=>v.recurso===r.recurso&&v.estado==='executando')
    if(!o){
      const novo=executar({rotinaId})
      o={...novo,estado:'executando',iniciadaEm:now(),tentativas:novo.tentativas+1,instrucaoRevisao:revisaoInstrucao(r.modulo,dia)}
      const claim=db.prepare("UPDATE ocorrencias SET estado='executando',data=? WHERE id=? AND estado IN ('agendada','aguardando')").run(JSON.stringify(o),o.id)
      if(!claim.changes)throw falha('RECURSO_OCUPADO','Outra execução assumiu este recurso.')
      evento(o,{tipo:'inicio_continuo',tentativa:o.tentativas})
    }
    o=salvar({...o,manual:true,ateMeta:true,mensagem:`Executando agora até completar ${r.metaDiaria} resultados hoje.`})
    return {ocorrencia:o,rotina:r,saldo:r.metaDiaria?Math.max(0,r.metaDiaria-u.realizado):r.quantidade,agenda:{id:o.id,arquivo,briefing:orientacoes(r.modulo,dia).map(i=>i.texto).join('\n')},limite:new Date(instante(dia,'23:59',r.fuso)+59999).toISOString()}
  }
  function estado({modulo,dia}={}) {
    materializar()
    dia ||= local(now()).dia
    const rs=todas().filter(r=>!modulo||r.modulo===modulo)
    const proxima=r=>{if(!r.ativa)return null;for(let n=0;n<8;n++){const d=new Date(Date.parse(local(now(),r.fuso).dia+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);if(!r.dias.includes(new Date(d+'T12:00:00Z').getUTCDay())||pausada(r,d))continue;const hs=r.intervalo?Array.from({length:Math.ceil(1440/r.intervalo)},(_,i)=>`${String(Math.floor(i*r.intervalo/60)).padStart(2,'0')}:${String(i*r.intervalo%60).padStart(2,'0')}`):r.horarios;const ts=hs.filter(h=>h<=r.fim).map(h=>instante(d,h,r.fuso)).filter(t=>t>now()).sort((a,b)=>a-b);if(ts.length)return ts[0]}return null}
    return {dia,servico:{ativo:Boolean(timer),ultimaVerificacao},rotinas:rs.map(r=>({...r,uso:uso(r,dia),pausada:pausada(r,dia),proxima:proxima(r)})),ocorrencias:listarOcorrencias(dia).filter(o=>!modulo||o.modulo===modulo).reverse(),orientacoes:modulo?orientacoes(modulo,dia):db.prepare('SELECT data FROM instrucoes WHERE dia=?').all(dia).map(v=>JSON.parse(v.data))}
  }
  function detalhes({id}) { const o=obter(id);return {...o,eventos:db.prepare('SELECT em,data FROM eventos WHERE ocorrencia=? ORDER BY id').all(id).map(e=>({em:e.em,...JSON.parse(e.data)}))} }
  function iniciar(){if(!timer){timer=setInterval(()=>void tick().catch(onError),15000);timer.unref?.();void tick().catch(onError)}}
  function parar(){clearInterval(timer);timer=null;db.prepare("DELETE FROM coordenador WHERE id=1 AND json_extract(data,'$.dono')=?").run(dono)}
  return {arquivo,importar,manual,estender,estado,detalhes,configurar,instruir,executar,controlar,autorizar,iniciar,parar,tick,obter,rotina,resultado,materializar,close:()=>{parar();fechado=true;db.close()}}
}
module.exports={criarAgenda,local,instante,validar,falha}
