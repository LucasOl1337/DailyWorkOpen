const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { criarServicoSkills, criarMiddlewareSkills } = require('../electron/lib-skills.cjs')

function dirTemporario(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-skills-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function escreverSkill(raiz, nome, descricao) {
  const dir = path.join(raiz, nome)
  fs.mkdirSync(dir, { recursive: true })
  const arquivo = path.join(dir, 'SKILL.md')
  fs.writeFileSync(arquivo, `---\nname: ${nome}\ndescription: ${descricao}\n---\n\n# ${nome}\n`)
  return arquivo
}

const AGORA = new Date('2026-09-15T12:00:00')

function servicoFixture(t, { catalogar, buscarEventos, lerArquivo } = {}) {
  return criarServicoSkills({
    homeDir: dirTemporario(t),
    agora: () => AGORA,
    catalogar,
    buscarEventos,
    lerArquivo,
  })
}

test('catalogo padrao com fallback varre roots e le proposito do frontmatter', async (t) => {
  const home = dirTemporario(t)
  escreverSkill(path.join(home, '.agents/skills'), 'alpha', 'Faz coisas alpha.')
  escreverSkill(path.join(home, '.hermes/skills'), 'beta', 'Skill nativa do hermes.')
  escreverSkill(path.join(home, '.codex/skills/.system'), 'gama', 'Skill do codex.')
  escreverSkill(path.join(home, '.agents/skills/.backup'), 'lixo', 'Nao deve entrar.')
  const servico = criarServicoSkills({
    homeDir: home,
    agora: () => AGORA,
    buscarEventos: async () => [],
  })
  const d = await servico.dashboard({ dias: 7 })
  const nomes = d.skills.map((s) => s.nome).sort()
  assert.deepEqual(nomes, ['alpha', 'beta', 'gama'])
  const alpha = d.skills.find((s) => s.nome === 'alpha')
  assert.equal(alpha.proposito, 'Faz coisas alpha.')
  assert.equal(alpha.origem, 'shared')
  assert.equal(alpha.origemRotulo, 'Compartilhada')
  assert.equal(alpha.catalogada, true)
  assert.equal(d.skills.find((s) => s.nome === 'beta').origem, 'hermes-native')
  assert.equal(d.skills.find((s) => s.nome === 'gama').origem, 'codex-native')
  assert.equal(d.resumo.inventario, 3)
  assert.equal(d.periodo.dias, 7)
})

test('catalogar injetado fornece origem e caminho; frontmatter vem de lerArquivo', async (t) => {
  const servico = servicoFixture(t, {
    catalogar: async () => [{ name: 'alpha', origin: 'shared', path: '/x/alpha/SKILL.md', sha256: 'a' }],
    buscarEventos: async () => [],
    lerArquivo: async (c) => (c === '/x/alpha/SKILL.md' ? '---\nname: alpha\ndescription: Propósito alpha.\n---\n' : null),
  })
  const d = await servico.dashboard({ dias: 7 })
  assert.equal(d.skills[0].proposito, 'Propósito alpha.')
  assert.equal(d.skills[0].caminho, '/x/alpha/SKILL.md')
})

test('frontmatter dobrado com description: > junta as linhas', async (t) => {
  const servico = servicoFixture(t, {
    catalogar: async () => [{ name: 'dobrada', origin: 'shared', path: '/x/dobrada/SKILL.md', sha256: 'd' }],
    buscarEventos: async () => [],
    lerArquivo: async () => '---\nname: dobrada\ndescription: >\n  Primeira parte do propósito\n  e a continuação dobrada.\n---\n',
  })
  const d = await servico.dashboard({ dias: 7 })
  assert.equal(d.skills[0].proposito, 'Primeira parte do propósito e a continuação dobrada.')
})

function linhaClaude(skill, timestamp, model = 'claude-sonnet') {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { model, content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] },
  })
}

