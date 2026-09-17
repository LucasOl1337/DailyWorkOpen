import { useEffect, useState } from 'react'
import { confirmarFechamento, revisarFechamento, revisarSemana } from '../lib/api'
import type { DestinoFechamento, RevisaoFechamento, RevisaoSemana } from '../lib/fluxo'
import './fechamento-dia.css'

interface FechamentoDiaProps {
  dia: string
  onBlocosAlterados: () => Promise<void>
}

const ROTULOS: Record<DestinoFechamento, string> = {
  daily: 'Registrar fechamento no dia',
  workspace: 'Atualizar memória dos projetos',
  knowledgeCandidates: 'Guardar aprendizados para revisão',
  portfolioCandidates: 'Guardar resultados para portfólio',
}

export function FechamentoDia({ dia, onBlocosAlterados }: FechamentoDiaProps) {
  const [aberto, setAberto] = useState(
    () => new URLSearchParams(window.location.search).get('fechamento') === 'open'
  )
  const [revisao, setRevisao] = useState<RevisaoFechamento | null>(null)
  const [semana, setSemana] = useState<RevisaoSemana | null>(null)
  const [destinos, setDestinos] = useState<Set<DestinoFechamento>>(new Set())
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')

  useEffect(() => {
    if (!aberto || revisao) return
    let ativo = true
    setCarregando(true)
    setErro('')
    void Promise.all([
        revisarFechamento(dia),
        revisarSemana(dia),
      ])
      .then(([resultado, resultadoSemana]) => {
        if (!ativo) return
      setRevisao(resultado)
      setSemana(resultadoSemana)
      const iniciais: DestinoFechamento[] = ['daily']
      if (resultado.destinos.workspace.length) iniciais.push('workspace')
      if (resultado.destinos.knowledgeCandidates.length) iniciais.push('knowledgeCandidates')
      if (resultado.destinos.portfolioCandidates.length) iniciais.push('portfolioCandidates')
      setDestinos(new Set(iniciais))
      })
      .catch((e) => {
        if (ativo) setErro(`Não foi possível revisar o fechamento: ${String(e)}`)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => { ativo = false }
  }, [aberto, dia, revisao])

  function abrirRevisao() {
    setAberto((valor) => !valor)
  }

  function alternar(destino: DestinoFechamento) {
    setDestinos((atuais) => {
      const proximos = new Set(atuais)
      if (proximos.has(destino)) proximos.delete(destino)
      else proximos.add(destino)
      return proximos
    })
  }

  async function confirmar() {
    if (!revisao || destinos.size === 0) return
    setSalvando(true)
    setErro('')
    try {
      const recibos = await confirmarFechamento(dia, revisao.reviewId, [...destinos])
      setMensagem(`${recibos.length} atualização(ões) confirmada(s), cada uma na sua fonte correta.`)
      await onBlocosAlterados()
    } catch (e) {
      setErro(`O fechamento não foi aplicado: ${String(e)}`)
    } finally {
      setSalvando(false)
    }
  }

  const contagens: Record<DestinoFechamento, number> = {
    daily: 1,
    workspace: revisao?.destinos.workspace.length || 0,
    knowledgeCandidates: revisao?.destinos.knowledgeCandidates.length || 0,
    portfolioCandidates: revisao?.destinos.portfolioCandidates.length || 0,
  }

  return (
    <section
      className="fechamento-dia"
      data-testid="fechamento-dia"
      data-fechamento-ready={!carregando && revisao ? 'true' : 'false'}
    >
      <button type="button" className="fechamento-chamada" onClick={abrirRevisao} aria-expanded={aberto}>
        <span>
          <small>Fim do ciclo</small>
          <strong>Revisar fechamento do dia</strong>
        </span>
        <span>{aberto ? 'Fechar' : 'Revisar'}</span>
      </button>

      {aberto && (
        <div className="fechamento-conteudo">
          {carregando && <p>Separando execução, memória e aprendizados…</p>}
          {erro && <div className="fechamento-alerta fechamento-alerta--erro">{erro}</div>}
          {mensagem && <div className="fechamento-alerta fechamento-alerta--ok">{mensagem}</div>}
          {revisao && (
            <>
              <div className="fechamento-metricas">
                <span><strong>{revisao.resumo.concluidas}</strong> concluídas</span>
                <span><strong>{revisao.resumo.abertas}</strong> continuam</span>
                <span className={revisao.resumo.semEvidencia ? 'fechamento-metrica--alerta' : ''}>
                  <strong>{revisao.resumo.semEvidencia}</strong> sem evidência
                </span>
              </div>

              {semana && (
                <section className="fechamento-semana">
                  <div>
                    <span>Últimos 7 dias</span>
                    <strong>{semana.resumo.concluidasComEvidencia} entregas comprovadas</strong>
                  </div>
                  <div>
                    <span>Reincidência</span>
                    <strong>{semana.frentesRecorrentes.length} frentes reapareceram</strong>
                  </div>
                  <div>
                    <span>Knowledge</span>
                    <strong>{semana.conhecimento.linksLocaisQuebrados} links quebrados</strong>
                  </div>
                </section>
              )}

              {revisao.alertas.map((alerta) => <div className="fechamento-alerta" key={alerta}>{alerta}</div>)}

              {revisao.handoffs.length > 0 && (
                <section className="fechamento-handoffs">
                  <header>
                    <span>Continuidade</span>
                    <h3>Próximas ações já prontas para handoff</h3>
                  </header>
                  <div>
                    {revisao.handoffs.map((handoff) => (
                      <article key={handoff.blocoId}>
                        <strong>{handoff.titulo}</strong>
                        <p>{handoff.proximaAcao}</p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="fechamento-destinos">
                <header>
                  <span>Confirmação por destino</span>
                  <h3>Onde cada informação deve ficar</h3>
                </header>
                <div>
                  {(Object.keys(ROTULOS) as DestinoFechamento[]).map((destino) => (
                    <label key={destino} className={contagens[destino] === 0 ? 'fechamento-destino--vazio' : ''}>
                      <input
                        type="checkbox"
                        checked={destinos.has(destino)}
                        disabled={contagens[destino] === 0}
                        onChange={() => alternar(destino)}
                      />
                      <span>
                        <strong>{ROTULOS[destino]}</strong>
                        <small>{contagens[destino]} item(ns)</small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <footer>
                <span>Nada é promovido direto para o Knowledge ou publicado no portfólio.</span>
                <button type="button" disabled={salvando || destinos.size === 0} onClick={confirmar}>
                  {salvando ? 'Confirmando…' : 'Confirmar fechamento'}
                </button>
              </footer>
            </>
          )}
        </div>
      )}
    </section>
  )
}
