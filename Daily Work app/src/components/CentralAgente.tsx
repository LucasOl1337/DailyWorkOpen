import { useEffect, useMemo, useState } from 'react'
import {
  configurarAgente,
  inspecionarContextoAgente,
  salvarConfiguracaoAgente,
  sondarProvedoresAgente,
  type ConfiguracaoAgente,
  type EscopoAgente,
  type InspecaoContextoAgente,
  type ProvedorAgenteId,
  type SondagemProvedores,
} from '../lib/api'
import { hojeLocal } from '../lib/data-local'
import { AssistenteDia } from './AssistenteDia'
import './central-agente.css'

const ESCOPOS: Array<{ id: EscopoAgente; nome: string; descricao: string }> = [
  { id: 'global', nome: 'Geral', descricao: 'Dias recentes, Principal, Fila e conexões' },
  { id: 'dia', nome: 'Dia de hoje', descricao: 'Os cards do dia, como no painel do Diário' },
  { id: 'principal', nome: 'Principal', descricao: 'Acervo e conhecimento canônico' },
]

function rotuloProvedor(id: ProvedorAgenteId): string {
  return id === '9router' ? '9Router' : 'Grok CLI'
}

function estadoProvedor(
  sondagem: SondagemProvedores | null,
  id: ProvedorAgenteId
): { classe: string; rotulo: string } {
  if (!sondagem) return { classe: 'desconhecido', rotulo: 'Verificando…' }
  const item = sondagem[id]
  if (!item) return { classe: 'desconhecido', rotulo: 'Sem leitura' }
  if (item.conectado) {
    return {
      classe: 'online',
      rotulo: item.modelos ? `Online · ${item.modelos} modelos` : 'Online',
    }
  }
  return { classe: 'offline', rotulo: 'Indisponível agora' }
}

