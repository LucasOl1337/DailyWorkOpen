import { useEffect, useMemo, useRef, useState } from 'react'
import { obterDashboardSkills, type DashboardSkills, type SkillItem } from '../lib/skills'
import './skills.css'

const PERIODOS = [7, 30, 90]
const CORES_HARNESS = ['#277158', '#4d7fa8', '#a8763e', '#7a5fa0', '#b0543f', '#5c8a52']

function rotuloData(iso: string | null): string {
  if (!iso) return 'Sem registro'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Sem registro'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
}

export function Skills() {
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState<DashboardSkills | null>(null)
  const [carregado, setCarregado] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [origemSel, setOrigemSel] = useState('')
  const [harnessSel, setHarnessSel] = useState('')
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const pedidoRef = useRef(0)

  async function carregar(quantidade: number) {
    const pedido = ++pedidoRef.current
    setCarregando(true)
    setErro('')
    try {
      const resultado = await obterDashboardSkills(quantidade)
      if (pedido !== pedidoRef.current) return
      setDados(resultado)
      setDias(quantidade)
    } catch (e) {
      if (pedido !== pedidoRef.current) return
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as skills.')
    } finally {
      if (pedido !== pedidoRef.current) return
      setCarregando(false)
      setCarregado(true)
    }
  }

  useEffect(() => {
    void carregar(30)
  }, [])

  const origens = useMemo(() => {
    const mapa = new Map((dados?.skills || []).map((skill) => [skill.origem, skill.origemRotulo]))
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [dados])
  const nomesHarness = useMemo(() => (dados?.harnesses || []).map((h) => h.nome), [dados])
  const cores = useMemo(() => new Map(nomesHarness.map((n, i) => [n, CORES_HARNESS[i % CORES_HARNESS.length]])), [nomesHarness])

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (dados?.skills || []).filter((s) => {
      if (origemSel && s.origem !== origemSel) return false
      if (harnessSel && !s.harnesses.some((h) => h.nome === harnessSel)) return false
      if (termo && !`${s.nome} ${s.proposito}`.toLowerCase().includes(termo)) return false
      return true
    })
  }, [dados, busca, origemSel, harnessSel])

  const selecionadaSkill = filtradas.find((s) => s.id === selecionada) || filtradas[0] || null
  const cruzamentosSelecionada = (dados?.cruzamentos || []).filter((c) => c.skillId === selecionadaSkill?.id)
  const maiorTotal = Math.max(1, ...(dados?.serieDiaria || []).map((d) => d.total))

  return (
    <main className="skills-page" data-dailywork-ready={carregado ? 'true' : 'false'}>
      <div className="skills-inner">
        <header className="skills-header">
          <div>
            <p className="skills-eyebrow">Telemetria local</p>
            <h1>Skills</h1>
            <p className="skills-lede">
              Inventário do catálogo de skills cruzado com o uso registrado por cada agente e harness nesta máquina.
            </p>
          </div>
          <div className="skills-acoes">
            <div className="skills-periodo" role="group" aria-label="Período" aria-busy={carregando}>
              {PERIODOS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={dias === p ? 'is-active' : ''}
                  disabled={carregando}
                  onClick={() => void carregar(p)}
                >
                  {p}d
                </button>
              ))}
            </div>
            <button type="button" className="skills-botao" disabled={carregando} onClick={() => void carregar(dias)}>
              Atualizar
            </button>
          </div>
        </header>

        {erro && (
          <p className="skills-erro" role="alert">
            {erro}{' '}
            <button type="button" onClick={() => void carregar(dias)}>
              Tentar de novo
            </button>
          </p>
        )}
        {dados?.alertas?.length ? (
          <p className="skills-aviso">{dados.alertas.join(' ')}</p>
        ) : null}

        {carregando && !dados && <p className="skills-vazio">Carregando telemetria…</p>}

        {dados && (
          <>
            <section className="skills-metricas" aria-label="Resumo">
              <div className="skills-metrica"><strong>{dados.resumo.inventario}</strong><span>Skills no inventário</span></div>
              <div className="skills-metrica"><strong>{dados.resumo.usadas}</strong><span>Usadas</span></div>
              <div className="skills-metrica"><strong>{dados.resumo.usosPeriodo}</strong><span>Ativações no período</span></div>
              <div className="skills-metrica"><strong>{dados.resumo.usosConhecidos}</strong><span>Volume conhecido</span></div>
              <div className="skills-metrica"><strong>{dados.resumo.harnesses}</strong><span>Harnesses</span></div>
            </section>

            <section className="skills-secao">
              <div className="skills-secao-heading">
                <h2>Uso por dia</h2>
                <div className="skills-legenda">
                  {nomesHarness.map((n) => (
                    <span key={n}><i style={{ background: cores.get(n) }} />{n}</span>
                  ))}
                </div>
              </div>
              <div className="skills-serie" role="list" aria-label="Série diária de ativações por harness">
                {dados.serieDiaria.map((dia) => (
                  <div
                    key={dia.dia}
                    className="skills-serie-col"
                    role="listitem"
                    aria-label={`${dia.dia}: ${dia.total} ativações`}
                    title={`${dia.dia} · ${dia.total}`}
                  >
                    <div className="skills-serie-barra" style={{ height: `${(dia.total / maiorTotal) * 100}%` }}>
                      {nomesHarness.map((n) =>
                        dia.porHarness[n] ? (
                          <span key={n} style={{ background: cores.get(n), flexGrow: dia.porHarness[n] }} />
                        ) : null
                      )}
                    </div>
                    <small>{dia.dia.slice(8)}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="skills-secao">
              <div className="skills-secao-heading"><h2>Por harness</h2></div>
              <div className="skills-harnesses">
                {dados.harnesses.map((h) => (
                  <div className="skills-harness" key={h.nome}>
                    <strong>{h.nome}</strong>
                    <span>{h.usosPeriodo} no período · {h.usosConhecidos} conhecidos</span>
                    <small>{h.skills} skills · {h.agentes.join(', ') || 'sem agente'} · {h.cobertura}</small>
                  </div>
                ))}
                {dados.harnesses.length === 0 && <p className="skills-vazio">Nenhum harness com uso registrado.</p>}
              </div>
            </section>

            <section className="skills-secao">
              <div className="skills-secao-heading">
                <h2>Inventário</h2>
                <div className="skills-filtros">
                  <input
                    type="search"
                    placeholder="Buscar skill"
                    aria-label="Buscar skill"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                  <select aria-label="Filtrar por origem" value={origemSel} onChange={(e) => setOrigemSel(e.target.value)}>
                    <option value="">Todas as origens</option>
                    {origens.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
                  </select>
                  <select aria-label="Filtrar por harness" value={harnessSel} onChange={(e) => setHarnessSel(e.target.value)}>
                    <option value="">Todos os harnesses</option>
                    {nomesHarness.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
              <div className="skills-grade">
                <div className="skills-tabela" role="region" aria-label="Inventário de skills">
                  <div className="skills-linha skills-linha--cab">
                    <span>Skill</span><span>Origem</span><span>Período</span><span>Conhecido</span><span>Último uso</span>
                  </div>
                  {filtradas.map((s: SkillItem) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={selecionadaSkill?.id === s.id}
                      className={`skills-linha ${selecionadaSkill?.id === s.id ? 'is-active' : ''}`}
                      onClick={() => setSelecionada(s.id)}
                    >
                      <span><strong>{s.nome}</strong>{s.proposito && <small>{s.proposito}</small>}</span>
                      <span>{s.origemRotulo}</span>
                      <span>{s.usosPeriodo}</span>
                      <span>{s.usosConhecidos}</span>
                      <span>{rotuloData(s.ultimoUso)}</span>
                    </button>
                  ))}
                  {filtradas.length === 0 && <p className="skills-vazio">Nenhuma skill encontrada com estes filtros.</p>}
                </div>

                {selecionadaSkill && (
                  <aside className="skills-detalhe" aria-label={`Detalhe de ${selecionadaSkill.nome}`}>
                    <h3>{selecionadaSkill.nome}</h3>
                    <p className="skills-detalhe-proposito">{selecionadaSkill.proposito || 'Sem propósito registrado.'}</p>
                    {selecionadaSkill.caminho && <p className="skills-detalhe-caminho">{selecionadaSkill.caminho}</p>}
                    <p className="skills-detalhe-meta">
                      {selecionadaSkill.origemRotulo} · {selecionadaSkill.usosConhecidos} usos conhecidos · {selecionadaSkill.diasAtivos} dias ativos
                    </p>
                    <h4>Agente × harness</h4>
                    <ul>
                      {cruzamentosSelecionada.map((c) => (
                        <li key={`${c.harness}|${c.agente}|${c.cobertura}`}>
                          <span>{c.agente} · {c.harness}</span>
                          <span>{c.usos} {c.cobertura === 'agregado' ? '(agregado)' : ''} · {rotuloData(c.ultimoUso)}</span>
                        </li>
                      ))}
                      {cruzamentosSelecionada.length === 0 && <li><span>Sem uso registrado.</span></li>}
                    </ul>
                  </aside>
                )}
              </div>
            </section>
          </>
        )}
        {!carregando && !dados && !erro && <p className="skills-vazio">Nenhum dado de skills disponível.</p>}
      </div>
    </main>
  )
}
