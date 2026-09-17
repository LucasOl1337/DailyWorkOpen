const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {criarAdaptadores}=require('../electron/agenda/adaptadores.cjs')
const {criarContexto}=require('../electron/agenda/contexto.cjs')
const {endpointChromium,criarNavegador}=require('../electron/candidaturas/navegador.cjs')
function servicos(){return {lib:{listarBlocos:dia=>dia==='2026-09-14'?[{id:'evidencia',titulo:'Entrega comprovada',corpo:'Resultado observado no projeto',status:'feito'}]:[]},sumario:{obterInputs:()=>({inputs:[]})},analiseSumario:{obter:()=>({})},filaEditorial:{listar:async()=>[]},agente:{completar:async()=>({mensagem:JSON.stringify({resumo:'Planejamento',briefing:'Priorize evidências',fontesUsadas:['dia:2026-09-14'],diasEditorial:['2026-09-14'],ajustes:[]})})},candidaturas:{},producaoEditorial:{},automacoes:{}}}
function contexto(tipo='producao'){const cache=new Map(),o={id:'ocorrencia',dia:'2026-09-15',tokens:0,realizado:0};return {ocorrencia:o,rotina:{id:tipo,tipo,modulo:tipo,quantidade:2,metaDiaria:3,fuso:'America/Sao_Paulo',fontes:[],contas:['x'],idiomas:['pt-BR'],estoqueAlvo:12},orientacoes:[],arquivo:'/unused',autorizar:()=>{},checkpoint:v=>Object.assign(o,v),contexto:(k,v)=>{if(v)cache.set(k,v);return cache.get(k)},saldo:3}}
test('contexto usa os últimos 30 dias e reutiliza análise só enquanto fontes e instruções permanecem iguais',async()=>{
 const s=servicos();let calls=0;const original=s.agente.completar;s.agente.completar=async e=>{calls++;const d=JSON.parse(e.mensagens[1].content);assert.equal(d.fontes[0].janela,'semana');return original(e)}
 const preparar=criarContexto(s),ctx=contexto();const a=await preparar(ctx);await preparar(ctx);assert.equal(calls,1)
 ctx.orientacoes=[{escopo:'producao',texto:'Nova direção',revisao:1}];const b=await preparar(ctx);assert.equal(calls,2);assert.notEqual(a.hash,b.hash)
})
test('produção recebe dias escolhidos pela IA, limite de estoque e vínculo persistente',async()=>{
 const s=servicos();let entrada;s.producaoEditorial={estado:()=>({producao:{status:'ociosa'}}),iniciar:e=>{entrada=e;return {producao:{id:'lote'}}}}
 const a=criarAdaptadores(s),ctx=contexto();const r=await a.producao.iniciar(ctx)
 assert.deepEqual(entrada.diasContexto,['2026-09-14']);assert.equal(entrada.limiteVersoes,12);assert.equal(entrada.agenda.id,'ocorrencia');assert.equal(r.referencia.id,'lote')
})
test('pausa interna de recuperação usa o serviço original e não aciona a pausa humana do módulo',()=>{
 const s=servicos();let n=0;s.candidaturas={missao:()=>({estado:'executando'}),controlar:()=>n++}
 const a=criarAdaptadores(s);s.candidaturas.controlar=()=>{throw new Error('wrapper humano não pode ser usado')}
 a.candidaturas.cancelar({referencia:{id:'missao'}});assert.equal(n,1)
})
test('recibo visual pendente não é contado como publicado; retomada apenas consulta o destino',async()=>{
 const s=servicos(),item={id:'p1',estado:'pendente',revisao:1,agenda:{id:'producao'}};let envios=0
 s.filaEditorial={listar:async()=>[item],verificar:async()=>({bloqueios:[]}),publicar:async()=>{envios++;item.estado='aguardando_executor';return item}}
 const a=criarAdaptadores(s),ctx=contexto('publicacao');let r=await a.publicacao.iniciar(ctx)
 assert.equal(r.estado,'executando');assert.equal(r.realizado,0);Object.assign(ctx.ocorrencia,r)
 r=await a.publicacao.consultar(ctx);assert.equal(envios,1);assert.equal(r.estado,'executando')
 item.estado='publicado';r=await a.publicacao.consultar(ctx);assert.equal(r.realizado,1);assert.equal(r.estado,'concluida')
})
test('publicação bloqueada por qualidade continua na fila sem chamar transporte',async()=>{
 const s=servicos();let envios=0;s.filaEditorial={listar:async()=>[{id:'p1',estado:'pendente',agenda:{id:'l'}}],verificar:async()=>({bloqueios:[{mensagem:'Revisão inválida'}]}),publicar:async()=>envios++}
 const r=await criarAdaptadores(s).publicacao.iniciar(contexto('publicacao'));assert.equal(envios,0);assert.equal(r.estado,'bloqueada');assert.equal(r.bloqueios[0].motivo,'Revisão inválida')
})
test('conector ignora endpoint pessoal e usa exclusivamente o perfil da bancada',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-bench-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pessoal=path.join(home,'.config/chromium');fs.mkdirSync(pessoal,{recursive:true});fs.writeFileSync(path.join(pessoal,'DevToolsActivePort'),'9222\n/devtools/browser/pessoal')
 assert.throws(()=>endpointChromium(home),{codigo:'CHROMIUM_CONEXAO_AUSENTE'})
 const bancada=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(bancada,{recursive:true});fs.writeFileSync(path.join(bancada,'DevToolsActivePort'),'12345\n/devtools/browser/bancada')
 assert.equal(endpointChromium(home),'ws://127.0.0.1:12345/devtools/browser/bancada')
})
test('conexão ausente tenta abrir o navegador uma vez e mantém o bloqueio explícito',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-chromium-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));let n=0
 const navi=criarNavegador({home,autorizar:()=>{},abrirAutomaticamente:true,abrir:()=>n++})
 await assert.rejects(navi.conectar(),{codigo:'CHROMIUM_CONEXAO_AUSENTE'});await assert.rejects(navi.conectar(),{codigo:'CHROMIUM_CONEXAO_AUSENTE'});assert.equal(n,1)
})
test('instalador produz uma unidade válida para o consumidor systemd',t=>{
 const {execFileSync}=require('node:child_process'),{configuracao}=require('../scripts/install-agenda-linux.cjs')
 const electron=path.join(__dirname,'../node_modules/electron/dist/electron')
 if(!fs.existsSync(electron)) { t.skip('binário do Electron ausente neste ambiente'); return }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const c=configuracao(),arquivo=path.join(dir,'dailywork.service');fs.writeFileSync(arquivo,c.unidade)
 execFileSync('systemd-analyze',['--user','verify',arquivo],{stdio:'pipe'})
})

