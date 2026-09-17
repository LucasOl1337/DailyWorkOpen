import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Bloco } from '../lib/md'
import {
  configurarAgente,
  confirmarAcaoAgente,
  conversarComAgente,
  type AnexoAgente,
  type ConfiguracaoAgente,
  type ConfirmacaoAgente,
  type ReciboAcaoAgente,
} from '../lib/api'
import { JanelaFlutuante } from './JanelaFlutuante'
import './assistente-dia.css'

type EstadoConfirmacao = 'pendente' | 'aplicando' | 'aplicada' | 'descartada' | 'invalida' | 'erro'

interface ConfirmacaoLocal extends ConfirmacaoAgente {
  estado: EstadoConfirmacao
  erro?: string
}

interface MensagemLocal {
  id: string
  role: 'user' | 'assistant'
  content: string
  anexos?: string[]
  acoes?: ReciboAcaoAgente[]
  confirmacoes?: ConfirmacaoLocal[]
}

interface AnexoLocal extends AnexoAgente {
  preview: string
}

interface AssistenteDiaProps {
  escopo?: 'dia' | 'principal' | 'global'
  dia?: string
  blocos?: Bloco[]
  aberto?: boolean
  onAbertoChange?: (aberto: boolean) => void
  onBlocosAlterados?: () => void | Promise<void>
  // Embutido: sem launcher nem scrim, o painel fica sempre aberto (aba Agente).
  embutido?: boolean
}

const CHAVE_PERFIL = 'dailywork:agente:perfil'
const CHAVE_CONTEXTO_DURAVEL = 'dailywork:agente:contexto-duravel'
const LIMITE_ANEXO = 4 * 1024 * 1024

function novoId() {
  return globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function chaveHistorico(escopo: string) {
  return `dailywork:agente:historico:${escopo}`
}

function lerPreferencia(chave: string) {
  try {
    return localStorage.getItem(chave) || ''
  } catch {
    return ''
  }
}

function rotuloProvider(config: ConfiguracaoAgente | null, pronta: boolean) {
  const nome = config?.provider === '9router' ? '9Router' : 'Grok CLI'
  if (config?.conectado) return `${nome} online`
  if (pronta) return `${nome} indisponível`
  return 'Conectando'
}

function lerHistorico(escopo: string): MensagemLocal[] {
  try {
    const valor = JSON.parse(localStorage.getItem(chaveHistorico(escopo)) || '[]')
    if (!Array.isArray(valor)) return []
    return valor
      .filter(
        (item) =>
          item &&
          ['user', 'assistant'].includes(item.role) &&
          typeof item.content === 'string'
      )
      .slice(-30)
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : novoId(),
        role: item.role,
        content: item.content,
        anexos: Array.isArray(item.anexos) ? item.anexos.map(String).slice(0, 1) : [],
        acoes: Array.isArray(item.acoes) ? item.acoes : [],
        // Confirmações vivem somente na sessão atual; o token expira no backend.
        confirmacoes: [],
      }))
  } catch {
    return []
  }
}

function rotuloData(dia: string) {
  const [ano, mes, data] = dia.split('-')
  return `${data}/${mes}/${ano}`
}

function SparkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2.75c.7 4.9 2.35 6.55 7.25 7.25-4.9.7-6.55 2.35-7.25 7.25C11.3 12.35 9.65 10.7 4.75 10 9.65 9.3 11.3 7.65 12 2.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M18.2 16.2c.28 1.96.94 2.62 2.9 2.9-1.96.28-2.62.94-2.9 2.9-.28-1.96-.94-2.62-2.9-2.9 1.96-.28 2.62-.94 2.9-2.9Z" fill="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="m4 12 15-7-4.5 14-3-5-7.5-2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m11.5 14 3.8-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="m9.5 12.5 5.7-5.7a3 3 0 1 1 4.2 4.2l-7.8 7.8a5 5 0 0 1-7.1-7.1l7.4-7.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function PreviewConfirmacao({ confirmacao }: { confirmacao: ConfirmacaoLocal }) {
  const depois = confirmacao.preview?.depois
  const antes = confirmacao.preview?.antes
  return (
    <div className="assistente-preview">
      {depois ? (
        <div className="assistente-preview-depois">
          <span>{antes ? 'Depois' : 'Conteúdo proposto'}</span>
          <strong>{depois.titulo}</strong>
          <small>{depois.tipo} · {depois.status}</small>
          <p>{depois.corpo || 'Sem corpo.'}</p>
          {depois.conexoes.length > 0 && (
            <small>Conexões: {depois.conexoes.join(', ')}</small>
          )}
        </div>
      ) : antes ? (
        <div className="assistente-preview-depois assistente-preview-arquivo">
          <span>Conteúdo que será arquivado</span>
          <strong>{antes.titulo}</strong>
          <small>{antes.tipo} · {antes.status}</small>
          <p>{antes.corpo || 'Sem corpo.'}</p>
        </div>
      ) : null}
      {antes && depois && (
        <details>
          <summary>Comparar com a versão atual</summary>
          <strong>{antes.titulo}</strong>
          <small>{antes.tipo} · {antes.status}</small>
          <p>{antes.corpo || 'Sem corpo.'}</p>
          {antes.conexoes.length > 0 && <small>Conexões: {antes.conexoes.join(', ')}</small>}
        </details>
      )}
    </div>
  )
}

async function prepararAnexo(arquivo: File): Promise<AnexoLocal> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(arquivo.type)) {
    throw new Error('Use PNG, JPEG, WebP ou GIF.')
  }
  if (arquivo.size > LIMITE_ANEXO) throw new Error('A imagem precisa ter até 4 MB.')
  const preview = await new Promise<string>((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result || ''))
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    leitor.readAsDataURL(arquivo)
  })
  const base64 = preview.split(',', 2)[1] || ''
  if (!base64) throw new Error('A imagem não contém dados válidos.')
  return { nome: arquivo.name, mimeType: arquivo.type, base64, preview }
}

