const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'..')
require('node:http').get=()=>{throw new Error('HTTP real proibido no ensaio')}
global.fetch=()=>{throw new Error('Fetch real proibido no ensaio')}
const {conferirAlvosResponsivos}=require(path.join(root,'electron/automacoes/cdp-saude.cjs'))
test('timeout preserva abas pendentes e desconhecidas sem emitir fechamento',async()=>{
 const comandos=[]
 await assert.rejects(conferirAlvosResponsivos(9999,{lerJson:async()=>[{id:'pending',type:'page',webSocketDebuggerUrl:'ws://fixture/pending'},{id:'unknown',type:'page',webSocketDebuggerUrl:'ws://fixture/unknown'}],enviar:async(_url,metodo)=>{comandos.push(metodo);return null}}),e=>e.codigo==='CHROMIUM_ABA_SEM_RESPOSTA'&&e.alvos.length===2)
 assert.deepEqual(comandos,['Runtime.evaluate','Runtime.evaluate'])
})
test('sondagem saudável usa só transporte injetado',async()=>{
 const r=await conferirAlvosResponsivos(9999,{lerJson:async()=>[{id:'ok',type:'page',webSocketDebuggerUrl:'ws://fixture/ok'}],enviar:async()=>({id:1,result:{result:{value:1}}})})
 assert.equal(r.verificadas,1)
})
test('campanhas propaga aba sem resposta antes de conectar Playwright',async()=>{
 const {criarNavegador}=require(path.join(root,'electron/automacoes/navegador.cjs'))
 let connections=0
 const nav=criarNavegador({conferirAlvos:async()=>{throw Object.assign(new Error('preservada'),{codigo:'CHROMIUM_ABA_SEM_RESPOSTA'})}})
 await assert.rejects(nav.conectarPlaywright({connectOverCDP:async()=>{connections++}},{conectado:true,endpoint:'ws://fixture',controle:'agente',porta:9999}),{codigo:'CHROMIUM_ABA_SEM_RESPOSTA'})
 assert.equal(connections,0)
})
test('candidaturas propaga diagnóstico e mocks não alcançam porta real',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-cdp-fixture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const p=path.join(dir,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'DevToolsActivePort'),'9999\n/devtools/browser/fixture\n')
 let connections=0
 const {criarNavegador}=require(path.join(root,'electron/candidaturas/navegador.cjs'))
 const nav=criarNavegador({home:dir,bancada:{},abrirAutomaticamente:false,autorizar(){},chromium:{connectOverCDP:async()=>{connections++}},conferirAlvos:async()=>{throw Object.assign(new Error('preservada'),{codigo:'CHROMIUM_ABA_SEM_RESPOSTA'})}})
 await assert.rejects(nav.conectar(),{codigo:'CHROMIUM_ABA_SEM_RESPOSTA'});assert.equal(connections,0)
})
function actionFixture(agenda){
 const filename=path.join(root,'electron/automacoes/navegador.cjs');let seen
 const guardError=Object.assign(new Error('instrução alterada'),{codigo:'ORIENTACAO_ALTERADA'})
 const r=name=>name==='../agenda/guarda.cjs'?{conferir:v=>{seen=v;throw guardError}}:name==='./arquivos.cjs'?require(path.join(root,'electron/automacoes/arquivos.cjs')):require(name)
 r.main=null
 const box={require:r,module:{exports:{}},process,__filename:filename,__dirname:path.dirname(filename),globalThis,setTimeout,clearTimeout}
 vm.runInNewContext(fs.readFileSync(filename,'utf8')+'\nmodule.exports.auditAction = acaoNavegador',box)
 return {run:()=>box.module.exports.auditAction({acao:'clicar',origem:agenda===undefined?{}:{agenda}}),seen:()=>seen}
}
test('ação interna usa vínculo explícito e bloqueia orientação alterada antes de navegar',async()=>{
 const vinculo={id:'current',arquivo:'/fixture/agenda.sqlite'},f=actionFixture(vinculo)
 await assert.rejects(f.run(),{codigo:'ORIENTACAO_ALTERADA'});assert.equal(f.seen(),vinculo)
})
test('ação interna sem envelope agenda falha; manual explícito não herda servidor',async()=>{
 await assert.rejects(actionFixture(undefined).run(),{codigo:'AGENDA_VINCULO_AUSENTE'})
 const f=actionFixture(null);await assert.rejects(f.run(),{codigo:'ORIENTACAO_ALTERADA'});assert.equal(f.seen(),null)
})
async function runFixture(t,code){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-research-fixture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const base=path.join(dir,'Portfolio/empresas/cognition');fs.mkdirSync(base,{recursive:true});fs.writeFileSync(path.join(base,'findings.md'),'# Fixture\nFato local.');fs.writeFileSync(path.join(base,'estado.json.local'),'{}')
 const keys=['LUCASOL_DIR','DAILYWORK_DATA_DIR','AUTOMACOES_CAMPANHA_ID','AUTOMACOES_TIPO','AUTOMACOES_ALVO_ID','AUTOMACOES_EXECUTOR','DAILYWORK_AGENDA_ID','DAILYWORK_AGENDA_DB']
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]])),exit=process.exitCode
 const ex=require(path.join(root,'electron/automacoes/executores.cjs')),original=ex.comandoExecutor
 try{
  for(const k of keys)delete process.env[k]
  Object.assign(process.env,{LUCASOL_DIR:dir,DAILYWORK_DATA_DIR:path.join(dir,'data'),AUTOMACOES_CAMPANHA_ID:'cognition',AUTOMACOES_TIPO:'pesquisa'})
  ex.comandoExecutor=()=>({bin:process.execPath,args:['-e',code],env:{},stdin:'fixture',nome:'Node fixture'})
  await require(path.join(root,'electron/automacoes/rodar.cjs')).rodar({navegador:{trava:path.join(dir,'browser.lock'),estado:async()=>({nome:'fixture',workspace:9,conectado:true,controle:'agente'})}})
  const folder=path.join(base,'runs/execucoes'),n=fs.readdirSync(folder).find(n=>n.endsWith('.json.local'));return JSON.parse(fs.readFileSync(path.join(folder,n)))
 }finally{ex.comandoExecutor=original;process.exitCode=exit;for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k]}}
}
test('pesquisa no-op não é entrega e recebe erro recuperável',async t=>{
 const result=await runFixture(t,'process.stdin.resume()');assert.equal(result.status,'falhou');assert.equal(result.codigo,'PESQUISA_SEM_RESULTADO')
})
test('pesquisa salva por esta execução preserva resultado e stdout de CLI',async t=>{
 const code=`(async()=>{const arquivos=require(${JSON.stringify(path.join(root,'electron/automacoes/arquivos.cjs'))}).criarArquivos({lucasOlDir:process.env.LUCASOL_DIR,dataDir:process.env.DAILYWORK_DATA_DIR});const pesquisa=require(${JSON.stringify(path.join(root,'electron/automacoes/campanhas.cjs'))}).criarPesquisa(arquivos);await pesquisa.salvar({revisao:pesquisa.obter().revisao,notas:'Sem novidade; fontes verificadas nesta rodada.',pessoas:[],fontes:[]});process.stdout.write('Pesquisa verificada, sem novidade.');})().catch(e=>{console.error(e);process.exitCode=1})`
 const result=await runFixture(t,code);assert.equal(result.status,'concluida');assert.equal(result.resultado.tipo,'pesquisa');assert.equal(result.resumo,'Pesquisa verificada, sem novidade.')
})
