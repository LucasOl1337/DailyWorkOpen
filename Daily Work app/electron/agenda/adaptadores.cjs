const {classificarEstoqueEditorial}=require('../lib-estoque-editorial.cjs')
const {local,falha}=require('./servico.cjs')
const {criarContexto}=require('./contexto.cjs')
function criarAdaptadores(s){
 const contexto=criarContexto(s)
 const {automacoes,sumario,analiseSumario,rotinaSumario}=s
 const f={...s.filaEditorial}
 const c={...s.candidaturas},p={...s.producaoEditorial}
 const vinculo=ctx=>({id:ctx.ocorrencia.id,arquivo:ctx.arquivo})
 const itens=async()=>{const v=await f.listar({});return Array.isArray(v)?v:v.itens||[]}
 const orientar=async ctx=>{const v=await contexto(ctx);if(v.bloqueio)throw falha('ORIENTACAO_AMBIGUA',v.bloqueio);return v}
 const campanha={
  async iniciar(ctx){
   const a=automacoes.paraCampanha(ctx.rotina.campanhaId)
   const est=await a.estado()
   const existente=est.execucoes.find(e=>e.agenda?.id===ctx.ocorrencia.id&&['executando','preparando','concluida','requer_revisao'].includes(e.status))
   if(existente){ctx.checkpoint({referencia:{id:existente.id}});return campanha.consultar({...ctx,ocorrencia:{...ctx.ocorrencia,referencia:{id:existente.id}}})}
   await a.abrirPerfil()
   const plano=await orientar(ctx)
   ctx.autorizar()
   const r=await a.executarAgora({tipo:ctx.rotina.tipo==='pesquisa'?'pesquisa':'ciclo',agenda:vinculo(ctx),briefing:plano.briefing,executor:ctx.rotina.executor||undefined,limite:ctx.rotina.metaDiaria?Math.min(ctx.rotina.quantidade,ctx.saldo):ctx.rotina.quantidade})
   return {referencia:{id:r.id},mensagem:ctx.rotina.tipo==='pesquisa'?'Pesquisando empresa e contexto.':'Executando ações da campanha.'}
  },
  async consultar(ctx){
   const est=await automacoes.paraCampanha(ctx.rotina.campanhaId).estado(),r=est.execucoes.find(e=>e.id===ctx.ocorrencia.referencia.id)
   if(!r)throw falha('INTERROMPIDA','Execução não encontrada; verificando recuperação.')
   const realizado=(ctx.ocorrencia.realizadoBase||0)+est.interacoes.filter(i=>i.contextoId===r.contextoId&&i.status==='confirmado').length
   ctx.checkpoint({realizado})
   if(['executando','preparando'].includes(r.status))return {mensagem:'Campanha em execução.',realizado}
   if(r.status==='concluida')return {estado:'concluida',realizado,mensagem:r.resumo||'Ciclo concluído.',referencia:{id:r.id,contextoId:r.contextoId}}
   if(r.status==='requer_revisao')throw falha('ENVIO_INCERTO','Há interações sem recibo; confira o histórico antes de repetir.')
   throw falha('INTERROMPIDA',r.erro||'O processo da campanha terminou.')
  },
  async cancelar(o){if(o.referencia)await automacoes.paraCampanha(o.modulo.slice(9)).cancelar(o.referencia)}
 }
 const candidaturas={
  async iniciar(ctx){
   const estado=c.estado()
   const ativa=estado.missoes.find(m=>['executando','iniciando'].includes(m.estado))
   if(ativa&&ativa.agenda?.id!==ctx.ocorrencia.id)throw falha('RECURSO_OCUPADO','Outra missão de candidaturas está em execução.')
   const hoje=estado.candidaturas.filter(v=>v.confirmacao?.em&&local(Date.parse(v.confirmacao.em),ctx.rotina.fuso).dia===ctx.ocorrencia.dia).length
   const saldo=ctx.rotina.metaDiaria?Math.max(0,ctx.rotina.metaDiaria-hoje):ctx.rotina.quantidade
   if(!saldo)return {estado:'sem_trabalho',mensagem:'Meta diária de candidaturas já atingida.'}
   const navegador=(s.navegadorCandidaturas || require('../candidaturas/navegador.cjs').criarNavegador)({autorizar:ctx.autorizar,abrirAutomaticamente:true})
   ctx.checkpoint({mensagem:'Verificando conexão da bancada de candidaturas.'})
   try{await navegador.conectar()}finally{await navegador.fechar()}
   const alvo=estado.missoes.find(m=>m.id===ctx.ocorrencia.entrada?.missaoId)
   const anterior=ctx.ocorrencia.decisao
   const revisao=ctx.orientacoes.map(i=>`${i.escopo}:${i.revisao}`).join('|')
   const reutilizar=ctx.ocorrencia.retomadaSolicitada&&anterior?.briefing&&!anterior.bloqueio&&(anterior.instrucaoRevisao||'')===revisao
   // An explicit mission resume already has its criteria, history and previous
   // planning. Avoid a slow planning-model call before the browser worker can
   // continue the saved forms; the worker still receives today's context.
   const direta=Boolean(alvo)
   ctx.checkpoint({mensagem:direta?'Retomando formulários salvos pelo caminho rápido.':reutilizar?'Retomando missão com o planejamento já salvo.':'Preparando contexto e critérios para a missão.'})
   const plano=direta?{briefing:[alvo.agenda?.briefing,'Rodada manual: priorize formulários salvos, presets e preenchimento em lote.'].filter(Boolean).join('\n\n'),instrucaoRevisao:revisao}:reutilizar?anterior:await orientar(ctx)
   ctx.autorizar()
   const m=ativa||alvo||estado.missoes.find(m=>['interrompida','bloqueada','finalizada'].includes(m.estado)||(m.estado==='pausada'&&m.agenda?.id===ctx.ocorrencia.id))
   const entrada={agenda:{...vinculo(ctx),briefing:plano.briefing,metaInicial:hoje,limiteDiario:ctx.rotina.metaDiaria,perfilId:ctx.rotina.perfilId||undefined},executor:ctx.rotina.executor||'nativo',minutos:ctx.rotina.minutos,metaAdicional:Math.min(saldo,ctx.rotina.quantidade)}
   const r=ativa|| (m?c.controlar({id:m.id,acao:'retomar',...entrada}):c.iniciar({criterios:{...estado.preferencias,...ctx.ocorrencia.entrada?.criterios,meta:entrada.metaAdicional,minutos:entrada.minutos,executor:entrada.executor},agenda:entrada.agenda}))
   if(!['iniciando','executando'].includes(r.estado))throw falha('EXECUTOR_FALHOU',r.motivo||'Executor não iniciou.')
   return {retomadaSolicitada:false,referencia:{id:r.id,inicial:ctx.ocorrencia.referencia?.id===r.id?ctx.ocorrencia.referencia.inicial:r.confirmadas},mensagem:'Missão em andamento; preparando navegador.'}
  },
  async consultar(ctx){
   const est=c.estado(),m=est.missoes.find(m=>m.id===ctx.ocorrencia.referencia.id)
   if(!m)throw falha('INTERROMPIDA','Missão não encontrada.')
   if(ctx.ocorrencia.retomadaSolicitada&&['pausada','interrompida','bloqueada'].includes(m.estado))return candidaturas.iniciar(ctx)
   const realizado=(ctx.ocorrencia.realizadoBase||0)+Math.max(0,m.confirmadas-(ctx.ocorrencia.referencia.inicial||0)),sup=m.supervisor||{}
   ctx.checkpoint({realizado})
   if(['iniciando','executando'].includes(m.estado))return {realizado,mensagem:sup.ultimaAcao||m.motivo||'Buscando vagas compatíveis.'}
   if(m.estado==='concluida')return {estado:'concluida',realizado,mensagem:'Envios comprovados no histórico da missão.'}
   if(['pausada','encerrada'].includes(m.estado))return {estado:'pausada',realizado,mensagem:'Missão pausada ou encerrada por você.'}
   const reinicio=/COORDENADOR_INDISPONIVEL|DAILYWORK_REINICIADO|PROCESSO_TERMINOU/.test(m.interrupcao?.codigo||'')
   throw falha(sup.estado==='aguardando_conexao'?'CHROMIUM_CONEXAO_AUSENTE':sup.estado==='aguardando_controle'||m.interrupcao?.codigo==='CONTROLE_HUMANO'?'CONTROLE_HUMANO':reinicio?'REINICIO_DAILYWORK':m.estado==='interrompida'?'INTERROMPIDA':'CANDIDATURA_BLOQUEADA',m.motivo||sup.erro||'Missão interrompida.')
  },
  cancelar(o){if(o.referencia){const m=c.missao(o.referencia.id);if(['iniciando','executando'].includes(m.estado))c.controlar({id:m.id,acao:'pausar'})}}
 }
 // A produção revisa com perfis do catálogo 9router e cura mídia com visão; com outro
 // provedor ativo o lote morreria em PERFIL_NAO_PERMITIDO/VISAO_INDISPONIVEL sem explicar.
 const exigirProvedorEditorial=async()=>{
  if(typeof s.agente?.configuracao!=='function')return
  let cfg;try{cfg=await s.agente.configuracao()}catch{return}
  if(cfg?.provider&&cfg.provider!=='9router')throw falha('PROVEDOR_EDITORIAL','A produção editorial precisa do provedor 9router ativo nas configurações do agente (revisão e curadoria visual). Provedor atual: '+cfg.provider+'.')
 }
 const producao={
  async iniciar(ctx){
   const atual=p.estado().producao
   if(atual.agenda?.id===ctx.ocorrencia.id&&['concluida','sem_pauta'].includes(atual.status))return {estado:atual.status==='sem_pauta'?'sem_trabalho':'concluida',realizado:atual.historias||0,versoes:atual.criados?.length||0,referencia:{id:atual.id,itens:atual.criados},mensagem:atual.mensagem}
   if(atual.status==='executando'){
    if(atual.agenda?.id===ctx.ocorrencia.id)return {referencia:{id:atual.id},mensagem:atual.mensagem}
    throw falha('RECURSO_OCUPADO','Outro lote editorial está em andamento.')
   }
   const estoque=classificarEstoqueEditorial(await itens())
   const espaco=Math.max(0,ctx.rotina.estoqueAlvo-estoque.ocupado)
   if(!espaco)return {estado:'sem_trabalho',mensagem:'Estoque editorial configurado já está completo.',estoque}
   await exigirProvedorEditorial()
   const plano=await orientar(ctx)
   ctx.autorizar()
   const r=p.iniciar({dia:ctx.ocorrencia.dia,quantidade:ctx.rotina.quantidade,contas:ctx.rotina.contas,idiomas:ctx.rotina.idiomas,perfilId:ctx.rotina.perfilId||undefined,limiteVersoes:espaco,diasContexto:plano.diasEditorial,briefing:plano.briefing,agenda:vinculo(ctx)})
   return {referencia:{id:r.producao.id},mensagem:'Produzindo e revisando pautas com contexto do dia, semana e mês.'}
  },
  async consultar(ctx){const r=p.estado().producao;if(r.id!==ctx.ocorrencia.referencia.id)throw falha('INTERROMPIDA','O lote foi substituído; resultados preservados na Fila.');
   if(r.status==='executando')return {mensagem:r.etapa||r.mensagem}
   if(['concluida','sem_pauta'].includes(r.status)||['SEM_CONTEXTO_EDITORIAL','SEM_PAUTA_PUBLICAVEL'].includes(r.erro?.codigo))return {estado:r.status==='sem_pauta'||r.erro?.codigo==='SEM_CONTEXTO_EDITORIAL'?'sem_trabalho':'concluida',mensagem:r.mensagem,realizado:r.historias||0,versoes:r.criados?.length||0,referencia:{id:r.id,itens:r.criados||[]}}
   throw falha(r.erro?.codigo||'PRODUCAO_BLOQUEADA',r.mensagem||'Produção interrompida.')},
  cancelar(){p.cancelar()}
 }
 const adaptadores={pesquisa:campanha,campanha,candidaturas,producao,
  planejamento:{async iniciar(ctx){await sumario.coletar(ctx.ocorrencia.dia);const plano=await orientar(ctx);return {estado:'concluida',mensagem:plano.resumo,decisao:plano}},consultar:async()=>({estado:'concluida'})},
  coleta:{async iniciar(ctx){ctx.autorizar();await rotinaSumario.executarAgora();return {estado:'concluida',mensagem:'Coleta atualizada; análises anteriores reconciliadas.'}},consultar:async()=>({estado:'aguardando',referencia:null,tentarEm:Date.now()})},
  balanco:{async iniciar(ctx){await sumario.coletar(ctx.ocorrencia.dia);ctx.autorizar();await analiseSumario.analisar(ctx.ocorrencia.dia,{finalizar:false,perfilId:ctx.rotina.perfilId||undefined});return {estado:'concluida',mensagem:'Balanço atualizado. Novas atividades continuam entrando no sumário.'}},consultar:async()=>({estado:'aguardando',referencia:null,tentarEm:Date.now()})},
  publicacao_agendada:{async iniciar(ctx){
    ctx.autorizar()
    const refs=(await itens()).filter(i=>i.estado==='agendado'&&Date.parse(i.agendadoPara)<=Date.now()).map(i=>i.id)
    ctx.checkpoint({referencia:{itens:refs}})
    await f.processarAgendados()
    if(!refs.length)return {estado:'concluida',mensagem:'Horários individuais da Fila conferidos.'}
    return adaptadores.publicacao.consultar({...ctx,ocorrencia:{...ctx.ocorrencia,referencia:{itens:refs}}})
  }},
  publicacao:{async iniciar(ctx){
   const plano=await orientar(ctx)
   let publicados=ctx.ocorrencia.realizadoBase||0;const bloqueios=[],refs=[]
   for(const item of await itens()){
    if(refs.length>=Math.min(ctx.rotina.quantidade,ctx.rotina.metaDiaria?ctx.saldo:ctx.rotina.quantidade))break
    // O estoque da produção conta toda peça pendente; a publicação drena a mesma população.
    // O critério é o portão (revisão, estilo, mídia, política), não a origem da peça.
    if(item.estado!=='pendente')continue
    ctx.autorizar()
    const portao=await f.verificar(item.id)
    if(portao.bloqueios?.length){bloqueios.push({id:item.id,motivo:portao.bloqueios.map(b=>b.mensagem).join('; ')});continue}
    // The durable reference precedes the external request, including uncertain responses.
    refs.push(item.id);ctx.checkpoint({referencia:{itens:refs},realizado:publicados})
    try{const r=await f.publicar(item.id,{revisao:item.revisao,canal:'api',agenda:vinculo(ctx)});if(r.estado==='publicado')publicados++;else if(!['aguardando_executor','publicando'].includes(r.estado))bloqueios.push({id:item.id,motivo:r.estado})}
    catch(e){bloqueios.push({id:item.id,motivo:e.message})}
    ctx.checkpoint({realizado:publicados})
   }
   const pendentes=(await itens()).filter(i=>refs.includes(i.id)&&['aguardando_executor','publicando'].includes(i.estado))
   return {estado:pendentes.length?'executando':bloqueios.length?'bloqueada':publicados?'concluida':'sem_trabalho',realizado:publicados,referencia:{itens:refs},decisao:plano,bloqueios,mensagem:pendentes.length?'Aguardando recibos de publicação.':bloqueios.length?`${bloqueios.length} peça(s) com impedimentos.`:publicados?`${publicados} publicações comprovadas.`:'Nenhuma peça nova pronta para publicação.'}
  },async consultar(ctx){
    const lista=(await itens()).filter(i=>ctx.ocorrencia.referencia.itens?.includes(i.id))
    const realizado=(ctx.ocorrencia.realizadoBase||0)+lista.filter(i=>i.estado==='publicado').length
    const pendentes=lista.filter(i=>['aguardando_executor','publicando'].includes(i.estado))
    const bloqueios=lista.filter(i=>!['publicado','aguardando_executor','publicando'].includes(i.estado)).map(i=>({id:i.id,motivo:i.erro?.mensagem||i.estado}))
    return {estado:pendentes.length?'executando':bloqueios.length?'bloqueada':lista.length?'concluida':'bloqueada',realizado,bloqueios,mensagem:pendentes.length?'Aguardando recibos do destino.':bloqueios.length?'Resultados pendentes de reconciliação na Fila.':`${realizado} publicações comprovadas.`}
  },async cancelar(o){for(const item of await itens()){if(o.referencia?.itens?.includes(item.id)&&item.publicacao?.jobId){try{await s.integracoes.sessoes.cancelar(item.publicacao.jobId)}catch(e){if(e.codigo!=='ENVIO_JA_INICIADO')throw e}}}}},
 }
 adaptadores.publicacao_agendada.consultar=adaptadores.publicacao.consultar
 adaptadores.publicacao_agendada.cancelar=adaptadores.publicacao.cancelar
 return adaptadores
}
module.exports={criarAdaptadores}
