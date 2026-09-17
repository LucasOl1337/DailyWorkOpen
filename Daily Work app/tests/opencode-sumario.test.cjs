const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DatabaseSync } = require('node:sqlite')

const { criarServicoSumario } = require('../electron/lib-sumario-diario.cjs')
const { coletarOpenCode } = require('../electron/sumario/fontes/opencode.cjs')

test('OpenCode separa sessões automáticas e envelope de grupo do input escrito pela pessoa', async (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-opencode-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))

  const banco = path.join(raiz, '.local', 'share', 'opencode', 'opencode.db')
  fs.mkdirSync(path.dirname(banco), { recursive: true })
  criarBanco(banco)
  const bancoAmr = path.join(
    raiz,
    '.amr',
    'opencode-sessions',
    'agente-1',
    'data',
    'opencode',
    'opencode-agente.db'
  )
  fs.mkdirSync(path.dirname(bancoAmr), { recursive: true })
  criarBanco(bancoAmr, { somenteAmr: true })

  const servico = criarServicoSumario({
    appRoot: raiz,
    homeDir: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [coletarOpenCode],
    now: () => new Date('2026-08-12T18:00:00.000Z'),
  })
  await servico.coletar('2026-08-12')

  const artefato = servico.lerArtefato('2026-08-12')
  const inputs = servico.obterInputs('2026-08-12')
  assert.equal(artefato.stats.userMessages, 1)
  assert.equal(artefato.stats.toolEvents, 2)
  assert.equal(
    artefato.conversations.flatMap((conversa) => conversa.messages)
      .filter((mensagem) => mensagem.kind === 'delegated_task').length,
    3
  )
  assert.deepEqual(inputs.inputs.map((input) => input.text), ['pedido escrito pela pessoa'])
  assert.equal(inputs.sources[0].inputCount, 1)
})

function criarBanco(arquivo, { somenteAmr = false } = {}) {
  const db = new DatabaseSync(arquivo)
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      permission TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      time_created INTEGER,
      data TEXT
    );
  `)
  const inicio = new Date(2026, 7, 12, 10, 0, 0).getTime()
  if (somenteAmr) {
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)')
      .run('sessao-amr', 'Sessão AMR', 'C:/Projeto', null, inicio, inicio + 60_000)
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)')
      .run('mensagem-amr', 'sessao-amr', inicio + 10_000, JSON.stringify({ role: 'user' }))
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)')
      .run('parte-amr', 'mensagem-amr', inicio + 10_001, JSON.stringify({
        type: 'text',
        text: 'pedido encaminhado pelo AMR',
      }))
    db.close()
    return
  }
  const inserirSessao = db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)')
  inserirSessao.run('sessao-1', 'Sessão OpenCode', 'C:/Projeto', null, inicio, inicio + 60_000)
  inserirSessao.run(
    'sessao-run',
    'Execução não interativa',
    'C:/Projeto',
    JSON.stringify([
      { permission: 'question', pattern: '*', action: 'deny' },
      { permission: 'plan_enter', pattern: '*', action: 'deny' },
      { permission: 'plan_exit', pattern: '*', action: 'deny' },
    ]),
    inicio,
    inicio + 60_000
  )
  inserirSessao.run(
    'sessao-buzz',
    'Workspace de agentes',
    path.join(path.dirname(path.dirname(path.dirname(path.dirname(arquivo)))), '.buzz'),
    null,
    inicio,
    inicio + 60_000
  )
  const inserirMensagem = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)')
  const inserirParte = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)')
  inserirMensagem.run('mensagem-automatica', 'sessao-1', inicio, JSON.stringify({ role: 'user' }))
  inserirParte.run('parte-envelope', 'mensagem-automatica', inicio + 1, JSON.stringify({
    type: 'text',
    text: '<group><current-channel-uuid>canal-1</current-channel-uuid><instructions>Script completed</instructions></group>',
  }))
  inserirParte.run('parte-contexto', 'mensagem-automatica', inicio + 2, JSON.stringify({
    type: 'text',
    text: 'contexto produzido pelo wrapper',
  }))
  inserirMensagem.run('mensagem-humana', 'sessao-1', inicio + 60_000, JSON.stringify({ role: 'user' }))
  inserirParte.run('parte-humana', 'mensagem-humana', inicio + 60_001, JSON.stringify({
    type: 'text',
    text: 'pedido escrito pela pessoa',
  }))
  inserirMensagem.run('mensagem-sintetica', 'sessao-1', inicio + 40_000, JSON.stringify({ role: 'user' }))
  inserirParte.run('parte-sintetica', 'mensagem-sintetica', inicio + 40_001, JSON.stringify({
    type: 'text',
    text: 'contexto sintético do OpenCode',
    synthetic: true,
  }))
  inserirMensagem.run('mensagem-run', 'sessao-run', inicio + 20_000, JSON.stringify({ role: 'user' }))
  inserirParte.run('parte-run', 'mensagem-run', inicio + 20_001, JSON.stringify({
    type: 'text',
    text: 'pedido enviado por opencode run',
  }))
  inserirMensagem.run('mensagem-buzz', 'sessao-buzz', inicio + 30_000, JSON.stringify({ role: 'user' }))
  inserirParte.run('parte-buzz', 'mensagem-buzz', inicio + 30_001, JSON.stringify({
    type: 'text',
    text: 'pedido do workspace de agentes',
  }))
  db.close()
}
