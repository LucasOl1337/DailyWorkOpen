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
  pedidoAutomaticoDoSumario,
  textoDeConteudo,
} = require('../shared.cjs')

function idArquivo(arquivo) {
  return path.basename(arquivo, '.jsonl').match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0]
    || idEstavel('session', arquivo)
}

function classificarConteudo(role, conteudo) {
  if (!Array.isArray(conteudo)) return role === 'user' ? 'message' : 'message'
  const tipos = new Set(conteudo.map((item) => item?.type).filter(Boolean))
  if (tipos.size && [...tipos].every((tipo) => tipo === 'tool_result')) return 'tool_result'
  if (tipos.has('tool_use') && !tipos.has('text')) return 'tool_call'
  if (tipos.size && [...tipos].every((tipo) => tipo === 'thinking')) return 'reasoning'
  return 'message'
}

function entradaAutomatica(registro, conteudo) {
  const texto = textoDeConteudo(conteudo).trim()
  return Boolean(
    registro?.isCompactSummary
    || registro?.isMeta
    || registro?.promptSource === 'system'
    || registro?.origin?.kind === 'task-notification'
    || /^<(?:task-notification|local-command-caveat|command-name|local-command-stdout)(?:\s|>)/i.test(texto)
    || /^This session is being continued from a previous conversation/i.test(texto)
    || /^\[Context\]\s*\n(?:Scope|Channel|Thread root):/i.test(texto)
    || /^\[New message[^\]]*\]\s*\n+\[Buzz event:/i.test(texto)
    || /^\[Request interrupted by user\]$/i.test(texto)
    || pedidoAutomaticoDoSumario(texto)
  )
}

function tituloRepeteEventoAutomatico(titulo, mensagens) {
  const comparavel = String(titulo || '').trim()
  if (!comparavel) return false
  return mensagens.some((mensagem) => (
    (mensagem.role !== 'user' || mensagem.kind !== 'message')
    && String(mensagem.text || '').trim().startsWith(comparavel)
  ))
}

function auditarSessoesCowork(ctx, idsDeTranscript) {
  const raiz = path.join(ctx.appDataDir, 'Claude', 'claude-code-sessions')
  if (!fs.existsSync(raiz)) return { files: 0, records: 0, matched: 0, errors: [] }
  const arquivos = listarArquivos(raiz, (_arquivo, nome) => /^local_.+\.json$/i.test(nome))
  const errors = []
  let records = 0
  let matched = 0
  for (const arquivo of arquivos) {
    let registro
    try {
      registro = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    } catch (erro) {
      try {
        if (arquivoIntersectaJanela(fs.statSync(arquivo), ctx.janela)) {
          errors.push(`${path.basename(arquivo)}: ${String(erro.message || erro)}`)
        }
      } catch {}
      continue
    }
    if (!dentroDaJanela(registro.lastActivityAt || registro.createdAt, ctx.janela)) continue
    records += 1
    const cliSessionId = String(registro.cliSessionId || '')
    if (cliSessionId && idsDeTranscript.has(cliSessionId)) {
      matched += 1
    } else {
      errors.push(`Cowork ${String(registro.sessionId || path.basename(arquivo)).slice(0, 18)}: transcript local não encontrado`)
    }
  }
  return { files: arquivos.length, records, matched, errors }
}