function linhaCodex(nome, timestamp) {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<skill>\n<name>${nome}</name>\n<path>/x/${nome}/SKILL.md</path>` }] },
  })
}

test('eventos Claude, Codex, Devin e Hermes alimentam periodo, conhecidos, serie e cruzamentos', async (t) => {
  const home = dirTemporario(t)
  const usage = { alpha: { use_count: 5, last_used_at: '2026-09-14T10:00:00Z' }, beta: { use_count: 0 }, quebrada: { use_count: 2, last_used_at: 'invalida' } }
  fs.mkdirSync(path.join(home, '.hermes/skills'), { recursive: true })
  fs.writeFileSync(path.join(home, '.hermes/skills/.usage.json'), JSON.stringify(usage))
  fs.mkdirSync(path.join(home, '.hermes/logs'), { recursive: true })
  fs.writeFileSync(
    path.join(home, '.hermes/logs/agent.log'),
    '2026-09-14 08:00:00,000 INFO [x] agent.tool_executor: tool skill_view completed (0.1s, 10 chars)\n' +
      '2026-09-15 09:00:00,000 INFO [x] agent.tool_executor: tool skill_view completed (0.1s, 10 chars)\n'
  )
  fs.mkdirSync(path.join(home, '.local/share/devin/cli'), { recursive: true })
  fs.writeFileSync(
    path.join(home, '.local/share/devin/cli/skill_events_spool.jsonl'),
    JSON.stringify({ event_kind: 'activated', skill_name: 'gama', occurred_at: '2026-09-15T10:00:00Z' }) + '\n'
  )
  const linhas = {
    claude: [linhaClaude('alpha', '2026-09-14T11:00:00Z')],
    codex: [linhaCodex('alpha', '2026-09-15T08:00:00Z'), JSON.stringify({ timestamp: '2026-09-15T08:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[$alpha](/x/alpha/SKILL.md)' }] } })],
  }
  const servico = criarServicoSkills({
    homeDir: home,
    agora: () => AGORA,
    catalogar: async () => [
      { name: 'alpha', origin: 'shared', path: null, sha256: 'a' },
      { name: 'beta', origin: 'hermes-native', path: null, sha256: 'b' },
      { name: 'gama', origin: 'codex-native', path: null, sha256: 'c' },
    ],
    buscarEventos: async (tipo) => linhas[tipo] || [],
  })
  const d = await servico.dashboard({ dias: 7 })
  const alpha = d.skills.find((s) => s.nome === 'alpha')
  assert.equal(alpha.usosPeriodo, 2)
  assert.equal(alpha.usosConhecidos, 7)
  assert.equal(alpha.diasAtivos, 2)
  assert.equal(alpha.ultimoUso, '2026-09-15T08:00:00.000Z')
  const gama = d.skills.find((s) => s.nome === 'gama')
  assert.equal(gama.usosPeriodo, 1)
  assert.equal(gama.usosConhecidos, 1)
  assert.equal(d.resumo.usosPeriodo, 5)
  assert.equal(d.resumo.usosConhecidos, 10)
  assert.equal(d.resumo.usadas, 3)
  const quebrada = d.skills.find((s) => s.nome === 'quebrada')
  assert.equal(quebrada.catalogada, false)
  assert.equal(quebrada.usosConhecidos, 2)
  assert.equal(quebrada.ultimoUso, null)
  assert.ok(d.cruzamentos.some((c) => c.skill === 'quebrada' && c.cobertura === 'agregado' && c.usos === 2 && c.ultimoUso === null))
  const dia14 = d.serieDiaria.find((s) => s.dia === '2026-09-14')
  assert.equal(dia14.total, 2)
  assert.equal(dia14.porHarness['Claude Code'], 1)
  assert.equal(dia14.porHarness['Hermes'], 1)
  assert.equal(d.serieDiaria.length, 7)
  assert.equal(d.serieDiaria[6].dia, '2026-09-15')
  const cruzamentos = d.cruzamentos.filter((c) => c.skill === 'alpha')
  assert.ok(cruzamentos.some((c) => c.harness === 'Claude Code' && c.agente === 'claude-sonnet' && c.usos === 1 && c.cobertura === 'evento'))
  assert.ok(cruzamentos.some((c) => c.harness === 'Codex' && c.agente === 'Codex' && c.usos === 1))
  assert.ok(cruzamentos.some((c) => c.harness === 'Hermes' && c.cobertura === 'agregado' && c.usos === 5))
  const hermes = d.harnesses.find((h) => h.nome === 'Hermes')
  assert.equal(hermes.usosPeriodo, 2)
  assert.equal(hermes.usosConhecidos, 7)
  assert.ok(hermes.agentes.includes('Hermes Agent'))
})

test('evento fora do periodo, skill observada e fonte ausente nao derrubam', async (t) => {
  const home = dirTemporario(t)
  const servico = criarServicoSkills({
    homeDir: home,
    agora: () => AGORA,
    catalogar: async () => [{ name: 'alpha', origin: 'shared', path: null, sha256: 'a' }],
    buscarEventos: async (tipo) =>
      tipo === 'claude'
        ? [linhaClaude('alpha', '2026-01-01T00:00:00Z'), linhaClaude('fora-do-catalogo', '2026-09-15T07:00:00Z')]
        : [],
  })
  const d = await servico.dashboard({ dias: 7 })
  const alpha = d.skills.find((s) => s.nome === 'alpha')
  assert.equal(alpha.usosPeriodo, 0)
  assert.equal(alpha.usosConhecidos, 1)
  const observada = d.skills.find((s) => s.nome === 'fora-do-catalogo')
  assert.equal(observada.catalogada, false)
  assert.equal(observada.origem, 'observada')
  assert.equal(observada.origemRotulo, 'Observada nos logs')
  assert.ok(observada.proposito.length > 0)
  assert.equal(d.resumo.origens, 1)
  assert.ok(d.fontes.length >= 3)
  assert.ok(d.fontes.some((f) => f.status !== 'ok'))
  assert.ok(d.alertas.length > 0)
  assert.equal(d.serieDiaria.reduce((s, dia) => s + dia.total, 0), 1)
})

test('nome duplicado associa primeiro a origem shared', async (t) => {
  const servico = servicoFixture(t, {
    catalogar: async () => [
      { name: 'dup', origin: 'codex-native', path: null, sha256: '1' },
      { name: 'dup', origin: 'shared', path: null, sha256: '2' },
    ],
    buscarEventos: async (tipo) => (tipo === 'claude' ? [linhaClaude('dup', '2026-09-15T07:00:00Z')] : []),
    lerArquivo: async () => null,
  })
  const d = await servico.dashboard({ dias: 7 })
  const shared = d.skills.filter((s) => s.nome === 'dup')
  assert.equal(shared.find((s) => s.origem === 'shared').usosPeriodo, 1)
  assert.equal(shared.find((s) => s.origem === 'codex-native').usosPeriodo, 0)
})

test('middleware serve so GET /dashboard local com envelope', async (t) => {
  const servico = servicoFixture(t, {
    catalogar: async () => [],
    buscarEventos: async () => [],
    lerArquivo: async () => null,
  })
  const middleware = criarMiddlewareSkills(servico)
  const server = http.createServer((req, res) => {
    req.url = req.url.replace(/^\/api\/skills/, '') || '/'
    middleware(req, res, () => {
      res.statusCode = 404
      res.end('fora')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    server.closeAllConnections()
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const local = { Host: `127.0.0.1:${server.address().port}` }
  const get = await fetch(`${base}/api/skills/dashboard?dias=7`, { headers: local })
  assert.equal(get.status, 200)
  assert.equal(get.headers.get('cache-control'), 'no-store')
  const corpo = await get.json()
  assert.equal(corpo.ok, true)
  assert.equal(corpo.data.periodo.dias, 7)
  const post = await fetch(`${base}/api/skills/dashboard`, { method: 'POST', headers: local })
  assert.equal(post.status, 405)
  assert.equal((await post.json()).ok, false)
  const remota = await fetch(`${base}/api/skills/dashboard`, { headers: { ...local, Origin: 'https://evil.example' } })
  assert.equal(remota.status, 403)
  const outra = await fetch(`${base}/api/skills/outra`, { headers: local })
  assert.equal(outra.status, 404)
})
