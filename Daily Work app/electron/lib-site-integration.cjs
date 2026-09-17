const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const path = require('node:path')
const stringify = require('fast-json-stable-stringify')
const sitePublico = require('../src/lib/site-publico.json')

const SITE_URL = sitePublico.url

function criarIntegracaoSite({ rootDir, userDataDir, safeStorage, fetchImpl = fetch, now = () => new Date() }) {
  if (!rootDir || !userDataDir || !safeStorage) throw new Error('integração do site sem dependências obrigatórias')

  const configurationPath = path.join(userDataDir, 'lucasol-site-integration.json')
  const projectionPath = path.join(rootDir, 'LucasOL site', 'src', 'data', 'public-projection.json')
  const auditPath = path.join(rootDir, 'Daily Work app', 'data', '_log.ndjson')
  const pending = new Map()

  async function readConfiguration() {
    try {
      return JSON.parse(await fs.readFile(configurationPath, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async function configuracao() {
    const persisted = await readConfiguration()
    return { configured: Boolean(persisted?.encryptedToken), baseUrl: SITE_URL }
  }

  async function configurar({ token }) {
    if (typeof token !== 'string' || token.trim().length < 24) {
      throw new Error('token de publicação precisa ter pelo menos 24 caracteres')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('criptografia segura do sistema indisponível')
    }

    const encryptedToken = safeStorage.encryptString(token.trim()).toString('base64')
    await fs.mkdir(userDataDir, { recursive: true })
    const temporaryPath = `${configurationPath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify({ encryptedToken })}\n`, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporaryPath, configurationPath)
    return configuracao()
  }

  async function token() {
    const persisted = await readConfiguration()
    if (!persisted?.encryptedToken) throw new Error(`integração com ${sitePublico.host} ainda não configurada`)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('criptografia segura do sistema indisponível')
    return safeStorage.decryptString(Buffer.from(persisted.encryptedToken, 'base64'))
  }

  async function localProjection() {
    const raw = await fs.readFile(projectionPath, 'utf8')
    const projection = JSON.parse(raw)
    const hash = crypto.createHash('sha256').update(stringify(projection)).digest('hex')
    return { projection, hash }
  }

  async function activeRelease() {
    const response = await fetchImpl(`${SITE_URL}/api/v1/snapshot`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404) return null
    const body = await response.json()
    if (!response.ok || !body?.ok) throw new Error(body?.error?.message || `${sitePublico.host} respondeu ${response.status}`)
    return body.data
  }

  async function prepararPublicacao() {
    const local = await localProjection()
    const remote = await activeRelease()
    const proposalId = crypto.randomUUID()
    const expiresAt = now().getTime() + 10 * 60 * 1000
    pending.set(proposalId, { ...local, remoteHash: remote?.hash || null, expiresAt })
    return {
      proposalId,
      localHash: local.hash,
      remoteHash: remote?.hash || null,
      remotePublishedAt: remote?.publishedAt || null,
      generatedAt: local.projection.generatedAt,
      schemaVersion: local.projection.schemaVersion,
      changed: local.hash !== remote?.hash,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async function status() {
    const currentConfiguration = await configuracao()
    try {
      return {
        ...currentConfiguration,
        online: true,
        active: await activeRelease(),
        error: null,
      }
    } catch (error) {
      return {
        ...currentConfiguration,
        online: false,
        active: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async function metricas() {
    const credential = await token()
    const response = await fetchImpl(`${SITE_URL}/api/v1/metrics/summary?days=30`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(8000),
    })
    const body = await response.json()
    if (!response.ok || !body?.ok) throw new Error(body?.error?.message || `métricas falharam com ${response.status}`)
    return body.data
  }

  async function confirmarPublicacao({ proposalId }) {
    const proposal = pending.get(proposalId)
    if (!proposal) throw new Error('proposta de publicação inexistente ou já consumida')
    if (now().getTime() > proposal.expiresAt) {
      pending.delete(proposalId)
      throw new Error('proposta de publicação expirada; prepare novamente')
    }

    const currentLocal = await localProjection()
    if (currentLocal.hash !== proposal.hash) throw new Error('projeção local mudou; prepare novamente')
    const currentRemote = await activeRelease()
    if ((currentRemote?.hash || null) !== proposal.remoteHash) throw new Error('versão publicada mudou; prepare novamente')

    const credential = await token()
    const response = await fetchImpl(`${SITE_URL}/api/v1/snapshot`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(proposal.projection),
      signal: AbortSignal.timeout(8000),
    })
    const body = await response.json()
    if (!response.ok || !body?.ok) throw new Error(body?.error?.message || `publicação falhou com ${response.status}`)

    pending.delete(proposalId)
    await fs.mkdir(path.dirname(auditPath), { recursive: true })
    await fs.appendFile(auditPath, `${JSON.stringify({
      ts: now().toISOString(),
      acao: 'site:publicar',
      hash: body.data.hash,
      previousHash: proposal.remoteHash,
    })}\n`, 'utf8')
    return body.data
  }

  return { configuracao, configurar, status, metricas, prepararPublicacao, confirmarPublicacao }
}

module.exports = { criarIntegracaoSite }
