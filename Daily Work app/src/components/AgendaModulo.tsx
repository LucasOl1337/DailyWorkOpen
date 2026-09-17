import {useCallback,useEffect,useState} from 'react'
import {agenda,type EstadoAgenda,type RotinaAgenda,type OcorrenciaAgenda} from '../lib/agenda'
import {navegarPara} from '../lib/destinos'
import './agenda.css'
const nomes:Record<string,string>={agendada:'Agendada',executando:'Em andamento',aguardando:'Nova tentativa',bloqueada:'Precisa de atenção',concluida:'Concluída',sem_trabalho:'Sem trabalho pendente',pausada:'Pausada',cancelada:'Cancelada',expirada:'Horário encerrado'}
const hora=(ms:number)=>new Date(ms).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
const hoje=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date())
function diagnosticarBloqueio(detalhe: OcorrenciaAgenda) {
 const msg = (detalhe.mensagem || '').toLowerCase()
 const cod = detalhe.codigo || ''
 if (cod === 'LIMITE_9ROUTER' || /429|limite|quota|rate limit|usage limit/i.test(msg)) {
  return {
   titulo: 'Limite de uso ou cota da IA atingido',
   descricao: detalhe.mensagem || 'O provedor configurado no 9Router atingiu o limite de cota da conta.',
   acaoSugerida: 'Troque o perfil ativo na Central do Agente para um modelo disponível (ex: Cursor Grok 4.6 High ou Claude 4.5 Sonnet) ou aguarde a renovação da cota.',
   destino: 'agente',
   destinoTexto: 'Configurar Provedor / Trocar IA →',
  }
 }
 if (cod === 'BLOCKED_AUTH' || /auth|unauthorized|401|403|chave|bearer/i.test(msg)) {
  return {
   titulo: 'Autenticação recusada pelo 9Router',
   descricao: detalhe.mensagem || 'A chave de API configurada foi recusada.',
   acaoSugerida: 'Abra as configurações do agente e confira as credenciais do 9Router.',
   destino: 'agente',
   destinoTexto: 'Ver configurações do Agente →',
  }
 }
 if (cod === 'TIMEOUT_9ROUTER' || /timeout|demorou/i.test(msg)) {
  return {
   titulo: 'Tempo limite da IA excedido',
   descricao: detalhe.mensagem || 'A chamada ao modelo demorou mais que o prazo limite.',
   acaoSugerida: 'Retome a atividade agora ou escolha um modelo mais ágil.',
   destino: 'agente',
   destinoTexto: 'Central do Agente →',
  }
 }
 if (cod === '9ROUTER_INDISPONIVEL' || /indisponível|conexão recusada|econnrefused/i.test(msg)) {
  return {
   titulo: '9Router local indisponível',
   descricao: detalhe.mensagem || 'Não foi possível alcançar o serviço 9Router local em http://127.0.0.1:20128.',
   acaoSugerida: 'Verifique se o 9Router está rodando ou alterne para Grok CLI.',
   destino: 'agente',
   destinoTexto: 'Central do Agente →',
  }
 }
 if (cod === 'SEM_PAUTA' || /sem pauta|evidência/i.test(msg)) {
  return {
   titulo: 'Faltam histórias ou evidências reais',
   descricao: detalhe.mensagem || 'Não foram encontradas evidências suficientes para compor o lote hoje.',
   acaoSugerida: 'Adicione notas no dia, peça um post específico ou gere um lote manual.',
   destino: 'producao',
   destinoTexto: 'Abrir painel de Produção →',
  }
 }
 if (cod === 'FALHA_9ROUTER' || /falha_9router|9router não conseguiu/i.test(msg)) {
  return {
   titulo: 'Falha na resposta do 9Router',
   descricao: detalhe.mensagem || 'O 9Router retornou um erro ao processar a requisição da IA.',
   acaoSugerida: 'Verifique se o modelo configurado está disponível ou troque o perfil na Central do Agente.',
   destino: 'agente',
   destinoTexto: 'Configurar Provedor / Trocar IA →',
  }
 }
 if (detalhe.tipo === 'producao' || detalhe.rotina?.includes('producao')) {
  return {
   titulo: 'Produção precisa de atenção',
   descricao: detalhe.mensagem || 'A produção foi interrompida ou encontrou pendências.',
   acaoSugerida: 'Abra o painel de Produção para verificar o lote ou tentar novamente.',
   destino: 'producao',
   destinoTexto: 'Abrir painel de Produção →',
  }
 }
 return {
  titulo: 'Atividade precisa de atenção',
  descricao: detalhe.mensagem || 'A execução falhou e está pausada para revisão.',
  acaoSugerida: 'Confira os detalhes e retome quando a causa estiver resolvida.',
 }
}