test('preload expõe a agenda e as pontes uma única vez no contexto isolado',()=>{
 const vm=require('node:vm'),expostos=new Map()
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(nome,api)=>{assert.ok(!expostos.has(nome),'ponte duplicada: '+nome);expostos.set(nome,api)}},ipcRenderer:{}})})
 assert.equal(typeof expostos.get('agendaApi').operar,'function')
})
test('porta salva com conexão recusada continua sendo falha transitória, antes da IA',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-porta-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));fs.mkdirSync(path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium'),{recursive:true});fs.writeFileSync(path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium/DevToolsActivePort'),'9222\n/devtools/browser/teste')
 let abriu=0;const n=criarNavegador({home,conferirAlvos:async()=>{throw Object.assign(new Error('endpoint fixture recusado'),{codigo:'CHROMIUM_CONEXAO_AUSENTE'})},autorizar:()=>{},abrirAutomaticamente:true,abrir:()=>abriu++,chromium:{connectOverCDP:async()=>{throw new Error('timeout')}}})
 await assert.rejects(n.conectar(),{codigo:'CHROMIUM_CONEXAO_AUSENTE'});assert.equal(abriu,1)
})

test('migração encontra instância Electron com argv reescrito e ignora subprocessos e outros aplicativos',t=>{
 const {processosAnteriores}=require('../scripts/install-agenda-linux.cjs')
 const proc=fs.mkdtempSync(path.join(os.tmpdir(),'dw-electron-'));t.after(()=>fs.rmSync(proc,{recursive:true,force:true}))
 const exe='/apps/Daily Work/node_modules/electron/dist/electron'
 for(const [pid,bin,cmd] of [[1,exe,exe+' --toggle /apps/Daily Work\0'],[2,exe,exe+' --type=zygote\0'],[3,'/other/electron','/other/electron\0']]){
  fs.mkdirSync(path.join(proc,String(pid)));fs.symlinkSync(bin,path.join(proc,String(pid),'exe'));fs.writeFileSync(path.join(proc,String(pid),'cmdline'),cmd)
 }
 assert.deepEqual(processosAnteriores(exe,proc),[1])
})

