const fs = require('node:fs')
const path = require('node:path')
const {
  arquivoIntersectaJanela,
  cobertura,
  criarMensagem,
  dentroDaJanela,
  idEstavel,
  lerJsonl,
  listarArquivos,
  mesclarConversas,
  textoDeConteudo,
} = require('../shared.cjs')

async function coletarPi(ctx) {
  const raiz = path.join(ctx.homeDir, '.pi', 'agent', 'sessions')
  const discovered = fs.existsSync(raiz)
  const arquivos = discovered
    ? listarArquivos(raiz, (_arquivo, nome) => nome.endsWith('.jsonl')).filter((arquivo) => {
      try { return arquivoIntersectaJanela(fs.statSync(arquivo), ctx.janela) } catch { return false }
    })
    : []
  const conversas = []
  const errors = []
  let records = 0

  for (const arquivo of arquivos) {
    let sessionId = path.basename(arquivo, '.jsonl').match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0]
      || idEstavel('pi', arquivo)
    let cwd = null
    let model = null
    const messages = []
    try {
      const leitura = await lerJsonl(arquivo, (registro, linha) => {
        records += 1
        if (registro?.type === 'session') {
          sessionId = registro.id || sessionId
          cwd = registro.cwd || cwd
          return
        }
        if (registro?.type === 'model_change') model = registro.modelId || model
        if (registro?.type !== 'message' || !registro.message) return
        if (!dentroDaJanela(registro.timestamp, ctx.janela)) return
        const role = registro.message.role === 'assistant' ? 'assistant'
          : registro.message.role === 'user' ? 'user' : 'tool'
        if (role === 'assistant' && Array.isArray(registro.message.content)) {
          const partes = registro.message.content
          const conversacionais = partes.filter((parte) => parte?.type === 'text')
          if (textoDeConteudo(conversacionais)) {
            messages.push(criarMensagem({
              source: 'pi',
              conversationId: sessionId,
              recordId: registro.id || `${sessionId}:${linha}`,
              timestamp: registro.timestamp,
              role: 'assistant',
              kind: 'message',
              text: textoDeConteudo(conversacionais),
              content: conversacionais.length === 1 ? conversacionais[0] : conversacionais,
              provenance: { path: arquivo, line: linha, parentId: registro.parentId || null },
            }))
          }
          for (const chamada of partes.filter((parte) => parte?.type === 'toolCall')) {
            messages.push(criarMensagem({
              source: 'pi',
              conversationId: sessionId,
              recordId: chamada.id || `${sessionId}:${linha}:${chamada.name || 'tool'}`,
              timestamp: registro.timestamp,
              role: 'tool',
              kind: 'tool_call',
              text: textoDeConteudo(chamada.arguments?.command || chamada.arguments),
              content: chamada,
              provenance: { path: arquivo, line: linha, parentId: registro.parentId || null },
            }))
          }
          return
        }
        messages.push(criarMensagem({
          source: 'pi',
          conversationId: sessionId,
          recordId: registro.id || `${sessionId}:${linha}`,
          timestamp: registro.timestamp,
          role,
          kind: role === 'tool' ? 'tool' : 'message',
          text: textoDeConteudo(registro.message.content),
          content: registro.message.content,
          provenance: { path: arquivo, line: linha, parentId: registro.parentId || null },
        }))
      })
      if (leitura.invalidas) errors.push(`${path.basename(arquivo)}: ${leitura.invalidas} linha(s) inválida(s)`)
    } catch (erro) {
      errors.push(`${path.basename(arquivo)}: ${String(erro.message || erro)}`)
      continue
    }
    if (!messages.length) continue
    const primeira = messages.find((item) => (
      item.role === 'user' && item.kind === 'message' && item.text
    ))?.text
    conversas.push({
      id: `pi:${sessionId}`,
      source: 'pi',
      app: 'Pi',
      title: primeira?.slice(0, 120) || `Sessão ${sessionId.slice(0, 8)}`,
      cwd,
      model,
      sourcePath: arquivo,
      messages,
    })
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'pi',
      label: 'Pi',
      discovered,
      conversations: normalizadas,
      files: arquivos.length,
      records,
      errors,
      notes: ['Sessões JSONL do Pi Agent.'],
    }),
  }
}

module.exports = { coletarPi }
