import { useEffect, useState } from 'react'
import {
  configurarSite,
  confirmarPublicacaoSite,
  obterMetricasSite,
  obterStatusSite,
  prepararPublicacaoSite,
  type SiteMetrics,
  type SitePublicationProposal,
  type SiteStatus,
} from '../lib/api'
import sitePublico from '../lib/site-publico.json'
import './site-lucasol.css'

const SITE_URL = `${sitePublico.url}/`

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

function SyncIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 5.7A5.5 5.5 0 0 0 3.6 4M2.8 1.8V4h2.3M2.8 10.3a5.5 5.5 0 0 0 9.6 1.7M13.2 14.2V12h-2.3" />
    </svg>
  )
}

function shortHash(hash: string | null | undefined) {
  return hash ? hash.slice(0, 10) : 'nenhuma'
}

export function SiteLucasOL() {
  const [carregando, setCarregando] = useState(true)
  const [revisao, setRevisao] = useState(0)
  const [painelAberto, setPainelAberto] = useState(
    () => new URLSearchParams(window.location.search).get('integracao') === 'open'
  )
  const [status, setStatus] = useState<SiteStatus | null>(null)
  const [metricas, setMetricas] = useState<SiteMetrics | null>(null)
  const [proposta, setProposta] = useState<SitePublicationProposal | null>(null)
  const [token, setToken] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [recibo, setRecibo] = useState('')

  async function atualizarIntegracao() {
    try {
      const atual = await obterStatusSite()
      setStatus(atual)
      setErro('')
      if (atual.configured && atual.online) {
        setMetricas(await obterMetricasSite())
      } else {
        setMetricas(null)
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    void atualizarIntegracao()
  }, [])

  function recarregar() {
    setCarregando(true)
    setRevisao((atual) => atual + 1)
  }

  function abrirExternamente() {
    window.open(SITE_URL, '_blank', 'noopener,noreferrer')
  }

  async function salvarToken() {
    setOcupado(true)
    try {
      await configurarSite(token)
      setToken('')
      setRecibo('Integração configurada com armazenamento seguro do sistema.')
      await atualizarIntegracao()
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error))
    } finally {
      setOcupado(false)
    }
  }

  async function preparar() {
    setOcupado(true)
    try {
      setProposta(await prepararPublicacaoSite())
      setRecibo('')
      setErro('')
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error))
    } finally {
      setOcupado(false)
    }
  }

  async function confirmar() {
    if (!proposta) return
    setOcupado(true)
    try {
      const publicado = await confirmarPublicacaoSite(proposta.proposalId)
      setProposta(null)
      setRecibo(`Versão ${shortHash(publicado.hash)} publicada e auditada.`)
      await atualizarIntegracao()
      recarregar()
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="site-lucasol" data-dailywork-ready={carregando ? 'false' : 'true'} aria-label={`Site ${sitePublico.host}`}>
      <header className="site-lucasol-toolbar">
        <div className="site-lucasol-identity">
          <span className="site-lucasol-mark" aria-hidden="true">OL</span>
          <span>
            <strong>OL.CC</strong>
            <small>{sitePublico.host}</small>
          </span>
        </div>

        <div className={`site-lucasol-environment ${carregando ? 'is-loading' : 'is-online'}`} aria-label="Estado do site">
          <span aria-hidden="true" />
          {carregando ? 'Carregando site' : 'Site online'}
        </div>

        <div className="site-lucasol-actions">
          <button type="button" onClick={() => setPainelAberto((aberto) => !aberto)} aria-expanded={painelAberto} title={`Abrir integração com ${sitePublico.host}`}>
            <SyncIcon />
            <span>Integração</span>
          </button>
          <button type="button" onClick={recarregar} title={`Recarregar ${sitePublico.host}`}>
            <ReloadIcon />
            <span>Recarregar</span>
          </button>
          <button type="button" onClick={abrirExternamente} title={`Abrir ${sitePublico.host} no navegador`}>
            <ExternalIcon />
            <span>Abrir no navegador</span>
          </button>
        </div>
      </header>

      <div className="site-lucasol-frame">
        {carregando && (
          <div className="site-lucasol-loading" role="status">
            <span aria-hidden="true" />
            Carregando {sitePublico.host}…
          </div>
        )}
        <iframe
          key={revisao}
          src={SITE_URL}
          title={sitePublico.host}
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => window.setTimeout(() => setCarregando(false), 1800)}
        />
        {painelAberto && (
          <aside className="site-integration-panel" aria-label={`Integração com ${sitePublico.host}`}>
            <header>
              <div>
                <small>DailyWork ↔ {sitePublico.host}</small>
                <h2>Publicação controlada</h2>
              </div>
              <button type="button" onClick={() => setPainelAberto(false)} aria-label="Fechar integração">×</button>
            </header>

            <div className="site-integration-status">
              <span className={status?.online ? 'is-online' : 'is-pending'} />
              <div>
                <strong>
                  {status?.online
                    ? 'Sincronização disponível'
                    : status?.configured
                      ? 'Endpoint ainda não publicado'
                      : 'Publicação não conectada'}
                </strong>
                <small>
                  {status?.active
                    ? `Versão ${shortHash(status.active.hash)}`
                    : 'O site abre normalmente; falta ativar /api/v1 no Cloudflare.'}
                </small>
              </div>
            </div>

            {erro && <p className="site-integration-message is-error">{erro}</p>}
            {recibo && <p className="site-integration-message is-success">{recibo}</p>}

            {status && !status.configured && (
              <section className="site-integration-section">
                <h3>Conectar publicação</h3>
                <p>O token será criptografado com a proteção nativa do sistema e não será enviado ao site incorporado.</p>
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Token de publicação"
                  aria-label={`Token de publicação do ${sitePublico.host}`}
                  autoComplete="off"
                />
                <button type="button" className="site-integration-primary" disabled={ocupado || token.trim().length < 24} onClick={() => void salvarToken()}>
                  Salvar com segurança
                </button>
              </section>
            )}

            {status?.configured && (
              <>
                <section className="site-integration-section">
                  <div className="site-integration-section-heading">
                    <h3>Projeção pública</h3>
                    <span>schema v{proposta?.schemaVersion ?? status.active?.schemaVersion ?? 1}</span>
                  </div>
                  <dl>
                    <div><dt>Local</dt><dd>{shortHash(proposta?.localHash)}</dd></div>
                    <div><dt>Publicada</dt><dd>{shortHash(proposta?.remoteHash ?? status.active?.hash)}</dd></div>
                  </dl>
                  {!proposta ? (
                    <button type="button" className="site-integration-primary" disabled={ocupado || !status.online} onClick={() => void preparar()}>
                      Preparar atualização
                    </button>
                  ) : proposta.changed ? (
                    <div className="site-integration-confirm">
                      <p>A versão local é diferente da produção. Confirme para publicar este hash.</p>
                      <button type="button" className="site-integration-primary" disabled={ocupado} onClick={() => void confirmar()}>
                        Confirmar publicação
                      </button>
                      <button type="button" disabled={ocupado} onClick={() => setProposta(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <p className="site-integration-up-to-date">A produção já corresponde à projeção local.</p>
                  )}
                </section>

                <section className="site-integration-section">
                  <div className="site-integration-section-heading">
                    <h3>Métricas agregadas</h3>
                    <span>{metricas?.days ?? 30} dias</span>
                  </div>
                  <p className="site-integration-metric">
                    <strong>{metricas?.items.reduce((total, item) => total + item.count, 0) ?? 0}</strong>
                    <span>eventos anônimos</span>
                  </p>
                </section>
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}
