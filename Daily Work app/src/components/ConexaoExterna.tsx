import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  autorizarConexao,
  cancelarPublicacaoConexao,
  conexoesDisponiveisNoDesktop,
  configurarConexao,
  confirmarPublicacaoConexao,
  desconectarConexao,
  limparSessaoConexao,
  obterPerfilConexao,
  obterSinaisConexao,
  obterStatusConexao,
  operarSessaoVisual,
  prepararPublicacaoConexao,
  prepararSessaoConexao,
  rascunharPublicacaoConexao,
  type CampoConexao,
  type Conexao,
  type PerfilConexao,
  type PropostaPublicacao,
  type ReciboPublicacao,
  type SessaoViewer,
  type SinaisConexao,
} from '../lib/api'
import type { WebviewElement } from '../webview'
import { hojeLocal } from '../lib/data-local'
import './conexao-externa.css'

type Aba = 'conta' | 'publicar' | 'atividade'
type Formulario = Record<string, string | boolean>

const MARCAS: Record<string, string> = { github: 'GH', linkedin: 'in', x: 'X', reddit: 'r/' }

function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 3H3.8a1.3 1.3 0 0 0-1.3 1.3v7.9a1.3 1.3 0 0 0 1.3 1.3h7.9a1.3 1.3 0 0 0 1.3-1.3V9.5M9 2.5h4.5V7M13.2 2.8 7.1 8.9" />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 5.8A5.5 5.5 0 1 0 13.2 10M13 2.5v3.7H9.3" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m9.5 3.5-4.5 4.5 4.5 4.5" />
    </svg>
  )
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M9.5 2.5v11" />
    </svg>
  )
}

function mensagemDeErro(erro: unknown) {
  return erro instanceof Error ? erro.message : String(erro)
}

function valoresIniciais(esquema: CampoConexao[]): Formulario {
  const inicial: Formulario = {}
  for (const campo of esquema) {
    if (campo.tipo === 'boolean') inicial[campo.campo] = false
    else if (campo.tipo === 'select') inicial[campo.campo] = campo.padrao ?? campo.opcoes?.[0]?.valor ?? ''
    else inicial[campo.campo] = ''
  }
  return inicial
}

function CampoFormulario({
  campo,
  valor,
  onChange,
  desabilitado,
}: {
  campo: CampoConexao
  valor: string | boolean
  onChange: (valor: string | boolean) => void
  desabilitado?: boolean
}) {
  const id = `campo-${campo.campo}`
  if (campo.tipo === 'boolean') {
    return (
      <label className="conexao-campo conexao-campo--boolean" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(valor)} disabled={desabilitado} onChange={(evento) => onChange(evento.target.checked)} />
        <span>{campo.rotulo}</span>
      </label>
    )
  }
  const texto = String(valor ?? '')
  return (
    <label className="conexao-campo" htmlFor={id}>
      <span>
        {campo.rotulo}
        {campo.max && campo.tipo === 'textarea' && (
          <small className={[...texto].length > campo.max ? 'is-over' : ''}>{[...texto].length}/{campo.max}</small>
        )}
      </span>
      {campo.tipo === 'textarea' ? (
        <textarea id={id} value={texto} disabled={desabilitado} rows={6} onChange={(evento) => onChange(evento.target.value)} />
      ) : campo.tipo === 'select' ? (
        <select id={id} value={texto} disabled={desabilitado} onChange={(evento) => onChange(evento.target.value)}>
          {(campo.opcoes || []).map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={campo.tipo === 'password' ? 'password' : 'text'}
          value={texto}
          disabled={desabilitado}
          autoComplete="off"
          spellCheck={false}
          onChange={(evento) => onChange(evento.target.value)}
        />
      )}
      {campo.ajuda && <small className="conexao-campo-ajuda">{campo.ajuda}</small>}
    </label>
  )
}

const ATRIBUTOS_WEBVIEW = { allowpopups: '' } as Record<string, string>

function descreverSessao(sessao: SessaoViewer): string {
  if (sessao.origem === 'chromium') {
    return `Sessão trazida do ${sessao.navegador}: ${sessao.importados} cookies${sessao.sessaoDoDominio ? '' : ' (o navegador não estava logado neste site; só os provedores de login entraram)'}.`
  }
  if (sessao.origem === 'nenhuma') return sessao.motivo || 'O navegador instalado não tem sessão para este site.'
  return sessao.navegador ? `Viewer usa a sessão trazida do ${sessao.navegador}${sessao.em ? ` em ${new Date(sessao.em).toLocaleString('pt-BR')}` : ''}.` : 'Viewer com sessão própria.'
}

