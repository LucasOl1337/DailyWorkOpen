const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {criarAgenda,local,instante}=require('../electron/agenda/servico.cjs')
const {padroes}=require('../electron/agenda/padroes.cjs')
const drenar=()=>new Promise(r=>setImmediate(r))
function fixture(t,adapter={iniciar:async()=>({estado:'concluida',realizado:1}),consultar:async()=>({estado:'concluida'})},extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-agenda-'));let agora=Date.parse('2026-09-15T13:00:00Z')
 const r={...padroes().find(r=>r.id==='candidaturas'),horarios:['10:00','15:00'],...extra}
 const opts={arquivo:path.join(dir,'agenda.sqlite'),rotinas:[r],adaptadores:{candidaturas:adapter},now:()=>agora,onError:()=>{}}
 let a=criarAgenda(opts);t.after(()=>{a.close();fs.rmSync(dir,{recursive:true,force:true})})
 return {get a(){return a},r,async tick(){await a.tick();await drenar()},tempo:ms=>agora=ms,reabrir(){a.close();a=criarAgenda(opts)},arquivo:opts.arquivo}
}
test('candidaturas usam meta diária padrão de 60 em duas rodadas de 30',()=>{
 const r=padroes().find(r=>r.id==='candidaturas')
 assert.equal(r.metaDiaria,60);assert.equal(r.quantidade,30);assert.equal(r.minutos,120)
})
test('três dias, recorrência e idempotência sem acumular dias anteriores',async t=>{
 let n=0;const f=fixture(t,{iniciar:async()=>({estado:'concluida',realizado:++n}),consultar:async()=>null})
 for(let d=15;d<=17;d++){f.tempo(Date.parse(`2026-09-${d}T13:00:00Z`));await f.tick();await f.tick()}
 assert.equal(n,3);assert.equal(f.a.estado({dia:'2026-09-15'}).ocorrencias.filter(o=>o.estado==='expirada').length,1)
})
test('manual simultâneo usa a ocorrência vencida e não duplica o executor',async t=>{
 let n=0;const f=fixture(t,{iniciar:async()=>{n++;return {referencia:{id:'real'}}},consultar:async()=>null})
 f.a.materializar();const a=f.a.executar({rotinaId:f.r.id}),b=f.a.executar({rotinaId:f.r.id});assert.equal(a.id,b.id)
 await f.tick();await f.tick();assert.equal(n,1)
})
test('rodada extra manual continua válida depois do fim da janela recorrente',async t=>{
 let n=0;const f=fixture(t,{iniciar:async ctx=>{n++;ctx.autorizar();return {estado:'concluida',realizado:1}},consultar:async()=>null})
 f.tempo(Date.parse('2026-09-16T00:00:00Z')) // 21:00 em São Paulo; rotina termina às 20:00.
 const o=f.a.executar({rotinaId:f.r.id});await f.tick()
 assert.equal(n,1);assert.equal(f.a.obter(o.id).estado,'concluida')
})
test('reinício adota a referência do executor sem novo envio',async t=>{
 let n=0,p=0;const f=fixture(t,{iniciar:async()=>{n++;return {referencia:{id:'missao'}}},consultar:async()=>{p++;return {estado:'concluida'}}})
 await f.tick();f.reabrir();await f.tick();assert.equal(n,1);assert.equal(p,1)
})
test('retry 1, 5, 15 minutos e bloqueio após esgotar tentativas',async t=>{
 let n=0;const f=fixture(t,{iniciar:async()=>{n++;throw Object.assign(new Error('rede'),{codigo:'ECONNRESET'})}})
 await f.tick();let o=f.a.estado().ocorrencias[0];assert.equal(o.tentarEm,Date.parse('2026-09-15T13:01:00Z'))
 for(const delta of [1,5,15]){f.tempo(o.tentarEm);await f.tick();o=f.a.obter(o.id)}
 assert.equal(n,4);assert.equal(o.estado,'bloqueada')
})
test('retomada manual remove a espera automática anterior',async t=>{
 const f=fixture(t,{iniciar:async()=>{throw Object.assign(new Error('rede'),{codigo:'ECONNRESET'})}})
 await f.tick();const o=f.a.estado().ocorrencias[0]
 assert.ok(o.tentarEm>Date.parse('2026-09-15T13:00:00Z'))
 await f.a.controlar({id:o.id,acao:'retomar'})
 const retomada=f.a.obter(o.id)
 assert.equal(retomada.estado,'agendada');assert.equal(retomada.tentarEm,null);assert.equal(retomada.codigo,null)
})
test('pausa humana persiste ao reiniciar e não relança execução',async t=>{
 let n=0,c=0;const f=fixture(t,{iniciar:async()=>{n++;return {referencia:{id:'m'}}},consultar:async()=>null,cancelar:async()=>{c++}})
 await f.tick();await f.a.controlar({modulo:'candidaturas',acao:'pausar_hoje'});f.reabrir();await f.tick()
 assert.equal(n,1);assert.equal(c,1);assert.equal(f.a.estado().rotinas[0].pausada,true)
})
test('nova orientação invalida autorização e expira no próximo dia',async t=>{
 const f=fixture(t,{iniciar:async()=>({referencia:{id:'m'}}),consultar:async()=>null,cancelar:async()=>{}})
 await f.tick();const o=f.a.estado().ocorrencias[0];f.a.instruir({escopo:'todos',texto:'Priorize IA hoje.'})
 assert.throws(()=>f.a.autorizar(o.id),{codigo:'ORIENTACAO_ALTERADA'});await f.tick();assert.equal(f.a.obter(o.id).estado,'aguardando')
 f.tempo(Date.parse('2026-09-16T13:00:00Z'));assert.deepEqual(f.a.estado({modulo:'candidaturas'}).orientacoes,[])
})
test('meta diária conta rodadas extras e não é zerada por reinício',async t=>{
 const f=fixture(t,undefined,{metaDiaria:1});await f.tick();f.reabrir();f.a.executar({rotinaId:f.r.id});await f.tick()
 assert.equal(f.a.estado().rotinas[0].uso.realizado,1);assert.ok(f.a.estado().ocorrencias.some(o=>o.estado==='sem_trabalho'))
})
test('consumo continua reportado sem bloquear autorização, reinício ou próxima tentativa',async t=>{
 let chamadas=0
 const f=fixture(t,{iniciar:async ctx=>{chamadas++;ctx.checkpoint({tokens:2000000});ctx.autorizar();if(chamadas===1)throw Object.assign(new Error('timeout'),{codigo:'TIMEOUT'});return {estado:'concluida',realizado:1}}}, {tokens:100})
 await f.tick();assert.equal(f.a.estado().ocorrencias[0].estado,'aguardando')
 f.reabrir();assert.equal('tokens' in f.a.rotina(f.r.id),false)
 f.tempo(Date.parse('2026-09-15T13:01:00Z'));await f.tick()
 assert.equal(chamadas,2);assert.equal(f.a.estado().ocorrencias[0].estado,'concluida');assert.equal(f.a.estado().rotinas[0].uso.tokens,2000000)
})
test('conflito de revisão preserva a configuração mais recente',t=>{
 const f=fixture(t);f.a.configurar({id:f.r.id,revisao:1,metaDiaria:10});assert.throws(()=>f.a.configurar({id:f.r.id,revisao:1,metaDiaria:20}),{codigo:'CONFLITO'});assert.equal(f.a.rotina(f.r.id).metaDiaria,10)
})
test('fuso e datas independem do fuso do processo',()=>{
 assert.deepEqual(local(Date.parse('2026-09-16T02:00:00Z')),{dia:'2026-09-15',hora:'23:00',semana:2})
 assert.equal(instante('2026-09-15','10:00','America/Sao_Paulo'),Date.parse('2026-09-15T13:00:00Z'))
})

