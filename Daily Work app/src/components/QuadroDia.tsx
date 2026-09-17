import { useEffect, useMemo, useState } from 'react'
import type { Bloco, StatusBloco } from '../lib/md'
import {
  aoAtualizarExecutorNativo,
  aoMudarBlocosExternos,
  atualizarBloco,
  cancelarExecutorNativo,
  excluirBloco,
  iniciarExecutorNativo,
  listarBlocos,
  obterEstadoExecutorNativo,
  type EstadoExecutorNativo,
  type ExecucaoNativa,
} from '../lib/api'
import { AssistenteDia } from './AssistenteDia'
import { PreparacaoDia } from './PreparacaoDia'
import { FechamentoDia } from './FechamentoDia'
import { NovaFrente } from './NovaFrente'
import './quadro-dia.css'

const STATUS_HUMANO: Record<StatusBloco, string> = {
  pendente: 'Pendente',
  fazendo: 'Em andamento',
  feito: 'Concluído',
}

function dataPorExtenso(data: string) {
  const [ano, mes, dia] = data.split('-').map(Number)
  const valor = new Date(ano, mes - 1, dia, 12)
  return {
    curta: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
      .format(valor)
      .replace('.', ''),
    semana: new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(valor),
    completa: new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(valor),
  }
}

function conteudoDoBloco(corpo: string) {
  const linhas = corpo
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
  const objetivo =
    linhas
      .find((linha) => /^(objetivo|foco|miss[aã]o)\s*:/i.test(linha))
      ?.replace(/^(objetivo|foco|miss[aã]o)\s*:\s*/i, '') ||
    linhas.find(
      (linha) => !/^[-*•]/.test(linha) && !/^(pronto|sa[ií]da|fechamento)\s*=/i.test(linha)
    ) ||
    ''
  const acoes = linhas
    .filter((linha) => /^[-*•]\s*/.test(linha))
    .map((linha) => linha.replace(/^[-*•]\s*/, ''))
  const prontidao =
    linhas
      .find((linha) => /^(pronto|sa[ií]da|fechamento)\s*=/i.test(linha))
      ?.replace(/^(pronto|sa[ií]da|fechamento)\s*=\s*/i, '') || ''
  return { objetivo, acoes, prontidao }
}

function ResumoVazio({ children }: { children: React.ReactNode }) {
  return <div className="dia-vazio">{children}</div>
}

