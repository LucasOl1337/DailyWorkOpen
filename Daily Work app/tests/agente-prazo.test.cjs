const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { criarServicoAgente } = require('../electron/lib-agente-9router.cjs')

function fixture(t, fetchImpl, agora) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-prazo-'))
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}))
  return criarServicoAgente({lib:{DATA_DIR:dir},apiKey:'fixture',provider:'9router',baseUrl:'http://127.0.0.1:1/v1',fetchImpl,agora})
}
const entrada = {perfilId:'cursor-grok-4-6-high',mensagens:[{role:'user',content:'fixture'}],ferramentas:[],executarFerramenta:async()=>{},timeoutMs:180000,maxRodadas:1}
test('fallback não renova prazo total nem aceita sucesso tardio', async t => {
  let tempo=0, chamadas=0, tokens=0
  const agente=fixture(t,async()=>{chamadas++;tempo+=120000;return chamadas===1
    ? {ok:false,status:502,json:async()=>({error:{message:'fixture'}})}
    : {ok:true,json:async()=>({choices:[{message:{content:'tardia'}}],usage:{total_tokens:7}})}},()=>tempo)
  await assert.rejects(agente.executarComFerramentas({...entrada,onUso:u=>tokens+=u.total_tokens||0}),{codigo:'TIMEOUT_9ROUTER'})
  assert.equal(chamadas,2)
  assert.equal(tokens,7)
})
test('cancelamento entre modelos impede fallback e nova chamada', async t => {
  let chamadas=0
  const agente=fixture(t,async()=>{chamadas++;return {ok:false,status:502,json:async()=>({error:{message:'fixture'}})}},()=>0)
  await assert.rejects(agente.executarComFerramentas({...entrada,antesDeAcao:()=>{if(chamadas)throw Object.assign(new Error('pausada'),{codigo:'PAUSADA'})}}),{codigo:'PAUSADA'})
  assert.equal(chamadas,1)
})

test('falha ao salvar consumo não dispara outro modelo', async t => {
  let chamadas=0
  const erro=Object.assign(new Error('fixture busy'),{codigo:'SQLITE_BUSY'})
  const agente=fixture(t,async()=>{chamadas++;return {ok:true,json:async()=>({choices:[{message:{content:'válida'}}],usage:{total_tokens:1}})}},()=>0)
  await assert.rejects(agente.executarComFerramentas({...entrada,onUso:()=>{throw erro}}),e=>e===erro)
  assert.equal(chamadas,1)
})

test('modelo lento deixa tempo disponível para chamar o fallback', async t=>{
 const timers=require('node:timers')
 const original=global.setTimeout
 let tempo=0,chamadas=0
 t.after(()=>{global.setTimeout=original})
 global.setTimeout=(cb,ms,...args)=>timers.setTimeout(()=>{tempo+=ms;cb(...args)},0)
 const agente=fixture(t,async(_url,init)=>{
  chamadas++
  if(chamadas===1)return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(Error('slow'),{name:'AbortError'})),{once:true}))
  return {ok:true,json:async()=>({choices:[{message:{content:'Resposta do fallback'}}]})}
 },()=>tempo)
 const resposta=await agente.completar({perfilId:'grok-4-6',mensagens:[{role:'user',content:'fixture'}],timeoutMs:120000})
 assert.equal(chamadas,2);assert.equal(tempo,90000);assert.equal(resposta.mensagem,'Resposta do fallback');assert.ok(resposta.fallback)
})
