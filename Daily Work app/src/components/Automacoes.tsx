import {useDestinoPagina,destacarSecao} from '../lib/destinos'
import { AgendaModulo } from './AgendaModulo'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelarCampanha, pesquisarEmpresa, abrirPerfilAutomacao, executarAutomacao, obterBibliotecaAutomacoes, obterContextoAutomacao, obterEstadoAutomacoes } from '../lib/api'
import type { BibliotecaAutomacao, ContextoAutomacao, EstadoAutomacoes } from '../lib/automacoes'
import { Biblioteca } from './automacoes/Biblioteca'
import { Materiais } from './automacoes/Materiais'
import { Operacao, nomeStatus } from './automacoes/Operacao'
import { ContextoDialog } from './automacoes/Contexto'
import { Campanhas } from './automacoes/Campanhas'
import { Alvos } from './automacoes/Alvos'
import { Bloco, Botao, Chip, Faixa, Kpi, Pagina } from './ui/ui'
import { ColunaDia } from './ui/ColunaDia'
import { useEstadoGlobal } from '../lib/estado-global'
import { Pesquisa } from './automacoes/Pesquisa'
import './automacoes.css'
import { Candidaturas } from './Candidaturas'
import type { ReactNode } from 'react'
import { useRelogio, haQuanto } from './Candidaturas'
import {agenda,ultimasOcorrencias,type OcorrenciaAgenda } from '../lib/agenda'

type Aba = 'pesquisa' | 'biblioteca' | 'materiais' | 'operacao'
const ABAS: { id: Aba; titulo: string }[] = [{ id: 'pesquisa', titulo: 'Pesquisa e pessoas' }, { id: 'biblioteca', titulo: 'Biblioteca e contexto' }, { id: 'materiais', titulo: 'Textos e currículos' }, { id: 'operacao', titulo: 'Operação e histórico' }]

