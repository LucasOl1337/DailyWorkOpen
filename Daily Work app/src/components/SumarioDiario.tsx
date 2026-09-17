import { AgendaModulo } from './AgendaModulo'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  aoProgressoAnaliseSumario,
  aoAtualizarAnaliseSumario,
  aoAtualizarSumario,
  coletarSumarioDiario,
  configurarAgente,
  gerarAnaliseSumarioDiario,
  interagirComSumarioDiario,
  obterAnaliseSumarioDiario,
  obterSumarioDiario,
  type AnaliseSumarioDiario,
  type CoberturaSumario,
  type ConversaSumario,
  type DadosSumarioDiario,
  type EntradaInteracaoSumario,
  type PerfilAgente,
  type ProgressoAnaliseSumario,
  type StatusFonteSumario,
  type StatusSumario,
} from '../lib/api'
import { PainelAgenteSumario } from './PainelAgenteSumario'
import './sumario-diario.css'

function dataPorExtenso(data: string) {
  const [ano, mes, dia] = data.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ano, mes - 1, dia, 12))
}

function numero(valor: number) {
  return new Intl.NumberFormat('pt-BR').format(valor)
}

function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function hora(timestamp: string | null) {
  if (!timestamp) return 'horário aproximado'
  const data = new Date(timestamp)
  if (Number.isNaN(data.getTime())) return 'horário aproximado'
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(data)
}

function geradoEm(timestamp: string | null) {
  if (!timestamp) return 'Ainda não coletado'
  const data = new Date(timestamp)
  if (Number.isNaN(data.getTime())) return 'Coleta concluída'
  return `Atualizado às ${new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(data)}`
}

const ROTULOS_STATUS: Record<StatusSumario, string> = {
  not_collected: 'Não coletado',
  empty: 'Sem atividade',
  partial: 'Cobertura parcial',
  complete: 'Cobertura completa',
}

const ROTULOS_FONTE: Record<StatusFonteSumario, string> = {
  not_found: 'Não encontrada',
  empty: 'Sem atividade',
  partial: 'Cobertura parcial',
  complete: 'Completo',
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 6.3V2.8m0 3.5h-3.5M4 13.7v3.5m0-3.5h3.5" />
      <path d="M15.1 8A5.7 5.7 0 0 0 5 5.8L4 7.2M4.9 12A5.7 5.7 0 0 0 15 14.2l1-1.4" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.7" cy="8.7" r="5.2" />
      <path d="m12.6 12.6 4 4" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h9l3 3v14H6z" />
      <path d="M15 3.5v4h3M9 11h6M9 14.5h6M9 18h4" />
    </svg>
  )
}

function SourceRow({ fonte }: { fonte: CoberturaSumario }) {
  return (
    <li className="sumario-source">
      <span className={`sumario-source__dot is-${fonte.status}`} aria-hidden="true" />
      <span className="sumario-source__copy">
        <strong>{fonte.label}</strong>
        <small>
          {fonte.status === 'empty'
            ? 'Nenhuma conversa neste dia'
            : `${numero(fonte.conversations)} conversas · ${numero(fonte.messages)} eventos`}
        </small>
      </span>
      <span className={`sumario-source__status is-${fonte.status}`}>
        {ROTULOS_FONTE[fonte.status]}
      </span>
    </li>
  )
}

function ConversationRow({ conversa }: { conversa: ConversaSumario }) {
  return (
    <details className="sumario-conversation">
      <summary>
        <span className="sumario-conversation__source">{conversa.app}</span>
        <span className="sumario-conversation__title">
          <strong>{conversa.title}</strong>
          <small>{numero(conversa.messageCount)} eventos{conversa.cwd ? ` · ${conversa.cwd}` : ''}</small>
        </span>
        <span className="sumario-conversation__chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="sumario-conversation__preview">
        {conversa.preview.length ? conversa.preview.map((mensagem) => (
          <article className={`sumario-preview is-${mensagem.role}`} key={mensagem.id}>
            <header>
              <strong>{mensagem.role === 'user' ? 'Você' : mensagem.role === 'assistant' ? 'IA' : 'Participante'}</strong>
              <time dateTime={mensagem.timestamp || undefined}>{hora(mensagem.timestamp)}</time>
            </header>
            <p>{mensagem.text}</p>
          </article>
        )) : (
          <p className="sumario-conversation__no-preview">Eventos estruturados preservados no arquivo completo.</p>
        )}
      </div>
    </details>
  )
}

