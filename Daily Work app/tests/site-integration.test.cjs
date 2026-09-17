const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sitePublico = require('../src/lib/site-publico.json')
const { criarIntegracaoSite } = require('../electron/lib-site-integration.cjs')

const temporaryDirectories = []

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
})

function environment() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-site-integration-'))
  temporaryDirectories.push(rootDir)
  const userDataDir = path.join(rootDir, 'user-data')
  fs.mkdirSync(userDataDir, { recursive: true })
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
  }
  const projectionPath = path.join(rootDir, 'LucasOL site', 'src', 'data', 'public-projection.json')
  fs.mkdirSync(path.dirname(projectionPath), { recursive: true })
  fs.writeFileSync(projectionPath, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-08-20T12:00:00Z' }))
  return { rootDir, userDataDir, safeStorage }
}

test('stores the publication credential encrypted outside the renderer', async () => {
  const { rootDir, userDataDir, safeStorage } = environment()
  const integration = criarIntegracaoSite({ rootDir, userDataDir, safeStorage })

  const token = 'super-secret-token-with-32-bytes'
  const configuration = await integration.configurar({ token })

  assert.equal(configuration.configured, true)
  assert.equal(configuration.baseUrl, sitePublico.url)
  const persisted = fs.readFileSync(path.join(userDataDir, 'lucasol-site-integration.json'), 'utf8')
  assert.doesNotMatch(persisted, new RegExp(token))
})

test('publishes only after the prepared version is explicitly confirmed', async () => {
  const { rootDir, userDataDir, safeStorage } = environment()
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    if (!init.method || init.method === 'GET') {
      return Response.json({
        ok: false,
        error: { code: 'NO_ACTIVE_PROJECTION', message: 'Nenhuma projeção ativa.' },
      }, { status: 404 })
    }
    return Response.json({
      ok: true,
      data: { hash: 'a'.repeat(64), publishedAt: '2026-08-20T12:01:00Z', schemaVersion: 1 },
    }, { status: 201 })
  }
  const integration = criarIntegracaoSite({ rootDir, userDataDir, safeStorage, fetchImpl })
  await integration.configurar({ token: 'super-secret-token-with-32-bytes' })

  const proposal = await integration.prepararPublicacao()
  assert.equal(requests.filter((request) => request.init.method === 'POST').length, 0)
  assert.equal(proposal.changed, true)
  assert.equal(requests[0].url, `${sitePublico.url}/api/v1/snapshot`)

  const receipt = await integration.confirmarPublicacao({ proposalId: proposal.proposalId })
  const publishRequest = requests.find((request) => request.init.method === 'POST')
  assert.equal(receipt.hash, 'a'.repeat(64))
  assert.equal(publishRequest.url, `${sitePublico.url}/api/v1/snapshot`)
  assert.equal(publishRequest.init.headers.Authorization, 'Bearer super-secret-token-with-32-bytes')
})

test('reports an offline state without queueing a later publication', async () => {
  const { rootDir, userDataDir, safeStorage } = environment()
  const integration = criarIntegracaoSite({
    rootDir,
    userDataDir,
    safeStorage,
    fetchImpl: async () => { throw new Error('network unavailable') },
  })

  const status = await integration.status()

  assert.deepEqual(status, {
    configured: false,
    baseUrl: sitePublico.url,
    online: false,
    active: null,
    error: 'network unavailable',
  })
})

test('reads private aggregate metrics with the encrypted credential', async () => {
  const { rootDir, userDataDir, safeStorage } = environment()
  let authorization = null
  let metricsUrl = null
  const integration = criarIntegracaoSite({
    rootDir,
    userDataDir,
    safeStorage,
    fetchImpl: async (url, init) => {
      metricsUrl = String(url)
      authorization = init.headers.Authorization
      return Response.json({ ok: true, data: { days: 30, items: [{ name: 'page_view', count: 12 }] } })
    },
  })
  await integration.configurar({ token: 'super-secret-token-with-32-bytes' })

  const metrics = await integration.metricas()

  assert.equal(authorization, 'Bearer super-secret-token-with-32-bytes')
  assert.equal(metricsUrl, `${sitePublico.url}/api/v1/metrics/summary?days=30`)
  assert.equal(metrics.items[0].count, 12)
})
