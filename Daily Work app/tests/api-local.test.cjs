const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { criarApiLocal } = require('../electron/lib-api-local.cjs')
const { criarPonteCanvas } = require('../electron/lib-ponte-canvas.cjs')
const { registrarOperacoes } = require('../electron/lib-operacoes.cjs')
const { contratos } = require('../electron/lib-contratos-api.cjs')
test('HTTP cobre todas as operações do IPC com contrato', () => {
  const nomes = []
  registrarOperacoes({ registrar: (nome, fn) => { nomes.push(nome); assert.equal(typeof fn, 'function') } })
  assert.deepEqual(nomes.sort(), Object.keys(contratos).sort())
  const api = criarApiLocal({ operacoes: new Map(nomes.map(n => [n, () => null])) })
  for (const item of api.catalogo()) assert.ok(api.openapi().paths[item.rota].post)
})
test('HTTP autentica, valida origem, método, JSON e erros de domínio', async t => {
  const api = criarApiLocal({ token: 'teste', operacoes: new Map([['blocos:listar', dia => ({ dia })], ['blocos:atualizar', () => { throw Object.assign(new Error('Conflito'), { codigo: 'CONFLITO', status: 409 }) }]]) })
  const server = http.createServer(api.middleware)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close(); server.closeAllConnections() })
  const base = `http://127.0.0.1:${server.address().port}`
  const auth = { Authorization: 'Bearer teste', 'Content-Type': 'application/json' }
  const call = (rota, init = {}) => fetch(base + rota, init)
  assert.equal((await call('/llms.txt')).status, 200)
  assert.equal((await call('/api/v1/capacidades')).status, 401)
  for (const headers of [{Origin:'https://evil.example'}]) assert.equal((await call('/api/v1/capacidades',{headers:{...auth,...headers}})).status,403)
  const hostStatus = await new Promise(resolve => { const req = http.get(base+'/api/v1/capacidades', {headers:{...auth,Host:'evil.example'}}, res=>{res.resume();resolve(res.statusCode)});req.on('error',resolve) }); assert.equal(hostStatus,403)
  assert.equal((await call('/api/v1/operacoes/blocos/listar', {headers:auth})).status,405)
  for (const body of ['bad json','{"args":{}}']) assert.equal((await call('/api/v1/operacoes/blocos/listar',{method:'POST',headers:auth,body})).status,400)
  const r = await call('/api/v1/operacoes/blocos/listar',{method:'POST',headers:auth,body:'{"args":["2026-09-10"]}'})
  assert.deepEqual(await r.json(),{ok:true,data:{dia:'2026-09-10'}})
  assert.equal((await call('/api/v1/operacoes/blocos/atualizar',{method:'POST',headers:auth,body:'{"args":["id",{}]}'})).status,409)
  assert.equal((await call('/api/v1/operacoes/__proto__/constructor',{method:'POST',headers:auth,body:'{"args":[]}'})).status,404)
})
test('ponte aceita somente renderer vinculado e rejeita ao desconectar',async()=>{
 const p=criarPonteCanvas({timeoutMs:500}); await assert.rejects(p.solicitar({}),{codigo:'EDITOR_INDISPONIVEL'})
 let enviado; p.conectar(1,m=>{enviado=m}); assert.throws(()=>p.conectar(2,()=>{}),{codigo:'EDITOR_OCUPADO'})
 const resultado=p.solicitar({}); p.responder(2,{id:enviado.id,ok:true,data:'forjada'}); p.responder(1,{id:enviado.id,ok:true,data:'correta'}); assert.equal(await resultado,'correta')
 const pendente=p.solicitar({}); p.desconectar(1); await assert.rejects(pendente,{codigo:'EDITOR_INDISPONIVEL'})
})

test('HTTP marca publicar/agendar como canal de agente e não muda a política de publicação', async t => {
  const recebidos = []
  const api = criarApiLocal({ token: 'teste', operacoes: new Map([
    ['editorial:publicar', (id, entrada) => { recebidos.push(['publicar', id, entrada]); return { id } }],
    ['editorial:agendar', (id, entrada) => { recebidos.push(['agendar', id, entrada]); return { id } }],
    ['editorial:configurar-publicacao', () => { throw new Error('não deveria chegar aqui') }],
  ]) })
  const server = http.createServer(api.middleware)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close(); server.closeAllConnections() })
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { Authorization: 'Bearer teste', 'Content-Type': 'application/json' }
  assert.equal((await fetch(`${base}/api/v1/operacoes/editorial/publicar`, { method: 'POST', headers, body: JSON.stringify({ args: ['ed-1', { revisao: 2, canal: 'desktop' }] }) })).status, 200)
  assert.equal((await fetch(`${base}/api/v1/operacoes/editorial/agendar`, { method: 'POST', headers, body: JSON.stringify({ args: ['ed-1', { revisao: 2, agendadoPara: '2026-09-13T12:00:00.000Z' }] }) })).status, 200)
  assert.deepEqual(recebidos, [['publicar', 'ed-1', { revisao: 2, canal: 'api' }], ['agendar', 'ed-1', { revisao: 2, agendadoPara: '2026-09-13T12:00:00.000Z', canal: 'api' }]])
  const r = await fetch(`${base}/api/v1/operacoes/editorial/configurar-publicacao`, { method: 'POST', headers, body: JSON.stringify({ args: [{ modo: 'automatico' }] }) })
  assert.equal(r.status, 403)
  assert.equal((await r.json()).erro.codigo, 'SOMENTE_DESKTOP')
})

test('ponte de candidaturas no Electron aceita todas as operações registradas, incluindo reorientação',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const {ACOES}=require('../electron/candidaturas/operacoes.cjs');const chamadas=[];let ponte
 const source=fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8').split("contextBridge.exposeInMainWorld('dailyworkApi'")[0]
 vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_nome,p)=>ponte=p},ipcRenderer:{invoke:(...a)=>{chamadas.push(a);return Promise.resolve({ok:true})}}})})
 for(const acao of ACOES)await ponte.operar(acao,{fixture:true})
 assert.deepEqual(chamadas.map(c=>c[0]),ACOES.map(a=>'candidaturas:'+a))
 assert.throws(()=>ponte.operar('operacao-inexistente'),/inválida/)
})
