import { useEffect, useRef, useState } from 'react'
import { abrirPaginaCampanha, adicionarAlvoAutomacao, conferirInteracaoAutomacao, importarSessaoCampanha, mostrarNavegadorCampanha, obterEvidenciaAutomacao } from '../../lib/api'
import type { EstadoAutomacoes } from '../../lib/automacoes'
import { TextoFonte } from './Contexto'

const NOMES: Record<string, string> = { preparando: 'Preparando contexto', executando: 'Em execução', concluida: 'Ciclo encerrado', falhou: 'Falhou', interrompida: 'Interrompida', requer_revisao: 'Resultado a conferir', enviando: 'Envio sem confirmação', incerto: 'Resultado incerto', confirmado: 'Confirmado', nao_enviado: 'Não enviado', na_fila: 'Na fila', feito: 'Concluído' }
export const nomeStatus = (status: string) => typeof status === 'string' && status ? NOMES[status] || status.replaceAll('_', ' ').toLocaleLowerCase('pt-BR') : 'Sem status registrado'

export function ConferirResultado({ campanhaId, id, executando, atualizar }: { campanhaId: string; id: string; executando: boolean; atualizar: () => void }) {
  const [status, setStatus] = useState<'confirmado' | 'nao_enviado'>('confirmado')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  async function salvar() {
    setSalvando(true); setErro('')
    try { await conferirInteracaoAutomacao({ id, status, ...(status === 'confirmado' ? { evidencia: observacao } : { nota: observacao }) }, campanhaId); atualizar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível registrar.') }
    finally { setSalvando(false) }
  }
  return <form className="auto-context-ready" onSubmit={e => { e.preventDefault(); void salvar() }}><h3>Conferir resultado no destino</h3><p className="auto-muted">{executando ? 'Aguarde o ciclo terminar antes de registrar sua conferência.' : 'Depois de conferir a conversa ou candidatura, registre o que aconteceu para liberar os próximos ciclos.'}</p><fieldset disabled={executando || salvando}><label className="auto-field">Resultado<select value={status} onChange={e => setStatus(e.target.value as 'confirmado' | 'nao_enviado')}><option value="confirmado">Envio confirmado</option><option value="nao_enviado">Não houve envio</option></select></label><label className="auto-field">{status === 'confirmado' ? 'Evidência ou recibo' : 'Como você confirmou que não houve envio?'}<input required value={observacao} maxLength={2000} onChange={e => setObservacao(e.target.value)} /></label><button className="auto-button" type="submit">{salvando ? 'Registrando…' : 'Registrar conferência'}</button></fieldset>{erro && <p className="auto-notice auto-notice--error" role="alert">{erro}</p>}</form>
}

function Evidencia({ campanhaId, arquivo, fechar }: { campanhaId: string; arquivo: string; fechar: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [src, setSrc] = useState('')
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    dialog.current?.showModal()
    obterEvidenciaAutomacao(arquivo, campanhaId).then(d => { if (vivo) setSrc(d) }).catch(e => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [arquivo])
  return <dialog ref={dialog} className="auto-dialog" onCancel={fechar} aria-label="Evidência da campanha"><header className="auto-dialog-header"><h2>{arquivo}</h2><button className="auto-button" autoFocus onClick={fechar}>Fechar</button></header><div className="auto-dialog-body">{src ? <img className="auto-evidence-image" src={src} alt={arquivo} /> : <p role="status">{erro || 'Carregando evidência…'}</p>}</div></dialog>
}

export function Operacao({ estado, atualizar, abrirContexto }: { estado: EstadoAutomacoes; atualizar: () => void; abrirContexto: (id: string) => void }) {
  const [url, setUrl] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [evidencia, setEvidencia] = useState('')
  const [acessoOcupado, setAcessoOcupado] = useState('')
  const ultimoResultado = estado.execucoes[0]
  const resultadoPedeAcesso = /gmail|signed out|desconectad|sess[aã]o ausente|login/i.test(`${ultimoResultado?.erro || ''} ${ultimoResultado?.resumo || ''}`)
  const sessaoAtualizadaDepois = Date.parse(estado.navegador.sessao?.importadaEm || '') > Date.parse(ultimoResultado?.concluidoEm || ultimoResultado?.criadoEm || '')
  const acessoPendente = !estado.navegador.conectado || resultadoPedeAcesso && !sessaoAtualizadaDepois
  async function agirAcesso(nome: string, acao: () => Promise<unknown>, sucesso: string) {
    setAcessoOcupado(nome); setErro(''); setAviso('')
    try { await acao(); setAviso(sucesso); atualizar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível preparar o acesso.') }
    finally { setAcessoOcupado('') }
  }
  async function adicionar() {
    setSalvando(true); setErro(''); setAviso('')
    try { const r = await adicionarAlvoAutomacao({ url }, estado.campanha); setUrl(''); setAviso(r.adicionado ? 'Alvo adicionado. Será priorizado no próximo ciclo.' : 'Esse alvo já está na fila.'); atualizar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível adicionar.') }
    finally { setSalvando(false) }
  }
  return <div className="auto-operation" data-testid="automacoes-operacao">
    <section className={`auto-access ${acessoPendente ? 'is-pending' : ''}`} aria-label="Acesso às contas da campanha">
      <div><span className="auto-eyebrow">Navegador e contas</span><h2>{acessoPendente ? 'Resolver acesso' : 'Acesso da campanha'}</h2><p className="auto-muted">{estado.campanha === 'cognition' ? <>O Gmail pode usar <strong>lucasoldev1@gmail.com</strong> ou <strong>lucasplays2000@gmail.com</strong>. A conta é conferida pelo endereço visível, não pela posição /u/0 ou /u/1.</> : 'Abra ou sincronize as contas usadas por esta campanha na bancada isolada do DailyWork.'}</p></div>
      <div className="auto-actions">{estado.campanha === 'cognition' && <button className="auto-button auto-button--primary" disabled={Boolean(acessoOcupado)} onClick={() => void agirAcesso('gmail', () => abrirPaginaCampanha('https://mail.google.com/mail/u/?authuser=lucasplays2000%40gmail.com', estado.campanha), 'Gmail de lucasplays2000 aberto na bancada. Confira a conta e rode a campanha novamente.')}>{acessoOcupado === 'gmail' ? 'Abrindo…' : 'Usar lucasplays2000'}</button>}<button className="auto-button" disabled={Boolean(acessoOcupado)} onClick={() => void agirAcesso('sincronizar', () => importarSessaoCampanha(estado.campanha), 'Sessões do Chromium sincronizadas com a bancada.')}>{acessoOcupado === 'sincronizar' ? 'Sincronizando…' : 'Sincronizar contas'}</button><button className="auto-text-button" disabled={Boolean(acessoOcupado)} onClick={() => void agirAcesso('ver', () => mostrarNavegadorCampanha(estado.campanha), 'Bancada aberta para conferência.')}>Ver bancada</button></div>
    </section>
    <section className="auto-queue"><span className="auto-eyebrow">Próximos contatos</span><h2>Fila da campanha</h2><p className="auto-muted">Perfis LinkedIn, perfis ou posts do X e vagas Ashby entram como prioridade.</p>
      <form className="auto-queue-form" onSubmit={e => { e.preventDefault(); void adicionar() }}><label className="auto-field">Link do alvo<input value={url} onChange={e => setUrl(e.target.value)} type="text" inputMode="url" autoComplete="url" spellCheck={false} required maxLength={2000} placeholder="https://www.linkedin.com/in/…" disabled={salvando} /></label><button type="submit" className="auto-button auto-button--primary" disabled={salvando}>{salvando ? 'Adicionando…' : 'Adicionar à fila'}</button></form>
      {erro && <p className="auto-notice auto-notice--error" role="alert">{erro}</p>}{aviso && <p className="auto-notice" role="status">{aviso}</p>}
      {estado.filaManual.length ? <ul className="auto-lined-list">{estado.filaManual.map(m => <li key={m.id}><div><strong>{m.alvo || m.url}</strong><span>{m.canal} · {nomeStatus(m.status)}</span></div><a href={m.url} target="_blank" rel="noreferrer">Abrir alvo ↗</a></li>)}</ul> : <p className="auto-empty">Nenhum alvo manual. O ciclo seguirá a rotação da campanha.</p>}
      {estado.filaArgumentos.length > 0 && <p className="auto-muted">Próximo argumento: <strong>{estado.filaArgumentos[0]}</strong> · {estado.filaArgumentos.length} na rotação. Consulte o banco na biblioteca.</p>}
    </section>
    <section className="auto-executions"><span className="auto-eyebrow">Execução e contexto</span><h2>Ciclos recentes</h2>
      {estado.execucoes.length ? <ul className="auto-execution-list">{estado.execucoes.map(e => <li key={e.id}><div className="auto-execution-heading"><div><strong>{nomeStatus(e.status)}</strong><span>{e.tipo === 'pesquisa' ? 'Pesquisa' : 'Campanha'} · {e.executor || 'codex'} · {new Date(e.criadoEm).toLocaleString('pt-BR')}</span></div>{e.contextoId && <button className="auto-button" onClick={() => abrirContexto(e.contextoId!)}>Ver base usada</button>}</div>{e.erro && <p className="auto-notice auto-notice--error">{e.erro}</p>}{e.resumo && <details><summary>Resumo do executor</summary><TextoFonte texto={e.resumo} organizada /></details>}</li>)}</ul> : <p className="auto-empty">O próximo ciclo guardará aqui sua base e seu resultado. Execuções antigas não têm contexto reconstruído.</p>}
    </section>
    <section className="auto-interactions"><span className="auto-eyebrow">O que foi dito e por quê</span><h2>Interações e referências</h2>
      {estado.interacoes.length ? estado.interacoes.map(i => <details className="auto-interaction" key={i.id}><summary><strong>{i.alvo}</strong><span>{i.tipo} · {nomeStatus(i.status)} · {new Date(i.criadoEm).toLocaleString('pt-BR')}</span></summary><TextoFonte texto={i.texto} />{i.nota && <p>{i.nota}</p>}{i.evidencia && <p className="auto-file-path">Evidência: {i.evidencia}</p>}<p className="auto-muted">{i.fontesUsadas.length} fontes da biblioteca citadas pelo executor.</p>{i.fontesExternas.map((f, n) => <blockquote key={n}><a href={f.url} target="_blank" rel="noreferrer">Fonte consultada durante o contato ↗</a><p>{f.trecho}</p></blockquote>)}<button className="auto-button" onClick={() => abrirContexto(i.contextoId)}>Inspecionar base original</button>{['enviando', 'incerto'].includes(i.status) && <ConferirResultado campanhaId={estado.campanha} id={i.id} executando={estado.execucoes.some(e => ['preparando', 'executando'].includes(e.status))} atualizar={atualizar} />}</details>) : <p className="auto-empty">Os novos contatos guardarão o texto, as fontes e a confirmação. Os registros anteriores continuam abaixo.</p>}
    </section>
    <section className="auto-legacy"><details><summary>Registros anteriores e evidências<span>{estado.candidaturas.length} candidaturas · {estado.evidencias.length} imagens</span></summary>
      <p className="auto-muted">Esses registros foram mantidos. As fontes usadas na época não foram registradas pelo executor anterior.</p>
      {estado.toqueHoje?.eventos.map((e, i) => <div className="auto-legacy-row" key={i}><strong>{e.tipo} · {nomeStatus(e.status)}</strong>{e.texto && <TextoFonte texto={e.texto} />}{e.motivo && <p>{e.motivo}</p>}</div>)}
      <ul className="auto-lined-list">{estado.candidaturas.map(c => <li key={c.id}><div><strong>{c.id}</strong><span>{nomeStatus(c.status)}</span>{c.note && <p>{c.note}</p>}</div>{c.evidencia && <button className="auto-button" onClick={() => setEvidencia(c.evidencia!.split('/').pop()!)}>Ver evidência</button>}</li>)}</ul>
      <div className="auto-evidence-files">{estado.evidencias.map(e => <button key={e.arquivo} className="auto-button" onClick={() => setEvidencia(e.arquivo)}>{e.arquivo}</button>)}</div>
      {estado.diario.length > 0 && <><h3>Diário</h3><ul>{estado.diario.map((d, i) => <li key={i}>{d.replace(/^- /, '')}</li>)}</ul></>}
    </details></section>
    {evidencia && <Evidencia campanhaId={estado.campanha} arquivo={evidencia} fechar={() => setEvidencia('')} />}
  </div>
}