export function SumarioDiario({ dia }: { dia: string }) {
  const [dados, setDados] = useState<DadosSumarioDiario | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [coletando, setColetando] = useState(false)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [fonte, setFonte] = useState('todas')
  const [analise, setAnalise] = useState<AnaliseSumarioDiario | null>(null)
  const [analiseCarregando, setAnaliseCarregando] = useState(true)
  const [analisando, setAnalisando] = useState(false)
  const [progressoAnalise, setProgressoAnalise] = useState<ProgressoAnaliseSumario | null>(null)
  const [erroAnalise, setErroAnalise] = useState('')
  const [perfis, setPerfis] = useState<PerfilAgente[]>([])
  const [perfilId, setPerfilId] = useState('grok-4-6')
  const analiseAutomaticaVerificada = useRef(false)

  useEffect(() => {
    let ativo = true
    void configurarAgente()
      .then((configuracao) => {
        if (ativo) setPerfis(configuracao.perfis)
      })
      .catch(() => {
        // O seletor mantém o perfil padrão mesmo se o catálogo estiver temporariamente indisponível.
      })
    return () => { ativo = false }
  }, [])

  async function carregar() {
    try {
      const resultado = await obterSumarioDiario(dia)
      setDados(resultado)
      setErro('')
      if (resultado.completeness === 'not_collected') {
        setColetando(true)
        setDados(await coletarSumarioDiario(dia))
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o Sumário Diário.')
    } finally {
      setCarregando(false)
      setColetando(false)
    }
  }

  useEffect(() => {
    let ativo = true
    const buscar = async () => {
      try {
        const resultado = await obterSumarioDiario(dia)
        if (!ativo) return
        if (resultado.completeness === 'not_collected') {
          setColetando(true)
          const coletado = await coletarSumarioDiario(dia)
          if (ativo) setDados(coletado)
        } else {
          setDados(resultado)
        }
        if (ativo) setErro('')
      } catch (e) {
        if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar o Sumário Diário.')
      } finally {
        if (ativo) {
          setCarregando(false)
          setColetando(false)
        }
      }
    }
    void buscar()
    const cancelar = aoAtualizarSumario(dia, () => void buscar())
    return () => {
      ativo = false
      cancelar()
    }
  }, [dia])

  useEffect(() => {
    if (!dados || analiseCarregando || !analise || analiseAutomaticaVerificada.current) return
    analiseAutomaticaVerificada.current = true
    if (
      dados.completeness === 'complete' &&
      (dados.stats?.conversations || 0) > 0 &&
      ['not_analyzed', 'outdated'].includes(analise.status)
    ) {
      gerarAnalise()
    }
  }, [analise, analiseCarregando, dados])

  useEffect(() => {
    let ativo = true
    const buscar = async () => {
      try {
        const resultado = await obterAnaliseSumarioDiario(dia)
        if (ativo) {
          setAnalise(resultado)
          setPerfilId(resultado.analysis?.profile.id || resultado.defaultProfileId)
          setErroAnalise('')
        }
      } catch (e) {
        if (ativo) setErroAnalise(e instanceof Error ? e.message : 'Não foi possível carregar a análise.')
      } finally {
        if (ativo) setAnaliseCarregando(false)
      }
    }
    void buscar()
    const cancelarProgresso = aoProgressoAnaliseSumario(dia, (progresso) => {
      if (!ativo) return
      setAnalisando(true)
      setProgressoAnalise(progresso)
    })
    const cancelarAtualizacao = aoAtualizarAnaliseSumario(dia, () => void buscar())
    return () => {
      ativo = false
      cancelarProgresso()
      cancelarAtualizacao()
    }
  }, [dia, dados?.generatedAt])

  const fontesComConteudo = useMemo(() => (
    dados?.coverage.filter((item) => item.conversations > 0) || []
  ), [dados])

  const conversas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return (dados?.conversations || []).filter((conversa) => {
      if (fonte !== 'todas' && conversa.source !== fonte) return false
      if (!termo) return true
      return [conversa.title, conversa.app, conversa.cwd, ...conversa.preview.map((item) => item.text)]
        .some((valor) => String(valor || '').toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [busca, dados, fonte])

  const pronto = !carregando && !analiseCarregando && Boolean(dados)
  const stats = dados?.stats

  function gerarAnalise() {
    setAnalisando(true)
    setProgressoAnalise(null)
    setErroAnalise('')
    void gerarAnaliseSumarioDiario(dia, perfilId)
      .then(setAnalise)
      .catch((e) => setErroAnalise(e instanceof Error ? e.message : 'Não foi possível analisar este dia. Tente novamente.'))
      .finally(() => {
        setAnalisando(false)
        setProgressoAnalise(null)
      })
  }

  async function interagir(entrada: EntradaInteracaoSumario) {
    const resultado = await interagirComSumarioDiario(dia, entrada)
    setAnalise(resultado)
  }

  return (
    <main
      className="sumario-diario"
      data-testid="sumario-diario"
      data-sumario-ready={pronto ? 'true' : 'false'}
      aria-busy={!pronto}
    >
      <div className="sumario-diario__inner"><AgendaModulo modulo="sumario" />
        <header className="sumario-diario__header">
          <div className="sumario-diario__heading">
            <div className="sumario-diario__eyebrow">
              <span>Sumário diário</span>
              <span>{geradoEm(dados?.generatedAt || null)}</span>
            </div>
            <h1>Como foi seu dia</h1>
            <p>{dataPorExtenso(dia)}</p>
          </div>
        </header>

        {erro && (
          <div className="sumario-diario__error" role="alert">
            <strong>A coleta precisa de atenção.</strong>
            <span>{erro}</span>
            <button type="button" onClick={() => void carregar()}>Tentar novamente</button>
          </div>
        )}

        <PainelAgenteSumario
          dia={dia}
          dados={dados}
          analise={analise}
          analisando={analisando}
          progresso={progressoAnalise}
          erroAnalise={erroAnalise}
          perfilId={perfilId}
          perfis={perfis}
          onPerfil={setPerfilId}
          onAnalisar={gerarAnalise}
          onInteragir={interagir}
        />

        <details className="sumario-details">
          <summary>
            <span>
              <strong>Detalhes da coleta</strong>
              <small>
                {dados?.coverage.filter((item) => item.discovered).length || 0} fontes · {numero(stats?.userMessages || 0)} mensagens suas detectadas
              </small>
            </span>
            <em>Ver detalhes</em>
          </summary>

          <div className="sumario-details__body">
            <div className="sumario-details__toolbar">
              <div>
                <span className={`sumario-diario__status is-${dados?.completeness || 'not_collected'}`}>
                  {ROTULOS_STATUS[dados?.completeness || 'not_collected']}
                </span>
                <span>{geradoEm(dados?.generatedAt || null)}</span>
              </div>
              <button
                className="sumario-diario__collect"
                type="button"
                disabled={coletando}
                onClick={() => {
                  setColetando(true)
                  void coletarSumarioDiario(dia)
                    .then((resultado) => {
                      setDados(resultado)
                      setErro('')
                    })
                    .catch((e) => setErro(e instanceof Error ? e.message : 'Falha durante a coleta.'))
                    .finally(() => setColetando(false))
                }}
              >
                <RefreshIcon />
                {coletando ? 'Atualizando fontes…' : 'Atualizar fontes'}
              </button>
            </div>

            <section className="sumario-stats" aria-label="Estatísticas da coleta">
              {[
                ['Conversas', stats?.conversations],
                ['Mensagens suas', stats?.userMessages],
                ['Respostas', stats?.agentMessages],
                ['Eventos técnicos', stats?.toolEvents],
                ['Arquivo privado', stats ? tamanho(stats.bytes) : undefined],
              ].map(([rotulo, valor]) => (
                <article key={String(rotulo)}>
                  <span>{rotulo}</span>
                  <strong>{typeof valor === 'number' ? numero(valor) : valor || '—'}</strong>
                </article>
              ))}
            </section>

            <section className="sumario-layout">
              <aside className="sumario-sidebar">
                <section className="sumario-card sumario-card--coverage">
                  <header>
                    <div>
                      <span>Cobertura</span>
                      <h2>Fontes deste PC</h2>
                    </div>
                    <strong>{dados?.coverage.filter((item) => item.discovered).length || 0}</strong>
                  </header>
                  {carregando ? (
                    <div className="sumario-skeleton" aria-label="Carregando fontes" />
                  ) : (
                    <ul>{dados?.coverage.map((item) => <SourceRow fonte={item} key={item.id} />)}</ul>
                  )}
                </section>

                <section className="sumario-card sumario-corpus">
                  <span className="sumario-corpus__icon"><FileIcon /></span>
                  <div>
                    <span>Arquivo da análise</span>
                    <h2>conversas.json</h2>
                    <p>As conversas completas ficam salvas localmente neste arquivo privado.</p>
                  </div>
                  <code title={dados?.file}>{dados?.file || 'Aguardando a primeira coleta'}</code>
                </section>
              </aside>

              <section className="sumario-card sumario-conversations">
                <header className="sumario-conversations__header">
                  <div>
                    <span>Histórico lido</span>
                    <h2>Conversas do dia</h2>
                  </div>
                  <span>{numero(conversas.length)} de {numero(dados?.conversations.length || 0)}</span>
                </header>

                <div className="sumario-conversations__tools">
                  <label>
                    <SearchIcon />
                    <input
                      value={busca}
                      onChange={(evento) => setBusca(evento.target.value)}
                      placeholder="Buscar título, projeto ou trecho"
                      aria-label="Buscar nas conversas"
                    />
                  </label>
                  <select value={fonte} onChange={(evento) => setFonte(evento.target.value)} aria-label="Filtrar por fonte">
                    <option value="todas">Todas as fontes</option>
                    {fontesComConteudo.map((item) => (
                      <option value={item.id} key={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>

                <div className="sumario-conversations__list">
                  {carregando && <div className="sumario-skeleton sumario-skeleton--large" />}
                  {!carregando && conversas.map((conversa) => (
                    <ConversationRow conversa={conversa} key={conversa.id} />
                  ))}
                  {!carregando && conversas.length === 0 && (
                    <div className="sumario-conversations__empty">
                      <strong>Nenhuma conversa encontrada</strong>
                      <span>Ajuste a busca ou atualize as fontes deste dia.</span>
                    </div>
                  )}
                </div>
              </section>
            </section>
          </div>
        </details>
      </div>
    </main>
  )
}
