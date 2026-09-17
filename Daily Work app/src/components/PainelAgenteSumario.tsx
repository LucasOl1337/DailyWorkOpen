import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AnaliseSumarioDiario,
  DadosSumarioDiario,
  EntradaInteracaoSumario,
  PerfilAgente,
  ProgressoAnaliseSumario,
} from '../lib/api'
import { PainelInputsSumario } from './PainelInputsSumario'

type AbaAgente = 'resumo' | 'inputs' | 'estudos' | 'conversa'

function abaInicial(): AbaAgente {
  const solicitada = new URLSearchParams(window.location.search).get('abaSumario')
  return solicitada === 'inputs' || solicitada === 'estudos' || solicitada === 'conversa'
    ? solicitada
    : 'resumo'
}

function geradoEm(timestamp: string | null) {
  if (!timestamp) return 'Ainda não analisado'
  const data = new Date(timestamp)
  if (Number.isNaN(data.getTime())) return 'Análise concluída'
  return `Atualizado às ${new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(data)}`
}

export function PainelAgenteSumario({
  dia,
  dados,
  analise,
  analisando,
  progresso,
  erroAnalise,
  perfilId,
  perfis,
  onPerfil,
  onAnalisar,
  onInteragir,
}: {
  dia: string
  dados: DadosSumarioDiario | null
  analise: AnaliseSumarioDiario | null
  analisando: boolean
  progresso: ProgressoAnaliseSumario | null
  erroAnalise: string
  perfilId: string
  perfis: PerfilAgente[]
  onPerfil: (perfilId: string) => void
  onAnalisar: () => void
  onInteragir: (entrada: EntradaInteracaoSumario) => Promise<void>
}) {
  const [aba, setAba] = useState<AbaAgente>(abaInicial)
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [respondendo, setRespondendo] = useState('')
  const [erroInteracao, setErroInteracao] = useState('')
  const artefato = analise?.analysis
  const interacoes = analise?.interactions
  const interativo = analise?.status === 'complete'
  const mostrandoInputs = aba === 'inputs'
  const percentual = progresso?.total
    ? Math.min(100, Math.round((progresso.completed / progresso.total) * 100))
    : 0
  const opcoesModelo = useMemo(() => {
    const visiveis = perfis.filter((perfil) => perfil.catalogado !== false)
    if (visiveis.some((perfil) => perfil.id === perfilId)) return visiveis
    return [
      {
        id: perfilId,
        nome: artefato?.profile.nome || 'Grok 4.6',
        familia: artefato?.profile.nome.split(' ')[0] || 'Grok',
        rota: artefato?.profile.rota || 'grok-4.6',
        catalogado: null,
      },
      ...visiveis,
    ]
  }, [artefato, perfilId, perfis])

  function rotuloProgresso() {
    if (!progresso) return 'Preparando as informações…'
    if (progresso.stage === 'map') return `Lendo o seu dia · etapa ${progresso.completed} de ${progresso.total}`
    if (progresso.stage === 'reduce') return 'Separando o que mais importa…'
    return 'Escrevendo resumo, revisão e perguntas…'
  }

  async function responder(questionId: string, optionId: string) {
    setRespondendo(questionId)
    setErroInteracao('')
    try {
      await onInteragir({ type: 'answer', questionId, optionId })
    } catch (erro) {
      setErroInteracao(erro instanceof Error ? erro.message : 'Não foi possível registrar sua resposta.')
    } finally {
      setRespondendo('')
    }
  }

  async function enviar() {
    const texto = mensagem.trim()
    if (!texto || enviando) return
    setEnviando(true)
    setErroInteracao('')
    try {
      await onInteragir({ type: 'chat', profileId: perfilId, message: texto })
      setMensagem('')
    } catch (erro) {
      setErroInteracao(erro instanceof Error ? erro.message : 'Não foi possível conversar sobre este dia.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="sumario-card sumario-agent" aria-label="Conteúdo do Sumário Diário">
      <header className="sumario-agent__header">
        <div>
          <span>{mostrandoInputs ? 'O que você escreveu' : 'Leitura do dia'}</span>
          <h2>{mostrandoInputs ? 'Todas as suas mensagens' : 'O que ficou deste dia'}</h2>
        </div>
        {mostrandoInputs ? (
          <span className="sumario-agent__input-status">
            {new Intl.NumberFormat('pt-BR').format(dados?.stats?.userMessages || 0)} mensagens
          </span>
        ) : (
          <label className="sumario-agent__model">
            <span>Modelo</span>
            <select
              aria-label="Modelo da análise"
              value={perfilId}
              disabled={analisando || enviando}
              onChange={(evento) => onPerfil(evento.target.value)}
            >
              {opcoesModelo.map((perfil) => (
                <option key={perfil.id} value={perfil.id}>{perfil.nome}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      <nav className="sumario-agent__tabs" role="tablist" aria-label="Conteúdo do sumário">
        {([
          ['resumo', 'Resumo'],
          ['inputs', 'Suas mensagens'],
          ['estudos', 'Revisar'],
          ['conversa', 'Perguntar'],
        ] as Array<[AbaAgente, string]>).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? 'is-active' : ''}
            onClick={() => setAba(id)}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      <div className="sumario-agent__content" role="tabpanel">
        {aba === 'resumo' && (
          <div className="sumario-agent__reading">
            {artefato && (
              <article className="sumario-day-reading">
                <header>
                  <div className="sumario-chat-message__avatar">IA</div>
                  <div>
                    <strong>Uma leitura de {artefato.profile.nome}</strong>
                    <span>{geradoEm(analise.generatedAt)}</span>
                  </div>
                </header>
                <div className="sumario-agent__markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{artefato.summaryMarkdown}</ReactMarkdown>
                </div>
              </article>
            )}

            {!artefato && !analisando && (
              <div className="sumario-agent__empty">
                <strong>Seu resumo ainda não foi escrito.</strong>
                <span>Assim que a leitura terminar, ele aparece aqui em linguagem direta.</span>
              </div>
            )}

            {analisando && (
              <article className="sumario-chat-message is-assistant is-processing" aria-live="polite">
                <div className="sumario-chat-message__avatar">IA</div>
                <div className="sumario-chat-message__body">
                  <header><strong>Lendo o seu dia</strong><span>{percentual}%</span></header>
                  <p>{rotuloProgresso()}</p>
                  <div className="sumario-agent__progress" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, percentual)}%` }} />
                  </div>
                </div>
              </article>
            )}
          </div>
        )}

        {aba === 'inputs' && (
          <PainelInputsSumario dia={dia} chaveAtualizacao={dados?.generatedAt || null} />
        )}

        {aba === 'estudos' && (
          <div className="sumario-study">
            {artefato ? (
              <>
                {artefato.studies.length > 0 && (
                  <header className="sumario-study__overview">
                    <div>
                      <span>{artefato.studies.length} {artefato.studies.length === 1 ? 'revisão' : 'revisões'}</span>
                      <h3>Um bloco por projeto e assunto</h3>
                    </div>
                    <p>{[...new Set(artefato.studies.map((revisao) => revisao.context))].join(' · ')}</p>
                  </header>
                )}
                <div className="sumario-study__lessons">
                  {artefato.studies.map((revisao) => (
                    <section className="sumario-study__lesson" key={`${revisao.context}:${revisao.subject}`}>
                      <header className="sumario-study__context" aria-label="Contexto da revisão">
                        <div>
                          <span>Projeto, app ou contexto</span>
                          <strong>{revisao.context}</strong>
                        </div>
                        <div>
                          <span>Assunto</span>
                          <strong>{revisao.subject}</strong>
                        </div>
                      </header>
                      <div className="sumario-agent__markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{revisao.markdown}</ReactMarkdown>
                      </div>
                    </section>
                  ))}
                  {artefato.studies.length === 0 && (
                    <div className="sumario-agent__empty">
                      <strong>Sem revisão neste dia</strong>
                      <span>Não há conteúdo suficiente para separar aprendizados por projeto ou app.</span>
                    </div>
                  )}
                </div>
                {artefato.questions.length > 0 && (
                  <section className="sumario-quiz" aria-label="Perguntas sobre o dia">
                    <header>
                      <span>{artefato.questions.length} perguntas</span>
                      <h3>Confira se ficou claro</h3>
                    </header>
                    {artefato.questions.map((questao, indice) => {
                      const resposta = interacoes?.answers[questao.id]
                      return (
                        <article className="sumario-question" key={questao.id}>
                          <header>
                            <span>{String(indice + 1).padStart(2, '0')}</span>
                            <strong>{questao.prompt}</strong>
                          </header>
                          <div className="sumario-question__options">
                            {questao.options.map((opcao) => {
                              const selecionada = resposta?.optionId === opcao.id
                              const correta = Boolean(resposta && opcao.id === questao.correctOptionId)
                              return (
                                <button
                                  key={opcao.id}
                                  type="button"
                                  disabled={!interativo || Boolean(resposta) || respondendo === questao.id}
                                  className={`${selecionada ? 'is-selected' : ''} ${correta ? 'is-correct' : ''}`}
                                  onClick={() => void responder(questao.id, opcao.id)}
                                >
                                  <span>{opcao.id.toUpperCase()}</span>
                                  {opcao.text}
                                </button>
                              )
                            })}
                          </div>
                          {resposta && (
                            <p className={`sumario-question__feedback ${resposta.correct ? 'is-correct' : 'is-wrong'}`}>
                              <strong>{resposta.correct ? 'Acertou.' : 'Revise este ponto.'}</strong> {questao.explanation}
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </section>
                )}
              </>
            ) : (
              <div className="sumario-agent__empty">A análise vai criar uma revisão curta e duas perguntas sobre este dia.</div>
            )}
          </div>
        )}

        {aba === 'conversa' && (
          <div className="sumario-conversation-chat">
            <div className="sumario-conversation-chat__messages" aria-live="polite">
              {interacoes?.chat.length ? interacoes.chat.map((item) => (
                <article className={`sumario-chat-message is-${item.role}`} key={item.id}>
                  <div className="sumario-chat-message__avatar">{item.role === 'user' ? 'Você' : 'IA'}</div>
                  <div className="sumario-chat-message__body">
                    <header>
                      <strong>{item.role === 'user' ? 'Você' : item.profile?.nome || 'Tutor'}</strong>
                      <span>{geradoEm(item.createdAt)}</span>
                    </header>
                    <div className="sumario-agent__markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                    </div>
                  </div>
                </article>
              )) : (
                <div className="sumario-agent__empty">
                  <strong>Pergunte sobre este dia.</strong>
                  <span>Você pode perguntar o que deu certo, o que pede atenção ou o que vale revisar.</span>
                </div>
              )}
              {enviando && (
                <article className="sumario-chat-message is-assistant is-processing">
                  <div className="sumario-chat-message__avatar">IA</div>
                  <div className="sumario-chat-message__body"><p>Relendo as evidências deste dia…</p></div>
                </article>
              )}
            </div>
            <form
              className="sumario-conversation-chat__composer"
              onSubmit={(evento) => {
                evento.preventDefault()
                void enviar()
              }}
            >
              <textarea
                value={mensagem}
                disabled={!interativo || enviando}
                maxLength={4000}
                rows={2}
                aria-label="Pergunta sobre este dia"
                placeholder="Pergunte algo sobre o trabalho deste dia…"
                onChange={(evento) => setMensagem(evento.target.value)}
              />
              <button type="submit" disabled={!interativo || enviando || !mensagem.trim()}>
                {enviando ? 'Pensando…' : 'Enviar'}
              </button>
            </form>
          </div>
        )}
      </div>

      {!mostrandoInputs && (
        <footer className="sumario-agent__footer">
          <div>
            {erroAnalise || erroInteracao ? (
              <span className="sumario-agent__error">{erroAnalise || erroInteracao}</span>
            ) : (
              <span>
                {analise?.status === 'outdated'
                  ? 'Há conversas novas desde a última análise.'
                  : analise?.status === 'complete'
                    ? 'Resumo, revisão e conversa ficam salvos neste dia.'
                    : 'A leitura começa automaticamente quando este dia abre.'}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={analisando || dados?.completeness !== 'complete'}
            onClick={onAnalisar}
          >
            {analisando
              ? 'Analisando…'
              : analise?.status === 'complete'
                ? 'Gerar nova análise'
                : analise?.status === 'outdated'
                  ? 'Atualizar análise'
                  : 'Analisar o dia'}
          </button>
        </footer>
      )}
    </section>
  )
}
