const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')
const { criarServicoSumario } = require('../electron/lib-sumario-diario.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')
const { temporario, json, redeFalsa } = require('./integracoes-suporte.cjs')

const DIA = '2026-09-05'

test('conexões conectadas viram fontes do Sumário e as demais aparecem como não encontradas', async (t) => {
  const raiz = temporario(t)
  const dentro = new Date(janelaDoDia(DIA).inicioMs + 3600_000).toISOString()
  const rede = redeFalsa([
    { trecho: '/users/lucas/events', resposta: json([{ id: '1', type: 'PushEvent', created_at: dentro, repo: { name: 'lucas/dw' }, payload: { commits: [{ sha: 'abc', message: 'feat: sumário com github' }] } }]) },
    { trecho: 'api.github.com/user', resposta: json({ login: 'lucas', name: 'Lucas', html_url: 'u', avatar_url: 'a' }) },
  ])
  const registro = criarRegistroIntegracoes({ userDataDir: raiz, fetchImpl: rede.fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }) })
  const fontes = registro.fontesSumario()
  assert.deepEqual(fontes.map((fonte) => fonte.name), ['coletarGitHub', 'coletarX', 'coletarReddit'])

  const sumario = criarServicoSumario({
    appRoot: raiz,
    homeDir: path.join(raiz, 'home'),
    appDataDir: path.join(raiz, 'appdata'),
    localAppDataDir: path.join(raiz, 'local'),
    programDataDir: path.join(raiz, 'program'),
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [],
    fontesExtras: fontes,
  })
  const resultado = await sumario.coletar(DIA)
  const porId = new Map(resultado.coverage.map((fonte) => [fonte.id, fonte]))
  assert.equal(porId.get('github').status, 'complete')
  assert.equal(porId.get('github').messages, 1)
  assert.equal(porId.get('x').status, 'not_found')
  assert.equal(porId.get('reddit').status, 'not_found')

  const inputs = sumario.obterInputs(DIA)
  const doGithub = inputs.inputs.filter((item) => item.source === 'github')
  assert.equal(doGithub.length, 1)
  assert.match(doGithub[0].text, /feat: sumário com github/)
})

test('sinais são lidos uma vez por dia dentro da janela de cache', async (t) => {
  const raiz = temporario(t)
  let leituras = 0
  const rede = redeFalsa([
    { trecho: '/users/lucas/events', resposta: () => { leituras += 1; return json([]) } },
    { trecho: 'api.github.com/user', resposta: json({ login: 'lucas', name: 'Lucas', html_url: 'u', avatar_url: 'a' }) },
  ])
  const registro = criarRegistroIntegracoes({ userDataDir: raiz, fetchImpl: rede.fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }) })
  await registro.sinais('github', DIA)
  await registro.sinais('github', DIA)
  assert.equal(leituras, 1)
  await registro.sinais('github', DIA, { forcar: true })
  assert.equal(leituras, 2)
})
