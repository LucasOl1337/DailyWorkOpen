const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const {execFileSync}=require('node:child_process')
const {criarFilaEditorial}=require('../electron/lib-fila-editorial.cjs')
const {criarProducaoEditorial}=require('../electron/lib-producao-editorial.cjs')
const {criarJobsMidiasEditoriais}=require('../electron/lib-jobs-midias-editoriais.cjs')
const {hashConteudo}=require('../electron/lib-editor-editorial.cjs')
function fixture(t){
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-editorial-recovery-'))
 t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}))
 const registro={obterConexao:()=>({capacidades:{midia:{imagem:true}}}),prepararPublicacao:async()=>{throw Error('No publication')},confirmarPublicacao:async()=>{throw Error('No publication')}}
 const fila=criarFilaEditorial({dataDir,registro})
 const skillsDir=path.join(dataDir,'skills')
 fs.mkdirSync(path.join(skillsDir,'aprendizado-em-post'),{recursive:true})
 fs.writeFileSync(path.join(skillsDir,'aprendizado-em-post/SKILL.md'),'Fixture only')
 return {dataDir,registro,fila,skillsDir}
}
async function done(produtor){for(let i=0;i<250;i++){await new Promise(r=>setTimeout(r,2));const p=produtor.estado().producao;if(p.status!=='executando')return p}throw Error('Fixture timeout')}
async function addItem(f){let item={pautaId:'fixture-pauta',conta:'linkedin',idioma:'pt-BR',titulo:'Fixture',texto:'A local draft.',editorial:{pauta:{midia:{tipo:'captura'}},qualidade:{aprovado:true,estado:'aprovada'}}};item.editorial.qualidade.conteudoHash=hashConteudo(item);return f.fila.criar(item)}
function saveJob(f,item,{id='media-recovery',status='producing',estrategia='referencia-real',...extra}={}){
 const d=path.join(f.dataDir,'editorial/media-jobs');fs.mkdirSync(d,{recursive:true})
 const job={id,itemId:item.id,revisao:item.revisao,tipo:'imagem',status,params:{estrategia},outputDir:path.join(d,id),criadoEm:new Date().toISOString(),atualizadoEm:new Date().toISOString(),...extra}
 fs.writeFileSync(path.join(d,id+'.json'),JSON.stringify(job));return job
}
function jobs(f,more={}){return criarJobsMidiasEditoriais({...f,completar:async()=>{throw Error('No text models')},completarComImagens:async()=>{throw Error('No vision')},...more})}
test('next production retries only media after transient failure, preserving text and item identity',async t=>{
 const f=fixture(t),ref='midias/refs/fixture.png',abs=path.join(f.dataDir,'editorial',ref)
 fs.mkdirSync(path.dirname(abs),{recursive:true})
 execFileSync('ffmpeg',['-y','-loglevel','error','-f','lavfi','-i','color=c=white:s=800x600','-frames:v','1',abs])
 const sha=crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
 let failing=true,visions=0,drafts=0,selections=0
 const media=jobs(f,{completarComImagens:async()=>{visions++;if(failing)throw Object.assign(Error('Temporary upstream failure'),{codigo:'FALHA_9ROUTER'});return JSON.stringify({vencedor:'captura',vereditos:[{provedor:'captura',accepted:true,identity_fidelity:'pass',topology:'pass',text:'pass',intent_alignment:'pass'}]})}})
 const produtor=criarProducaoEditorial({...f,jobsMidias:media,lib:{listarBlocos:dia=>dia?[{titulo:'Fixture source',corpo:'A supplied source with factual context.',status:'feito'}]:[]},redator:{prepararPauta:async()=>{selections++;return {titulo:'Fixture',tese:'A source',anguloHash:'same-angle',midia:{tipo:'captura',referencia:ref,referenciaSha256:sha}}},rascunhar:async({pautaEditorial})=>{drafts++;return {contextoUsado:true,rascunho:{texto:'The approved local draft.'},editorial:{pauta:pautaEditorial,qualidade:{estado:'aprovada',aprovado:true}}}}}})
 t.after(()=>produtor.parar())
 const req={dia:'2026-09-16',quantidade:1,contas:['linkedin'],idiomas:['pt-BR']}
 produtor.iniciar(req);assert.equal((await done(produtor)).status,'erro')
 const [before]=await f.fila.listar();assert.equal(before.midias.length,0)
 failing=false;produtor.iniciar(req);const result=await done(produtor)
 assert.equal(result.status,'concluida');const after=await f.fila.listar()
 assert.equal(after.length,1);assert.equal(after[0].id,before.id);assert.equal(after[0].texto,before.texto)
 assert.equal(after[0].revisao,before.revisao+1);assert.equal(after[0].midias.length,1)
 assert.equal(drafts,1);assert.equal(selections,1);assert.equal(visions,3)
})
test('startup reconciles missing items and uncertain generation without executing models or generation',async t=>{
 const f=fixture(t),item=await addItem(f)
 saveJob(f,{...item,id:'deleted-item'},{id:'media-missing'})
 saveJob(f,item,{id:'media-paid',estrategia:'editorial'})
 const before=await f.fila.obter(item.id)
 const media=jobs(f,{gerarImagemCli:{gerar:async()=>{throw Error('Must never generate')}}})
 const result=await media.reconciliarPendentes()
 assert.equal(result.reconciliados.length,2)
 assert.equal(media.obter('media-missing').erro.codigo,'ITEM_NAO_ENCONTRADO')
 assert.equal(media.obter('media-paid').erro.codigo,'MIDIA_RECONCILIACAO_NECESSARIA')
 assert.equal(await media.retomarItem(item.id,item.revisao),null)
 assert.deepEqual(await f.fila.obter(item.id),before)
})
test('startup recognizes attachment already persisted and does not edit the item again',async t=>{
 const f=fixture(t),item=await addItem(f),job=saveJob(f,item)
 const changed=await f.fila.atualizar(item.id,{revisao:item.revisao,midias:[{id:'media-proof',tipo:'imagem',arquivo:'midias/'+job.id+'/proof.png'}]})
 const media=jobs(f);await media.reconciliarPendentes()
 assert.equal(media.obter(job.id).status,'ready');assert.equal((await f.fila.obter(item.id)).revisao,changed.revisao)
})
test('startup does not steal a media job from a live process',async t=>{
 const f=fixture(t),item=await addItem(f),job=saveJob(f,item)
 fs.writeFileSync(path.join(f.dataDir,'editorial/media-jobs',job.id+'.lock'),JSON.stringify({pid:process.pid}))
 const media=jobs(f);assert.deepEqual(await media.reconciliarPendentes(),{reconciliados:[]});assert.equal(media.obter(job.id).status,'producing')
})
test('rejected or cancelled media and stale text are not retried automatically',async t=>{
 const f=fixture(t),item=await addItem(f)
 saveJob(f,item,{status:'failed',erro:{codigo:'REFERENCIA_INADEQUADA',mensagem:'Not a suitable capture'}})
 const media=jobs(f);assert.equal(await media.retomarItem(item.id,item.revisao),null)
 assert.equal(await media.retomarItem(item.id,item.revisao+1),null)
 saveJob(f,item,{status:'cancelled'})
 assert.equal(await media.retomarItem(item.id,item.revisao),null)
})
test('stock reserves publicable and in-flight pieces while reporting blocked pieces separately',()=>{
 const {classificarEstoqueEditorial}=require('../electron/lib-estoque-editorial.cjs')
 assert.deepEqual(classificarEstoqueEditorial([
  {estado:'pendente',prontidao:{pronta:true}},
  {estado:'pendente',prontidao:{pronta:false,bloqueios:[{codigo:'SEM_MIDIA'}]}},
  {estado:'aguardando_executor'},{estado:'agendado'},{estado:'publicando'},
  {estado:'publicado'},{estado:'recusado'},
 ]),{prontas:1,bloqueadas:1,emAndamento:3,semAvaliacao:0,ocupado:4})
})
test('full stock stops scheduled production before provider checks or planning',async()=>{
 const {criarAdaptadores}=require('../electron/agenda/adaptadores.cjs')
 let calls=0
 const fail=()=>{calls++;throw Error('Must not plan')}
 const a=criarAdaptadores({filaEditorial:{listar:async()=>[{estado:'pendente',prontidao:{pronta:true}}]},producaoEditorial:{estado:()=>({producao:{status:'ociosa'}}),iniciar:fail},agente:{configuracao:fail,completar:fail}})
 const r=await a.producao.iniciar({ocorrencia:{id:'fixture'},rotina:{estoqueAlvo:1}})
 assert.equal(r.estado,'sem_trabalho');assert.equal(calls,0);assert.equal(r.estoque.prontas,1)
})