test('dois coordenadores não iniciam a mesma ocorrência, inclusive antes do checkpoint',async t=>{
 let n=0;let soltar;const espera=new Promise(r=>soltar=r)
 const f=fixture(t,{iniciar:async()=>{n++;await espera;return {referencia:{id:'m'}}},consultar:async()=>null})
 const outro=criarAgenda({arquivo:f.arquivo,now:()=>Date.parse('2026-09-15T13:00:00Z'),adaptadores:{candidaturas:{iniciar:async()=>{n++;return null}}}})
 t.after(()=>outro.close())
 await f.tick();await outro.tick();assert.equal(n,1);soltar();await drenar()
})
test('salvar configuração sem mudar horários preserva as atividades futuras',async t=>{
 const f=fixture(t);f.a.materializar();const antes=f.a.estado().ocorrencias.find(o=>o.prevista>Date.parse('2026-09-15T13:00:00Z'))
 f.a.configurar({id:f.r.id,revisao:1,horarios:f.r.horarios,dias:f.r.dias,fuso:f.r.fuso,intervalo:null,metaDiaria:10})
 assert.equal(f.a.obter(antes.id).estado,'agendada')
})
test('reagendamento humano não é sobrescrito pelo planejamento da IA',async t=>{
 const f=fixture(t,{iniciar:async ctx=>{ctx.aplicarPlano({ajustes:[{rotinaId:'candidaturas',horario:'17:00'}]});return {estado:'concluida'}},consultar:async()=>null})
 f.a.materializar();const tarde=f.a.estado().ocorrencias.find(o=>o.prevista>Date.parse('2026-09-15T13:00:00Z'))
 await f.a.controlar({id:tarde.id,acao:'reagendar',prevista:Date.parse('2026-09-15T19:00:00Z')});await f.tick()
 assert.equal(f.a.obter(tarde.id).prevista,Date.parse('2026-09-15T19:00:00Z'))
})
test('manual preserva o retorno do domínio e reserva o recurso',async t=>{
 const f=fixture(t);const v=f.a.manual({rotinaId:'candidaturas'},({agenda})=>({resposta:{id:'missao',agenda},registro:{referencia:{id:'missao'}}}))
 assert.equal(v.id,'missao');assert.equal(f.a.obter(v.agenda.id).estado,'executando')
 assert.throws(()=>f.a.manual({rotinaId:'candidaturas'},()=>{}),{codigo:'RECURSO_OCUPADO'})
})
test('execução contínua ignora o corte da rodada, conserva uma ocorrência e termina no fim do dia',async t=>{
 const f=fixture(t,{iniciar:async()=>({referencia:{id:'missao'}}),consultar:async()=>null})
 await f.tick();const antes=f.a.estado().ocorrencias.find(o=>o.estado==='executando')
 const ctx=f.a.estender({rotinaId:'candidaturas'})
 assert.equal(ctx.ocorrencia.id,antes.id);assert.equal(ctx.ocorrencia.ateMeta,true);assert.equal(ctx.saldo,60)
 assert.equal(ctx.limite,'2026-09-16T02:59:59.999Z')
 f.tempo(Date.parse('2026-09-15T18:00:01Z'))
 assert.equal(f.a.autorizar(antes.id).ocorrencia.id,antes.id)
})
test('limites incompatíveis com o executor são recusados ao salvar',t=>{
 const f=fixture(t);assert.throws(()=>f.a.configurar({id:f.r.id,revisao:1,minutos:1000}),{codigo:'CONFIG_INVALIDA'})
 assert.throws(()=>f.a.configurar({id:f.r.id,revisao:1,executor:'inexistente'}),{codigo:'CONFIG_INVALIDA'})
})

