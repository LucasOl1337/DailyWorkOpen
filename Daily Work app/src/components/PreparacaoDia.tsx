import { useEffect, useMemo, useState } from 'react'
import { confirmarPropostas, criarBloco, prepararDia, rascunharDia } from '../lib/api'
import type { PacoteContextoDia, PropostaContexto, RascunhoDia } from '../lib/fluxo'
import './preparacao-dia.css'

interface PreparacaoDiaProps {
  dia: string
  frentes?: number
  onBlocosAlterados: () => Promise<void>
  onPacoteCarregado?: (pacote: PacoteContextoDia) => void
}

const GRUPOS_PROPOSTA: Array<{ kind: PropostaContexto['kind']; titulo: string }> = [
  { kind: 'sumario_proximo_passo', titulo: 'Sumário de ontem' },
  { kind: 'carryover', titulo: 'Continuidade' },
  { kind: 'project_next_action', titulo: 'Projetos' },
]

function statusFonte(status: string) {
  if (status === 'fresh') return 'atual'
  if (status === 'stale') return 'desatualizada'
  if (status === 'available') return 'disponível'
  return 'indisponível'
}

function chavePreparacao(dia: string) {
  return `dailywork:preparacao:aberto:${dia}`
}

function chaveRascunho(dia: string, packId: string) {
  return `dailywork:rascunho-dia:${dia}:${packId}`
}

function lerAberto(dia: string) {
  try {
    return localStorage.getItem(chavePreparacao(dia))
  } catch {
    return null
  }
}

function gravarAberto(dia: string, aberto: boolean) {
  try {
    localStorage.setItem(chavePreparacao(dia), String(aberto))
  } catch {
    // Preferência local é opcional.
  }
}

function lerRascunho(dia: string, packId: string): RascunhoDia | null {
  try {
    const valor = JSON.parse(localStorage.getItem(chaveRascunho(dia, packId)) || 'null')
    if (valor?.rascunhoId && Array.isArray(valor.frentes) && typeof valor.direcao === 'string') {
      return valor as RascunhoDia
    }
  } catch {
    // Cache local é opcional.
  }
  return null
}

function gravarRascunho(dia: string, packId: string, rascunho: RascunhoDia) {
  try {
    localStorage.setItem(chaveRascunho(dia, packId), JSON.stringify(rascunho))
  } catch {
    // Cache local é opcional.
  }
}