async function coletarClaude(ctx) {
  const raizes = [
    path.join(ctx.homeDir, '.claude', 'projects'),
    path.join(ctx.homeDir, '.openclaude', 'projects'),
  ]
  const discovered = raizes.some((raiz) => fs.existsSync(raiz))
  const todosArquivos = []
  const vistos = new Set()
  for (const raiz of raizes) {
    for (const arquivo of listarArquivos(
      raiz,
      (completo, nome) => nome.endsWith('.jsonl') && !completo.includes(`${path.sep}tool-results${path.sep}`)
    )) {
      if (vistos.has(arquivo)) continue
      vistos.add(arquivo)
      todosArquivos.push(arquivo)
    }
  }
  const arquivos = []
  for (const arquivo of todosArquivos) {
    try {
      if (arquivoIntersectaJanela(fs.statSync(arquivo), ctx.janela)) arquivos.push(arquivo)
    } catch {
      // Arquivo rotacionado entre listagem e stat.
    }
  }

  const auditoriaCowork = auditarSessoesCowork(ctx, new Set(todosArquivos.map(idArquivo)))

  const conversas = []
  const errors = [...auditoriaCowork.errors]
  let records = auditoriaCowork.records
  for (const arquivo of arquivos) {
    let sessionId = idArquivo(arquivo)
    let cwd = null
    let title = null
    const messages = []
    try {
      const leitura = await lerJsonl(arquivo, (registro, linha) => {
        records += 1
        sessionId = registro?.sessionId || sessionId
        cwd = registro?.cwd || cwd
        if (registro?.type === 'custom-title' && registro.customTitle) title = registro.customTitle
        if (!dentroDaJanela(registro?.timestamp, ctx.janela)) return

        if (['user', 'assistant'].includes(registro?.type) && registro.message) {
          const role = registro.message.role === 'assistant' ? 'assistant' : 'user'
          const content = registro.message.content
          const kind = classificarConteudo(role, content)
          const automatica = role === 'user' && entradaAutomatica(registro, content)
          const delegada = role === 'user' && kind === 'message' && (
            /(^|[\\/])\.maestri[\\/]roles(?:[\\/]|$)/i.test(String(registro.cwd || cwd || ''))
            || registro.isSidechain === true
            || arquivo.includes(`${path.sep}subagents${path.sep}`)
            || registro.sessionKind === 'bg'
            || (
              registro.entrypoint === 'sdk-cli'
              && registro.promptSource === 'sdk'
              && registro.origin?.kind !== 'human'
            )
          )
          const roleFinal = automatica || delegada ? 'system' : role
          const kindFinal = automatica ? 'context' : delegada ? 'delegated_task' : kind
          messages.push(criarMensagem({
            source: 'claude',
            conversationId: sessionId,
            recordId: registro.uuid || `${sessionId}:${linha}`,
            timestamp: registro.timestamp,
            role: roleFinal,
            kind: kindFinal,
            text: textoDeConteudo(content),
            content,
            provenance: {
              path: arquivo,
              line: linha,
              sidechain: registro.isSidechain === true,
              parentId: registro.parentUuid || null,
            },
          }))
          return
        }

        if (registro?.type === 'system') {
          messages.push(criarMensagem({
            source: 'claude',
            conversationId: sessionId,
            recordId: registro.uuid || `system:${sessionId}:${linha}`,
            timestamp: registro.timestamp,
            role: 'system',
            kind: registro.subtype || 'system',
            text: textoDeConteudo(registro.content || registro.message),
            content: registro.content || registro.message || registro,
            provenance: { path: arquivo, line: linha },
          }))
          return
        }

        if (registro?.type === 'attachment') {
          messages.push(criarMensagem({
            source: 'claude',
            conversationId: sessionId,
            recordId: registro.uuid || `attachment:${sessionId}:${linha}`,
            timestamp: registro.timestamp,
            role: 'tool',
            kind: 'attachment',
            text: '',
            content: registro.attachment,
            provenance: { path: arquivo, line: linha },
          }))
        }
      })
      if (leitura.invalidas) errors.push(`${path.basename(arquivo)}: ${leitura.invalidas} linha(s) inválida(s)`)
    } catch (erro) {
      errors.push(`${path.basename(arquivo)}: ${String(erro.message || erro)}`)
      continue
    }
    if (!messages.length) continue
    const primeiraPergunta = messages.find((item) => (
      item.role === 'user' && item.kind === 'message' && item.text
    ))?.text
    const tituloUtil = tituloRepeteEventoAutomatico(title, messages) ? null : title
    conversas.push({
      id: `claude:${sessionId}`,
      source: 'claude',
      app: 'Claude Code / Claude Cowork',
      title: tituloUtil || primeiraPergunta?.slice(0, 120) || `Sessão ${sessionId.slice(0, 8)}`,
      cwd,
      sourcePath: arquivo,
      messages,
    })
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'claude',
      label: 'Claude Code / Cowork',
      discovered,
      conversations: normalizadas,
      files: arquivos.length + auditoriaCowork.files,
      records,
      errors,
      notes: [
        'Mensagens principais, sidechains, ferramentas e anexos das sessões JSONL.',
        `${auditoriaCowork.matched} sessão(ões) do Claude Cowork vinculada(s) ao transcript local.`,
      ],
    }),
  }
}

module.exports = { coletarClaude }
