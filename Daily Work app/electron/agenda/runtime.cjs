const path=require('node:path')
const {criarAgenda}=require('./servico.cjs')
const {padroes}=require('./padroes.cjs')
const {criarAdaptadores}=require('./adaptadores.cjs')
const {criarRotinaSumario}=require('../lib-rotina-sumario.cjs')
function criarRuntimeAgenda(s,{arquivo,modoCaptura=false,onError=console.error}={}){
 const catalogo=require('../automacoes/campanhas.cjs').criarCatalogoCampanhas({lucasOlDir:process.env.LUCASOL_DIR||path.resolve(__dirname,'../../../LucasOL'),dataDir:s.lib.DATA_DIR})
 const rotinaSumario=s.rotinaSumario||criarRotinaSumario({coletar:dia=>s.sumario.coletar(dia),obterAnalise:dia=>s.analiseSumario.obter(dia),analisar:(dia,opcoes)=>s.analiseSumario.analisar(dia,opcoes)})
 const agenda=criarAgenda({arquivo:arquivo||path.join(modoCaptura?s.lib.DATA_DIR:path.resolve(__dirname,'../../../LucasOL/Private'),'agenda','estado.sqlite'),rotinas:padroes({campanhas:catalogo.listar(),candidaturas:s.candidaturas.estado().preferencias,editorial:s.producaoEditorial?.estado().config}),adaptadores:modoCaptura?{}:criarAdaptadores({...s,rotinaSumario}),onError})
 if(modoCaptura)agenda.materializar()
 else {
  require('./manuais.cjs').conectarManuais(s,agenda)
  const criar=s.automacoes.criarCampanha
  s.automacoes.criarCampanha=async entrada=>{
   const campanha=await criar(entrada)
   agenda.importar(padroes({campanhas:[campanha]}).filter(r=>r.campanhaId===campanha.id))
   agenda.materializar()
   return campanha
  }
 }
 return agenda
}
const ACOES=['estado','detalhes','configurar','instruir','executar','controlar']
function registrarAgenda(registrar,agenda){for(const acao of ACOES)registrar('agenda:'+acao,entrada=>{if(!agenda)throw Object.assign(new Error('Agenda disponível no DailyWork desktop.'),{codigo:'AGENDA_INDISPONIVEL',status:503});return agenda[acao](entrada)})}
function middlewareAgenda(agenda){const {origemLocal,lerJson,erro}=require('../lib-api-local.cjs');return async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
 try{if(!origemLocal(req))throw erro('ORIGEM_NAO_PERMITIDA','Somente origem local.',403)
 const acao=new URL(req.url,'http://localhost').pathname.slice(1)
 if(req.method!=='POST'||!ACOES.includes(acao))throw erro('ROTA_INEXISTENTE','Operação não encontrada.',404)
 if(!/^application\/json/.test(req.headers['content-type']||''))throw erro('TIPO_INVALIDO','Use application/json.',415)
 const {entrada}=await lerJson(req,64*1024);res.end(JSON.stringify({ok:true,data:await agenda[acao](entrada)}))
 }catch(e){res.statusCode=e.status||400;res.end(JSON.stringify({ok:false,erro:{codigo:e.codigo||'ERRO',mensagem:e.message}}))}
}}
module.exports={criarRuntimeAgenda,registrarAgenda,middlewareAgenda,ACOES}