export function AssistenteDia({
  escopo = 'dia',
  dia,
  blocos = [],
  aberto = false,
  onAbertoChange = () => {},
  onBlocosAlterados = () => {},
  embutido = false,
}: AssistenteDiaProps) {
  const principal = escopo === 'principal'
  const global = escopo === 'global'
  const chaveEscopo = principal ? 'principal' : global ? 'global' : `dia:${dia}`
  const rotuloEscopo = principal ? 'Canvas Principal' : global ? 'Visão geral' : rotuloData(dia || '')
  const abertoEfetivo = embutido || aberto
  const [config, setConfig] = useState<ConfiguracaoAgente | null>(null)
  const [configPronta, setConfigPronta] = useState(false)
  const [modal, setModal] = useState(
    () => !embutido && window.matchMedia('(max-width: 820px)').matches
  )
  const [perfilId, setPerfilId] = useState(() => lerPreferencia(CHAVE_PERFIL))
  const [usarContextoDuravel, setUsarContextoDuravel] = useState(
    () => lerPreferencia(CHAVE_CONTEXTO_DURAVEL) === 'true'
  )
  const [mensagens, setMensagens] = useState<MensagemLocal[]>(() => lerHistorico(chaveEscopo))
  const [texto, setTexto] = useState('')
  const [anexo, setAnexo] = useState<AnexoLocal | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const configSolicitada = useRef(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const painelRef = useRef<HTMLElement>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const textoRef = useRef<HTMLTextAreaElement>(null)
  const arquivoRef = useRef<HTMLInputElement>(null)

  async function carregarConfiguracao() {
    if (configSolicitada.current) return
    configSolicitada.current = true
    setConfigPronta(false)
    setErro('')
    try {
      const dados = await configurarAgente()
      setConfig(dados)
      const salvoExiste = dados.perfis.some((perfil) => perfil.id === perfilId)
      const proximo = salvoExiste ? perfilId : dados.perfilPadrao
      setPerfilId(proximo)
      try {
        localStorage.setItem(CHAVE_PERFIL, proximo)
      } catch {
        // Preferência local é opcional.
      }
    } catch (e) {
      configSolicitada.current = false
      setErro(`Não foi possível carregar o agente: ${String(e)}`)
    } finally {
      setConfigPronta(true)
    }
  }

  useEffect(() => {
    if (abertoEfetivo) void carregarConfiguracao()
  }, [abertoEfetivo])

  useEffect(() => {
    try {
      const persistivel = mensagens.slice(-30).map((mensagem) => ({
        ...mensagem,
        confirmacoes: [],
      }))
      localStorage.setItem(chaveHistorico(chaveEscopo), JSON.stringify(persistivel))
    } catch {
      // O chat continua funcional sem persistência local.
    }
  }, [chaveEscopo, mensagens])

  useEffect(() => {
    if (!abertoEfetivo) return
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [abertoEfetivo, enviando, mensagens])

  useEffect(() => {
    if (!abertoEfetivo) return
    const timer = window.setTimeout(() => {
      if (textoRef.current && !textoRef.current.disabled) {
        textoRef.current.focus()
        return
      }
      painelRef.current
        ?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled])')
        ?.focus()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [abertoEfetivo])

  useEffect(() => {
    if (embutido) return
    const media = window.matchMedia('(max-width: 820px)')
    const atualizar = () => setModal(media.matches)
    atualizar()
    media.addEventListener('change', atualizar)
    return () => media.removeEventListener('change', atualizar)
  }, [embutido])

  useEffect(() => {
    if (!abertoEfetivo || embutido) return
    const area = document.querySelector<HTMLElement>(principal ? '.tl-container' : '.dia-area')
    if (modal && area) area.inert = true
    const aoPressionarTecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        fecharAssistente()
        return
      }
      if (evento.key !== 'Tab' || !modal || !painelRef.current) return
      const elementos = Array.from(
        painelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]):not([hidden]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (elementos.length === 0) return
      const indice = elementos.indexOf(document.activeElement as HTMLElement)
      if (evento.shiftKey && indice <= 0) {
        evento.preventDefault()
        elementos.at(-1)?.focus()
      } else if (!evento.shiftKey && (indice === -1 || indice === elementos.length - 1)) {
        evento.preventDefault()
        elementos[0].focus()
      }
    }
    document.addEventListener('keydown', aoPressionarTecla)
    return () => {
      document.removeEventListener('keydown', aoPressionarTecla)
      if (area) area.inert = false
    }
  }, [abertoEfetivo, modal, principal, embutido])

  const familias = useMemo(() => {
    const grupos = new Map<string, NonNullable<ConfiguracaoAgente['perfis']>>()
    for (const perfil of config?.perfis || []) {
      const grupo = grupos.get(perfil.familia) || []
      grupo.push(perfil)
      grupos.set(perfil.familia, grupo)
    }
    return [...grupos]
  }, [config])

  const perfilSelecionado = config?.perfis.find((perfil) => perfil.id === perfilId)
  const imagensDoEscopo = blocos.filter((bloco) => bloco.tipo === 'imagem' && bloco.midia).length
  const confirmacaoAplicando = mensagens.some((mensagem) =>
    mensagem.confirmacoes?.some((confirmacao) => confirmacao.estado === 'aplicando')
  )
  const ocupado = enviando || confirmacaoAplicando

  function selecionarPerfil(valor: string) {
    setPerfilId(valor)
    try {
      localStorage.setItem(CHAVE_PERFIL, valor)
    } catch {
      // Preferência local é opcional.
    }
  }

  function alternarContextoDuravel(valor: boolean) {
    setUsarContextoDuravel(valor)
    try {
      localStorage.setItem(CHAVE_CONTEXTO_DURAVEL, String(valor))
    } catch {
      // Preferência local é opcional.
    }
  }

  async function enviar(conteudoForcado?: string) {
    const conteudo = (conteudoForcado ?? texto).trim()
    if (!conteudo || ocupado) return
    if (!perfilId) {
      setErro('Aguarde o carregamento dos perfis do agente.')
      return
    }
    const usuario: MensagemLocal = {
      id: novoId(),
      role: 'user',
      content: conteudo,
      anexos: anexo ? [anexo.nome] : [],
    }
    const historico = [...mensagens, usuario]
    setMensagens(historico)
    setTexto('')
    setErro('')
    setEnviando(true)
    const anexoEnviado = anexo
    setAnexo(null)
    if (arquivoRef.current) arquivoRef.current.value = ''
    try {
      const resposta = await conversarComAgente({
        escopo,
        ...(dia ? { dia } : {}),
        perfilId,
        mensagens: historico.map(({ role, content }) => ({ role, content })),
        anexos: anexoEnviado
          ? [
              {
                nome: anexoEnviado.nome,
                mimeType: anexoEnviado.mimeType,
                base64: anexoEnviado.base64,
              },
            ]
          : undefined,
        usarContextoDuravel: principal || global || usarContextoDuravel,
      })
      setMensagens((atuais) => [
        ...atuais,
        {
          id: novoId(),
          role: 'assistant',
          content: resposta.mensagem,
          acoes: resposta.acoes,
          confirmacoes: resposta.confirmacoes.map((confirmacao) => ({
            ...confirmacao,
            estado: 'pendente' as const,
          })),
        },
      ])
    } catch (e) {
      setErro(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setEnviando(false)
    }
  }

  function atualizarConfirmacao(
    mensagemId: string,
    acaoId: string,
    patch: Partial<ConfirmacaoLocal>
  ) {
    setMensagens((atuais) =>
      atuais.map((mensagem) =>
        mensagem.id === mensagemId
          ? {
              ...mensagem,
              confirmacoes: mensagem.confirmacoes?.map((confirmacao) =>
                confirmacao.id === acaoId ? { ...confirmacao, ...patch } : confirmacao
              ),
            }
          : mensagem
      )
    )
  }

  async function confirmar(mensagemId: string, confirmacao: ConfirmacaoLocal) {
    if (enviando || confirmacaoAplicando) return
    if (confirmacao.estado !== 'pendente' && confirmacao.estado !== 'erro') return
    atualizarConfirmacao(mensagemId, confirmacao.id, { estado: 'aplicando', erro: '' })
    setErro('')
    try {
      const resultado = await confirmarAcaoAgente(escopo, dia, confirmacao.id)
      atualizarConfirmacao(mensagemId, confirmacao.id, { estado: 'aplicada' })
      setMensagens((atuais) => [
        ...atuais,
        {
          id: novoId(),
          role: 'assistant',
          content: resultado.mensagem,
          acoes: [resultado.acao],
        },
      ])
      await onBlocosAlterados()
    } catch (e) {
      const mensagemErro = String(e).replace(/^Error:\s*/, '')
      const invalida = /^(CONFLITO|CONFIRMACAO_EXPIRADA|NAO_ENCONTRADO|DIA_INVALIDO):/.test(
        mensagemErro
      )
      atualizarConfirmacao(mensagemId, confirmacao.id, {
        estado: invalida ? 'invalida' : 'erro',
        erro: mensagemErro,
      })
    }
  }

  function limparConversa() {
    if (ocupado) return
    setMensagens([])
    setErro('')
    try {
      localStorage.removeItem(chaveHistorico(chaveEscopo))
    } catch {
      // Sem persistência local, basta limpar o estado.
    }
  }

  async function escolherAnexo(arquivo?: File) {
    if (!arquivo) return
    setErro('')
    try {
      setAnexo(await prepararAnexo(arquivo))
    } catch (e) {
      setErro(String(e).replace(/^Error:\s*/, ''))
      if (arquivoRef.current) arquivoRef.current.value = ''
    }
  }

  function removerAnexo() {
    setAnexo(null)
    if (arquivoRef.current) arquivoRef.current.value = ''
  }

  function fecharAssistente() {
    onAbertoChange(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }

  const tituloAgente = principal
    ? 'Agente do Principal'
    : global
      ? 'Agente global'
      : 'Agente do dia'

  const painel = (
      <aside
        ref={painelRef}
        id="assistente-dia"
        data-testid="assistente-dia"
        data-principal-ui
        data-assistente-ready={configPronta ? 'true' : 'false'}
        className={`assistente-painel ${abertoEfetivo ? 'assistente-painel--aberto' : ''} ${embutido ? 'assistente-painel--embutido' : 'assistente-painel--flutuante'}`}
        aria-label={`${tituloAgente} · ${rotuloEscopo}`}
        aria-hidden={!abertoEfetivo}
        role={embutido ? undefined : 'dialog'}
        aria-modal={!embutido && abertoEfetivo && modal ? true : undefined}
      >
        <header className="assistente-cabecalho" data-janela-alca={!embutido && !modal ? true : undefined}>
          <div className="assistente-identidade">
            <span className="assistente-marca"><SparkIcon /></span>
            <div>
              <strong>{tituloAgente}</strong>
              <span>{rotuloEscopo}</span>
            </div>
          </div>
          <div className="assistente-cabecalho-acoes">
            {!embutido && !modal && (
              <button type="button" data-janela-ajustar>
                Ajustar
              </button>
            )}
            {mensagens.length > 0 && (
              <button type="button" disabled={ocupado} onClick={limparConversa}>Limpar</button>
            )}
            {!embutido && (
              <button
                type="button"
                className="assistente-fechar"
                aria-label="Fechar agente"
                onClick={fecharAssistente}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </header>

        <section className="assistente-config" aria-label="Configuração do agente">
          <label>
            <span>Modelo</span>
            <select
              data-testid="modelo-assistente"
              value={perfilId}
              disabled={!config || ocupado}
              onChange={(evento) => selecionarPerfil(evento.target.value)}
            >
              {!config && <option value="">Carregando perfis…</option>}
              {familias.map(([familia, perfis]) => (
                <optgroup label={familia} key={familia}>
                  {perfis.map((perfil) => (
                    <option value={perfil.id} key={perfil.id}>
                      {perfil.nome}{perfil.catalogado === false ? ' · rota não listada' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="assistente-contexto-linha">
            <span className={`assistente-status ${config?.conectado ? 'assistente-status--online' : ''}`}>
              <i /> {rotuloProvider(config, configPronta)}
            </span>
            {!global && (
              <span>{blocos.length} cards{imagensDoEscopo ? ` · ${imagensDoEscopo} imagens` : ''}</span>
            )}
          </div>
          {!config && configPronta && (
            <button
              type="button"
              className="assistente-reconectar"
              onClick={() => void carregarConfiguracao()}
            >
              Tentar reconectar
            </button>
          )}
          {principal ? (
            <div className="assistente-contexto-fixo">
              <strong>Conhecimento incluído</strong>
              <small>Acervo integrado: arraste cards para reorganizar, edite fontes ou arquive notas diretamente pelo mapa.</small>
            </div>
          ) : global ? (
            <div className="assistente-contexto-fixo">
              <strong>Visão global incluída</strong>
              <small>Dias recentes, Principal, Fila editorial e conexões. Escritas miram um dia por vez, sempre com confirmação.</small>
            </div>
          ) : (
            <label className="assistente-contexto-toggle">
              <input
                type="checkbox"
                checked={usarContextoDuravel}
                disabled={ocupado}
                onChange={(evento) => alternarContextoDuravel(evento.target.checked)}
              />
              <span>
                <strong>Incluir contexto durável</strong>
                <small>Orientação, práticas e projetos do Principal</small>
              </span>
            </label>
          )}
          {perfilSelecionado?.catalogado === false && (
            <p className="assistente-aviso-rota">
              Esta rota faz parte do kit, mas não foi anunciada pelo catálogo atual. O envio ainda pode ser tentado.
            </p>
          )}
        </section>

        <div
          className="assistente-mensagens"
          data-testid="mensagens-assistente"
          role="log"
          aria-live="polite"
          aria-busy={ocupado}
        >
          {mensagens.length === 0 && (
            <div className="assistente-vazio">
              <span><SparkIcon size={24} /></span>
              <h2>{principal ? 'Eu já vejo o Principal.' : global ? 'Eu já vejo o DailyWork inteiro.' : 'Eu já vejo o seu dia.'}</h2>
              <p>
                {principal
                  ? 'Posso analisar o portfólio, a Stack e o conhecimento, auxiliando na evolução e organização do Principal.'
                  : global
                    ? 'Vejo os dias recentes, o Principal, a Fila editorial e as conexões. Cada mudança mira um dia e só vale depois da sua confirmação.'
                    : 'Posso analisar todos os cards, propor ajustes e aplicar cada mudança depois da sua confirmação.'}
              </p>
              <div className="assistente-sugestoes">
                {principal ? (
                  <>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Revise o portfólio e aponte lacunas de narrativa ou evidência.')}>Revisar portfólio</button>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Resuma a Stack e as capacidades demonstradas no Principal.')}>Resumir Stack</button>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Encontre conexões duráveis entre portfólio, Stack e conhecimento.')}>Encontrar conexões</button>
                  </>
                ) : global ? (
                  <>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('O que está pendente na Fila editorial e o que você recomenda?')}>Revisar Fila</button>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Resuma minha semana de trabalho até hoje, com os pontos fortes e os riscos.')}>Resumir semana</button>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Com base em tudo que você vê, qual é a próxima ação mais importante agora?')}>Próxima ação</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Qual é a próxima ação mais importante agora?')}>Próxima ação</button>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Revise as prioridades deste dia e aponte riscos.')}>Revisar prioridades</button>
                    <button type="button" disabled={ocupado || !perfilId} onClick={() => enviar('Resuma o progresso e os bloqueios deste dia.')}>Resumir progresso</button>
                  </>
                )}
              </div>
            </div>
          )}

          {mensagens.map((mensagem) => (
            <article
              className={`assistente-mensagem assistente-mensagem--${mensagem.role}`}
              key={mensagem.id}
            >
              <span>{mensagem.role === 'user' ? 'Você' : 'Agente'}</span>
              {mensagem.role === 'assistant' ? (
                <div className="assistente-markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children }) => <span>{children}</span>,
                      img: ({ alt }) => (
                        <span>{alt ? `[Imagem: ${alt}]` : '[Imagem externa não exibida]'}</span>
                      ),
                    }}
                  >
                    {mensagem.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p>{mensagem.content}</p>
              )}
              {mensagem.anexos?.map((nome) => (
                <small className="assistente-anexo-recibo" key={nome}>Imagem · {nome}</small>
              ))}
              {mensagem.acoes?.map((acao) => (
                <div className="assistente-acao-aplicada" key={`${acao.tipo}-${acao.blocoId}`}>
                  <span aria-hidden="true">✓</span> {acao.descricao}
                </div>
              ))}
              {mensagem.confirmacoes?.map((confirmacao) => (
                <div className="assistente-confirmacao" key={confirmacao.id}>
                  <div>
                    <strong>{confirmacao.descricao}</strong>
                    {confirmacao.detalhe && <span>{confirmacao.detalhe}</span>}
                    {confirmacao.erro && <small>{confirmacao.erro}</small>}
                  </div>
                  <PreviewConfirmacao confirmacao={confirmacao} />
                  <div className="assistente-confirmacao-acoes">
                    {confirmacao.estado === 'aplicada' ? (
                      <span className="assistente-confirmada">Aplicada</span>
                    ) : confirmacao.estado === 'descartada' ? (
                      <span className="assistente-descartada">Descartada</span>
                    ) : confirmacao.estado === 'invalida' ? (
                      <span className="assistente-descartada">Peça novamente</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="assistente-confirmar"
                          disabled={confirmacao.estado === 'aplicando'}
                          onClick={() => confirmar(mensagem.id, confirmacao)}
                        >
                          {confirmacao.estado === 'aplicando' ? 'Aplicando…' : 'Aplicar'}
                        </button>
                        <button
                          type="button"
                          disabled={confirmacao.estado === 'aplicando'}
                          onClick={() =>
                            atualizarConfirmacao(mensagem.id, confirmacao.id, { estado: 'descartada' })
                          }
                        >
                          Descartar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </article>
          ))}

          {enviando && (
            <div className="assistente-digitando" aria-label="Agente pensando">
              <span /><span /><span />
              <small>Analisando {principal ? 'o Principal' : global ? 'o DailyWork inteiro' : 'o dia'} com {perfilSelecionado?.nome || 'Grok'}…</small>
            </div>
          )}
          <div ref={fimRef} />
        </div>

        <footer className="assistente-compositor">
          {erro && <div className="assistente-erro" role="alert">{erro}</div>}
          {anexo && (
            <div className="assistente-anexo">
              <img src={anexo.preview} alt="Prévia do anexo" />
              <span><strong>{anexo.nome}</strong><small>Pronto para enviar</small></span>
              <button type="button" aria-label="Remover anexo" onClick={removerAnexo}>
                <CloseIcon />
              </button>
            </div>
          )}
          <div className="assistente-caixa-texto">
            <textarea
              ref={textoRef}
              data-testid="mensagem-assistente"
              rows={2}
              value={texto}
              disabled={ocupado}
              placeholder={principal ? 'Pergunte ou peça uma ação no Principal…' : global ? 'Pergunte ou peça uma ação em qualquer dia…' : 'Pergunte ou peça uma ação no dia…'}
              aria-label={`Mensagem para o agente do ${principal ? 'Principal' : global ? 'escopo global' : 'dia'}`}
              onChange={(evento) => setTexto(evento.target.value.slice(0, 8_000))}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' && !evento.shiftKey) {
                  evento.preventDefault()
                  void enviar()
                }
              }}
            />
            <div className="assistente-compositor-acoes">
              <button
                type="button"
                className="assistente-anexar"
                aria-label="Anexar imagem"
                title="Anexar imagem (até 4 MB)"
                disabled={ocupado}
                onClick={() => arquivoRef.current?.click()}
              >
                <PaperclipIcon />
              </button>
              <input
                ref={arquivoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(evento) => void escolherAnexo(evento.target.files?.[0])}
              />
              <span>{texto.length}/8000</span>
              <button
                type="button"
                className="assistente-enviar"
                data-testid="enviar-assistente"
                aria-label="Enviar mensagem"
                disabled={ocupado || !texto.trim() || !perfilId}
                onClick={() => void enviar()}
              >
                <SendIcon />
              </button>
            </div>
          </div>
          <p>Escritas só acontecem após você confirmar.</p>
        </footer>
      </aside>
  )

  return (
    <>
      {!abertoEfetivo && !embutido && (
        <button
          ref={launcherRef}
          className="assistente-launcher"
          data-testid="abrir-assistente"
          aria-label={`Abrir agente do ${principal ? 'Principal' : global ? 'escopo global' : 'dia'}`}
          aria-controls="assistente-dia"
          aria-expanded="false"
          onClick={() => onAbertoChange(true)}
        >
          <SparkIcon size={23} />
          <span>Agente</span>
        </button>
      )}

      {abertoEfetivo && !embutido && modal && (
        <button
          className="assistente-scrim"
          aria-label={`Fechar agente do ${principal ? 'Principal' : global ? 'escopo global' : 'dia'}`}
          aria-hidden="true"
          tabIndex={-1}
          onClick={fecharAssistente}
        />
      )}

      {embutido
        ? painel
        : (
          <JanelaFlutuante
            id={principal ? 'agente-principal' : 'agente-dia'}
            aberta={abertoEfetivo}
            folha={modal}
          >
            {abertoEfetivo ? painel : null}
          </JanelaFlutuante>
        )}
    </>
  )
}