test('reagendar conserva referência de envio incerto para consultar antes de repetir',async t=>{
 const f=fixture(t,{iniciar:async()=>({referencia:{itens:['envio-incerto']}}),consultar:async()=>null,cancelar:async()=>{}})
 await f.tick();const o=f.a.estado().ocorrencias[0];await f.a.controlar({id:o.id,acao:'reagendar',prevista:Date.parse('2026-09-15T14:00:00Z')})
 assert.deepEqual(f.a.obter(o.id).referencia,{itens:['envio-incerto']})
})
test('horário removido e recolocado volta à agenda sem desfazer cancelamento humano',t=>{
 const f=fixture(t);f.a.materializar();f.a.configurar({id:f.r.id,revisao:1,horarios:['10:00','16:00']});f.a.materializar();f.a.configurar({id:f.r.id,revisao:2,horarios:['10:00','15:00']});f.a.materializar()
 assert.equal(f.a.estado().ocorrencias.find(o=>o.prevista===Date.parse('2026-09-15T18:00:00Z')).estado,'agendada')
})

test('campanha criada durante a sessão entra na agenda sem alterar rotinas existentes',async t=>{
 const f=fixture(t);f.a.configurar({id:f.r.id,revisao:1,metaDiaria:8})
 f.a.importar(padroes({campanhas:[{id:'nova',nome:'Nova',executor:'codex'}]}));f.a.materializar()
 assert.equal(f.a.rotina(f.r.id).metaDiaria,8);assert.equal(f.a.estado().ocorrencias.filter(o=>o.modulo==='campanha:nova').length,2)
})
test('inteligência recuperada depois do horário original libera ações do mesmo dia',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-dep-'));let agora=Date.parse('2026-09-15T13:00:00Z'),acoes=0
 const a=criarAgenda({arquivo:path.join(dir,'db'),now:()=>agora,rotinas:padroes({campanhas:[{id:'nova',nome:'Nova',executor:'codex'}]}).filter(r=>r.campanhaId),adaptadores:{pesquisa:{iniciar:async()=>({estado:'concluida'})},campanha:{iniciar:async()=>{acoes++;return {estado:'concluida'}}}}})
 t.after(()=>{a.close();fs.rmSync(dir,{recursive:true,force:true})});a.materializar()
 const pesquisa=a.estado().ocorrencias.find(o=>o.tipo==='pesquisa');await a.controlar({id:pesquisa.id,acao:'reagendar',prevista:agora+60000})
 agora+=60000;await a.tick();await drenar();await a.tick();await drenar();assert.equal(acoes,1)
})