export function Automacoes({ modulo = 'campanhas' }: { modulo?: 'campanhas' | 'candidaturas' }) {
  const [campanhaId, setCampanhaId] = useState(() => new URLSearchParams(location.search).get('campanha') || 'cognition')
  useDestinoPagina('automacoes', d => {if(d.campanhaId)setCampanhaId(d.campanhaId)})
  if (modulo === 'candidaturas') return <Candidaturas />
  return <main className="automacoes automacoes--pagina"><Campanhas campanhaId={campanhaId} selecionar={setCampanhaId}>{(barra: ReactNode) => <Campanha key={campanhaId} campanhaId={campanhaId} barra={barra} />}</Campanhas></main>
}
function Campanha({ campanhaId, barra }: { campanhaId: string; barra: ReactNode }) {
  const global = useEstadoGlobal()
  const [aba, setAba] = useState<Aba>(() => {
    const valor = new URLSearchParams(location.search).get('abaAutomacoes')
    return valor === 'biblioteca' || valor === 'materiais' || valor === 'operacao' ? valor : 'pesquisa'
  })
  useEffect(()=>{const fn=()=>{setAba('operacao');document.querySelector('.auto-tabs')?.scrollIntoView({behavior:'smooth'})};window.addEventListener('agenda:historico',fn);return()=>window.removeEventListener('agenda:historico',fn)},[])
  const [estado, setEstado] = useState<EstadoAutomacoes | null>(null)
  const [biblioteca, setBiblioteca] = useState<BibliotecaAutomacao | null>(null)
  const [erroLeitura, setErroLeitura] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [selecaoPendente, setSelecaoPendente] = useState(false)
  const [contexto, setContexto] = useState<ContextoAutomacao | null>(null)
  const vivo = useRef(true)
  const lendo = useRef(false)
  const acaoPendente = useRef(false)
  useDestinoPagina('automacoes', d => {if(d.campanhaId && d.campanhaId!==campanhaId)return;const id=d.secao?.replace('auto-panel-','');if(ABAS.some(a=>a.id===id)){setAba(id as Aba);destacarSecao(d.secao!)}},Boolean(estado))
  const atualizar = useCallback(async () => {
    if (lendo.current) return
    lendo.current = true
    try {
      const [e, b] = await Promise.allSettled([obterEstadoAutomacoes(campanhaId), obterBibliotecaAutomacoes(campanhaId)])
      if (!vivo.current) return
      if (e.status === 'fulfilled') setEstado(e.value)
      if (b.status === 'fulfilled') setBiblioteca(atual => atual?.config.revisao === b.value.config.revisao && JSON.stringify(atual.fontes) === JSON.stringify(b.value.fontes) ? atual : b.value)
      setErroLeitura([e, b].flatMap(r => r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : 'Falha ao atualizar a campanha.'] : []).join(' '))
    } finally { lendo.current = false }
  }, [campanhaId])
  useEffect(() => { vivo.current = true; void atualizar(); const timer = setInterval(() => void atualizar(), ocupado || estado?.execucoes.some(e=>['preparando','executando'].includes(e.status)) ? 2000 : 10_000); return () => { vivo.current = false; clearInterval(timer) } }, [atualizar, ocupado, estado?.execucoes.some(e=>['preparando','executando'].includes(e.status))])
  async function agir(acao: 'ciclo' | 'perfil' | 'pesquisa' | 'parar' | 'retomar') {
    if(acaoPendente.current)return
    acaoPendente.current=true
    setOcupado(acao); setErro(''); setAviso('')
    if(acao==='pesquisa')setAba('pesquisa')
    try {
      if (acao === 'ciclo') { await executarAutomacao(campanhaId); setAviso('Ciclo iniciado: conectando à bancada e preparando o contexto. A ação imediata aparece em "Agora"; se parar, o motivo aparece na faixa em até 1 minuto.') }
      else if (acao === 'pesquisa') { await pesquisarEmpresa(campanhaId); setAviso('') }
      else if (acao === 'retomar' && bloqueada) {await agenda('controlar',{id:bloqueada.id,acao:'retomar'});setAviso('Retomada solicitada para '+bloqueada.nome+'.');await global.atualizar()}
      else if (acao === 'parar' && ativa) { await cancelarCampanha(ativa.id, campanhaId); setAviso('Executor encerrado. O navegador permanece aberto.') }
      else { const n = await abrirPerfilAutomacao(campanhaId); setAviso(`Navegador pronto${n.workspace ? ` no workspace ${n.workspace}` : ''}. Confira sua conta na bancada.`) }
      await atualizar()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível concluir.'
      if (/execu[cç][aã]o neste recurso|RECURSO_OCUPADO/i.test(msg)) {
        const outra = (global.agenda?.ocorrencias || []).find(o => o.estado === 'executando' && o.modulo.startsWith('campanha:'))
        setErro(outra ? `A bancada de campanhas está ocupada por "${outra.nome}" desde ${new Date(outra.iniciadaEm || outra.atualizadaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Só uma campanha usa o navegador por vez: espere terminar ou pare esse ciclo.` : 'Outra campanha está usando a bancada agora. Espere terminar ou pare esse ciclo.')
      } else setErro(msg)
      await atualizar()
    }
    finally { acaoPendente.current=false;setOcupado('') }
  }
  async function abrirContexto(id: string) {
    if(acaoPendente.current)return
    acaoPendente.current=true
    setErro(''); setOcupado('contexto')
    try { setContexto(await obterContextoAutomacao(id, campanhaId)) }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível abrir o contexto.') }
    finally { acaoPendente.current=false;setOcupado('') }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('contextoAutomacao')
    if (id) void abrirContexto(id)
  }, [])
  useEffect(()=>{void global.atualizar()},[estado?.execucoes[0]?.id,estado?.execucoes[0]?.status,global.atualizar])
  const ativa = estado?.execucoes.find(e => ['preparando', 'executando'].includes(e.status))
  const pendentes = estado?.pendenciasInteracoes || 0
  const cadastro = estado?.cadastro, marca = cadastro?.identidade
  const ocorrencias = (global.agenda?.ocorrencias || []).filter(o => o.modulo === `campanha:${campanhaId}`)
  const rotinas = (global.agenda?.rotinas || []).filter(r => r.modulo === `campanha:${campanhaId}`)
  const bloqueada = ultimasOcorrencias(ocorrencias).find(o => o.estado === 'bloqueada')
  const pesquisaRecente = estado?.execucoes.find(e => e.tipo === 'pesquisa')
  const pesquisando = ocupado==='pesquisa' || ativa?.tipo==='pesquisa'
  const textoPesquisa = ocupado==='pesquisa' ? 'Iniciando pesquisa…' : pesquisando ? 'Pesquisando empresa…' : 'Pesquisar empresa'
  const proxima = rotinas.map(r => r.proxima).filter((v): v is number => Boolean(v)).sort()[0]
  const hora = (v: number | string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const fila = (estado?.filaManual || []).filter(m => m.status === 'na_fila').length
  const interacoes = estado?.interacoes || []
  const enviados = interacoes.filter(i => i.status === 'confirmado').length, incertos = interacoes.filter(i => ['enviando', 'incerto'].includes(i.status)).length
  const hojeStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const contatosHoje = interacoes.filter(i => i.status === 'confirmado' && new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(i.criadoEm)) === hojeStr).length
  const metaHoje = rotinas.reduce((n, r) => n + (r.metaDiaria || 0), 0)
  const estadoChip = ativa ? { tone: 'ativo' as const, texto: nomeStatus(ativa.status) } : bloqueada ? { tone: 'atencao' as const, texto: 'precisa de você' } : pendentes ? { tone: 'atencao' as const, texto: `${pendentes} a conferir` } : { tone: 'neutro' as const, texto: proxima ? `próximo ${hora(proxima)}` : 'sem agendamento' }
  const navegadorOk = Boolean(estado?.chromeCDP)
  const acoes = <>
    {estado && !navegadorOk && <Botao icone="eye" disabled={Boolean(ocupado)} onClick={() => void agir('perfil')}>{ocupado === 'perfil' ? 'Conectando…' : 'Conectar bancada'}</Botao>}
    <Botao disabled={Boolean(ocupado || ativa)} onClick={() => void agir('pesquisa')}>{textoPesquisa}</Botao>
    {ativa ? <Botao icone="pause" disabled={Boolean(ocupado)} onClick={() => void agir('parar')}>{ocupado === 'parar' ? 'Encerrando…' : 'Parar executor'}</Botao>
      : <Botao kind="primary" icone="play" disabled={Boolean(ocupado || pendentes || selecaoPendente || erroLeitura)} onClick={() => void agir('ciclo')}>{ocupado === 'ciclo' ? 'Iniciando…' : 'Rodar ciclo agora'}</Botao>}
  </>
  const identidade = cadastro && <div className="camp-identidade">
    {marca?.logo?.startsWith('data:image/') ? <img src={marca.logo} alt="" /> : <span className="camp-monograma">{(cadastro.nome || '?').slice(0, 1).toUpperCase()}</span>}
    <div className="camp-identidade-texto"><strong>{cadastro.nome}</strong>{marca?.produto && <span> · {marca.produto}</span>}{cadastro.site && <a href={cadastro.site} target="_blank" rel="noreferrer"> · {cadastro.site.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}<small>{[cadastro.objetivo, ...(marca?.fatos || []).slice(0, 2).map(f => `${f.rotulo}: ${f.texto}`)].filter(Boolean).join(' · ')}</small></div>
  </div>
  return <Pagina titulo="Campanhas" eyebrow="Automações · Networking" chips={<><Chip tone={estadoChip.tone}>{estadoChip.texto}</Chip><Chip tone={navegadorOk ? 'ok' : 'atencao'}>{estado?.navegador.controle === 'humano' ? 'bancada com você' : navegadorOk ? `bancada ${estado?.navegador.workspace ? 'ws ' + estado.navegador.workspace : 'conectada'}` : 'bancada desconectada'}</Chip></>} acoes={acoes}>
    <div className="camp-topo" data-automacoes-ready={Boolean(biblioteca && estado)}>{barra}{identidade}</div>
    {(erroLeitura || erro) && <Faixa tone="erro" acoes={<Botao kind="ghost" onClick={() => { setErro('') }}>Fechar</Botao>}>{erroLeitura} {erro}</Faixa>}
    {aviso && <Faixa tone="ok" acoes={<Botao kind="ghost" onClick={() => setAviso('')}>Fechar</Botao>}>{aviso}</Faixa>}
    {(ocupado==='pesquisa' || ativa) ? <Faixa tone="info"><strong>{ocupado==='pesquisa' && !ativa ? 'Iniciando pesquisa…' : ativa?.status==='preparando' ? 'Preparando pesquisa e contexto…' : pesquisando ? 'Pesquisando empresa…' : 'Ciclo em andamento.'}</strong> {ativa ? 'A atividade atual e o tempo decorrido aparecem em Agora.' : 'Conectando à bancada. As descobertas aparecerão em Pesquisa e pessoas.'}</Faixa> : bloqueada ? <Faixa tone="atencao" detalhe={bloqueada.mensagem} acoes={<>{!navegadorOk && <Botao icone="eye" disabled={Boolean(ocupado)} onClick={() => void agir('perfil')}>Conectar bancada</Botao>}<Botao kind="primary" icone="play" disabled={Boolean(ocupado || ativa)} onClick={() => void agir('retomar')}>Retomar agora</Botao></>}><strong>{bloqueada.nome} parou às {hora(bloqueada.atualizadaEm)}.</strong> {/timeout|cdp|conex|navegador|chromium/i.test(bloqueada.mensagem || '') ? 'Uma aba da bancada não respondeu. O trabalho aberto foi preservado; confira a conexão antes de retomar.' : (bloqueada.mensagem || '').split(/(?<=[.!?])\s/)[0].slice(0, 160)}</Faixa>
      : !ativa && pendentes > 0 ? <Faixa tone="atencao" acoes={<Botao kind="primary" onClick={() => setAba('operacao')}>Conferir</Botao>}><strong>{pendentes} {pendentes === 1 ? 'envio sem recibo' : 'envios sem recibo'}.</strong> Confira se saiu antes do próximo ciclo; o agente não repete envio incerto.</Faixa>
      : !proxima && estado ? <Faixa tone="info">Sem ciclo agendado hoje. Rode agora ou ajuste as rotinas.</Faixa> : null}
    {!pesquisando && pesquisaRecente && !['preparando','executando'].includes(pesquisaRecente.status) && <Faixa tone={pesquisaRecente.status==='concluida'?'ok':'atencao'} acoes={<Botao kind="ghost" onClick={()=>{setAba(pesquisaRecente.status==='concluida'?'pesquisa':'operacao');destacarSecao(pesquisaRecente.status==='concluida'?'auto-panel-pesquisa':'auto-panel-operacao')}}>{pesquisaRecente.status==='concluida'?'Ver descobertas':'Ver execução'}</Botao>}>
      {pesquisaRecente.status==='concluida' ? `Pesquisa concluída${pesquisaRecente.concluidoEm?' às '+hora(pesquisaRecente.concluidoEm):''}. ${pesquisaRecente.resultado ? `Pesquisa salva com ${pesquisaRecente.resultado.pessoas} pessoas e ${pesquisaRecente.resultado.fontes} fontes.` : 'Confira as descobertas salvas abaixo.'}` : `Pesquisa ${nomeStatus(pesquisaRecente.status).toLowerCase()}: ${pesquisaRecente.erro || 'consulte o histórico desta execução.'}`}
    </Faixa>}
    <div className="dw-kpis">
      <Kpi valor={`${contatosHoje}/${metaHoje || '—'}`} rotulo="contatos hoje" tone="ok" />
      <Kpi valor={fila} rotulo="na fila" />
      <Kpi valor={enviados} rotulo="enviados · confirmados" />
      <Kpi valor={incertos} rotulo="sem recibo" tone={incertos ? 'atencao' : undefined} />
      <Kpi valor={proxima ? hora(proxima) : '—'} rotulo="próximo ciclo" />
    </div>
    <div className="dw-grade camp-grade">
      <Alvos campanhaId={campanhaId} estado={estado} atualizar={() => void atualizar()} abrirContexto={id => void abrirContexto(id)} irOperacao={() => setAba('operacao')} bloqueado={Boolean(ocupado || ativa || pendentes || selecaoPendente || erroLeitura)} />
      <ColunaDia modulo="campanhas" agora={<AgoraCampanha ativa={ativa} bloqueada={bloqueada} estado={estado} executor={cadastro?.executor} />} />
    </div>
    <Bloco titulo="Pesquisa, biblioteca, materiais e operação" className="camp-abas">
      <nav className="auto-tabs" aria-label="Áreas de automações">{ABAS.map(a => <button key={a.id} id={`auto-tab-${a.id}`} aria-controls={`auto-panel-${a.id}`} aria-current={aba === a.id ? 'page' : undefined} onClick={() => setAba(a.id)}>{a.titulo}{a.id === 'biblioteca' && biblioteca && <span>{biblioteca.config.fontes.length}</span>}{a.id === 'operacao' && estado && <span>{estado.filaManual.filter(f => f.status === 'na_fila').length}</span>}</button>)}</nav>
      <div className="camp-abas-corpo">
      <section id="auto-panel-pesquisa" aria-labelledby="auto-tab-pesquisa" hidden={aba !== "pesquisa"}><Pesquisa campanhaId={campanhaId} pesquisar={() => void agir("pesquisa")} executando={Boolean(ativa || ocupado)} textoPesquisa={textoPesquisa} atualizacao={pesquisaRecente ? `${pesquisaRecente.id}:${pesquisaRecente.status}:${pesquisaRecente.concluidoEm}` : undefined} /></section>
      <section id="auto-panel-biblioteca" aria-labelledby="auto-tab-biblioteca" hidden={aba !== 'biblioteca'}>{biblioteca ? <Biblioteca campanhaId={campanhaId} biblioteca={biblioteca} atualizar={setBiblioteca} alterada={setSelecaoPendente} /> : <p className="auto-empty" role="status">{erroLeitura ? 'A biblioteca não pôde ser carregada. Use Atualizar para tentar novamente.' : 'Carregando a biblioteca profissional…'}</p>}</section>
      <section id="auto-panel-materiais" aria-labelledby="auto-tab-materiais" hidden={aba !== 'materiais'}>{biblioteca && <Materiais campanhaId={campanhaId} materiais={estado?.materiais || []} fontes={biblioteca.config.fontes.length} revisao={biblioteca.config.revisao} selecaoPendente={selecaoPendente} atualizar={() => void atualizar()} abrirContexto={id => void abrirContexto(id)} />}</section>
      <section id="auto-panel-operacao" aria-labelledby="auto-tab-operacao" hidden={aba !== 'operacao'}>{estado ? <Operacao estado={estado} atualizar={() => void atualizar()} abrirContexto={id => void abrirContexto(id)} /> : <p className="auto-empty">{erroLeitura || 'Carregando os registros…'}</p>}</section>
      </div>
    </Bloco>
    <details className="cand-schedule"><summary>Agenda, orientações e horários</summary><AgendaModulo modulo={`campanha:${campanhaId}`} /></details>
    {contexto && <ContextoDialog contexto={contexto} fechar={() => setContexto(null)} />}
  </Pagina>
}

