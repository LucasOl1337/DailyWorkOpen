const {test,after}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dailywork-agente-canvas-'))
process.env.DAILYWORK_DATA_DIR=path.join(tmp,'data')
process.env.LUCAS_KNOWLEDGE_DIR=path.join(tmp,'knowledge')
const lib=require('../electron/lib-md.cjs')
const {criarServicoAgente}=require('../electron/lib-agente-9router.cjs')
after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
for(const provider of ['9router','grok-cli']) test(`${provider}: agente descobre API e só aplica canvas após confirmação`,async()=>{
 let revisao='v1';const aplicados=[],chamadas=[]
 const canvas={async solicitar({tipo,entrada}){if(tipo==='canvas.estado')return{alvo:'principal',revisao,formas:[]};if(entrada.revisao!==revisao)throw Object.assign(new Error('Releia o canvas'),{codigo:'CONFLITO',status:409});aplicados.push(entrada);revisao='v2';return{persistido:true,revisao}}}
 const tool=(name,args={})=>({id:name,type:'function',function:{name,arguments:JSON.stringify(args)}})
 const respostas=[{choices:[{message:{role:'assistant',content:'',tool_calls:[tool('consultar_api_dailywork'),tool('consultar_canvas',{alvo:'principal'}),tool('propor_comando_canvas',{alvo:'principal',revisao:'v1',comando:'createShapes',args:[[{id:'shape:a',type:'geo'}]],descricao:'Criar retângulo'})]}}]},{choices:[{message:{role:'assistant',content:'Proposta pronta.'}}]}]
 const proxima=payload=>{chamadas.push(payload);assert.ok(respostas.length);return respostas.shift()}
 const servico=criarServicoAgente({lib,provider,apiKey:'teste-sem-rede',configPath:path.join(tmp,provider+'.json'),fontes:{canvas},fetchImpl:async(_url,init)=>({ok:true,status:200,json:async()=>proxima(JSON.parse(init.body))}),grokCli:{completarChat:async entrada=>proxima(entrada)}})
 const conversa=await servico.conversar({escopo:'principal',perfilId:'grok-4-6',mensagens:[{role:'user',content:'Crie um retângulo no Principal.'}]})
 assert.equal(aplicados.length,0);assert.equal(conversa.confirmacoes.length,1)
 assert.ok(chamadas[0].tools.some(t=>t.function.name==='consultar_api_dailywork'))
 const acaoId=conversa.confirmacoes[0].id
 const resultado=await servico.confirmarAcao({escopo:'principal',acaoId})
 assert.equal(resultado.canvas.persistido,true);assert.equal(aplicados.length,1)
 await servico.confirmarAcao({escopo:'principal',acaoId});assert.equal(aplicados.length,1)
})
