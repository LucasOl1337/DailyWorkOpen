// O dia do sumário é local e as fixtures usam -03:00: fixa o fuso para o
// resultado não depender da máquina (o CI roda em UTC).
process.env.TZ = 'America/Sao_Paulo'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { criarServicoSumario } = require('../electron/lib-sumario-diario.cjs')
const { coletarWhatsApp } = require('../electron/sumario/fontes/whatsapp.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')

function temporario(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-whatsapp-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  return raiz
}

function gravarJson(arquivo, valor) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  fs.writeFileSync(arquivo, `${JSON.stringify(valor, null, 2)}\n`)
}

function criarExecucao(raiz, nome, {
  version = 2,
  status = 'complete',
  messages = [],
  completedAt = '2026-08-13T12:00:00-03:00',
} = {}) {
  const runDir = path.join(raiz, nome)
  fs.mkdirSync(runDir, { recursive: true })
  for (const mensagem of messages) {
    for (const campo of ['media_file', 'audio_file', 'transcript_file']) {
      const referencia = mensagem[campo]
      if (!referencia || path.isAbsolute(referencia) || referencia.split(/[\\/]/).includes('..')) continue
      const arquivo = path.join(runDir, referencia)
      fs.mkdirSync(path.dirname(arquivo), { recursive: true })
      fs.writeFileSync(arquivo, `fixture ${mensagem.id} ${campo}`)
    }
  }
  const janela = {
    window_hours: 48,
    window_start: '2026-08-12T00:00:00-03:00',
    window_end: '2026-08-14T00:00:00-03:00',
  }
  gravarJson(path.join(runDir, 'manifest.json'), {
    version,
    contact: 'Contato de teste',
    timezone: 'America/Sao_Paulo',
    ...janela,
    created_at: '2026-08-12T00:00:00-03:00',
    source: 'WhatsApp Web',
    status,
    ...(status === 'complete' ? {
      completed_at: completedAt,
      counts: {
        messages: messages.length,
        audios: messages.filter((mensagem) => mensagem.type === 'audio').length,
      },
    } : {}),
  })
  gravarJson(path.join(runDir, 'messages.json'), {
    version,
    contact: 'Contato de teste',
    ...janela,
    messages,
  })
  fs.writeFileSync(path.join(runDir, 'log.md'), '# Log validado\n')
  fs.writeFileSync(path.join(runDir, 'relatorio-dev.md'), '# Relatório validado\n')
  return runDir
}