test('botões legados de campanha e publicação reservam recurso e preservam resposta de domínio',async()=>{
 const {conectarManuais}=require('../electron/agenda/manuais.cjs');const reservas=[]
 const ctx={agenda:{id:'oc1'},rotina:{quantidade:2,executor:'nativo'},saldo:2}
 const a={abrirPerfil:async()=>{},executarAgora:async e=>({id:'camp1',agenda:e.agenda})}
 const s={candidaturas:{},automacoes:{paraCampanha:()=>a},filaEditorial:{publicar:async(id,e)=>({id,estado:'publicado',agenda:e.agenda})}}
 conectarManuais(s,{manual:async(e,fn)=>{reservas.push(e.rotinaId);return (await fn(ctx)).resposta}})
 assert.equal((await s.automacoes.executarAgora()).id,'camp1')
 assert.equal((await s.filaEditorial.publicar('p1')).estado,'publicado')
 assert.deepEqual(reservas,['campanha:cognition','publicacao'])
})

test('disparo focado de campanha reserva uma execução avulsa',async()=>{
 const {conectarManuais}=require('../electron/agenda/manuais.cjs');let reserva
 const a={abrirPerfil:async()=>{},executarAgora:async e=>({id:'focado',alvoId:e.alvoId})}
 const s={candidaturas:{},automacoes:{paraCampanha:()=>a}}
 conectarManuais(s,{manual:async(e,fn)=>{reserva=e;return (await fn({agenda:{id:'oc'},rotina:{quantidade:2,executor:'nativo'},saldo:0})).resposta}})
 assert.equal((await s.automacoes.paraCampanha('cognition').executarAgora({alvoId:'alvo-1'})).alvoId,'alvo-1')
 assert.equal(reserva.avulsa,true)
})

test('contexto volumoso de trinta dias preserva todas as janelas dentro do limite do modelo',async()=>{
 const s=servicos();s.lib.listarBlocos=()=>Array.from({length:40},(_,i)=>({id:'b'+i,tipo:'nota',titulo:'Tema',corpo:'x'.repeat(2000),fontes:['x'.repeat(5000)]}))
 s.sumario.obterInputs=()=>({inputs:Array.from({length:15},(_,i)=>({id:'i'+i,text:'x'.repeat(2000)}))})
 s.analiseSumario.obter=()=>({analysis:{resumo:'x'.repeat(9000)}})
 s.filaEditorial.listar=async()=>Array.from({length:100},(_,i)=>({id:'p'+i,titulo:'Tema',texto:'x'.repeat(2000)}))
 s.agente.completar=async({mensagens})=>{assert.ok(JSON.stringify(mensagens).length<180000);const d=JSON.parse(mensagens[1].content);assert.equal(d.fontes.length,30);assert.deepEqual([...new Set(d.fontes.map(f=>f.janela))],['dia','semana','mes']);return {mensagem:JSON.stringify({resumo:'Resumo',briefing:'Plano',diasEditorial:[]})}}
 await criarContexto(s)(contexto())
})

