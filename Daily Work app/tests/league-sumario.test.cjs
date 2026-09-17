const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { criarServicoSumario } = require('../electron/lib-sumario-diario.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')

function criarFixtureLeague(raiz, sessoes) {
  const programDataDir = path.join(raiz, 'ProgramData')
  const installDir = path.join(raiz, 'League of Legends')
  const metadataDir = path.join(programDataDir, 'Riot Games', 'Metadata', 'league_of_legends.live')
  const gameLogsDir = path.join(installDir, 'Logs', 'GameLogs')
  fs.mkdirSync(metadataDir, { recursive: true })
  fs.mkdirSync(gameLogsDir, { recursive: true })
  fs.writeFileSync(
    path.join(metadataDir, 'league_of_legends.live.product_settings.yaml'),
    `product_install_full_path: "${installDir.replaceAll('\\', '/')}"\n`,
    'utf8'
  )
  for (const sessao of sessoes) {
    const sessionDir = path.join(gameLogsDir, sessao)
    fs.mkdirSync(sessionDir)
    fs.writeFileSync(path.join(sessionDir, `${sessao}_r3dlog.txt`), 'evidência local da partida\n', 'utf8')
  }
  return programDataDir
}

test('League registra partidas como contexto sem inventar inputs da pessoa', async (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-league-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))

  const programDataDir = criarFixtureLeague(raiz, [
    '2026-08-07T23-59-59',
    '2026-08-08T10-15-30',
    '2026-08-08T23-55-00',
  ])

  const { coletarLeague } = require('../electron/sumario/fontes/league-of-legends.cjs')
  const resultado = await coletarLeague({
    programDataDir,
    janela: janelaDoDia('2026-08-08'),
  })

  assert.deepEqual(resultado.coverage, {
    id: 'league-of-legends',
    label: 'League of Legends',
    discovered: true,
    status: 'complete',
    files: 2,
    records: 2,
    conversations: 2,
    messages: 2,
    errors: [],
    notes: [
      'Partidas comprovadas pelos GameLogs locais; os logs não comprovam o texto digitado no chat.',
    ],
  })
  assert.deepEqual(resultado.conversations.map((conversa) => conversa.title), [
    'Partida às 10:15',
    'Partida às 23:55',
  ])
  assert.deepEqual(resultado.conversations.flatMap((conversa) => conversa.messages).map((mensagem) => ({
    role: mensagem.role,
    kind: mensagem.kind,
    timestamp: mensagem.timestamp,
  })), [
    {
      role: 'tool',
      kind: 'tool_activity',
      timestamp: new Date(2026, 7, 8, 10, 15, 30).toISOString(),
    },
    {
      role: 'tool',
      kind: 'tool_activity',
      timestamp: new Date(2026, 7, 8, 23, 55, 0).toISOString(),
    },
  ])
  assert.equal(resultado.conversations.some((conversa) => (
    conversa.messages.some((mensagem) => mensagem.role === 'user')
  )), false)
})

test('serviço diário inclui League na cobertura sem projetar partida como input', async (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-league-service-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))

  const programDataDir = criarFixtureLeague(raiz, ['2026-08-08T10-15-30'])

  const servico = criarServicoSumario({
    appRoot: raiz,
    homeDir: path.join(raiz, 'home'),
    appDataDir: path.join(raiz, 'AppData', 'Roaming'),
    localAppDataDir: path.join(raiz, 'AppData', 'Local'),
    programDataDir,
    outputDir: path.join(raiz, 'sumarios'),
    whatsappExportDir: path.join(raiz, 'whatsapp'),
    now: () => new Date('2026-08-09T02:00:00.000Z'),
  })

  await servico.coletar('2026-08-08')
  const artefato = servico.lerArtefato('2026-08-08')
  const inputs = servico.obterInputs('2026-08-08')
  const coberturaLeague = artefato.coverage.find((fonte) => fonte.id === 'league-of-legends')
  const inputsLeague = inputs.sources.find((fonte) => fonte.id === 'league-of-legends')

  assert.equal(artefato.stats.userMessages, 0)
  assert.equal(artefato.stats.toolEvents, 1)
  assert.deepEqual(coberturaLeague, {
    id: 'league-of-legends',
    label: 'League of Legends',
    discovered: true,
    status: 'complete',
    files: 1,
    records: 1,
    conversations: 1,
    messages: 1,
    errors: [],
    notes: [
      'Partidas comprovadas pelos GameLogs locais; os logs não comprovam o texto digitado no chat.',
    ],
  })
  assert.deepEqual(inputsLeague, {
    id: 'league-of-legends',
    label: 'League of Legends',
    status: 'complete',
    conversations: 1,
    messages: 1,
    errorCount: 0,
    inputCount: 0,
  })
  assert.equal(inputs.stats.inputs, 0)
})
