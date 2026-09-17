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

function idDaSessao(arquivo) {
  return path.basename(arquivo, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f-]{27})$/i)?.[1]
    || idEstavel('thread', arquivo)
}

function papelCodex(valor) {
  if (['user', 'assistant', 'system', 'developer', 'tool'].includes(valor)) return valor
  return 'participant'
}

function tipoFerramenta(tipo) {
  if (!tipo || tipo === 'message' || tipo === 'reasoning') return null
  if (/output|result/i.test(tipo)) return 'tool_result'
  if (/call|search|tool/i.test(tipo)) return 'tool_call'
  return 'event'
}

const MARCAS_DE_CONTEXTO = [
  /^<app-context(?:\s|>)/i,
  /^<apps_instructions(?:\s|>)/i,
  /^<collaboration_mode(?:\s|>)/i,
  /^<environment_context(?:\s|>)/i,
  /^<in-app-browser-context(?:\s|>)/i,
  /^<permissions instructions(?:\s|>)/i,
  /^<plugins_instructions(?:\s|>)/i,
  /^<recommended_plugins(?:\s|>)/i,
  /^<skills_instructions(?:\s|>)/i,
  /^<codex_internal_context(?:\s|>)/i,
  /^# AGENTS\.md instructions/i,
  /^# Chrome tabs:/i,
  /^<image name=\[Image #\d+\]\s+path=/i,
  /^<\/image>$/i,
]

function parteAutomatica(parte) {
  const texto = textoDeConteudo(parte).trim()
  return pedidoAutomaticoDoSumario(texto)
    || MARCAS_DE_CONTEXTO.some((marca) => marca.test(texto))
}

function parteComTexto(parte, texto) {
  return typeof parte === 'string' ? texto : { ...parte, text: texto }
}

function separarParteCodex(parte) {
  const texto = textoDeConteudo(parte)
  const contextoComposto = parteAutomatica(parte)
    || /^\s*# Files mentioned by the user:/i.test(texto)
  if (contextoComposto) {
    const marcador = /(?:^|\r?\n)## My request:\s*(?:\r?\n|$)/i.exec(texto)
    if (!marcador) return { humanas: [], automaticas: [parte] }
    const contexto = texto.slice(0, marcador.index).trim()
    const pedido = texto
      .slice(marcador.index + marcador[0].length)
      .replace(/\s*<\/image>\s*$/i, '')
      .trim()
    return {
      humanas: pedido ? [parteComTexto(parte, pedido)] : [],
      automaticas: contexto ? [parteComTexto(parte, contexto)] : [],
    }
  }
  return { humanas: [parte], automaticas: [] }
}

function separarConteudoCodex(conteudo) {
  const partes = Array.isArray(conteudo) ? conteudo : [conteudo]
  const resultado = { humanas: [], automaticas: [] }
  for (const parte of partes) {
    const separada = separarParteCodex(parte)
    resultado.humanas.push(...separada.humanas)
    resultado.automaticas.push(...separada.automaticas)
  }
  return resultado
}

function sessaoAutomatica(meta) {
  return Boolean(
    meta?.source && typeof meta.source === 'object'
    || meta?.source === 'exec'
    || ['buzz-acp', 'codex_exec'].includes(meta?.originator)
  )
}

function arquivosDaFonte(raizes, janela) {
  const vistos = new Set()
  const arquivos = []
  for (const raiz of raizes) {
    for (const arquivo of listarArquivos(raiz, (_completo, nome) => nome.endsWith('.jsonl'))) {
      if (vistos.has(arquivo)) continue
      vistos.add(arquivo)
      try {
        if (arquivoIntersectaJanela(fs.statSync(arquivo), janela)) arquivos.push(arquivo)
      } catch {
        // O arquivo pode desaparecer durante rotação; a leitura registrará apenas os existentes.
      }
    }
  }
  return arquivos
}

async function coletarCodex(ctx) {
  const raizes = [
    path.join(ctx.homeDir, '.codex', 'sessions'),
    path.join(ctx.homeDir, '.codex', 'archived_sessions'),
  ]
  const discovered = raizes.some((raiz) => fs.existsSync(raiz))
  const arquivos = arquivosDaFonte(raizes, ctx.janela)
  const conversas = []
  const errors = []
  let records = 0

  for (const arquivo of arquivos) {
    const sessionId = idDaSessao(arquivo)
    const mensagensPrincipais = []
    const mensagensFallback = []
    let meta = {}
    let automatica = false
    try {
      const leitura = await lerJsonl(arquivo, (registro, linha) => {
        records += 1
        if (registro?.type === 'session_meta') {
          meta = registro.payload || meta
          automatica ||= sessaoAutomatica(registro.payload)
          return
        }
        if (!dentroDaJanela(registro?.timestamp, ctx.janela)) return
        const base = {
          source: 'codex',
          conversationId: sessionId,
          timestamp: registro.timestamp,
          provenance: { path: arquivo, line: linha },
        }

        if (registro?.type === 'response_item') {
          const payload = registro.payload || {}
          if (payload.type === 'reasoning') return
          if (payload.type === 'message') {
            const role = papelCodex(payload.role)
            const delegada = role === 'user' && automatica
            const partes = role === 'user'
              ? separarConteudoCodex(payload.content)
              : { humanas: Array.isArray(payload.content) ? payload.content : [payload.content], automaticas: [] }
            if (partes.humanas.length && (textoDeConteudo(partes.humanas) || partes.humanas.some((parte) => parte?.type === 'input_image'))) {
              mensagensPrincipais.push(criarMensagem({
                ...base,
                recordId: payload.id || `${sessionId}:${linha}`,
                role: delegada ? 'system' : role,
                kind: delegada ? 'delegated_task' : 'message',
                text: textoDeConteudo(partes.humanas),
                content: partes.humanas.length === 1 ? partes.humanas[0] : partes.humanas,
              }))
            }
            if (partes.automaticas.length) {
              mensagensPrincipais.push(criarMensagem({
                ...base,
                recordId: `context:${payload.id || `${sessionId}:${linha}`}`,
                role: 'system',
                kind: 'context',
                text: textoDeConteudo(partes.automaticas),
                content: partes.automaticas,
              }))
            }
            return
          }
          const kind = tipoFerramenta(payload.type)
          if (kind) {
            mensagensPrincipais.push(criarMensagem({
              ...base,
              recordId: `${kind}:${payload.call_id || payload.id || `${sessionId}:${linha}`}`,
              role: 'tool',
              kind,
              text: textoDeConteudo(payload.output || payload.result || payload.arguments),
              content: payload,
            }))
          }
          return
        }

        if (registro?.type === 'event_msg') {
          const payload = registro.payload || {}
          if (payload.type === 'item_completed' && payload.item?.type === 'CommandExecution') {
            const item = payload.item
            mensagensPrincipais.push(criarMensagem({
              ...base,
              recordId: `command:${item.id || `${sessionId}:${linha}`}`,
              timestamp: payload.started_at_ms || registro.timestamp,
              role: 'tool',
              kind: 'tool_call',
              text: textoDeConteudo(item.command),
              content: item,
            }))
            return
          }
          if (!['user_message', 'agent_message'].includes(payload.type)) return
          const delegada = payload.type === 'user_message' && automatica
          const partes = payload.type === 'user_message'
            ? separarConteudoCodex([{ type: 'input_text', text: textoDeConteudo(payload.message) }]).humanas
            : [payload.message]
          const texto = textoDeConteudo(partes)
          if (!texto && !partes.some((parte) => parte?.type === 'input_image')) return
          mensagensFallback.push(criarMensagem({
            ...base,
            recordId: `fallback:${sessionId}:${linha}`,
            role: payload.type === 'user_message' ? (delegada ? 'system' : 'user') : 'assistant',
            kind: delegada ? 'delegated_task' : 'message',
            text: texto,
            content: partes.length === 1 ? partes[0] : partes,
          }))
        }
      })
      if (leitura.invalidas) errors.push(`${path.basename(arquivo)}: ${leitura.invalidas} linha(s) inválida(s)`)
    } catch (erro) {
      errors.push(`${path.basename(arquivo)}: ${String(erro.message || erro)}`)
      continue
    }

    const assinaturas = new Map()
    for (const mensagem of mensagensPrincipais) {
      const chave = `${mensagem.role}\u0000${mensagem.text}`
      assinaturas.set(chave, (assinaturas.get(chave) || 0) + 1)
    }
    const usados = new Map()
    const fallbackUnico = mensagensFallback.filter((mensagem) => {
      const chave = `${mensagem.role}\u0000${mensagem.text}`
      const usadosAgora = usados.get(chave) || 0
      usados.set(chave, usadosAgora + 1)
      return usadosAgora >= (assinaturas.get(chave) || 0)
    })
    const messages = [...mensagensPrincipais, ...fallbackUnico]
    if (!messages.length) continue
    const primeiraPergunta = messages.find((item) => (
      item.role === 'user' && item.kind === 'message' && item.text
    ))?.text
    conversas.push({
      id: `codex:${sessionId}`,
      source: 'codex',
      app: 'Codex / ChatGPT',
      title: meta.summary || meta.title || primeiraPergunta?.slice(0, 120) || `Sessão ${sessionId.slice(0, 8)}`,
      cwd: meta.cwd || null,
      sourcePath: arquivo,
      messages,
    })
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'codex',
      label: 'Codex / ChatGPT',
      discovered,
      conversations: normalizadas,
      files: arquivos.length,
      records,
      errors,
      notes: ['Rollouts ativos e arquivados do Codex.'],
    }),
  }
}

module.exports = { coletarCodex }
