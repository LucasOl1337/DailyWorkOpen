import { useEffect, useMemo, useState } from 'react'
import {
  coletarSumarioDiario,
  obterInputsSumarioDiario,
  type DadosInputsSumario,
  type InputHumanoSumario,
} from '../lib/api'
import { CoberturaInputsSumario } from './CoberturaInputsSumario'

function numero(valor: number) {
  return new Intl.NumberFormat('pt-BR').format(valor)
}

function hora(timestamp: string | null) {
  if (!timestamp) return '—'
  const data = new Date(timestamp)
  if (Number.isNaN(data.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(data)
}

function textoEstruturado(input: InputHumanoSumario) {
  if (input.content == null) return ''
  if (typeof input.content === 'string' && input.content.trim() === input.text.trim()) return ''
  if (
    input.content
    && typeof input.content === 'object'
    && !Array.isArray(input.content)
    && 'text' in input.content
    && typeof input.content.text === 'string'
    && input.content.text.trim() === input.text.trim()
    && Object.keys(input.content).every((chave) => chave === 'type' || chave === 'text')
  ) return ''
  try {
    return JSON.stringify(input.content, null, 2)
  } catch {
    return String(input.content)
  }
}

function InputRow({ input }: { input: InputHumanoSumario }) {
  const conteudoEstruturado = textoEstruturado(input)
  return (
    <li className="sumario-input-row">
      <div className="sumario-input-row__time">
        <time dateTime={input.timestamp || undefined}>{hora(input.timestamp)}</time>
        <span>#{String(input.sequence).padStart(2, '0')}</span>
      </div>
      <article>
        <header>
          <span>{input.app}</span>
          <strong>{input.conversationTitle}</strong>
        </header>
        {input.text ? (
          <p>{input.text}</p>
        ) : (
          <p className="sumario-input-row__non-text">Registro sem texto visível.</p>
        )}
        {conteudoEstruturado && (
          <details className="sumario-input-row__structured">
            <summary>Ver dados técnicos</summary>
            <pre>{conteudoEstruturado}</pre>
          </details>
        )}
      </article>
    </li>
  )
}

export function PainelInputsSumario({
  dia,
  chaveAtualizacao,
}: {
  dia: string
  chaveAtualizacao: string | null
}) {
  const [dados, setDados] = useState<DadosInputsSumario | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [preparando, setPreparando] = useState(false)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [fonte, setFonte] = useState('todas')
  const [conversa, setConversa] = useState('todas')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErro('')
    setDados((atual) => atual?.day === dia ? atual : null)
    void obterInputsSumarioDiario(dia)
      .then((resultado) => {
        if (!ativo) return
        setDados(resultado)
        setErro('')
      })
      .catch((e) => {
        if (!ativo) return
        setDados((atual) => atual?.day === dia ? atual : null)
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar suas mensagens.')
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => { ativo = false }
  }, [chaveAtualizacao, dia])

  useEffect(() => {
    setBusca('')
    setFonte('todas')
    setConversa('todas')
  }, [dia])

  const dadosDoDia = dados?.day === dia ? dados : null

  const fontes = useMemo(
    () => dadosDoDia?.sources.filter((item) => item.inputCount > 0) || [],
    [dadosDoDia]
  )
  const conversas = useMemo(() => {
    const unicas = new Map<string, { id: string; title: string; count: number }>()
    for (const input of dadosDoDia?.inputs || []) {
      if (fonte !== 'todas' && input.source !== fonte) continue
      const atual = unicas.get(input.conversationId)
      if (atual) atual.count += 1
      else unicas.set(input.conversationId, {
        id: input.conversationId,
        title: input.conversationTitle,
        count: 1,
      })
    }
    return [...unicas.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  }, [dadosDoDia, fonte])
  useEffect(() => {
    if (conversa !== 'todas' && !conversas.some((item) => item.id === conversa)) {
      setConversa('todas')
    }
  }, [conversa, conversas])
  const inputs = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return (dadosDoDia?.inputs || []).filter((input) => {
      if (fonte !== 'todas' && input.source !== fonte) return false
      if (conversa !== 'todas' && input.conversationId !== conversa) return false
      if (!termo) return true
      return [input.text, input.app, input.conversationTitle, input.cwd, textoEstruturado(input)]
        .some((valor) => String(valor || '').toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [busca, conversa, dadosDoDia, fonte])

  async function prepararInputs() {
    setPreparando(true)
    setErro('')
    try {
      await coletarSumarioDiario(dia)
      setDados(await obterInputsSumarioDiario(dia))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível preparar suas mensagens.')
    } finally {
      setPreparando(false)
      setCarregando(false)
    }
  }

  const pronta = !carregando
  const naoPreparada = dadosDoDia?.completeness === 'not_collected'

  return (
    <section
      className="sumario-inputs"
      data-testid="sumario-inputs"
      data-inputs-ready={pronta ? 'true' : 'false'}
      aria-busy={carregando || preparando}
    >
      {erro && <div className="sumario-inputs__error" role="alert">{erro}</div>}

      {!carregando && naoPreparada && (
        <div className="sumario-inputs__empty">
          <strong>Suas mensagens ainda não foram separadas.</strong>
          <span>Atualize as fontes para reunir o que você escreveu neste dia.</span>
          <button type="button" disabled={preparando} onClick={() => void prepararInputs()}>
            {preparando ? 'Atualizando…' : 'Atualizar mensagens'}
          </button>
        </div>
      )}

      {carregando && <div className="sumario-skeleton sumario-skeleton--inputs" aria-label="Carregando suas mensagens" />}

      {!carregando && dadosDoDia && !naoPreparada && (
        <>
          <div className="sumario-inputs__meta">
            <span><strong>{numero(dadosDoDia.stats.inputs)}</strong> mensagens suas</span>
            <span><strong>{numero(dadosDoDia.stats.sources)}</strong> fontes com suas mensagens</span>
            <span><strong>{numero(dadosDoDia.stats.conversations)}</strong> conversas</span>
            <em className={`is-${dadosDoDia.completeness}`}>
              {dadosDoDia.completeness === 'complete' ? 'Leitura completa nas fontes encontradas' : 'Algumas fontes falharam'}
            </em>
          </div>

          <CoberturaInputsSumario fontes={dadosDoDia.sources} />

          <div className="sumario-conversations__tools sumario-inputs__tools">
            <label>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.7" cy="8.7" r="5.2" />
                <path d="m12.6 12.6 4 4" />
              </svg>
              <input
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Buscar no que você disse"
                aria-label="Buscar nas suas mensagens"
              />
            </label>
            <select
              value={fonte}
              onChange={(evento) => {
                setFonte(evento.target.value)
                setConversa('todas')
              }}
              aria-label="Filtrar mensagens por fonte"
            >
              <option value="todas">Todas as fontes</option>
              {fontes.map((item) => (
                <option value={item.id} key={item.id}>{item.label} · {numero(item.inputCount)}</option>
              ))}
            </select>
            <select value={conversa} onChange={(evento) => setConversa(evento.target.value)} aria-label="Filtrar mensagens por conversa">
              <option value="todas">Todas as conversas</option>
              {conversas.map((item) => (
                <option value={item.id} key={item.id}>{item.title} · {numero(item.count)}</option>
              ))}
            </select>
            <span role="status" aria-atomic="true" aria-live="polite">{numero(inputs.length)} de {numero(dadosDoDia.inputs.length)}</span>
          </div>

          {inputs.length ? (
            <ol className="sumario-inputs__timeline">
              {inputs.map((input) => (
                <InputRow input={input} key={`${input.conversationId}:${input.id}`} />
              ))}
            </ol>
          ) : (
            <div className="sumario-inputs__empty sumario-inputs__empty--filtered">
              <strong>{dadosDoDia.inputs.length ? 'Nenhuma mensagem corresponde aos filtros.' : 'Nenhuma mensagem sua foi encontrada.'}</strong>
              <span>{dadosDoDia.inputs.length ? 'Ajuste a busca, a fonte ou a conversa.' : 'As fontes coletadas não registraram mensagens suas neste dia.'}</span>
            </div>
          )}

          <footer className="sumario-inputs__coverage">
            <strong>O que esta aba mostra</strong>
            <span>Esta aba reúne todas as suas mensagens encontradas nas fontes acima. O WhatsApp aparece quando há uma extração local validada. Em jogos, os registros mostram a partida, mas não o que você digitou no chat.</span>
          </footer>
        </>
      )}
    </section>
  )
}