export function AgendaModulo({modulo,ocorrenciaId,diaInicial}:{modulo?:string;ocorrenciaId?:string;diaInicial?:string}){
 const escopo=modulo||'todos'
 const [dados,setDados]=useState<EstadoAgenda|null>(null),[erro,setErro]=useState(''),[aviso,setAviso]=useState(''),[dia,setDia]=useState(diaInicial||hoje),[selecionada,setSelecionada]=useState<OcorrenciaAgenda|null>(null),[ocupado,setOcupado]=useState(false)
 const [texto,setTexto]=useState(''),[todos,setTodos]=useState(false),[editando,setEditando]=useState(false),[novaHora,setNovaHora]=useState('')
 const atualizar=useCallback(async()=>{try{setDados(await agenda('estado',{modulo,dia}));setErro('')}catch(e){setErro(String((e as Error).message))}},[modulo,dia])
 useEffect(()=>{let vivo=true;const ler=async()=>{try{const d=await agenda<EstadoAgenda>('estado',{modulo,dia});if(vivo){setDados(d);setErro('')}}catch(e){if(vivo)setErro((e as Error).message)}};void ler();const t=setInterval(()=>void ler(),5000);return()=>{vivo=false;clearInterval(t)}},[modulo,dia])
 useEffect(()=>{if(!editando)setTexto(dados?.orientacoes.find(i=>i.escopo===(todos?'todos':escopo))?.texto||'')},[dados,todos,escopo,editando])
 useEffect(()=>{setSelecionada(null);setEditando(false);if(!ocorrenciaId)return;let vivo=true;void agenda<OcorrenciaAgenda>('detalhes',{id:ocorrenciaId}).then(o=>{if(vivo)setSelecionada(o)}).catch(e=>{if(vivo)setErro(e.message)});return()=>{vivo=false}},[modulo,dia,ocorrenciaId])
 async function agir(acao:string,entrada:unknown,mensagem='Alteração aplicada.'){
  setOcupado(true);setErro('');setAviso('')
  try{await agenda(acao,entrada);setAviso(mensagem);await atualizar();window.dispatchEvent(new CustomEvent('dailywork:estado'))}catch(e){setErro((e as Error).message)}finally{setOcupado(false)}
 }
 const os=dados?.ocorrencias||[],ativas=os.filter(o=>o.estado==='executando'),bloqueios=os.filter(o=>o.estado==='bloqueada'),proxima=os.find(o=>['agendada','aguardando'].includes(o.estado)&&o.prevista>Date.now())
 const detalhe=selecionada?(os.find(o=>o.id===selecionada.id)||selecionada):os.find(o=>o.id===ocorrenciaId)||ativas[0]||bloqueios[0]||null
 const seguinte=dados?.rotinas.filter(r=>r.proxima).sort((a,b)=>(a.proxima||0)-(b.proxima||0))[0]
 const ultima=os.filter(o=>o.iniciadaEm).sort((a,b)=>b.atualizadaEm-a.atualizadaEm)[0]
 const visiveis=os.filter(o=>!['coleta','publicacao_agendada'].includes(o.tipo)||!['concluida','sem_trabalho'].includes(o.estado)||o.id===os.filter(v=>v.rotina===o.rotina&&['concluida','sem_trabalho'].includes(v.estado)).at(-1)?.id)
 const realizado=dados?.rotinas.reduce((n,r)=>n+r.uso.realizado,0)||0
 return <section data-agenda-ready={dados?"true":"false"} className="agenda-modulo" aria-label="Agenda automática do módulo">
  <header className="agenda-cabecalho"><div><p className="agenda-sobre">AUTOMAÇÃO DIÁRIA</p><h2>O dia em andamento</h2></div><div className="agenda-acoes"><label>Dia<input aria-label="Dia da agenda" type="date" value={dia} onChange={e=>setDia(e.target.value)}/></label><button disabled={ocupado} onClick={()=>void agir('controlar',{modulo:escopo,acao:dados?.rotinas.some(r=>r.pausada)?'retomar':'pausar_hoje'})}>{dados?.rotinas.some(r=>r.pausada)?'Retomar hoje':'Pausar hoje'}</button></div></header>
  <div className="agenda-indicadores"><div><strong>{realizado}{dados?.rotinas.some(r=>r.metaDiaria>0)?` / ${dados.rotinas.reduce((n,r)=>n+r.metaDiaria,0)}`:""}</strong><span>resultados registrados</span></div><div><strong>{ativas.length?ativas[0].nome:proxima?hora(proxima.prevista):seguinte?.proxima?new Date(seguinte.proxima).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Sem próxima atividade'}</strong><span>{ativas.length?'em execução':proxima?proxima.nome:seguinte?.nome||'configure as rotinas abaixo'}</span></div><div className={bloqueios.length?'agenda-atencao':''}><strong>{bloqueios.length||'Sem'}</strong><span>impedimentos</span></div><div><strong>{dados?.servico.ativo?'Em segundo plano':'Execução indisponível'}</strong><span>{dados?.servico.ativo?'rotina automática ligada':'verifique o serviço do DailyWork'}</span></div></div>
  {ultima&&<p className="agenda-aviso">Última atividade: {hora(ultima.atualizadaEm)} · {ultima.nome} · {nomes[ultima.estado]}</p>}
  {erro&&<p className="agenda-erro" role="alert">{erro}</p>}{aviso&&<p className="agenda-aviso" role="status">{aviso}</p>}
  <div className="agenda-trabalho"><div className="agenda-lista" aria-label="Atividades do dia">{visiveis.length?visiveis.map(o=><button className={`agenda-linha ${detalhe?.id===o.id?'selecionada':''}`} key={o.id} onClick={()=>{setSelecionada(o);void agenda<OcorrenciaAgenda>('detalhes',{id:o.id}).then(setSelecionada).catch(e=>setErro(e.message))}}><time>{hora(o.prevista)}</time><span><strong>{o.nome}</strong><small>{o.mensagem||'Aguardando o horário programado.'}</small></span><span className={`agenda-status estado-${o.estado}`}>{nomes[o.estado]||o.estado}</span></button>):<p className="agenda-vazio">A programação aparecerá aqui conforme as rotinas deste dia.</p>}</div>
   <aside className="agenda-detalhe">{detalhe?<><span className="agenda-sobre">{nomes[detalhe.estado]}</span><h3>{detalhe.nome}</h3>
    {detalhe.estado === 'bloqueada' && (() => {
      const diag = diagnosticarBloqueio(detalhe)
      return (
        <div className="agenda-card-diagnostico" role="alert">
          <div className="agenda-diagnostico-topo">
            <span className="agenda-diagnostico-badge">Atenção necessária</span>
            {detalhe.codigo && <code className="agenda-diagnostico-codigo">{detalhe.codigo}</code>}
          </div>
          <h4 className="agenda-diagnostico-titulo">{diag.titulo}</h4>
          <p className="agenda-diagnostico-desc">{diag.descricao}</p>
          {diag.acaoSugerida && <p className="agenda-diagnostico-sugestao"><strong>O que fazer:</strong> {diag.acaoSugerida}</p>}
          <div className="agenda-diagnostico-acoes">
            {(diag.destino === 'producao' || (modulo === 'editorial' && (detalhe.tipo === 'producao' || detalhe.rotina?.includes('producao')))) && (
              <button
                type="button"
                className="agenda-btn-acao agenda-btn-acao--destaque"
                onClick={() => navegarPara({view:'fila',secao:'fila-producao'})}
              >
                Abrir painel de Produção →
              </button>
            )}
            {diag.destino === 'agente' && (
              <button
                type="button"
                className="agenda-btn-acao agenda-btn-acao--destaque"
                onClick={() => window.dispatchEvent(new CustomEvent('agenda:navegar', { detail: { view: 'agente' } }))}
              >
                {diag.destinoTexto || 'Configurar IA / Trocar modelo →'}
              </button>
            )}
            {modulo === 'editorial' && (
              <button
                type="button"
                className="agenda-btn-acao"
                onClick={() => navegarPara({view:'fila',secao:'fila-revisao'})}
              >
                Ver itens na Fila ↓
              </button>
            )}
            <button
              type="button"
              className="agenda-btn-acao"
              disabled={ocupado}
              onClick={() => void agir('controlar', { id: detalhe.id, acao: 'retomar' }, 'Retomando atividade agora…')}
            >
              Retomar agora
            </button>
          </div>
        </div>
      )
    })()}
    <p>{detalhe.mensagem||'Atividade programada.'}</p><dl><dt>Previsto</dt><dd>{hora(detalhe.prevista)}</dd><dt>Início real</dt><dd>{detalhe.iniciadaEm?hora(detalhe.iniciadaEm):'Ainda não iniciou'}</dd><dt>Última atividade</dt><dd>{hora(detalhe.atualizadaEm)}</dd><dt>Tentativas</dt><dd>{detalhe.tentativas}</dd><dt>Consumo reportado</dt><dd>{detalhe.tokens.toLocaleString('pt-BR')} tokens</dd>{detalhe.tentarEm&&<><dt>Próxima tentativa</dt><dd>{hora(detalhe.tentarEm)}</dd></>}</dl>
    {detalhe.decisao&&<details open><summary>Decisão e fontes</summary><p>{detalhe.decisao.interpretacao||detalhe.decisao.resumo}</p><p>{detalhe.decisao.justificativa}</p><ul>{detalhe.decisao.fontesUsadas?.map(f=><li key={f}>{f}</li>)}</ul></details>}
    {!!detalhe.bloqueios?.length&&<ul>{detalhe.bloqueios.map(b=><li key={b.id}>{b.motivo}</li>)}</ul>}
    {detalhe.referencia&&<button onClick={()=>navegarPara(detalhe.modulo.startsWith('campanha:')?{view:'automacoes',campanhaId:detalhe.modulo.slice(9),secao:'auto-panel-operacao'}:detalhe.modulo==='candidaturas'?{view:'candidaturas',secao:'cand-historico'}:detalhe.modulo==='sumario'?{view:`sumario:${detalhe.dia}`}:{view:'fila',secao:'fila-revisao'})}>Ver resultados no módulo</button>}
    {!['concluida','sem_trabalho','cancelada','expirada'].includes(detalhe.estado) && (
      <div className="agenda-acoes agenda-acoes--detalhe">
        <div className="agenda-acoes-linha">
          {!['bloqueada','executando'].includes(detalhe.estado)&&<button disabled={ocupado} onClick={()=>void agir('controlar',{id:detalhe.id,acao:'retomar'})}>Retomar agora</button>}
          <button disabled={ocupado} onClick={()=>void agir('controlar',{id:detalhe.id,acao:'cancelar'})}>Cancelar atividade</button>
        </div>
        <div className="agenda-acoes-reagendar">
          <input type="time" aria-label="Novo horário" value={novaHora} onChange={e=>setNovaHora(e.target.value)}/>
          <button disabled={ocupado||!novaHora} onClick={()=>void agir('controlar',{id:detalhe.id,acao:'reagendar',horario:novaHora})}>Reagendar</button>
        </div>
      </div>
    )}
    {!!selecionada?.eventos?.length&&<details><summary>Eventos</summary><ol>{selecionada.eventos.map((e,i)=><li key={i}>{hora(Date.parse(e.em))} · {e.tipo}{e.codigo?' · '+e.codigo:''}</li>)}</ol></details>}
   </>:<><h3>Programação e resultados</h3><p>Selecione uma atividade para acompanhar a execução, a decisão da IA e os resultados.</p></>}</aside>
  </div>
  <div className="agenda-orientacao"><div><h3>Orientações para hoje</h3><p>Suas instruções têm prioridade nas próximas atividades e valem até o fim do dia.</p></div><textarea rows={2} value={texto} placeholder="Hoje priorize as novidades do DailyWork e deixe o conteúdo geral para a tarde…" onChange={e=>{setTexto(e.target.value);setEditando(true)}}/><div className="agenda-acoes"><label className="agenda-check"><input type="checkbox" checked={todos} onChange={e=>{setTodos(e.target.checked);setEditando(false)}}/>Aplicar a todos os módulos</label><button disabled={ocupado} onClick={()=>void agir('instruir',{escopo:todos?'todos':escopo,dia,texto,revisao:dados?.orientacoes.find(i=>i.escopo===(todos?'todos':escopo))?.revisao||0},'Orientações salvas. A IA atualizará o restante do dia.').then(()=>setEditando(false))}>Aplicar orientações</button></div></div>
  <details className="agenda-config"><summary>Rotinas e horários <span>{dados?.rotinas.length||0} {dados?.rotinas.length===1?"rotina":"rotinas"}</span></summary>{dados?.rotinas.map(r=><ConfigRotina key={`${r.id}:${r.revisao}`} rotina={r} ocupado={ocupado} agir={agir}/>)}</details>
 </section>
}
function ConfigRotina({rotina:r,ocupado,agir}:{rotina:RotinaAgenda;ocupado:boolean;agir:(a:string,e:unknown,m?:string)=>Promise<void>}){
 const [v,setV]=useState(r),[horarios,setHorarios]=useState(r.horarios.join(', '))
 const set=<K extends keyof RotinaAgenda>(k:K,val:RotinaAgenda[K])=>setV({...v,[k]:val})
 return <form className="agenda-rotina" onSubmit={e=>{e.preventDefault();const {id,revisao,ativa,dias,intervalo,fuso,fim,metaDiaria,quantidade,minutos,tentativas,perfilId,executor,fontes,contas,idiomas,estoqueAlvo}=v;void agir('configurar',{id,revisao,ativa,dias,horarios:horarios.split(',').map(h=>h.trim()).filter(Boolean),intervalo,fuso,fim,metaDiaria,quantidade,minutos,tentativas,perfilId,executor,fontes,contas,idiomas,...(estoqueAlvo!==undefined?{estoqueAlvo}:{})})}}>
 <header><h3>{r.nome}</h3><label className="agenda-check"><input type="checkbox" checked={v.ativa} onChange={e=>set('ativa',e.target.checked)}/>Automática</label><button type="button" disabled={ocupado} onClick={()=>void agir('executar',{rotinaId:r.id},'Rodada enfileirada com os limites diários atuais.')}>Executar agora / extra</button></header>
 <div className="agenda-form-grid"><label>Horários · separados por vírgula<input value={horarios} onChange={e=>setHorarios(e.target.value)} placeholder="10:00, 15:00"/></label><label>Fuso<input value={v.fuso} onChange={e=>set('fuso',e.target.value)}/></label><label>Fim da janela<input type="time" value={v.fim} onChange={e=>set('fim',e.target.value)}/></label>{r.intervalo!==null&&<label>Intervalo · minutos<input type="number" min="1" max="1440" value={v.intervalo||15} onChange={e=>set('intervalo',Number(e.target.value))}/></label>}
 {(['metaDiaria','quantidade','minutos','tentativas'] as const).map(k=><label key={k}>{{metaDiaria:'Meta diária · 0 sem meta adicional',quantidade:'Quantidade por rodada',minutos:'Duração máxima · minutos',tentativas:'Novas tentativas · até 3'}[k]}<input type="number" min={k==='quantidade'||k==='minutos'?1:0} max={k==='tentativas'?3:undefined} value={v[k]} onChange={e=>set(k,Number(e.target.value))}/></label>)}
 {v.estoqueAlvo!==undefined&&<label>Estoque alvo de versões<input type="number" min="0" value={v.estoqueAlvo} onChange={e=>set('estoqueAlvo',Number(e.target.value))}/></label>}
 <label>Perfil de IA · vazio usa o atual<input value={v.perfilId} onChange={e=>set('perfilId',e.target.value)}/></label>{['campanha','pesquisa','candidaturas'].includes(v.tipo)&&<label>Executor<select value={v.executor} onChange={e=>set('executor',e.target.value)}>{(v.tipo==='candidaturas'?['nativo','codex']:['codex','grok','devin','claude','hermes','opencode','cursor','pi','omp','gemini','jcode','copilot','crush']).map(x=><option key={x}>{x}</option>)}</select></label>}
 {(['fontes',...(v.tipo==='producao'?['contas','idiomas']:[])] as ('fontes'|'contas'|'idiomas')[]).map(k=><label key={k}>{{fontes:'Fontes · IDs separados por vírgula',contas:'Contas · separadas por vírgula',idiomas:'Idiomas · separados por vírgula'}[k]}<input value={v[k].join(', ')} onChange={e=>set(k,e.target.value.split(',').map(x=>x.trim()).filter(Boolean))}/></label>)}
 </div><div className="agenda-dias">{['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d,i)=><label className="agenda-check" key={d}><input type="checkbox" checked={v.dias.includes(i)} onChange={e=>set('dias',e.target.checked?[...v.dias,i]:v.dias.filter(x=>x!==i))}/>{d}</label>)}</div><footer><span>{r.uso.realizado}{r.metaDiaria?` / ${r.metaDiaria}`:''} resultados · {r.uso.tokens.toLocaleString('pt-BR')} tokens hoje</span><button disabled={ocupado}>Salvar rotina</button></footer>
 </form>
}