export function ConexaoExterna({ id }: { id: string }) {
  const desktop = conexoesDisponiveisNoDesktop()
  const webviewRef = useRef<WebviewElement | null>(null)
  const [conexao, setConexao] = useState<Conexao | null>(null)
  const [pronto, setPronto] = useState(false)
  const [carregandoViewer, setCarregandoViewer] = useState(desktop)
  // A partição recebe a sessão do Chromium instalado antes de o webview
  // carregar; assim a primeira abertura já vem logada.
  const [sessaoPronta, setSessaoPronta] = useState(!desktop)
  const [sessaoViewer, setSessaoViewer] = useState<SessaoViewer | null>(null)
  const [painelAberto, setPainelAberto] = useState(() => {
    const parametros = new URLSearchParams(window.location.search)
    return parametros.get('abaConexao') !== null || parametros.get('integracao') === 'open' || !desktop
  })
  const [aba, setAba] = useState<Aba>(() => {
    const solicitada = new URLSearchParams(window.location.search).get('abaConexao')
    return solicitada === 'publicar' || solicitada === 'atividade' ? solicitada : 'conta'
  })
  const [erro, setErro] = useState('')
  const [recibo, setRecibo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [configuracao, setConfiguracao] = useState<Formulario>({})
  const [perfil, setPerfil] = useState<PerfilConexao | null>(null)
  const [publicacao, setPublicacao] = useState<Formulario>({})
  const [briefing, setBriefing] = useState('')
  const [proposta, setProposta] = useState<PropostaPublicacao | null>(null)
  const [publicado, setPublicado] = useState<ReciboPublicacao | null>(null)
  const [diaAtividade, setDiaAtividade] = useState(hojeLocal())
  const [sinais, setSinais] = useState<SinaisConexao | null>(null)
  const [carregandoSinais, setCarregandoSinais] = useState(false)

  const status = conexao?.status ?? null
  const conectada = Boolean(status?.configured && status?.online)
  const visual = conexao?.visual
  const podeUsarSessao = visual?.transporte === 'sessao_visual' && !!visual.contaEsperada

  useEffect(() => {
    if (!publicado?.jobId || ['publicado','incerto','falhou','cancelado','expirado'].includes(publicado.estado || '')) return
    const timer = window.setInterval(() => {
      void operarSessaoVisual<ReciboPublicacao>('job', { conta: id, jobId: publicado.jobId }).then(setPublicado).catch(() => {})
    }, 3000)
    return () => window.clearInterval(timer)
  }, [publicado?.jobId, publicado?.estado])

  const atualizarStatus = useCallback(async () => {
    try {
      const atual = await obterStatusConexao(id)
      setConexao(atual)
      setErro('')
      return atual
    } catch (falha) {
      setErro(mensagemDeErro(falha))
      return null
    } finally {
      setPronto(true)
    }
  }, [id])

  useEffect(() => {
    void atualizarStatus()
  }, [atualizarStatus])

  useEffect(() => {
    if (!conexao) return
    setConfiguracao((atual) => (Object.keys(atual).length ? atual : valoresIniciais(conexao.esquemaConfiguracao)))
    setPublicacao((atual) => (Object.keys(atual).length ? atual : valoresIniciais(conexao.esquemaPublicacao)))
  }, [conexao])

  useEffect(() => {
    if (status?.autorizacao?.estado !== 'aguardando') return
    const timer = window.setInterval(() => void atualizarStatus(), 2000)
    return () => window.clearInterval(timer)
  }, [status?.autorizacao?.estado, atualizarStatus])

  useEffect(() => {
    if (!conectada || aba !== 'conta') return
    let ativo = true
    obterPerfilConexao(id)
      .then((dados) => { if (ativo) setPerfil(dados) })
      .catch(() => { if (ativo) setPerfil(null) })
    return () => { ativo = false }
  }, [id, conectada, aba])

  const carregarSinais = useCallback(async (forcar = false) => {
    if (!conexao?.capacidades.sinais || !conectada) return
    setCarregandoSinais(true)
    try {
      setSinais(await obterSinaisConexao(id, diaAtividade, forcar))
      setErro('')
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setCarregandoSinais(false)
    }
  }, [conexao?.capacidades.sinais, conectada, id, diaAtividade])

  useEffect(() => {
    if (aba === 'atividade') void carregarSinais()
  }, [aba, carregarSinais])

  useEffect(() => {
    if (!desktop || !conexao?.id) return
    let ativo = true
    setSessaoPronta(false)
    prepararSessaoConexao(conexao.id)
      .then((resultado) => { if (ativo) setSessaoViewer(resultado) })
      .catch(() => { if (ativo) setSessaoViewer(null) })
      .finally(() => { if (ativo) setSessaoPronta(true) })
    return () => { ativo = false }
  }, [desktop, conexao?.id])

  useEffect(() => {
    const elemento = webviewRef.current
    if (!elemento) return
    const iniciou = () => setCarregandoViewer(true)
    const terminou = () => setCarregandoViewer(false)
    elemento.addEventListener('did-start-loading', iniciou)
    elemento.addEventListener('did-stop-loading', terminou)
    elemento.addEventListener('did-fail-load', terminou)
    return () => {
      elemento.removeEventListener('did-start-loading', iniciou)
      elemento.removeEventListener('did-stop-loading', terminou)
      elemento.removeEventListener('did-fail-load', terminou)
    }
  }, [conexao?.id, sessaoPronta])

  async function executar(acao: () => Promise<void>) {
    setOcupado(true)
    setErro('')
    try {
      await acao()
    } catch (falha) {
      setErro(mensagemDeErro(falha))
    } finally {
      setOcupado(false)
    }
  }

  const camposPublicacaoVisiveis = useMemo(() => {
    if (!conexao) return []
    const tipo = String(publicacao.tipo || '')
    return conexao.esquemaPublicacao.filter((campo) => {
      if (conexao.id === 'github') {
        if (campo.campo === 'repo') return tipo !== 'gist'
        if (campo.campo === 'numero') return tipo === 'comentario'
        if (campo.campo === 'arquivo' || campo.campo === 'publico') return tipo === 'gist'
        if (campo.campo === 'titulo') return tipo !== 'comentario'
      }
      if (conexao.id === 'reddit') {
        if (campo.campo === 'alvo') return tipo === 'comentario'
        if (campo.campo === 'subreddit' || campo.campo === 'titulo') return tipo !== 'comentario'
        if (campo.campo === 'url') return tipo === 'link'
        if (campo.campo === 'texto') return tipo !== 'link'
      }
      return true
    })
  }, [conexao, publicacao.tipo])

  const marca = MARCAS[id] || id.slice(0, 2).toUpperCase()
  const nome = conexao?.nome || id
  const dominio = conexao?.dominio || ''
  const estadoViewer = !desktop ? 'is-offline' : carregandoViewer ? 'is-loading' : 'is-online'
  const rotuloEstado = !desktop
    ? 'Viewer só no app desktop'
    : carregandoViewer
      ? `Carregando ${dominio}`
      : conectada
        ? `Conectada como ${status?.conta?.login}`
        : status?.configured
          ? 'Credencial salva, sem resposta'
          : podeUsarSessao ? `Sessão dos agentes · ${visual?.contaEsperada?.nome}` : 'API não autorizada'

  return (
    <section
      className="conexao"
      data-dailywork-ready={pronto ? 'true' : 'false'}
      data-testid={`conexao-${id}`}
      aria-label={`Conexão ${nome}`}
    >
      <header className="conexao-toolbar">
        <div className="conexao-identity">
          <span className={`conexao-mark conexao-mark--${id}`} aria-hidden="true">{marca}</span>
          <span>
            <strong>{nome}</strong>
            <small>{dominio}</small>
          </span>
        </div>

        <div className={`conexao-environment ${estadoViewer}`} aria-label="Estado da conexão">
          <span aria-hidden="true" />
          {rotuloEstado}
        </div>

        <div className="conexao-actions">
          <button type="button" onClick={() => webviewRef.current?.goBack()} title="Voltar no viewer" disabled={!desktop}>
            <BackIcon />
            <span>Voltar</span>
          </button>
          <button type="button" onClick={() => webviewRef.current?.reload()} title={`Recarregar ${dominio}`} disabled={!desktop}>
            <ReloadIcon />
            <span>Recarregar</span>
          </button>
          <button type="button" onClick={() => setPainelAberto((aberto) => !aberto)} aria-expanded={painelAberto} title="Abrir painel da conexão">
            <PanelIcon />
            <span>Painel</span>
          </button>
          <button type="button" onClick={() => window.open(conexao?.urlInicial || `https://${dominio}`, '_blank', 'noopener,noreferrer')} title={`Abrir ${dominio} no navegador`}>
            <ExternalIcon />
            <span>Abrir no navegador</span>
          </button>
        </div>
      </header>

      <div className="conexao-frame">
        {desktop && conexao && sessaoPronta ? (
          <webview
            ref={webviewRef as never}
            src={conexao.urlInicial}
            partition={conexao.partition}
            // O React descarta `allowpopups={true}` (atributo não booleano no
            // DOM) e o Electron só lê a presença do atributo na hora de anexar
            // o webview; sem ele, popups de login (Google, Microsoft) falham.
            {...ATRIBUTOS_WEBVIEW}
            className="conexao-webview"
          />
        ) : (
          <div className="conexao-placeholder" role="status">
            <strong>{nome} abre dentro do DailyWork desktop.</strong>
            <p>No navegador de desenvolvimento, use o painel ao lado para configurar, publicar e ler a atividade pela API.</p>
          </div>
        )}
        {desktop && (carregandoViewer || !sessaoPronta) && (
          <div className="conexao-loading" role="status">
            <span aria-hidden="true" />
            {sessaoPronta ? `Carregando ${dominio}…` : 'Trazendo a sessão do Chromium…'}
          </div>
        )}

        {painelAberto && (
          <aside className="conexao-painel" aria-label={`Painel da conexão ${nome}`}>
            <header>
              <div>
                <small>DailyWork ↔ {dominio}</small>
                <h2>{nome}</h2>
              </div>
              <button type="button" onClick={() => setPainelAberto(false)} aria-label="Fechar painel">×</button>
            </header>

            <nav className="conexao-abas" aria-label="Seções da conexão">
              {(['conta', 'publicar', 'atividade'] as Aba[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={aba === item ? 'is-active' : ''}
                  aria-current={aba === item ? 'page' : undefined}
                  data-testid={`conexao-aba-${item}`}
                  onClick={() => setAba(item)}
                >
                  {item === 'conta' ? 'Conta' : item === 'publicar' ? 'Publicar' : 'Atividade'}
                </button>
              ))}
            </nav>

            <div className="conexao-status">
              <span className={conectada || visual?.disponivel ? 'is-online' : status?.configured || podeUsarSessao ? 'is-warning' : 'is-pending'} />
              <div>
                <strong>
                  {podeUsarSessao ? visual?.contaEsperada?.nome : conectada
                    ? status?.conta?.nome || status?.conta?.login
                    : status?.configured
                      ? 'Credencial salva, mas a conta não respondeu'
                      : 'Nenhuma credencial salva'}
                </strong>
                <small>
                  {podeUsarSessao ? `Sessão dos agentes · ${status?.configured ? 'API configurada separadamente' : 'API não autorizada'}` : conectada
                    ? `${status?.conta?.login} · via ${status?.origemCredencial}`
                    : status?.error || 'O viewer ao lado continua funcionando; a API precisa de credencial própria.'}
                </small>
              </div>
            </div>

            {erro && <p className="conexao-mensagem is-error">{erro}</p>}
            {recibo && <p className="conexao-mensagem is-success">{recibo}</p>}

            {aba === 'conta' && conexao && (
              <>
                {(id === 'linkedin' || id === 'x') && visual && <section className="conexao-secao" data-testid="conexao-sessao-visual">
                  <h3>Sessão dos agentes</h3>
                  <p>{visual.contaEsperada ? `${visual.contaEsperada.nome} · ${visual.contaEsperada.perfilUrl}` : 'Use a conta aberta na bancada dailywork-redes.'}</p>
                  <p>{visual.sessao === 'autenticada' ? 'Login verificado' : visual.sessao === 'desconhecida' ? 'Verifique o login para atualizar o estado' : `Sessão: ${visual.sessao}`} · {visual.executor === 'livre' ? 'Executor disponível' : `Executor: ${visual.executor}`}</p>
                  <p>{id === 'x' ? 'Publicações com texto e até quatro imagens usam essa sessão após sua aprovação.' : 'Publicações com texto e imagens usam essa sessão após sua aprovação. Vídeos ainda não estão disponíveis nesse envio.'}</p>
                  <div className="conexao-botoes">
                    <button type="button" disabled={ocupado} onClick={() => void executar(async () => { await operarSessaoVisual('verificar', { conta: id }); await atualizarStatus() })}>Verificar login</button>
                    <button type="button" disabled={ocupado} onClick={() => void executar(async () => { await operarSessaoVisual('importar', { conta: id }); await atualizarStatus() })}>Usar sessão do Chromium na bancada</button>
                    {visual.contaVerificada && <button type="button" disabled={ocupado} onClick={() => void executar(async () => { await operarSessaoVisual('vincular', { conta: id, perfilUrl: visual.contaVerificada?.perfilUrl }); await atualizarStatus() })}>Usar esta conta para os agentes</button>}
                  </div>
                </section>}
                {conectada && perfil && (
                  <section className="conexao-secao conexao-perfil">
                    {perfil.avatar && <img src={perfil.avatar} alt="" />}
                    <div>
                      <strong>{perfil.nome}</strong>
                      <small>{perfil.login}</small>
                      {perfil.bio ? <p>{String(perfil.bio)}</p> : null}
                      <dl>
                        {Object.entries(perfil)
                          .filter(([chave, valor]) => !['login', 'nome', 'bio', 'url', 'avatar', 'repositorios', 'email'].includes(chave) && (typeof valor === 'number' || typeof valor === 'string'))
                          .slice(0, 6)
                          .map(([chave, valor]) => (
                            <div key={chave}><dt>{chave.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{String(valor)}</dd></div>
                          ))}
                      </dl>
                    </div>
                  </section>
                )}

                <section className="conexao-secao">
                  <h3>{status?.configured ? 'Atualizar credencial' : 'Conectar pela API'}</h3>
                  <p>Segredos ficam cifrados no cofre do sistema e nunca são enviados ao viewer.</p>
                  {conexao.esquemaConfiguracao.map((campo) => (
                    <CampoFormulario
                      key={campo.campo}
                      campo={campo}
                      valor={configuracao[campo.campo] ?? ''}
                      desabilitado={ocupado}
                      onChange={(valor) => setConfiguracao((atual) => ({ ...atual, [campo.campo]: valor }))}
                    />
                  ))}
                  <div className="conexao-botoes">
                    <button
                      type="button"
                      className="conexao-primario"
                      disabled={ocupado}
                      data-testid="conexao-salvar"
                      onClick={() => void executar(async () => {
                        const enviados: Formulario = {}
                        for (const [chave, valor] of Object.entries(configuracao)) {
                          if (valor !== '' && valor !== false) enviados[chave] = valor
                        }
                        setConexao(await configurarConexao(id, enviados))
                        setConfiguracao(valoresIniciais(conexao.esquemaConfiguracao))
                        setRecibo('Credencial salva no cofre cifrado.')
                      })}
                    >
                      Salvar com segurança
                    </button>
                    {conexao.capacidades.oauth && (
                      <button
                        type="button"
                        disabled={ocupado || status?.autorizacao?.estado === 'aguardando'}
                        onClick={() => void executar(async () => {
                          const resultado = await autorizarConexao(id)
                          if (!desktop && resultado.url) window.open(resultado.url, '_blank', 'noopener,noreferrer')
                          setRecibo('Autorize a conta na janela que abriu. O DailyWork conclui sozinho ao receber o retorno.')
                          await atualizarStatus()
                        })}
                      >
                        {status?.autorizacao?.estado === 'aguardando' ? 'Aguardando autorização…' : 'Autorizar no navegador'}
                      </button>
                    )}
                  </div>
                  {status?.autorizacao?.estado === 'falhou' && (
                    <p className="conexao-mensagem is-error">Autorização falhou: {status.autorizacao.erro}</p>
                  )}
                  {status?.expiraEm && <small className="conexao-nota">Token expira em {new Date(status.expiraEm).toLocaleDateString('pt-BR')}.</small>}
                </section>

                <section className="conexao-secao conexao-secao--perigo">
                  <h3>Sessões</h3>
                  <div className="conexao-botoes">
                    <button
                      type="button"
                      disabled={ocupado || !status?.configured}
                      onClick={() => void executar(async () => {
                        setConexao(await desconectarConexao(id))
                        setPerfil(null)
                        setRecibo('Credencial removida do cofre.')
                      })}
                    >
                      Remover credencial
                    </button>
                    <button
                      type="button"
                      disabled={ocupado || !desktop}
                      onClick={() => void executar(async () => {
                        await limparSessaoConexao(id)
                        webviewRef.current?.reload()
                        setRecibo('Sessão do viewer limpa. Faça login de novo quando quiser.')
                      })}
                    >
                      Sair do viewer
                    </button>
                    <button
                      type="button"
                      data-testid="conexao-sessao-chromium"
                      disabled={ocupado || !desktop}
                      title="Copia os cookies do seu Chromium (ou Chrome/Brave) para este viewer"
                      onClick={() => void executar(async () => {
                        const resultado = await prepararSessaoConexao(id, { forcar: true })
                        setSessaoViewer(resultado)
                        webviewRef.current?.reload()
                        setRecibo(descreverSessao(resultado))
                      })}
                    >
                      Usar sessão do Chromium
                    </button>
                  </div>
                  {sessaoViewer && <p className="conexao-mensagem">{descreverSessao(sessaoViewer)}</p>}
                </section>
              </>
            )}

            {aba === 'publicar' && conexao && (
              <>
                {!conexao.capacidades.publicar ? (
                  <p className="conexao-mensagem">Esta conta não permite publicar pelo DailyWork.</p>
                ) : publicado ? (
                  <section className="conexao-secao">
                    <h3>{publicado.jobId && publicado.estado !== 'publicado' ? `Publicação: ${{ aguardando_executor: 'aguardando executor', preparando: 'preparando', aguardando_humano: 'aguardando você na bancada', envio_iniciado: 'verificando envio', incerto: 'resultado incerto', falhou: 'interrompida', cancelado: 'cancelada', expirado: 'aprovação expirada' }[publicado.estado || ''] || publicado.estado}` : `Publicado em ${publicado.nome}`}</h3>
                    <p>{publicado.resumo}</p>
                    {publicado.erro && <p>{publicado.erro}</p>}
                    {publicado.recibo?.url && <a href={publicado.recibo.url} target="_blank" rel="noopener noreferrer">Ver publicação</a>}
                    {publicado.jobId && ['aguardando_executor','preparando','aguardando_humano'].includes(publicado.estado || '') && <button type="button" disabled={ocupado} onClick={() => void executar(async () => { setPublicado(await operarSessaoVisual<ReciboPublicacao>('cancelar', { conta: id, jobId: publicado.jobId })) })}>Cancelar envio</button>}
                    {publicado.url && (
                      <a href={publicado.url} target="_blank" rel="noopener noreferrer">{publicado.url}</a>
                    )}
                    <div className="conexao-botoes">
                      <button type="button" className="conexao-primario" onClick={() => { setPublicado(null); setPublicacao(valoresIniciais(conexao.esquemaPublicacao)) }}>
                        Nova publicação
                      </button>
                    </div>
                  </section>
                ) : proposta ? (
                  <section className="conexao-secao conexao-proposta" data-testid="conexao-proposta">
                    <div className="conexao-secao-heading">
                      <h3>Revisar antes de enviar</h3>
                      <span>{proposta.preview.destino}</span>
                    </div>
                    <strong>{proposta.preview.titulo}</strong>
                    <pre>{proposta.preview.corpo}</pre>
                    <small className="conexao-nota">Proposta válida até {new Date(proposta.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Nada foi enviado ainda.</small>
                    <div className="conexao-botoes">
                      <button
                        type="button"
                        className="conexao-primario"
                        disabled={ocupado}
                        data-testid="conexao-confirmar"
                        onClick={() => void executar(async () => {
                          const resultado = await confirmarPublicacaoConexao(proposta.proposalId)
                          setPublicado(resultado)
                          setProposta(null)
                          setRecibo('')
                          void carregarSinais(true)
                        })}
                      >
                        Confirmar e publicar
                      </button>
                      <button type="button" disabled={ocupado} onClick={() => void executar(async () => { await cancelarPublicacaoConexao(proposta.proposalId); setProposta(null) })}>
                        Voltar e editar
                      </button>
                    </div>
                  </section>
                ) : (
                  <>
                    <section className="conexao-secao conexao-redator">
                      <h3>Rascunhar com o contexto do dia</h3>
                      <p>{conexao.orientacaoRedacao}</p>
                      <label className="conexao-campo">
                        <span>Briefing (opcional)</span>
                        <textarea rows={3} value={briefing} onChange={(evento) => setBriefing(evento.target.value)} placeholder="O que você quer contar? Tom, foco, público…" />
                      </label>
                      <div className="conexao-botoes">
                        <button
                          type="button"
                          disabled={ocupado}
                          data-testid="conexao-rascunhar"
                          onClick={() => void executar(async () => {
                            const resultado = await rascunharPublicacaoConexao({ conta: id, dia: hojeLocal(), briefing })
                            setPublicacao((atual) => ({ ...atual, ...resultado.rascunho }))
                            setRecibo(resultado.contextoUsado ? 'Rascunho gerado a partir do seu dia. Revise antes de preparar.' : 'Rascunho gerado sem registros do dia. Revise com atenção.')
                          })}
                        >
                          {ocupado ? 'Escrevendo…' : 'Rascunhar com o agente'}
                        </button>
                      </div>
                    </section>

                    <section className="conexao-secao">
                      <h3>Compor</h3>
                      {camposPublicacaoVisiveis.map((campo) => (
                        <CampoFormulario
                          key={campo.campo}
                          campo={campo}
                          valor={publicacao[campo.campo] ?? ''}
                          desabilitado={ocupado}
                          onChange={(valor) => setPublicacao((atual) => ({ ...atual, [campo.campo]: valor }))}
                        />
                      ))}
                      <div className="conexao-botoes">
                        <button
                          type="button"
                          className="conexao-primario"
                          disabled={ocupado || !(podeUsarSessao || conectada)}
                          data-testid="conexao-preparar"
                          onClick={() => void executar(async () => {
                            setProposta(await prepararPublicacaoConexao(id, publicacao))
                            setRecibo('')
                          })}
                        >
                          Preparar publicação
                        </button>
                      </div>
                      {!(podeUsarSessao || conectada) && <small className="conexao-nota">Vincule a sessão dos agentes ou conecte a API na aba Conta.</small>}
                    </section>
                  </>
                )}
              </>
            )}

            {aba === 'atividade' && conexao && (
              <section className="conexao-secao" data-testid="conexao-atividade">
                <div className="conexao-secao-heading">
                  <h3>Atividade do dia</h3>
                  <input type="date" value={diaAtividade} max={hojeLocal()} aria-label="Dia da atividade" onChange={(evento) => evento.target.value && setDiaAtividade(evento.target.value)} />
                </div>
                {!conexao.capacidades.sinais ? (
                  <p className="conexao-mensagem">{sinais?.indisponivel || 'Esta conta não expõe o histórico pela API pessoal. Use o viewer ao lado para ler o feed.'}</p>
                ) : !conectada ? (
                  <p className="conexao-mensagem">Conecte a conta pela API para ler a atividade e alimentar o Sumário Diário.</p>
                ) : (
                  <>
                    <div className="conexao-botoes">
                      <button type="button" disabled={carregandoSinais} onClick={() => void carregarSinais(true)}>
                        {carregandoSinais ? 'Lendo…' : 'Atualizar'}
                      </button>
                      <small className="conexao-nota">
                        {sinais ? `${sinais.itens.length} ${sinais.itens.length === 1 ? 'item' : 'itens'} · entram no Sumário Diário` : 'Ainda não lido'}
                      </small>
                    </div>
                    {sinais?.erros.map((mensagem) => (
                      <p className="conexao-mensagem is-error" key={mensagem}>{mensagem}</p>
                    ))}
                    <ul className="conexao-sinais">
                      {sinais?.itens.map((item) => (
                        <li key={item.id}>
                          <span className="conexao-sinal-tipo">{item.tipo}</span>
                          <div>
                            <strong>{item.titulo}</strong>
                            {item.texto && item.texto !== item.titulo && <p>{item.texto}</p>}
                            <small>
                              {item.timestamp ? new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                              {item.url && (
                                <>
                                  {' · '}
                                  <a href={item.url} target="_blank" rel="noopener noreferrer">abrir</a>
                                </>
                              )}
                            </small>
                          </div>
                        </li>
                      ))}
                      {sinais && sinais.itens.length === 0 && <li className="conexao-sinais-vazio">Nenhuma atividade registrada neste dia.</li>}
                    </ul>
                  </>
                )}
              </section>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}