const ACOES_NAV: Record<string, string> = { abas: 'listando as abas', abrir: 'abrindo', navegar: 'navegando para', ler: 'lendo a página', clicar: 'clicando em', preencher: 'preenchendo', tecla: 'digitando em', capturar: 'capturando a tela de', fechar: 'fechando' }
function AgoraCampanha({ ativa, bloqueada, estado, executor }: { ativa?: { id: string; status: string; tipo?: string; executor?: string; criadoEm: string }; bloqueada?: OcorrenciaAgenda; estado: EstadoAutomacoes | null; executor?: string }) {
  const agora = useRelogio()
  const at = !ativa || estado?.atividade?.execucaoId === ativa.id ? estado?.atividade : null
  const idade = at ? agora - Date.parse(at.em) : ativa ? agora-Date.parse(ativa.criadoEm) : Infinity
  const semSinal = Boolean(ativa) && idade > 120000
  const hora = (v: number | string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return <div className="camp-agora">
    <div className="camp-agora-titulo"><span className={`camp-agora-ponto ${ativa && !semSinal ? 'is-on' : ativa || bloqueada ? 'is-off' : ''}`} /><strong>{ativa ? (semSinal ? 'Sem sinal do executor' : 'Ação imediata') : bloqueada ? 'Parado · aguardando você' : 'Aguardando próximo ciclo'}</strong>{ativa && <time>desde {hora(ativa.criadoEm)}</time>}</div>
    {ativa && <p className="camp-agora-acao">{at && idade < 15 * 60000 ? <><strong>{ACOES_NAV[at.acao] || at.acao} {at.url || at.alvo || ''}</strong> · {haQuanto(at.em, agora)}</> : <><strong>{ativa.status === 'preparando' ? 'Preparando o contexto (biblioteca, pesquisa e argumento)' : 'Executor rodando, ainda sem ação no navegador'}</strong> · {haQuanto(ativa.criadoEm, agora)}</>}{semSinal && <span className="camp-agora-aviso"> · nenhuma ação do navegador nos últimos 2 min; o executor pode estar analisando o contexto. Confira o histórico se a espera continuar.</span>}</p>}
    <p>{ativa ? `${ativa.tipo === 'pesquisa' ? 'Pesquisa' : 'Contato'} em andamento · executor ${ativa.executor || executor || ''}` : bloqueada ? `${bloqueada.nome} não concluiu. As ações seguintes dependem dela.` : estado?.filaArgumentos[0] ? `Próximo argumento: ${estado.filaArgumentos[0]}` : 'Sem argumento na rotação.'}</p>
    {!ativa && at && idade < 15 * 60000 && <p className="camp-agora-ultima">Última ação do navegador: {ACOES_NAV[at.acao] || at.acao} {at.url || ''} · {haQuanto(at.em, agora)}</p>}
  </div>
}