export function QuadroDia({ dia }: { dia: string }) {
  const [blocos, setBlocos] = useState<Bloco[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [erroExecutor, setErroExecutor] = useState('')
  const [executor, setExecutor] = useState<EstadoExecutorNativo | null>(null)
  const [iniciandoExecutor, setIniciandoExecutor] = useState(false)
  const [salvandoId, setSalvandoId] = useState('')
  const [assistenteAberto, setAssistenteAberto] = useState(
    () => new URLSearchParams(window.location.search).get('assistente') === 'open'
  )
  const [projetosDia, setProjetosDia] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    let ativo = true
    const carregar = () => {
      listarBlocos(dia)
        .then((dados) => {
          if (!ativo) return
          setBlocos(dados)
          setErro('')
        })
        .catch((e) => ativo && setErro(String(e)))
        .finally(() => ativo && setCarregando(false))
    }
    setCarregando(true)
    carregar()
    const cancelar = aoMudarBlocosExternos(carregar)
    return () => {
      ativo = false
      cancelar()
    }
  }, [dia])

  useEffect(() => {
    let ativo = true
    const carregar = async () => {
      try {
        const estado = await obterEstadoExecutorNativo(dia)
        if (ativo) setExecutor(estado)
      } catch (e) {
        if (ativo) setErroExecutor(String(e))
      }
    }
    void carregar()
    const cancelarEvento = aoAtualizarExecutorNativo(dia, (execucao) => {
      if (!ativo) return
      setExecutor((atual) => ({
        ativo: ['na_fila', 'executando'].includes(execucao.status) ? execucao : null,
        historico: [execucao, ...(atual?.historico || []).filter((item) => item.id !== execucao.id)],
      }))
      if (!['na_fila', 'executando'].includes(execucao.status)) void recarregarAposAgente()
    })
    const intervalo = window.setInterval(carregar, 2_000)
    return () => {
      ativo = false
      cancelarEvento()
      window.clearInterval(intervalo)
    }
  }, [dia])

  const estado = useMemo(() => {
    const ordenados = [...blocos].sort((a, b) => a.y - b.y || a.x - b.x)
    const objetivos = ordenados.filter((b) => b.tipo === 'tarefa' || b.tipo === 'projeto')
    const pendentes = objetivos.filter((b) => b.status === 'pendente')
    const fazendo = objetivos.filter((b) => b.status === 'fazendo')
    const feitos = objetivos.filter((b) => b.status === 'feito')
    const notas = ordenados.filter((b) => b.tipo === 'nota')
    const diretriz =
      notas.find((b) => b.papel === 'direction') ||
      notas.find((b) => /dire[cç][aã]o|prioridade/i.test(b.titulo)) ||
      notas[0]
    const checkpoints = notas.filter((b) =>
      ['checkpoint', 'closure'].includes(b.papel || '') ||
      /checkpoint|evid[eê]ncia|progresso|status|fechamento/i.test(b.titulo)
    )
    const candidatasAPlano = notas.filter(
      (b) => b.id !== diretriz?.id && !checkpoints.includes(b)
    )
    const plano =
      candidatasAPlano.find((b) => b.papel === 'plan') ||
      candidatasAPlano.find((b) => /plano|opera[cç][aã]o|coordena[cç][aã]o/i.test(b.titulo)) ||
      candidatasAPlano[0]
    const acordos = candidatasAPlano.filter((b) => b.id !== plano?.id)
    return { objetivos, pendentes, fazendo, feitos, diretriz, plano, checkpoints, acordos }
  }, [blocos])

  async function mudarStatus(bloco: Bloco, status: StatusBloco) {
    const anterior = blocos
    setSalvandoId(bloco.id)
    setBlocos((atuais) => atuais.map((item) => (item.id === bloco.id ? { ...item, status } : item)))
    try {
      await atualizarBloco(bloco.id, { status }, dia)
      setErro('')
    } catch (e) {
      setBlocos(anterior)
      setErro(`Não foi possível atualizar “${bloco.titulo}”: ${String(e)}`)
    } finally {
      setSalvandoId('')
    }
  }

  async function excluirFrente(bloco: Bloco) {
    const confirmou = window.confirm(
      `Excluir “${bloco.titulo}” deste dia?\n\nEla será removida do Resumo, mas poderá ser recuperada no arquivo.`
    )
    if (!confirmou) return

    const anterior = blocos
    setSalvandoId(bloco.id)
    setBlocos((atuais) => atuais.filter((item) => item.id !== bloco.id))
    try {
      const excluido = await excluirBloco(bloco.id, dia)
      if (!excluido) throw new Error('a frente não foi encontrada')
      setErro('')
    } catch (e) {
      setBlocos(anterior)
      setErro(`Não foi possível excluir “${bloco.titulo}”: ${String(e)}`)
    } finally {
      setSalvandoId('')
    }
  }

  async function recarregarAposAgente() {
    try {
      setBlocos(await listarBlocos(dia))
      setErro('')
    } catch (e) {
      setErro(`A ação foi concluída, mas o Resumo não pôde ser recarregado: ${String(e)}`)
    }
  }

  async function executarAutomaticamente(blocoId?: string) {
    setIniciandoExecutor(true)
    setErroExecutor('')
    try {
      const execucao = await iniciarExecutorNativo(dia, blocoId)
      setExecutor((atual) => ({
        ativo: execucao,
        historico: [execucao, ...(atual?.historico || []).filter((item) => item.id !== execucao.id)],
      }))
    } catch (e) {
      setErroExecutor(String(e))
    } finally {
      setIniciandoExecutor(false)
    }
  }

  async function cancelarExecucao(execucao: ExecucaoNativa) {
    setErroExecutor('')
    try {
      const atualizada = await cancelarExecutorNativo(execucao.id)
      setExecutor((atual) => ({
        ativo: atualizada,
        historico: [atualizada, ...(atual?.historico || []).filter((item) => item.id !== atualizada.id)],
      }))
    } catch (e) {
      setErroExecutor(String(e))
    }
  }

  const data = dataPorExtenso(dia)
  const planoConteudo = estado.plano ? conteudoDoBloco(estado.plano.corpo) : null

  return (
    <div className={`quadro-dia ${assistenteAberto ? 'quadro-dia--assistente-aberto' : ''}`}>
      <div className="dia-area">
        <main className="dia-painel" data-dailywork-ready={!carregando ? 'true' : 'false'}>
          <header className="dia-cabecalho-compacto">
            <div className="dia-data" aria-label={data.completa}>
              <strong>{data.curta}</strong>
              <span>{data.semana}</span>
            </div>
            <div className="dia-titulo">
              <h1>Hoje</h1>
              <p>{estado.objetivos.length} frentes independentes</p>
            </div>
            <div className="dia-contadores" aria-label="Contagem por estado">
              <span><strong>{estado.pendentes.length}</strong> pendentes</span>
              <span><strong>{estado.fazendo.length}</strong> em andamento</span>
              <span><strong>{estado.feitos.length}</strong> concluídas</span>
            </div>
            {estado.diretriz && (
              <aside className="dia-direcao" aria-label="Direção do dia">
                <strong>
                  {estado.diretriz.titulo.replace(/^dire[cç][aã]o\s*[·:—-]?\s*/i, '')}
                </strong>
                <span>{estado.diretriz.corpo}</span>
              </aside>
            )}
          </header>

          {erro && <div className="dia-erro">{erro}</div>}
          {erroExecutor && <div className="dia-erro">Executor nativo: {erroExecutor}</div>}

          <PreparacaoDia
            dia={dia}
            frentes={estado.objetivos.length}
            onBlocosAlterados={recarregarAposAgente}
            onPacoteCarregado={(pacote) => setProjetosDia(pacote.projetosDisponiveis)}
          />

          {estado.plano && planoConteudo && (
            <section className="dia-plano" data-testid="plano-do-dia">
              <div className="dia-plano-cabecalho">
                <span>Plano do dia</span>
                <h2>{estado.plano.titulo}</h2>
                {planoConteudo.objetivo && <p>{planoConteudo.objetivo}</p>}
              </div>
              {planoConteudo.acoes.length > 0 && (
                <ul>
                  {planoConteudo.acoes.map((acao) => <li key={acao}>{acao}</li>)}
                </ul>
              )}
              {planoConteudo.prontidao && (
                <p className="dia-plano-fechamento">
                  <strong>Fechamento:</strong> {planoConteudo.prontidao}
                </p>
              )}
            </section>
          )}

          <section className="dia-frentes" data-testid="objetivos-do-dia" aria-busy={carregando}>
            <header className="dia-frentes-cabecalho">
              <div>
                <span>Execução</span>
                <h2>Frentes de trabalho</h2>
                <p>Cada frente avança e conclui no próprio ritmo.</p>
              </div>
              <div className="dia-frentes-acoes">
                {estado.objetivos.some((bloco) => bloco.status !== 'feito') && (
                  <button
                    className="acao-executor-dia"
                    disabled={iniciandoExecutor || Boolean(executor?.ativo)}
                    onClick={() => executarAutomaticamente()}
                  >
                    {executor?.ativo ? 'Trabalhando…' : 'Fazer meu dia'}
                  </button>
                )}
                <strong>{estado.objetivos.length}</strong>
              </div>
            </header>

            <NovaFrente dia={dia} projetos={projetosDia} onCriada={recarregarAposAgente} />

            {executor?.ativo && (
              <aside className="executor-nativo-status" aria-live="polite">
                <div>
                  <span>Executor nativo</span>
                  <strong>{executor.ativo.tituloAtual || 'Preparando a próxima frente'}</strong>
                  <small>{executor.ativo.etapa} · Grok 4.6 com fallback GPT 5.6 Sol</small>
                </div>
                <button onClick={() => cancelarExecucao(executor.ativo!)}>Cancelar</button>
              </aside>
            )}

            {carregando ? (
              <ResumoVazio>Carregando frentes…</ResumoVazio>
            ) : estado.objetivos.length === 0 ? (
              <ResumoVazio>Escreva uma frente acima ou aceite uma sugestão em Preparar o dia.</ResumoVazio>
            ) : (
              <div className="frentes-grade">
                {estado.objetivos.map((bloco) => {
                  const conteudo = conteudoDoBloco(bloco.corpo)
                  const salvando = salvandoId === bloco.id
                  const execucaoDoBloco = executor?.historico.find((item) => item.blocos.includes(bloco.id))
                  const resultadoExecucao = execucaoDoBloco?.resultados.find((item) => item.blocoId === bloco.id)
                  const executandoAgora = executor?.ativo?.blocoIdAtual === bloco.id
                  return (
                    <article className={`frente-card frente-card--${bloco.status}`} key={bloco.id}>
                      <header>
                        <div>
                          <span className={`estado-marca estado-marca--${bloco.status}`} />
                          <h3>{bloco.titulo}</h3>
                        </div>
                        <span className={`estado-texto estado-texto--${bloco.status}`}>
                          {STATUS_HUMANO[bloco.status]}
                        </span>
                      </header>

                      {conteudo.objetivo && <p className="frente-objetivo">{conteudo.objetivo}</p>}

                      {conteudo.acoes.length > 0 && (
                        <div className="frente-execucao">
                          <strong>Como executar</strong>
                          <ul>
                            {conteudo.acoes.map((acao) => <li key={acao}>{acao}</li>)}
                          </ul>
                        </div>
                      )}

                      {conteudo.prontidao && (
                        <p className="frente-saida"><strong>Saída:</strong> {conteudo.prontidao}</p>
                      )}

                      {(executandoAgora || resultadoExecucao) && (
                        <div className={`frente-automacao ${resultadoExecucao?.concluido ? 'is-concluida' : ''}`}>
                          <strong>{executandoAgora ? 'DailyWork trabalhando' : resultadoExecucao?.concluido ? 'Feita automaticamente' : 'Precisa de atenção'}</strong>
                          <span>{executandoAgora ? executor?.ativo?.etapa : resultadoExecucao?.resumo}</span>
                          {resultadoExecucao?.fallback && <small>Fallback usado: GPT 5.6 Sol High</small>}
                        </div>
                      )}

                      <footer>
                        {bloco.status !== 'feito' && (
                          <button
                            className="acao-automatica"
                            disabled={salvando || iniciandoExecutor || Boolean(executor?.ativo) || !bloco.repositorio && !bloco.worktree}
                            title={!bloco.repositorio && !bloco.worktree ? 'Informe repositorio ou worktree no card' : undefined}
                            onClick={() => executarAutomaticamente(bloco.id)}
                          >
                            {!bloco.repositorio && !bloco.worktree ? 'Defina o repositório' : 'Fazer automaticamente'}
                          </button>
                        )}
                        {bloco.status === 'pendente' && (
                          <>
                            <button disabled={salvando} onClick={() => mudarStatus(bloco, 'fazendo')}>
                              Iniciar
                            </button>
                            <button className="acao-secundaria" disabled={salvando} onClick={() => mudarStatus(bloco, 'feito')}>
                              Concluir direto
                            </button>
                          </>
                        )}
                        {bloco.status === 'fazendo' && (
                          <>
                            <button disabled={salvando} onClick={() => mudarStatus(bloco, 'feito')}>
                              Marcar concluído
                            </button>
                            <button className="acao-secundaria" disabled={salvando} onClick={() => mudarStatus(bloco, 'pendente')}>
                              Pausar
                            </button>
                          </>
                        )}
                        {bloco.status === 'feito' && (
                          <button className="acao-secundaria" disabled={salvando} onClick={() => mudarStatus(bloco, 'pendente')}>
                            Reabrir
                          </button>
                        )}
                        <button
                          className="acao-excluir"
                          disabled={salvando}
                          onClick={() => excluirFrente(bloco)}
                        >
                          Excluir
                        </button>
                      </footer>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {(estado.checkpoints.length > 0 || estado.acordos.length > 0) && (
            <section className="dia-registros" data-testid="registros-do-dia">
              <header>
                <span>Contexto vivo</span>
                <h2>Registros e limites</h2>
              </header>
              <div>
                {[...estado.checkpoints, ...estado.acordos].map((bloco) => (
                  <article key={bloco.id}>
                    <strong>{bloco.titulo}</strong>
                    <p>{bloco.corpo}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {!carregando && estado.objetivos.length > 0 && (
            <FechamentoDia dia={dia} onBlocosAlterados={recarregarAposAgente} />
          )}
        </main>
      </div>

      <AssistenteDia
        dia={dia}
        blocos={blocos}
        aberto={assistenteAberto}
        onAbertoChange={setAssistenteAberto}
        onBlocosAlterados={recarregarAposAgente}
      />
    </div>
  )
}