for (const pausa of ['inicio', 'releitura']) test(`cancelar na ${pausa} da retomada preserva cancelamento e não registra sucesso`, async t=>{
 const f=fixture(t),item=await addItem(f)
 let entrou,liberar,cancelamentos=0,anexos=0
 const iniciada=new Promise(r=>entrou=r),espera=new Promise(r=>liberar=r)
 const p=criarProducaoEditorial({...f,redator:{},fila:{listar:async()=>[item],criar:async()=>{throw Error('Não recriar texto')},obter:async()=>{if(pausa==='releitura'){entrou();await espera}return item}},jobsMidias:{
  retomarItem:async()=>{if(pausa==='inicio'){entrou();await espera}return {job:{id:'fixture-job'}}},
  aguardar:async()=>{anexos++;return {status:'ready',midias:[{id:'fixture-media'}]}},cancelar:()=>cancelamentos++,
 }})
 t.after(()=>p.parar())
 p.iniciar({dia:'2026-09-16',quantidade:1,contas:['linkedin'],idiomas:['pt-BR']})
 await iniciada;p.cancelar();liberar()
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))
 assert.equal(cancelamentos,1)
 assert.equal(anexos,pausa==='inicio'?0:1)
 assert.equal(p.estado().producao.status,'cancelada')
 assert.equal(p.estado().producao.criados.length,0)
})

test('imagem retomada completa também o vídeo configurado antes de concluir', async t=>{
 const f=fixture(t),item=await addItem(f),etapas=[]
 f.registro.obterConexao=()=>({capacidades:{midia:{imagem:true,video:true}}})
 const media={retomarItem:async()=>({job:{id:'imagem'}}),iniciar:async req=>{etapas.push(req.tipo);assert.equal(req.revisao,2);return {job:{id:'video'}}},aguardar:async id=>{
  etapas.push(id+'-pronto');const atual=await f.fila.obter(item.id)
  await f.fila.atualizar(item.id,{revisao:atual.revisao,midias:[...atual.midias,{id,tipo:id==='imagem'?'imagem':'video',arquivo:'midias/fixture/'+id}]})
  return {status:'ready',midias:[{id}]}
 }}
 const p=criarProducaoEditorial({...f,redator:{},jobsMidias:media});t.after(()=>p.parar());p.configurar({formatoMidia:'video'})
 p.iniciar({dia:'2026-09-16',quantidade:1,contas:['linkedin'],idiomas:['pt-BR']})
 assert.equal((await done(p)).status,'concluida');assert.deepEqual(etapas,['imagem-pronto','video','video-pronto'])
 assert.ok((await f.fila.obter(item.id)).midias.some(m=>m.tipo==='video'))
})
