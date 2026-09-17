const fs = require('node:fs')
const path = require('node:path')
const {
  cobertura,
  criarMensagem,
  dentroDaJanela,
  idEstavel,
  mesclarConversas,
  podarVazios,
  textoDeConteudo,
} = require('../shared.cjs')

function papelDaEntrada(entrada) {
  if (entrada?.kind === 'message' && ['user', 'assistant'].includes(entrada.role)) return entrada.role
  return 'tool'
}

function textoDaEntrada(entrada) {
  if (entrada?.kind === 'message') return textoDeConteudo(entrada.content)
  return textoDeConteudo(entrada?.message?.content || entrada?.message || entrada?.content)
}

async function coletarGrokBot(ctx) {
  const raiz = path.join(ctx.appDataDir, 'Grok Bot', 'sand-client-persistence')
  const discovered = fs.existsSync(raiz)
  const arquivos = discovered
    ? fs.readdirSync(raiz, { withFileTypes: true })
      .filter((entrada) => entrada.isFile() && entrada.name.endsWith('.blob'))
      .map((entrada) => path.join(raiz, entrada.name))
    : []
  const conversas = []
  const errors = []
  let records = 0

  for (const arquivo of arquivos) {
    let documento
    try {
      documento = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    } catch (erro) {
      errors.push(`${path.basename(arquivo)}: ${String(erro.message || erro)}`)
      continue
    }
    const entries = documento?.value?.entries
    if (!Array.isArray(entries)) continue
    const selecionadas = entries.filter((entrada) => dentroDaJanela(entrada?.timestampMs, ctx.janela))
    if (!selecionadas.length) continue
    records += entries.length
    const conversationId = idEstavel('grokbot', path.basename(arquivo))
    const messages = selecionadas.map((entrada, indice) => {
      const role = papelDaEntrada(entrada)
      const delegada = role === 'user' && Boolean(entrada.fromAgent?.id)
      const kind = entrada.kind === 'message' ? 'message' : entrada.kind || 'event'
      return criarMensagem({
        source: 'grok-bot',
        conversationId,
        recordId: `${conversationId}:${entrada.id || indice}`,
        timestamp: entrada.timestampMs,
        role: delegada ? 'system' : role,
        kind: delegada ? 'delegated_task' : kind,
        text: textoDaEntrada(entrada),
        content: podarVazios(entrada),
        provenance: {
          path: arquivo,
          recordId: entrada.id || null,
          ...(delegada ? { fromAgent: entrada.fromAgent } : {}),
        },
      })
    })
    const primeira = messages.find((item) => (
      item.role === 'user' && item.kind === 'message' && item.text
    ))?.text
    conversas.push({
      id: `grok-bot:${conversationId}`,
      source: 'grok-bot',
      app: 'Grok Bot',
      title: primeira?.slice(0, 120) || `Conversa ${conversationId.slice(-8)}`,
      cwd: null,
      sourcePath: arquivo,
      messages,
    })
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'grok-bot',
      label: 'Grok Bot',
      discovered,
      conversations: normalizadas,
      files: arquivos.length,
      records,
      errors,
      notes: ['Persistência local Sand: mensagens, anexos e eventos de transporte com timestamp original.'],
    }),
  }
}

module.exports = { coletarGrokBot }