test('WhatsApp incorpora só mensagens enviadas e deduplica extrações sobrepostas', async (t) => {
  const raiz = temporario(t)
  const exportDir = path.join(raiz, 'exports')
  const mensagemRepetida = {
    id: 'msg-0002',
    timestamp: '2026-08-13T08:05:00-03:00',
    sender: 'Lucas',
    direction: 'out',
    type: 'text',
    text: 'Vou revisar o fluxo hoje.',
  }
  criarExecucao(exportDir, 'antiga', {
    completedAt: '2026-08-13T11:00:00-03:00',
    messages: [
      {
        id: 'msg-0001', timestamp: '2026-08-13T08:00:00-03:00', sender: 'Contato de teste',
        direction: 'in', type: 'text', text: 'Bom dia.',
      },
      mensagemRepetida,
      {
        id: 'msg-0003', timestamp: '2026-08-13T09:00:00-03:00', sender: 'Lucas',
        direction: 'out', type: 'audio', audio_file: 'audios/msg-0003.ogg',
        transcript_file: 'transcricoes/msg-0003.txt', transcript: 'Decidi manter o caminho simples.',
        transcription_status: 'ok',
      },
      {
        id: 'msg-0004', timestamp: '2026-08-13T09:10:00-03:00', sender: 'Lucas',
        direction: 'out', type: 'image', media_file: 'midias/msg-0004.png',
      },
      {
        id: 'msg-0005', timestamp: '2026-08-13T09:15:00-03:00', sender: 'WhatsApp',
        direction: 'system', type: 'system', text: 'Criptografia ativada.',
      },
      {
        id: 'msg-0006', timestamp: '2026-08-12T23:00:00-03:00', sender: 'Lucas',
        direction: 'out', type: 'text', text: 'Mensagem de outro dia.',
      },
    ],
  })
  criarExecucao(exportDir, 'nova', {
    completedAt: '2026-08-13T12:00:00-03:00',
    messages: [
      { ...mensagemRepetida, id: 'msg-0099' },
      {
        id: 'wamid-estavel', timestamp: '2026-08-13T10:00:00-03:00', sender: 'Lucas',
        direction: 'out', type: 'text', text: 'Concluí a revisão.',
      },
    ],
  })

  const coleta = await coletarWhatsApp({
    whatsappExportDir: exportDir,
    janela: janelaDoDia('2026-08-13'),
  })

  assert.equal(coleta.coverage.status, 'complete')
  assert.equal(coleta.coverage.files, 2)
  assert.equal(coleta.coverage.records, 8)
  assert.equal(coleta.conversations.length, 1)
  assert.equal(coleta.conversations[0].title, 'Contato de teste')
  assert.deepEqual(
    coleta.conversations[0].messages.map((mensagem) => mensagem.role),
    ['participant', 'user', 'user', 'user', 'system', 'user']
  )

  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    whatsappExportDir: exportDir,
    fontes: [coletarWhatsApp],
    now: () => new Date('2026-08-13T18:00:00.000Z'),
  })
  const resumo = await servico.coletar('2026-08-13')
  const inputs = servico.obterInputs('2026-08-13')

  assert.equal(resumo.stats.participantMessages, 1)
  assert.equal(resumo.stats.userMessages, 4)
  assert.equal(inputs.sources[0].id, 'whatsapp')
  assert.equal(inputs.sources[0].inputCount, 4)
  assert.deepEqual(inputs.inputs.map((input) => input.text), [
    'Vou revisar o fluxo hoje.',
    'Decidi manter o caminho simples.',
    '',
    'Concluí a revisão.',
  ])
  assert.equal(inputs.inputs[0].app, 'WhatsApp')
  assert.equal(inputs.inputs[0].conversationTitle, 'Contato de teste')
  assert.equal(inputs.inputs[1].content.type, 'audio')
  assert.equal(inputs.inputs[1].content.transcript, 'Decidi manter o caminho simples.')
  assert.equal(inputs.inputs[2].content.type, 'image')
})

test('WhatsApp ignora execução incompleta e legada e denuncia contrato completo inválido', async (t) => {
  const raiz = temporario(t)
  const mensagem = {
    id: 'msg-0001', timestamp: '2026-08-13T08:00:00-03:00', sender: 'Lucas',
    direction: 'out', type: 'text', text: 'Não pode entrar.',
  }
  criarExecucao(raiz, 'incompleta', { status: 'collecting', messages: [mensagem] })
  criarExecucao(raiz, 'legada', { version: 1, messages: [mensagem] })
  criarExecucao(raiz, 'invalida', {
    messages: [{
      ...mensagem,
      type: 'image',
      media_file: '..\\fora.png',
      text: 'SEGREDO-QUE-NAO-DEVE-APARECER-NO-ERRO',
    }],
  })

  const coleta = await coletarWhatsApp({
    whatsappExportDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })

  assert.equal(coleta.coverage.status, 'partial')
  assert.equal(coleta.coverage.files, 0)
  assert.equal(coleta.coverage.records, 0)
  assert.equal(coleta.coverage.errors.length, 1)
  assert.equal(coleta.coverage.errors.join('\n').includes('SEGREDO-QUE-NAO-DEVE-APARECER'), false)
  assert.ok(coleta.coverage.notes.some((nota) => nota.includes('incompleta')))
  assert.ok(coleta.coverage.notes.some((nota) => nota.includes('legadas')))
  assert.deepEqual(coleta.conversations, [])
})