export function PreparacaoDia({
  dia,
  frentes = 0,
  onBlocosAlterados,
  onPacoteCarregado,
}: PreparacaoDiaProps) {
  const [aberto, setAberto] = useState(
    () => new URLSearchParams(window.location.search).get('preparacao') === 'open'
  )
  const [projetoId, setProjetoId] = useState('')
  const [pacote, setPacote] = useState<PacoteContextoDia | null>(null)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [rascunho, setRascunho] = useState<RascunhoDia | null>(null)
  const [rascunhoSel, setRascunhoSel] = useState<Set<number>>(new Set())
  const [incluirPlano, setIncluirPlano] = useState(true)
  const [gerandoRascunho, setGerandoRascunho] = useState(false)
  const [aplicandoRascunho, setAplicandoRascunho] = useState(false)
  const [erroRascunho, setErroRascunho] = useState('')

  async function carregar(projeto = projetoId) {
    setCarregando(true)
    setErro('')
    try {
      const resultado = await prepararDia(dia, projeto || undefined)
      setPacote(resultado)
      setProjetoId(resultado.projeto?.id || projeto)
      setSelecionadas(new Set(resultado.propostas.map((proposta) => proposta.id)))
      onPacoteCarregado?.(resultado)
      const salvo = lerAberto(dia)
      if (new URLSearchParams(window.location.search).get('preparacao') === 'open') {
        setAberto(true)
      } else if (salvo === 'true' || salvo === 'false') {
        setAberto(salvo === 'true')
      } else {
        setAberto(frentes === 0 && resultado.propostas.length > 0)
      }
      const cache = lerRascunho(dia, resultado.packId)
      setRascunho(cache)
      setRascunhoSel(cache ? new Set(cache.frentes.map((_, indice) => indice)) : new Set())
    } catch (e) {
      setErro(`Não foi possível preparar o dia: ${String(e)}`)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    setProjetoId('')
    setMensagem('')
    setRascunho(null)
    setErroRascunho('')
    void carregar('')
    // A troca de data sempre começa pela inferência canônica do novo dia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia])

  const sinaisFonte = pacote?.fontes.find((fonte) => fonte.kind === 'work_signals')
  const resumo = useMemo(() => {
    if (!pacote) return 'Reúne contexto do workspace sem alterar o seu dia.'
    const n = pacote.propostas.length
    if (n > 0) {
      const origens = GRUPOS_PROPOSTA
        .filter((grupo) => pacote.propostas.some((proposta) => proposta.kind === grupo.kind))
        .map((grupo) => grupo.titulo)
      return `${n} sugestão${n === 1 ? '' : 'ões'} pronta${n === 1 ? '' : 's'}${origens.length ? ` · ${origens.join(' · ')}` : ''}`
    }
    const partes = [
      `${pacote.carryovers.length} carryover${pacote.carryovers.length === 1 ? '' : 's'}`,
      `${pacote.conhecimento.length} conhecimento${pacote.conhecimento.length === 1 ? '' : 's'}`,
      `${pacote.skills.length} procedimento${pacote.skills.length === 1 ? '' : 's'}`,
    ]
    return partes.join(' · ')
  }, [pacote])

  const grupos = useMemo(
    () =>
      GRUPOS_PROPOSTA.map((grupo) => ({
        ...grupo,
        itens: (pacote?.propostas || []).filter((proposta) => proposta.kind === grupo.kind),
      })).filter((grupo) => grupo.itens.length > 0),
    [pacote]
  )

  function alternarAberto() {
    setAberto((valor) => {
      const proximo = !valor
      gravarAberto(dia, proximo)
      return proximo
    })
  }

  function alternarProposta(id: string) {
    setSelecionadas((atuais) => {
      const proximas = new Set(atuais)
      if (proximas.has(id)) proximas.delete(id)
      else proximas.add(id)
      return proximas
    })
  }

  async function confirmar() {
    if (!pacote || selecionadas.size === 0) return
    setConfirmando(true)
    setErro('')
    try {
      const recibos = await confirmarPropostas(
        dia,
        pacote.packId,
        [...selecionadas],
        projetoId || undefined
      )
      setMensagem(
        recibos.length === 1
          ? '1 frente foi adicionada ao dia.'
          : `${recibos.length} frentes foram adicionadas ao dia.`
      )
      await onBlocosAlterados()
      await carregar(projetoId)
    } catch (e) {
      setErro(`As propostas não foram aplicadas: ${String(e)}`)
    } finally {
      setConfirmando(false)
    }
  }

  async function gerarRascunho() {
    if (!pacote || gerandoRascunho) return
    setGerandoRascunho(true)
    setErroRascunho('')
    try {
      const gerado = await rascunharDia(dia)
      setRascunho(gerado)
      setRascunhoSel(new Set(gerado.frentes.map((_, indice) => indice)))
      gravarRascunho(dia, pacote.packId, gerado)
    } catch (e) {
      setErroRascunho(`Não foi possível rascunhar o dia: ${String(e).replace(/^Error:\s*/, '')}`)
    } finally {
      setGerandoRascunho(false)
    }
  }

  useEffect(() => {
    if (!aberto || !pacote || frentes > 0 || gerandoRascunho || rascunho || erroRascunho) return
    void gerarRascunho()
    // Gera uma vez quando o dia vazio abre sem cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, pacote?.packId, frentes])

  function alternarFrenteRascunho(indice: number) {
    setRascunhoSel((atuais) => {
      const proximas = new Set(atuais)
      if (proximas.has(indice)) proximas.delete(indice)
      else proximas.add(indice)
      return proximas
    })
  }

  async function aplicarRascunho() {
    if (!rascunho || rascunhoSel.size === 0) return
    setAplicandoRascunho(true)
    setErroRascunho('')
    try {
      const selecionadasRascunho = rascunho.frentes.filter((_, indice) => rascunhoSel.has(indice))
      for (const frente of selecionadasRascunho) {
        const acoes = frente.acoes.length
          ? frente.acoes.map((acao) => `- ${acao}`).join('\n')
          : `- ${frente.objetivo}`
        await criarBloco(
          {
            tipo: 'tarefa',
            titulo: frente.titulo,
            status: 'pendente',
            papel: 'front',
            origem: 'agent',
            projeto: frente.projeto || undefined,
            fontes: [`rascunho-dia:${rascunho.rascunhoId}`],
            corpo: `Objetivo: ${frente.objetivo}\n\n${acoes}\n\nPRONTO = ${frente.pronto}`,
          },
          dia
        )
      }
      if (incluirPlano && rascunho.direcao.trim()) {
        await criarBloco(
          {
            tipo: 'nota',
            titulo: 'Plano do dia',
            status: 'pendente',
            papel: 'plan',
            origem: 'agent',
            fontes: [`rascunho-dia:${rascunho.rascunhoId}`],
            corpo: rascunho.direcao,
          },
          dia
        )
      }
      setMensagem(
        selecionadasRascunho.length === 1
          ? '1 frente do rascunho foi adicionada ao dia.'
          : `${selecionadasRascunho.length} frentes do rascunho foram adicionadas ao dia.`
      )
      await onBlocosAlterados()
      await carregar(projetoId)
    } catch (e) {
      setErroRascunho(`O rascunho não foi aplicado: ${String(e).replace(/^Error:\s*/, '')}`)
    } finally {
      setAplicandoRascunho(false)
    }
  }

  return (
    <section
      className={`preparacao-dia ${aberto ? 'preparacao-dia--aberta' : ''}`}
      data-testid="preparacao-dia"
      data-preparacao-ready={!carregando && pacote ? 'true' : 'false'}
    >
      <button
        className="preparacao-resumo"
        type="button"
        aria-expanded={aberto}
        onClick={alternarAberto}
      >
        <span className="preparacao-selo">Workspace</span>
        <span>
          <strong>Preparar o dia</strong>
          <small>{carregando ? 'Reunindo o contexto certo…' : resumo}</small>
        </span>
        <span className="preparacao-abrir">{aberto ? 'Fechar' : 'Revisar'}</span>
      </button>

      {aberto && (
        <div className="preparacao-conteudo">
          <header>
            <div>
              <span>Contexto seletivo</span>
              <h2>{pacote?.projeto?.name || 'Escolha uma frente'}</h2>
              <p>Nada abaixo altera o dia antes da sua confirmação.</p>
            </div>
            <label>
              Projeto
              <select
                value={projetoId}
                onChange={(evento) => {
                  const valor = evento.target.value
                  setProjetoId(valor)
                  setMensagem('')
                  void carregar(valor)
                }}
              >
                <option value="">Inferir pelo dia</option>
                {pacote?.projetosDisponiveis.map((projeto) => (
                  <option value={projeto.id} key={projeto.id}>{projeto.name}</option>
                ))}
              </select>
            </label>
          </header>

          {erro && <div className="preparacao-alerta preparacao-alerta--erro">{erro}</div>}
          {mensagem && <div className="preparacao-alerta preparacao-alerta--ok">{mensagem}</div>}
          {pacote?.riscos.map((risco) => (
            <div className="preparacao-alerta" key={risco.code}>{risco.message}</div>
          ))}

          {carregando ? (
            <div className="preparacao-vazio">Consultando Workspace, Knowledge, skills e sinais…</div>
          ) : pacote && (
            <>
              <div className="preparacao-grade">
                <article>
                  <span>Continuidade</span>
                  <strong>{pacote.carryovers.length} frentes abertas</strong>
                  <ul>
                    {pacote.carryovers.slice(0, 3).map((bloco) => <li key={bloco.id}>{bloco.titulo}</li>)}
                    {pacote.carryovers.length === 0 && <li>Nenhuma pendência herdada.</li>}
                  </ul>
                </article>
                <article>
                  <span>Conhecimento</span>
                  <strong>{pacote.conhecimento.length} notas relevantes</strong>
                  <ul>
                    {pacote.conhecimento.slice(0, 3).map((nota) => <li key={nota.caminho}>{nota.titulo}</li>)}
                    {pacote.conhecimento.length === 0 && <li>Nenhuma nota relacionada.</li>}
                    {(pacote.ditados?.length ?? 0) > 0 && (
                      <li>
                        {pacote.ditados.length === 1
                          ? '1 ditado do Sussurro neste dia'
                          : `${pacote.ditados.length} ditados do Sussurro neste dia`}
                      </li>
                    )}
                  </ul>
                </article>
                <article>
                  <span>Procedimentos</span>
                  <strong>{pacote.skills.length} skills sugeridas</strong>
                  <ul>
                    {pacote.skills.slice(0, 3).map((skill) => <li key={skill.id}>{skill.id}</li>)}
                    {pacote.skills.length === 0 && <li>Nenhuma skill necessária.</li>}
                  </ul>
                </article>
                <article>
                  <span>Sinais · {statusFonte(sinaisFonte?.status || 'unavailable')}</span>
                  <strong>{pacote.sinais.length} observações recentes</strong>
                  <ul>
                    {pacote.sinais.slice(0, 3).map((sinal) => <li key={sinal.id}>{sinal.title}</li>)}
                    {pacote.sinais.length === 0 && <li>Nenhum sinal atual confiável.</li>}
                  </ul>
                </article>
              </div>

              <section className="preparacao-propostas" aria-label="Propostas para o dia">
                <header>
                  <div>
                    <span>Revisão humana</span>
                    <h3>O que pode entrar no dia</h3>
                  </div>
                  <strong>{pacote.propostas.length}</strong>
                </header>
                {pacote.propostas.length === 0 ? (
                  <p className="preparacao-vazio">O contexto foi reunido, mas não há novas frentes para propor.</p>
                ) : (
                  <div className="preparacao-lista">
                    {grupos.map((grupo) => (
                      <div className="preparacao-grupo" key={grupo.kind}>
                        <span className="preparacao-grupo-titulo">{grupo.titulo}</span>
                        {grupo.itens.map((proposta) => (
                          <label key={proposta.id}>
                            <input
                              type="checkbox"
                              checked={selecionadas.has(proposta.id)}
                              onChange={() => alternarProposta(proposta.id)}
                            />
                            <span>
                              <strong>{proposta.bloco.titulo}</strong>
                              <small>{proposta.reason}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <footer>
                  <span>{selecionadas.size} selecionada{selecionadas.size === 1 ? '' : 's'}</span>
                  <button
                    type="button"
                    disabled={confirmando || selecionadas.size === 0}
                    onClick={confirmar}
                  >
                    {confirmando ? 'Adicionando…' : 'Adicionar ao meu dia'}
                  </button>
                </footer>
              </section>

              <section
                className="preparacao-rascunho"
                data-testid="preparacao-rascunho"
                aria-label="Rascunho do agente"
              >
                <header>
                  <div>
                    <span>Agente</span>
                    <h3>Rascunho do dia</h3>
                    <p>O modelo organiza as propostas em um plano curto. Nada é gravado antes de aplicar.</p>
                  </div>
                  <button
                    type="button"
                    className="preparacao-rascunho-gerar"
                    disabled={gerandoRascunho}
                    onClick={() => void gerarRascunho()}
                  >
                    {gerandoRascunho ? 'Rascunhando…' : rascunho ? 'Gerar de novo' : 'Rascunhar meu dia'}
                  </button>
                </header>
                {erroRascunho && <div className="preparacao-alerta preparacao-alerta--erro">{erroRascunho}</div>}
                {rascunho && (
                  <>
                    <p className="preparacao-rascunho-direcao">{rascunho.direcao}</p>
                    <div className="preparacao-lista">
                      {rascunho.frentes.map((frente, indice) => (
                        <label key={`${rascunho.rascunhoId}-${indice}`}>
                          <input
                            type="checkbox"
                            checked={rascunhoSel.has(indice)}
                            onChange={() => alternarFrenteRascunho(indice)}
                          />
                          <span>
                            <strong>{frente.titulo}</strong>
                            <small>{frente.objetivo}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="preparacao-rascunho-plano">
                      <input
                        type="checkbox"
                        checked={incluirPlano}
                        onChange={(evento) => setIncluirPlano(evento.target.checked)}
                      />
                      Incluir a direção como plano do dia
                    </label>
                    <footer>
                      <span>{rascunhoSel.size} selecionada{rascunhoSel.size === 1 ? '' : 's'}</span>
                      <button
                        type="button"
                        disabled={aplicandoRascunho || rascunhoSel.size === 0}
                        onClick={() => void aplicarRascunho()}
                      >
                        {aplicandoRascunho ? 'Aplicando…' : 'Aplicar selecionadas'}
                      </button>
                    </footer>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </section>
  )
}
