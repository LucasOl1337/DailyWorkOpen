const fs = require('node:fs')
const path = require('node:path')
const {
  cobertura,
  criarMensagem,
  dentroDaJanela,
  lerJsonl,
  mesclarConversas,
} = require('../shared.cjs')

const SOURCE_ID = 'sussurro'
const LABEL = 'Sussurro'
const NOTE = 'Ditados locais do history.jsonl; só transcrições concluídas entram como fala da pessoa.'

function candidatosHistorico(ctx) {
  const dirs = []
  if (ctx.sussurroHistoryDir) dirs.push(ctx.sussurroHistoryDir)
  const envDir = String(process.env.SUSSURRO_HISTORY_DIR || '').trim()
  if (envDir) dirs.push(envDir)
  if (ctx.appRoot) dirs.push(path.join(ctx.appRoot, '..', '..', 'sussurro', 'history'))
  if (ctx.homeDir) {
    dirs.push(path.join(ctx.homeDir, 'Projects', 'sussurro', 'history'))
    dirs.push(path.join(ctx.homeDir, 'projects', 'sussurro', 'history'))
    dirs.push(path.join(ctx.homeDir, '.local', 'share', 'sussurro', 'history'))
  }
  const vistos = new Set()
  const unicos = []
  for (const dir of dirs) {
    const absoluto = path.resolve(dir)
    if (vistos.has(absoluto)) continue
    vistos.add(absoluto)
    unicos.push(absoluto)
  }
  return unicos
}

function resolverHistorico(ctx) {
  for (const dir of candidatosHistorico(ctx)) {
    const indice = path.join(dir, 'history.jsonl')
    if (fs.existsSync(indice) && fs.statSync(indice).isFile()) {
      return { dir, indice, discovered: true }
    }
  }
  for (const dir of candidatosHistorico(ctx)) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return { dir, indice: path.join(dir, 'history.jsonl'), discovered: true }
    }
  }
  return { dir: null, indice: null, discovered: false }
}

function timestampDoWav(wav) {
  const nome = path.basename(String(wav || ''))
  const match = nome.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (!match) return null
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ).toISOString()
}

function timestampDaEntrada(entrada) {
  if (entrada?.ts) return entrada.ts
  return timestampDoWav(entrada?.wav)
}

function chaveDaEntrada(entrada, linha) {
  const wav = path.basename(String(entrada?.wav || ''))
  if (wav && wav !== '.' && wav !== '..' && !wav.includes(path.sep)) return wav
  return `linha-${linha}`
}

function ditadoValido(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return false
  if (entrada.failed) return false
  return Boolean(String(entrada.text || '').trim())
}

async function coletarSussurro(ctx) {
  const historico = resolverHistorico(ctx)
  const errors = []
  const porChave = new Map()
  let records = 0

  if (historico.discovered && fs.existsSync(historico.indice)) {
    try {
      const leitura = await lerJsonl(historico.indice, (entrada, linha) => {
        records += 1
        if (!ditadoValido(entrada)) return
        const timestamp = timestampDaEntrada(entrada)
        if (!dentroDaJanela(timestamp, ctx.janela)) return
        porChave.set(chaveDaEntrada(entrada, linha), { entrada, linha, timestamp })
      })
      if (leitura.invalidas) {
        errors.push(`${path.basename(historico.indice)}: ${leitura.invalidas} linha(s) inválida(s)`)
      }
    } catch (erro) {
      errors.push(`${path.basename(historico.indice)}: ${String(erro.message || erro)}`)
    }
  }

  const selecionadas = [...porChave.values()].sort((a, b) => a.linha - b.linha)
  const conversationId = `${SOURCE_ID}:${ctx.janela.dia}`
  const messages = selecionadas.map(({ entrada, linha, timestamp }) => criarMensagem({
    source: SOURCE_ID,
    conversationId,
    recordId: chaveDaEntrada(entrada, linha),
    timestamp,
    role: 'user',
    kind: 'message',
    text: String(entrada.text).trim(),
    content: {
      wav: entrada.wav || null,
      duration: Number.isFinite(Number(entrada.dur)) ? Number(entrada.dur) : null,
      libraryFixes: Number.isFinite(Number(entrada.fix)) ? Number(entrada.fix) : null,
    },
    provenance: {
      path: historico.indice,
      wav: entrada.wav || null,
      line: linha,
    },
  }))

  const conversas = messages.length
    ? [{
      id: conversationId,
      source: SOURCE_ID,
      app: LABEL,
      title: messages[0].text.slice(0, 120) || `Ditados ${ctx.janela.dia}`,
      cwd: null,
      sourcePath: historico.indice,
      messages,
    }]
    : []
  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: SOURCE_ID,
      label: LABEL,
      discovered: historico.discovered,
      conversations: normalizadas,
      files: historico.discovered && fs.existsSync(historico.indice) ? 1 : 0,
      records,
      errors,
      notes: [NOTE],
    }),
  }
}

module.exports = { coletarSussurro, resolverHistorico }
