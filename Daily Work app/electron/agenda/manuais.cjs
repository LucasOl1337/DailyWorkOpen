// Preserve domain return values while making legacy buttons/API calls use the coordinator's resource reservation.
function conectarManuais(s,agenda){
 const c=s.candidaturas, iniciar=c.iniciar,controlar=c.controlar
 c.iniciar=(entrada={})=>entrada.agenda?iniciar(entrada):agenda.manual({rotinaId:'candidaturas'},ctx=>{
  const criterios=entrada.criterios||c.estado().preferencias
  const r=iniciar({...entrada,criterios:{...criterios,meta:Math.min(criterios.meta,ctx.saldo),minutos:Math.min(criterios.minutos,ctx.rotina.minutos)},agenda:{...ctx.agenda,perfilId:ctx.rotina.perfilId}})
  return {resposta:r,registro:{referencia:{id:r.id,inicial:r.confirmadas},mensagem:r.motivo||'Missão iniciada manualmente.'}}
 })
 c.controlar=entrada=>{
  if(entrada.agenda)return controlar(entrada)
  if(entrada.acao==='completar_meta'){
   const ctx=agenda.estender({rotinaId:'candidaturas'})
   const dia=v=>new Intl.DateTimeFormat('sv-SE',{timeZone:ctx.rotina.fuso}).format(new Date(v))
   const hoje=dia(Date.now()),estado=c.estado()
   const confirmadasHoje=estado.candidaturas.filter(v=>v.confirmacao?.em&&dia(v.confirmacao.em)===hoje).length
   const saldo=Math.max(0,ctx.rotina.metaDiaria-confirmadasHoje)
   if(!saldo)throw Object.assign(new Error('Meta diária atingida.'),{codigo:'META_ATINGIDA',status:409})
   const r=controlar({...entrada,agenda:ctx.agenda,metaAdicional:saldo,limite:ctx.limite})
   const inicial=ctx.ocorrencia.referencia?.id===r.id?ctx.ocorrencia.referencia.inicial:r.confirmadas
   agenda.resultado(ctx.ocorrencia.id,{referencia:{id:r.id,inicial},mensagem:`Missão ampliada para completar ${ctx.rotina.metaDiaria} confirmações hoje.`})
   return r
  }
  if(entrada.acao==='retomar')return agenda.manual({rotinaId:'candidaturas'},ctx=>{const r=controlar({...entrada,agenda:ctx.agenda,minutos:ctx.rotina.minutos,metaAdicional:ctx.saldo});return {resposta:r,registro:{referencia:{id:r.id,inicial:r.confirmadas},mensagem:'Missão retomada manualmente.'}}})
  const r=controlar(entrada)
  if(r.agenda)void agenda.controlar({modulo:'candidaturas',acao:'pausar_hoje'})
  return r
 }
 const originalPara=s.automacoes.paraCampanha,ligados=new Set()
 function paraCampanha(id='cognition'){
  const a=originalPara(id)
  if(!ligados.has(id)){
   ligados.add(id);const executar=a.executarAgora
   a.executarAgora=(entrada={})=>entrada.agenda?executar(entrada):agenda.manual({rotinaId:`${entrada.tipo==='pesquisa'?'pesquisa':'campanha'}:${id}`,avulsa:Boolean(entrada.alvoId)},async ctx=>{
    await a.abrirPerfil()
    const r=await executar({...entrada,agenda:ctx.agenda,briefing:ctx.agenda.briefing,limite:Math.min(ctx.rotina.quantidade,ctx.saldo),executor:ctx.rotina.executor})
    return {resposta:r,registro:{referencia:{id:r.id},mensagem:'Campanha iniciada manualmente.'}}
   })
   a.pesquisar=()=>a.executarAgora({tipo:'pesquisa'})
  }
  return a
 }
 s.automacoes.paraCampanha=paraCampanha
 s.automacoes.executarAgora=entrada=>paraCampanha().executarAgora(entrada)
 s.automacoes.pesquisar=()=>paraCampanha().pesquisar()
 const fila=s.filaEditorial
 if(fila){const publicar=fila.publicar;fila.publicar=(id,entrada={})=>entrada.agenda?publicar(id,entrada):agenda.manual({rotinaId:'publicacao'},async ctx=>{
   const resposta=await require('./consumo.cjs').contexto.run(ctx.agenda,()=>publicar(id,{...entrada,agenda:ctx.agenda}))
   return {resposta,registro:{referencia:{itens:[id]},estado:resposta.estado==='publicado'?'concluida':'executando',realizado:resposta.estado==='publicado'?1:0,mensagem:'Publicação manual registrada na agenda.'}}
 })}
 const p=s.producaoEditorial
 if(p){
  const iniciar=p.iniciar,estado=p.estado,configurar=p.configurar
  const campos=['ativa','quantidade','contas','idiomas','estoqueAlvo','perfilId']
  const configDaRotina=r=>Object.fromEntries(campos.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))
  p.estado=()=>{
   const pacote=estado(),rotina=agenda.estado().rotinas.find(r=>r.id==='producao')
   return rotina?{...pacote,config:{...pacote.config,...configDaRotina(rotina)}}:pacote
  }
  p.configurar=(entrada={})=>{
   require('../lib-producao-editorial.cjs').validarConfig({...p.estado().config,...entrada})
   const rotina=agenda.estado().rotinas.find(r=>r.id==='producao')
   const patch=Object.fromEntries(campos.filter(k=>entrada[k]!==undefined).map(k=>[k,entrada[k]]))
   if(rotina&&Object.keys(patch).length)agenda.configurar({id:rotina.id,revisao:rotina.revisao,...patch})
   configurar(entrada)
   return p.estado().config
  }
  p.iniciar=(entrada={})=>entrada.agenda?iniciar(entrada):agenda.manual({rotinaId:'producao',avulsa:true},ctx=>{
   const r=iniciar({...configDaRotina(ctx.rotina),...entrada,agenda:ctx.agenda,briefing:[ctx.agenda.briefing,entrada.briefing].filter(Boolean).join('\n')})
   return {resposta:r,registro:{referencia:{id:r.producao.id},mensagem:'Lote editorial iniciado manualmente.'}}
  })
 }
}
module.exports={conectarManuais}