export function CentralAgente() {
  const [config, setConfig] = useState<ConfiguracaoAgente | null>(null)
  const [sondagem, setSondagem] = useState<SondagemProvedores | null>(null)
  const [sondagemPronta, setSondagemPronta] = useState(false)
  const [providerSel, setProviderSel] = useState<ProvedorAgenteId>('grok-cli')
  const [perfilSel, setPerfilSel] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [escopoCtx, setEscopoCtx] = useState<EscopoAgente>('global')
  const [duravelCtx, setDuravelCtx] = useState(false)
  const [inspecao, setInspecao] = useState<InspecaoContextoAgente | null>(null)
  const [carregandoInspecao, setCarregandoInspecao] = useState(true)
  const [chatKey, setChatKey] = useState(0)
  const hoje = hojeLocal()

  useEffect(() => {
    let ativo = true
    configurarAgente()
      .then((dados) => {
        if (!ativo) return
        setConfig(dados)
        setProviderSel(dados.provider)
        setPerfilSel(dados.configuracaoPersistida?.perfilId || dados.perfilPadrao)
      })
      .catch((e) => ativo && setErro(`Não foi possível carregar o agente: ${String(e)}`))
    sondarProvedoresAgente()
      .then((dados) => ativo && setSondagem(dados))
      .catch(() => ativo && setSondagem(null))
      .finally(() => ativo && setSondagemPronta(true))
    return () => {
      ativo = false
    }
  }, [])

  async function carregarInspecao(escopo: EscopoAgente, duravel: boolean) {
    setCarregandoInspecao(true)
    try {
      const dados = await inspecionarContextoAgente({
        escopo,
        dia: escopo === 'dia' ? hoje : undefined,
        usarContextoDuravel: duravel,
      })
      setInspecao(dados)
      setErro('')
    } catch (e) {
      setErro(`Não foi possível inspecionar o contexto: ${String(e)}`)
    } finally {
      setCarregandoInspecao(false)
    }
  }

  useEffect(() => {
    void carregarInspecao(escopoCtx, duravelCtx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopoCtx, duravelCtx])

  const perfisDoProvedor = useMemo(
    () => config?.catalogos?.[providerSel] || [],
    [config, providerSel]
  )

  const familias = useMemo(() => {
    const grupos = new Map<string, typeof perfisDoProvedor>()
    for (const perfil of perfisDoProvedor) {
      const grupo = grupos.get(perfil.familia) || []
      grupo.push(perfil)
      grupos.set(perfil.familia, grupo)
    }
    return [...grupos]
  }, [perfisDoProvedor])

  function selecionarProvedor(id: ProvedorAgenteId) {
    setProviderSel(id)
    setAviso('')
    if (!config) return
    const catalogo = config.catalogos?.[id] || []
    const atual = config.configuracaoPersistida
    const preferido =
      id === config.provider
        ? atual?.perfilId || config.perfilPadrao
        : catalogo.find((perfil) => perfil.id === 'grok-4-6')?.id || catalogo[0]?.id || ''
    setPerfilSel(preferido)
  }

  const persistida = config?.configuracaoPersistida || null
  const sujo = Boolean(
    config && (persistida?.provider !== providerSel || (persistida?.perfilId || config.perfilPadrao) !== perfilSel)
  )

  async function salvar() {
    if (!perfilSel || salvando) return
    setSalvando(true)
    setErro('')
    setAviso('')
    try {
      const nova = await salvarConfiguracaoAgente({ provider: providerSel, perfilId: perfilSel })
      setConfig(nova)
      setAviso(`Configuração salva: ${rotuloProvedor(nova.provider)} · perfil padrão ${nova.perfilPadrao}. Vale para novas conversas e para os serviços internos.`)
      setChatKey((atual) => atual + 1)
      sondarProvedoresAgente().then(setSondagem).catch(() => {})
    } catch (e) {
      setErro(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setSalvando(false)
    }
  }

  const pronto = Boolean(config) && !carregandoInspecao && sondagemPronta

  return (
    <main className="central-agente" data-dailywork-ready={pronto ? 'true' : 'false'}>
      <div className="central-agente-inner">
        <header className="agente-page-header">
          <div>
            <p className="agente-eyebrow">Presença global</p>
            <h1>Agente</h1>
            <p className="agente-page-lede">
              Um cérebro só para o DailyWork: escolha o provedor e o modelo, veja exatamente o que
              ele enxerga e converse com a visão geral do app.
            </p>
          </div>
          <div className="agente-page-metric">
            <strong>{config ? rotuloProvedor(config.provider) : '…'}</strong>
            <span>{config?.conectado ? 'online' : 'verificando'}</span>
            <small>padrão: {config?.perfilPadrao || '…'}</small>
          </div>
        </header>

        {erro && <p className="agente-erro" role="alert">{erro}</p>}
        {aviso && <p className="agente-aviso" role="status">{aviso}</p>}

        <div className="agente-grade">
          <div className="agente-coluna">
            <section className="agente-secao" data-testid="agente-config" aria-labelledby="agente-config-titulo">
              <div className="agente-secao-heading">
                <div>
                  <h2 id="agente-config-titulo">Provedor e modelo</h2>
                  <p>Vale para o chat e para os serviços internos que não definem perfil próprio.</p>
                </div>
              </div>

              <div className="agente-provedores" role="radiogroup" aria-label="Provedor do agente">
                {(config?.provedores || [
                  { id: 'grok-cli' as const, nome: 'Grok CLI', selecionado: false },
                  { id: '9router' as const, nome: '9Router', selecionado: false },
                ]).map((provedor) => {
                  const estado = estadoProvedor(sondagem, provedor.id)
                  const selecionado = providerSel === provedor.id
                  return (
                    <button
                      key={provedor.id}
                      type="button"
                      role="radio"
                      aria-checked={selecionado}
                      data-testid={`agente-provedor-${provedor.id}`}
                      className={`agente-provedor ${selecionado ? 'agente-provedor--selecionado' : ''}`}
                      onClick={() => selecionarProvedor(provedor.id)}
                    >
                      <span className="agente-provedor-topo">
                        <strong>{provedor.nome}</strong>
                        <i className={`agente-dot agente-dot--${estado.classe}`} aria-hidden="true" />
                      </span>
                      <small>{estado.rotulo}</small>
                      <small className="agente-provedor-nota">
                        {provedor.id === 'grok-cli'
                          ? 'CLI local, sem custo por chamada'
                          : 'Gateway local com catálogo de modelos'}
                      </small>
                    </button>
                  )
                })}
              </div>

              <label className="agente-campo">
                <span>Modelo padrão</span>
                <select
                  data-testid="agente-modelo-global"
                  value={perfilSel}
                  disabled={!config || salvando}
                  onChange={(evento) => setPerfilSel(evento.target.value)}
                >
                  {!config && <option value="">Carregando perfis…</option>}
                  {familias.map(([familia, perfis]) => (
                    <optgroup label={familia} key={familia}>
                      {perfis.map((perfil) => (
                        <option value={perfil.id} key={perfil.id}>
                          {perfil.nome}
                          {config && providerSel === config.provider && perfil.catalogado === false
                            ? ' · rota não listada'
                            : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div className="agente-secao-footer">
                <small>
                  A produção editorial tem perfil próprio na Fila; o Sumário escolhe o perfil a cada
                  análise.
                </small>
                <button
                  type="button"
                  className="agente-botao agente-botao--acento"
                  data-testid="agente-salvar-config"
                  disabled={!config || !perfilSel || !sujo || salvando}
                  onClick={() => void salvar()}
                >
                  {salvando ? 'Salvando…' : 'Salvar configuração'}
                </button>
              </div>
            </section>

            <section className="agente-secao" data-testid="agente-contexto" aria-labelledby="agente-contexto-titulo">
              <div className="agente-secao-heading">
                <div>
                  <h2 id="agente-contexto-titulo">O que o agente enxerga</h2>
                  <p>O prompt exato que sai daqui, antes de qualquer resposta.</p>
                </div>
                <button
                  type="button"
                  className="agente-botao"
                  data-testid="agente-atualizar-contexto"
                  disabled={carregandoInspecao}
                  onClick={() => void carregarInspecao(escopoCtx, duravelCtx)}
                >
                  {carregandoInspecao ? 'Lendo…' : 'Reler contexto'}
                </button>
              </div>

              <div className="agente-escopos" role="tablist" aria-label="Escopo inspecionado">
                {ESCOPOS.map((escopo) => (
                  <button
                    key={escopo.id}
                    type="button"
                    role="tab"
                    aria-selected={escopoCtx === escopo.id}
                    data-testid={`agente-escopo-${escopo.id}`}
                    className={`agente-escopo ${escopoCtx === escopo.id ? 'agente-escopo--ativo' : ''}`}
                    onClick={() => setEscopoCtx(escopo.id)}
                  >
                    <strong>{escopo.nome}</strong>
                    <small>{escopo.descricao}</small>
                  </button>
                ))}
              </div>

              {escopoCtx === 'dia' && (
                <label className="agente-toggle">
                  <input
                    type="checkbox"
                    checked={duravelCtx}
                    onChange={(evento) => setDuravelCtx(evento.target.checked)}
                  />
                  <span>
                    <strong>Incluir contexto durável</strong>
                    <small>Orientação, práticas e projetos do Principal</small>
                  </span>
                </label>
              )}

              {inspecao && (
                <>
                  <ul className="agente-secoes">
                    {inspecao.secoes.map((secao) => (
                      <li key={secao.id} className="agente-secao-item">
                        <span className="agente-secao-qtd">{secao.quantidade}</span>
                        <div>
                          <strong>{secao.titulo}</strong>
                          {secao.detalhe && <small>{secao.detalhe}</small>}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="agente-ferramentas" aria-label="Ferramentas disponíveis neste escopo">
                    {inspecao.ferramentas.map((ferramenta) => (
                      <code key={ferramenta}>{ferramenta}</code>
                    ))}
                  </div>

                  <details className="agente-prompt">
                    <summary data-testid="agente-prompt-completo">
                      Prompt completo · {inspecao.caracteresPrompt.toLocaleString('pt-BR')} caracteres
                    </summary>
                    <pre>{inspecao.prompt}</pre>
                  </details>
                </>
              )}
            </section>
          </div>

          <section className="agente-chat" data-testid="agente-chat" aria-label="Conversa com o agente global">
            <AssistenteDia
              key={chatKey}
              escopo="global"
              embutido
              onBlocosAlterados={() => carregarInspecao(escopoCtx, duravelCtx)}
            />
          </section>
        </div>
      </div>
    </main>
  )
}