test('ordem citada no histórico não cria bloqueio global sem orientação vigente',async()=>{
 const s=servicos();s.agente.completar=async()=>({mensagem:JSON.stringify({resumo:'Plano',briefing:'Continuar as vagas disponíveis',diasEditorial:[],bloqueio:'Um formulário exige CPF; interromper tudo'})})
 const p=await criarContexto(s)(contexto('candidaturas'));assert.equal(p.bloqueio,null)
})
test('ambiguidade aponta a revisão da orientação humana vigente',async()=>{
 const s=servicos();s.agente.completar=async()=>({mensagem:JSON.stringify({resumo:'Plano',briefing:'Falta destino',diasEditorial:[],bloqueio:{mensagem:'Qual conta?',escopo:'editorial',revisao:2}})})
 const ctx=contexto();ctx.orientacoes=[{texto:'Use só aquela conta',escopo:'editorial',revisao:2}]
 assert.equal((await criarContexto(s)(ctx)).bloqueio,'Qual conta?')
 ctx.orientacoes[0].revisao=3;assert.equal((await criarContexto(s)(ctx)).bloqueio,null)
})

test('retomada explícita reativa missão pausada preservando a base das confirmações',async()=>{
 const s=servicos();let retomou=0;const m={id:'m',estado:'pausada',confirmadas:11,agenda:{id:'ocorrencia'}}
 s.candidaturas={estado:()=>({missoes:[m],candidaturas:[]}),controlar:e=>{retomou++;assert.equal(e.acao,'retomar');return {...m,estado:'executando'}}}
 s.navegadorCandidaturas=()=>({conectar:async()=>{},fechar:async()=>{}})
 const ctx=contexto('candidaturas');ctx.ocorrencia={...ctx.ocorrencia,retomadaSolicitada:true,referencia:{id:'m',inicial:10}}
 const r=await criarAdaptadores(s).candidaturas.consultar(ctx);assert.equal(retomou,1);assert.equal(r.referencia.inicial,10);assert.equal(r.retomadaSolicitada,false)
})
test('retomada por id usa o contexto salvo e não espera outro planejamento de IA',async()=>{
 const s=servicos();let planejamentos=0,entrada
 s.agente.completar=async()=>{planejamentos++;throw new Error('não deve planejar')}
 const m={id:'m',estado:'interrompida',confirmadas:11,agenda:{briefing:'Plano anterior'}}
 s.candidaturas={estado:()=>({missoes:[m],candidaturas:[],preferencias:{}}),controlar:e=>{entrada=e;return {...m,estado:'executando'}}}
 s.navegadorCandidaturas=()=>({conectar:async()=>{},fechar:async()=>{}})
 const ctx=contexto('candidaturas');ctx.ocorrencia.entrada={missaoId:'m'}
 const r=await criarAdaptadores(s).candidaturas.iniciar(ctx)
 assert.equal(planejamentos,0);assert.equal(entrada.id,'m');assert.match(entrada.agenda.briefing,/Plano anterior/);assert.equal(r.referencia.inicial,11)
})

