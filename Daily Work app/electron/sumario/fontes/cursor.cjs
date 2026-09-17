const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const {
  cobertura,
  criarMensagem,
  mesclarConversas,
  podarVazios,
  textoDeConteudo,
} = require('../shared.cjs')

function abrirDb(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true })
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000')
  return db
}

function detalhesDaBolha(bolha) {
  const ignorar = new Set(['text', 'type', 'bubbleId', 'createdAt'])
  const resultado = {}
  for (const [chave, valor] of Object.entries(bolha || {})) {
    if (ignorar.has(chave)) continue
    const limpo = podarVazios(valor)
    if (limpo !== undefined) resultado[chave] = limpo
  }
  return podarVazios(resultado)
}

function cabecalhos(db) {
  const resultado = new Map()
  for (const linha of db.prepare('SELECT composerId, createdAt, lastUpdatedAt, value FROM composerHeaders').iterate()) {
    let valor = {}
    try {
      valor = JSON.parse(String(linha.value || '{}'))
    } catch {
      // Título é opcional; a bolha continua sendo canônica.
    }
    resultado.set(String(linha.composerId), {
      title: valor.name || valor.subtitle || null,
      cwd: valor.workspaceIdentifier || null,
      createdAt: Number(linha.createdAt) || null,
      updatedAt: Number(linha.lastUpdatedAt) || null,
    })
  }
  return resultado
}

async function coletarCursor(ctx) {
  const arquivo = path.join(ctx.appDataDir, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  const discovered = fs.existsSync(arquivo)
  const conversas = new Map()
  const errors = []
  let records = 0
  if (!discovered) {
    return {
      conversations: [],
      coverage: cobertura({ id: 'cursor', label: 'Cursor', discovered, conversations: [] }),
    }
  }

  let db
  try {
    db = abrirDb(arquivo)
    const headers = cabecalhos(db)
    const consulta = db.prepare(`
      SELECT key, CAST(value AS TEXT) AS value
      FROM cursorDiskKV
      WHERE key LIKE 'bubbleId:%'
        AND json_extract(CAST(value AS TEXT), '$.createdAt') >= ?
        AND json_extract(CAST(value AS TEXT), '$.createdAt') < ?
      ORDER BY json_extract(CAST(value AS TEXT), '$.createdAt'), key
    `)
    for (const linha of consulta.iterate(ctx.janela.inicioIso, ctx.janela.fimIso)) {
      records += 1
      const partes = String(linha.key).split(':')
      const composerId = partes[1] || 'sem-composer'
      const bubbleId = partes.slice(2).join(':') || String(records)
      let bolha
      try {
        bolha = JSON.parse(String(linha.value || '{}'))
      } catch (erro) {
        errors.push(`${linha.key}: JSON inválido`)
        continue
      }
      const role = Number(bolha.type) === 1 ? 'user' : Number(bolha.type) === 2 ? 'assistant' : 'participant'
      const text = textoDeConteudo(bolha.text)
      const tarefaDelegada = role === 'user' && Boolean(
        bolha.isSimulatedMsg || bolha.subagentSpawnTaskToolCallId
      )
      const historicoSincronizado = role === 'user'
        && !bolha.requestId
        && typeof bolha.serverBubbleId === 'string'
        && Number.isInteger(bolha.conversationTurnIndex)
      const kind = tarefaDelegada
        ? 'delegated_task'
        : historicoSincronizado
        ? 'context'
        : bolha.toolResults?.length || bolha.toolFormerData || (!text && role === 'assistant')
        ? 'activity'
        : 'message'
      const header = headers.get(composerId) || {}
      if (!conversas.has(composerId)) {
        conversas.set(composerId, {
          id: `cursor:${composerId}`,
          source: 'cursor',
          app: 'Cursor',
          title: header.title || `Conversa ${composerId.slice(0, 8)}`,
          cwd: header.cwd || null,
          startedAt: header.createdAt ? new Date(header.createdAt).toISOString() : null,
          updatedAt: header.updatedAt ? new Date(header.updatedAt).toISOString() : null,
          sourcePath: arquivo,
          messages: [],
        })
      }
      conversas.get(composerId).messages.push(criarMensagem({
        source: 'cursor',
        conversationId: composerId,
        recordId: `${composerId}:${bubbleId}`,
        timestamp: bolha.createdAt,
        role: tarefaDelegada || historicoSincronizado ? 'system' : role,
        kind,
        text,
        content: detalhesDaBolha(bolha),
        provenance: { path: arquivo, recordId: linha.key },
      }))
    }
  } catch (erro) {
    errors.push(String(erro.message || erro))
  } finally {
    try { db?.close() } catch {}
  }

  const normalizadas = mesclarConversas([...conversas.values()])
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'cursor',
      label: 'Cursor',
      discovered,
      conversations: normalizadas,
      files: 1,
      records,
      errors,
      notes: ['Bolhas canônicas do Composer com timestamps individuais; históricos sincronizados entram apenas como contexto.'],
    }),
  }
}

module.exports = { coletarCursor }
