const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { criarServicoSumario } = require('../electron/lib-sumario-diario.cjs')
const { coletarSussurro } = require('../electron/sumario/fontes/sussurro.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')

function temporario(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-sussurro-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  return raiz
}

function gravarHistorico(dir, linhas) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'history.jsonl'),
    linhas.map((linha) => (typeof linha === 'string' ? linha : JSON.stringify(linha))).join('\n') + '\n'
  )
  return dir
}

test('Sussurro incorpora só ditados concluídos do dia como fala da pessoa', async (t) => {
  const raiz = temporario(t)
  const historico = gravarHistorico(path.join(raiz, 'history'), [
    { ts: '2026-08-12T23:50:00', wav: '20260812_235000.wav', text: 'Ditado de ontem.', dur: 1.2, fix: 0 },
    { ts: '2026-08-13T09:10:00', wav: '20260813_091000.wav', text: 'Preciso validar o PDF hoje.', dur: 3.4, fix: 1 },
    { ts: '2026-08-13T09:11:00', wav: '20260813_091100.wav', text: '', dur: 0.4, fix: 0 },
    {
      ts: '2026-08-13T09:12:00',
      wav: '20260813_091200.wav',
      text: 'Falhou a primeira vez.',
      dur: 2.1,
      fix: 0,
      failed: true,
      error: 'Nenhuma fala reconhecida.',
    },
    { ts: '2026-08-13T09:12:00', wav: '20260813_091200.wav', text: 'Agora o ditado saiu certo.', dur: 2.8, fix: 2 },
    { ts: '2026-08-14T00:05:00', wav: '20260814_000500.wav', text: 'Ditado de amanhã.', dur: 1.1, fix: 0 },
    '{isto não é json',
  ])

  const resultado = await coletarSussurro({
    homeDir: path.join(raiz, 'home'),
    appRoot: path.join(raiz, 'app'),
    sussurroHistoryDir: historico,
    janela: janelaDoDia('2026-08-13'),
  })

  assert.equal(resultado.coverage.id, 'sussurro')
  assert.equal(resultado.coverage.label, 'Sussurro')
  assert.equal(resultado.coverage.discovered, true)
  assert.equal(resultado.coverage.status, 'partial')
  assert.equal(resultado.coverage.files, 1)
  assert.equal(resultado.coverage.conversations, 1)
  assert.equal(resultado.coverage.messages, 2)
  assert.deepEqual(resultado.coverage.errors, ['history.jsonl: 1 linha(s) inválida(s)'])
  assert.deepEqual(
    resultado.conversations.flatMap((conversa) => conversa.messages).map((mensagem) => ({
      role: mensagem.role,
      kind: mensagem.kind,
      text: mensagem.text,
    })),
    [
      { role: 'user', kind: 'message', text: 'Preciso validar o PDF hoje.' },
      { role: 'user', kind: 'message', text: 'Agora o ditado saiu certo.' },
    ]
  )
})

test('Sussurro fica ausente quando o histórico local não existe', async (t) => {
  const raiz = temporario(t)
  const resultado = await coletarSussurro({
    homeDir: path.join(raiz, 'home'),
    appRoot: path.join(raiz, 'app'),
    janela: janelaDoDia('2026-08-13'),
  })
  assert.deepEqual(resultado, {
    conversations: [],
    coverage: {
      id: 'sussurro',
      label: 'Sussurro',
      discovered: false,
      status: 'not_found',
      files: 0,
      records: 0,
      conversations: 0,
      messages: 0,
      errors: [],
      notes: ['Ditados locais do history.jsonl; só transcrições concluídas entram como fala da pessoa.'],
    },
  })
})

test('serviço diário projeta ditados do Sussurro como inputs da pessoa', async (t) => {
  const raiz = temporario(t)
  const historico = gravarHistorico(path.join(raiz, 'home', 'Projects', 'sussurro', 'history'), [
    { ts: '2026-08-13T10:15:00', wav: '20260813_101500.wav', text: 'Abra o Sumário diário.', dur: 2.2, fix: 0 },
  ])

  const servico = criarServicoSumario({
    appRoot: path.join(raiz, 'app'),
    homeDir: path.join(raiz, 'home'),
    appDataDir: path.join(raiz, 'appdata'),
    localAppDataDir: path.join(raiz, 'local'),
    programDataDir: path.join(raiz, 'program'),
    outputDir: path.join(raiz, 'sumarios'),
    whatsappExportDir: path.join(raiz, 'whatsapp'),
    sussurroHistoryDir: historico,
    now: () => new Date(2026, 7, 13, 18, 0, 0),
  })

  await servico.coletar('2026-08-13')
  const artefato = servico.lerArtefato('2026-08-13')
  const inputs = servico.obterInputs('2026-08-13')
  const cobertura = artefato.coverage.find((fonte) => fonte.id === 'sussurro')

  assert.equal(cobertura.status, 'complete')
  assert.equal(artefato.stats.userMessages, 1)
  assert.equal(inputs.inputs.length, 1)
  assert.equal(inputs.inputs[0].source, 'sussurro')
  assert.equal(inputs.inputs[0].app, 'Sussurro')
  assert.equal(inputs.inputs[0].text, 'Abra o Sumário diário.')
})