test('retomada reutiliza plano salvo somente enquanto as orientações são as mesmas',async()=>{
 const s=servicos();let planejamentos=0,retomadas=0
 const original=s.agente.completar;s.agente.completar=async(...args)=>{planejamentos++;return original(...args)}
 const m={id:'m',estado:'pausada',confirmadas:10,agenda:{id:'ocorrencia'}}
 s.candidaturas={estado:()=>({missoes:[m],candidaturas:[]}),controlar:()=>{retomadas++;return {...m,estado:'executando'}}}
 s.navegadorCandidaturas=()=>({conectar:async()=>{},fechar:async()=>{}})
 const ctx=contexto('candidaturas');ctx.ocorrencia={...ctx.ocorrencia,retomadaSolicitada:true,referencia:{id:'m',inicial:10},decisao:{briefing:'Plano salvo',instrucaoRevisao:''}}
 await criarAdaptadores(s).candidaturas.consultar(ctx);assert.equal(planejamentos,0);assert.equal(retomadas,1)
 ctx.ocorrencia.retomadaSolicitada=true;ctx.orientacoes=[{escopo:'candidaturas',revisao:1,texto:'Priorize backend'}]
 await criarAdaptadores(s).candidaturas.consultar(ctx);assert.equal(planejamentos,1)
})
test('publicação drena peça pendente sem vínculo de agenda, mesma população que o estoque da produção',async()=>{
 const s=servicos();const item={id:'manual-1',estado:'pendente',revisao:1};let envios=0
 s.filaEditorial={listar:async()=>[item],verificar:async()=>({bloqueios:[]}),publicar:async()=>{envios++;item.estado='publicado';return item}}
 const r=await criarAdaptadores(s).publicacao.iniciar(contexto('publicacao'))
 assert.equal(envios,1);assert.equal(r.estado,'concluida');assert.equal(r.realizado,1)
})
test('contexto respeita o orçamento global mesmo com muitos dias, acervo e histórico',async()=>{
 const {caberNoOrcamento,ORCAMENTO_CONTEXTO}=require('../electron/agenda/contexto.cjs')
 const grande='x'.repeat(9000)
 const dados={dia:'2026-09-15',rotinas:[],modulo:'editorial',fontes:Array.from({length:30},(_,n)=>({id:`dia:${n}`,dia:String(n),janela:n?'mes':'dia',blocos:[{id:'b',corpo:grande}],inputs:[],analise:''})),acervo:Array.from({length:30},(_,n)=>({id:`a${n}`,corpo:grande})),historico:Array.from({length:40},(_,n)=>({id:`h${n}`,texto:'y'.repeat(250)})),orientacoes:[]}
 assert.ok(JSON.stringify(dados).length>ORCAMENTO_CONTEXTO)
 caberNoOrcamento(dados)
 assert.ok(JSON.stringify(dados).length<=ORCAMENTO_CONTEXTO)
 assert.equal(dados.fontes[0].id,'dia:0')
 const s=servicos();s.lib.listarBlocos=dia=>Array.from({length:30},(_,n)=>({id:`${dia}-${n}`,titulo:'t',corpo:grande,status:'feito',tipo:'nota'}))
 let chars=0;s.agente.completar=async({mensagens})=>{chars=mensagens.reduce((t,m)=>t+m.content.length,0);return {mensagem:JSON.stringify({resumo:'ok',briefing:'ok',fontesUsadas:[],diasEditorial:['2026-09-15'],ajustes:[]})}}
 await criarContexto(s)(contexto('producao'))
 assert.ok(chars>0&&chars<180_000,`pedido com ${chars} caracteres`)
})
test('produção recusa provedor sem catálogo editorial com mensagem clara e segue com 9router',async()=>{
 const s=servicos();let iniciados=0
 s.producaoEditorial={estado:()=>({producao:{status:'ociosa'},config:{midiaAutomatica:true}}),iniciar:()=>{iniciados++;return {producao:{id:'lote'}}}}
 s.agente.configuracao=async()=>({provider:'grok-cli',capacidades:{imagens:false}})
 await assert.rejects(criarAdaptadores(s).producao.iniciar(contexto('producao')),e=>e.codigo==='PROVEDOR_EDITORIAL')
 assert.equal(iniciados,0)
 s.agente.configuracao=async()=>({provider:'9router',capacidades:{imagens:true}})
 const r=await criarAdaptadores(s).producao.iniciar(contexto('producao'))
 assert.equal(iniciados,1);assert.equal(r.referencia.id,'lote')
})
