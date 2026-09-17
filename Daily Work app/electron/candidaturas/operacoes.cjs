const { origemLocal, lerJson, erro }=require('../lib-api-local.cjs')
const ACOES=['estado','observar','configurar','reorientar','iniciar','reiniciar','responder','reabrir','controlar','missao','obter','reservar','atualizar','intencao','captura','resultado','evidencia','executorEstado','autorizar']
function registrarCandidaturas(registrar,servico){for(const acao of ACOES)registrar('candidaturas:'+acao,(entrada)=>servico[acao](entrada))}
function criarMiddlewareCandidaturas(servico){return async(req,res)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store')
 try{if(!origemLocal(req))throw erro('ORIGEM_NAO_PERMITIDA','Candidaturas aceita somente chamadas locais.',403)
 const acao=new URL(req.url,'http://localhost').pathname.slice(1)
 if(req.method!=='POST'||!ACOES.includes(acao))throw erro('ROTA_INEXISTENTE','Operação não encontrada.',404)
 if(!/^application\/json/.test(req.headers['content-type']||''))throw erro('TIPO_INVALIDO','Use application/json.',415)
 const {entrada}=await lerJson(req,256*1024)
 res.end(JSON.stringify({ok:true,data:await servico[acao](entrada)}))
 }catch(e){res.statusCode=e.status||400;res.end(JSON.stringify({ok:false,erro:{codigo:e.codigo||'ERRO',mensagem:e.message}}))}
}}
module.exports={ACOES,registrarCandidaturas,criarMiddlewareCandidaturas}