test('migração remove orçamento persistido sem apagar consumo ou configurações humanas',async t=>{
 const f=fixture(t,{iniciar:async ctx=>{ctx.checkpoint({tokens:2100000});return {estado:'concluida',realizado:1}}})
 await f.tick()
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(f.arquivo)
 db.prepare("UPDATE rotinas SET data=json_set(data,'$.tokens',1000000,'$.perfilId','grok-4-6') WHERE id=?").run(f.r.id);db.close()
 f.reabrir()
 assert.equal(Object.hasOwn(f.a.rotina(f.r.id),'tokens'),false)
 assert.equal(f.a.rotina(f.r.id).perfilId,'grok-4-6')
 assert.equal(f.a.estado().rotinas[0].uso.tokens,2100000)
 assert.equal(f.a.estado().rotinas[0].uso.realizado,1)
})
test('reinício do DailyWork retoma em segundos sem consumir tentativas; progresso zera falhas seguidas',async t=>{
 let n=0,p=0,agora=Date.parse('2026-09-15T13:00:00Z')
 const f=fixture(t,{iniciar:async()=>{n++;return {referencia:{id:'missao'}}},consultar:async()=>{p++;if(p<=5)throw Object.assign(new Error('reiniciado'),{codigo:'REINICIO_DAILYWORK'});if(p===6)return {realizado:2};throw Object.assign(new Error('rede'),{codigo:'ECONNRESET'})}})
 await f.tick();let o=f.a.estado().ocorrencias[0]
 for(let i=0;i<5;i++){await f.tick();o=f.a.obter(o.id);assert.equal(o.estado,'aguardando');assert.equal(o.falhas||0,0);assert.equal(o.tentarEm-agora,20000);agora=o.tentarEm;f.tempo(agora);await f.tick()}
 assert.equal(n,6)
 await f.tick();o=f.a.obter(o.id);assert.equal(o.realizado,2);assert.equal(o.estado,'executando')
 for(let i=0;i<4;i++){await f.tick();o=f.a.obter(o.id);if(o.estado==='aguardando'){f.tempo(o.tentarEm);await f.tick()}}
 assert.equal(f.a.obter(o.id).estado,'bloqueada');assert.equal(f.a.obter(o.id).falhas,4)
})

test('lote avulso não liga recorrência pausada e continua sujeito ao cancelamento', async t => {
 const f=fixture(t,undefined,{ativa:false})
 let id
 f.a.manual({rotinaId:f.r.id,avulsa:true},ctx=>{id=ctx.agenda.id;return {resposta:{},registro:{referencia:{id:'lote'}}}})
 assert.equal(f.a.estado().rotinas[0].ativa,false)
 assert.doesNotThrow(()=>f.a.autorizar(id))
 await f.a.controlar({id,acao:'cancelar'})
 assert.throws(()=>f.a.autorizar(id),{codigo:'AGENDA_PAUSADA'})
})

test('ação avulsa explícita pode ultrapassar a meta diária sem ampliar a rotina', async t => {
 const f=fixture(t,undefined,{metaDiaria:1,quantidade:1})
 f.a.manual({rotinaId:f.r.id,avulsa:true},()=>({resposta:{ok:true},registro:{estado:'concluida',realizado:1}}))
 const segunda=f.a.manual({rotinaId:f.r.id,avulsa:true},()=>({resposta:{ok:true},registro:{estado:'concluida',realizado:1}}))
 assert.equal(segunda.ok,true);assert.equal(f.a.rotina(f.r.id).metaDiaria,1)
})

test('lote avulso preserva pausa global dos outros módulos', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-avulsa-pausa-'))
 const a=criarAgenda({arquivo:path.join(dir,'db'),rotinas:padroes(),now:()=>Date.parse('2026-09-15T13:00:00Z')})
 t.after(()=>{a.close();fs.rmSync(dir,{recursive:true,force:true})})
 await a.controlar({modulo:'todos',acao:'pausar_hoje'})
 const pausadas=a.estado().rotinas.filter(r=>r.id!=='producao').map(r=>r.id)
 assert.ok(pausadas.length>0)
 a.manual({rotinaId:'producao',avulsa:true},()=>({resposta:{},registro:{referencia:{id:'lote'}}}))
 assert.equal(a.estado().rotinas.find(r=>r.id==='producao').pausada,false)
 for(const id of pausadas)assert.equal(a.estado().rotinas.find(r=>r.id===id).pausada,true,id)
})
