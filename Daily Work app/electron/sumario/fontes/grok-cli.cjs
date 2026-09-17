const fs = require('node:fs')
const path = require('node:path')
const {
  arquivoIntersectaJanela,
  cobertura,
  criarMensagem,
  dentroDaJanela,
  hash,
  idEstavel,
  lerJsonl,
  listarArquivos,
  mesclarConversas,
  desmontarPromptGrokDailyWork,
  pedidoAutomaticoDoSumario,
  textosHumanosDoPedido,
  podarVazios,
  textoDeConteudo,
  timestampMs,
} = require('../shared.cjs')

function lerJsonSeguro(arquivo, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')) } catch { return fallback }
}

function idSessao(diretorio) {
  return path.basename(diretorio).match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0]
    || idEstavel('grok', diretorio)
}

function adicionarComContagem(destino, mensagem) {
  const chave = `${mensagem.role}\u0000${mensagem.kind}\u0000${mensagem.text}`
  destino.contagens.set(chave, (destino.contagens.get(chave) || 0) + 1)
  destino.mensagens.push(mensagem)
}

function conteudoAutomatico(conteudo) {
  const texto = textoDeConteudo(conteudo).trim()
  return (
    /^(?:<user_query>\s*)?<system-reminder(?:\s|>)/i.test(texto)
    || /^\[Context\]\s*\n(?:Scope|Channel|Thread root):/i.test(texto)
    || /^\[(?:Base|Buzz event:|Thread Context(?:\s|\())/i.test(texto)
    || /^\[New message[^\]]*\]\s*\n+\[Buzz event:/i.test(texto)
    || /^\[Request interrupted by user\]$/i.test(texto)
    || pedidoAutomaticoDoSumario(texto)
    || Boolean(desmontarPromptGrokDailyWork(texto) && textosHumanosDoPedido(texto).length === 0)
  )
}

function partesDoConteudo(conteudo) {
  return Array.isArray(conteudo) ? conteudo : [conteudo]
}

function removerLinhasRepetidasDeColagem(mensagens) {
  const candidatas = mensagens
    .map((mensagem, indice) => ({ mensagem, indice }))
    .filter(({ mensagem }) => mensagem.role === 'user' && mensagem.kind === 'message' && mensagem.text.trim())
  const remover = new Set()

  for (let origem = 0; origem < candidatas.length; origem += 1) {
    const principal = candidatas[origem].mensagem
    const textoPrincipal = principal.text.trim()
    const instantePrincipal = timestampMs(principal.timestamp)
    if (textoPrincipal.length < 100 || instantePrincipal == null) continue
    const repetidas = []
    const rajada = []
    let instanteAnterior = instantePrincipal

    for (let atual = origem + 1; atual < candidatas.length; atual += 1) {
      const candidata = candidatas[atual].mensagem
      const instante = timestampMs(candidata.timestamp)
      if (instante == null || instante - instantePrincipal > 120_000) break
      const texto = candidata.text.trim()

      const intervalo = instante - instanteAnterior
      const limite = rajada.length ? 1_500 : 30_000
      if (intervalo <= limite && texto.length * 2 <= textoPrincipal.length) {
        rajada.push(candidatas[atual].indice)
        instanteAnterior = instante
      } else if (rajada.length) {
        break
      }

      if (texto.length < 8 || texto.length * 2 > textoPrincipal.length) continue
      if (textoPrincipal.includes(texto)) repetidas.push(candidatas[atual].indice)
    }

    if (repetidas.length > 1) repetidas.forEach((indice) => remover.add(indice))
    if (rajada.length >= 5) rajada.forEach((indice) => remover.add(indice))
  }

  return mensagens.filter((_mensagem, indice) => !remover.has(indice))
}

async function mensagensPrecisas(diretorio, sessionId, ctx, errors) {
  const arquivo = path.join(diretorio, 'updates.jsonl')
  const resultado = { mensagens: [], contagens: new Map(), promptIndices: new Set(), records: 0, files: 0 }
  if (!fs.existsSync(arquivo)) return resultado
  resultado.files += 1
  const vistos = new Set()
  const ferramentas = new Map()
  let assistente = null
  let usuario = null

  function descarregarUsuario() {
    if (!usuario?.parts.length) {
      usuario = null
      return
    }
    adicionarComContagem(resultado, criarMensagem({
      source: 'grok-cli',
      conversationId: sessionId,
      recordId: `user:${usuario.id}`,
      timestamp: usuario.timestamp,
      role: 'user',
      kind: 'message',
      text: textoDeConteudo(usuario.parts),
      content: usuario.parts.length === 1 ? usuario.parts[0] : usuario.parts,
      provenance: { path: arquivo, line: usuario.line, promptIndex: usuario.promptIndex },
    }))
    if (Number.isInteger(usuario.promptIndex)) resultado.promptIndices.add(usuario.promptIndex)
    usuario = null
  }

  function descarregarAssistente() {
    if (!assistente?.text) {
      assistente = null
      return
    }
    adicionarComContagem(resultado, criarMensagem({
      source: 'grok-cli',
      conversationId: sessionId,
      recordId: `assistant:${assistente.id}`,
      timestamp: assistente.timestamp,
      role: 'assistant',
      kind: 'message',
      text: assistente.text,
      content: assistente.parts,
      provenance: { path: arquivo, line: assistente.line },
    }))
    assistente = null
  }

  try {
    const leitura = await lerJsonl(arquivo, (registro, linha) => {
      resultado.records += 1
      const update = registro?.params?.update
      const timestamp = registro?.timestamp
      if (!update?.sessionUpdate || !dentroDaJanela(timestamp, ctx.janela)) return
      const assinatura = hash(`${timestamp}\u0000${JSON.stringify(update)}`)
      if (vistos.has(assinatura)) return
      vistos.add(assinatura)
      const tipo = update.sessionUpdate

      if (tipo === 'user_message_chunk') {
        descarregarAssistente()
        const texto = textoDeConteudo(update.content)
        const envelope = desmontarPromptGrokDailyWork(texto)
        let conteudo = update.content
        if (envelope || conteudoAutomatico(update.content)) {
          adicionarComContagem(resultado, criarMensagem({
            source: 'grok-cli',
            conversationId: sessionId,
            recordId: `context:${linha}:${assinatura.slice(0, 10)}`,
            timestamp,
            role: 'system',
            kind: 'context',
            text: texto,
            content: update.content,
            provenance: { path: arquivo, line: linha },
          }))
          const humanas = envelope ? textosHumanosDoPedido(texto) : []
          if (!humanas.length) return
          conteudo = { type: 'text', text: humanas.join('\n') }
        }
        const promptIndex = update._meta?.promptIndex ?? update.content?._meta?.promptIndex ?? null
        if (
          usuario
          && promptIndex != null
          && usuario.promptIndex != null
          && promptIndex !== usuario.promptIndex
        ) descarregarUsuario()
        if (!usuario) {
          usuario = {
            id: `${linha}:${assinatura.slice(0, 10)}`,
            timestamp,
            line: linha,
            promptIndex,
            parts: [],
          }
        }
        usuario.parts.push(conteudo)
        return
      }

      if (tipo === 'agent_message_chunk') {
        descarregarUsuario()
        if (!assistente) {
          assistente = {
            id: `${linha}:${assinatura.slice(0, 10)}`,
            timestamp,
            line: linha,
            text: '',
            parts: [],
          }
        }
        const texto = textoDeConteudo(update.content)
        assistente.text += texto
        assistente.parts.push(update.content)
        return
      }

      if (tipo === 'turn_completed') {
        descarregarUsuario()
        descarregarAssistente()
        return
      }

      if (tipo === 'tool_call') {
        descarregarUsuario()
        ferramentas.set(update.toolCallId, {
          id: update.toolCallId,
          timestamp,
          line: linha,
          call: podarVazios(update),
          result: null,
        })
        return
      }

      if (tipo === 'tool_call_update') {
        const atual = ferramentas.get(update.toolCallId) || {
          id: update.toolCallId,
          timestamp,
          line: linha,
          call: null,
          result: null,
        }
        atual.result = podarVazios(update)
        atual.resultTimestamp = timestamp
        ferramentas.set(update.toolCallId, atual)
      }
    })
    if (leitura.invalidas) errors.push(`${path.basename(diretorio)} updates: ${leitura.invalidas} linha(s) inválida(s)`)
  } catch (erro) {
    errors.push(`${path.basename(diretorio)} updates: ${String(erro.message || erro)}`)
  }
  descarregarUsuario()
  descarregarAssistente()

  for (const ferramenta of ferramentas.values()) {
    if (ferramenta.call) {
      resultado.mensagens.push(criarMensagem({
        source: 'grok-cli',
        conversationId: sessionId,
        recordId: `tool-call:${ferramenta.id}`,
        timestamp: ferramenta.timestamp,
        role: 'tool',
        kind: 'tool_call',
        text: textoDeConteudo(ferramenta.call.rawInput),
        content: ferramenta.call,
        provenance: { path: arquivo, line: ferramenta.line },
      }))
    }
    if (ferramenta.result) {
      resultado.mensagens.push(criarMensagem({
        source: 'grok-cli',
        conversationId: sessionId,
        recordId: `tool-result:${ferramenta.id}`,
        timestamp: ferramenta.resultTimestamp || ferramenta.timestamp,
        role: 'tool',
        kind: 'tool_result',
        text: textoDeConteudo(ferramenta.result.rawOutput || ferramenta.result.content),
        content: ferramenta.result,
        provenance: { path: arquivo, line: ferramenta.line },
      }))
    }
  }
  resultado.mensagens = removerLinhasRepetidasDeColagem(resultado.mensagens)
  return resultado
}

async function turnosDaSessao(diretorio) {
  const arquivo = path.join(diretorio, 'events.jsonl')
  const turnos = new Map()
  if (!fs.existsSync(arquivo)) return { turnos, files: 0, records: 0 }
  let records = 0
  await lerJsonl(arquivo, (registro) => {
    records += 1
    if (registro?.type === 'turn_started' && Number.isInteger(registro.turn_number)) {
      turnos.set(registro.turn_number, registro.ts)
    }
  })
  return { turnos, files: 1, records }
}

function historicosDaSessao(diretorio) {
  const snapshots = []
  const recapDir = path.join(diretorio, 'recap_requests')
  if (fs.existsSync(recapDir)) {
    for (const arquivo of fs.readdirSync(recapDir, { withFileTypes: true })) {
      if (!arquivo.isFile() || !arquivo.name.endsWith('.json')) continue
      const completo = path.join(recapDir, arquivo.name)
      const documento = lerJsonSeguro(completo, null)
      if (Array.isArray(documento?.chat_history)) {
        snapshots.push({ path: completo, createdAt: documento.created_at || '', records: documento.chat_history })
      }
    }
  }
  const atual = path.join(diretorio, 'chat_history.jsonl')
  if (fs.existsSync(atual)) {
    const records = []
    for (const linha of fs.readFileSync(atual, 'utf8').split(/\r?\n/)) {
      if (!linha.trim()) continue
      try { records.push(JSON.parse(linha)) } catch {}
    }
    snapshots.push({ path: atual, createdAt: '9999', records })
  }
  snapshots.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return snapshots
}

function mensagensHistoricas(diretorio, sessionId, ctx, turnos, precisas) {
  const mensagens = []
  const vistos = new Set()
  const consumidos = new Map()
  let turnoAtual = null

  for (const snapshot of historicosDaSessao(diretorio)) {
    for (let indice = 0; indice < snapshot.records.length; indice += 1) {
      const registro = snapshot.records[indice]
      const assinaturaRegistro = hash(JSON.stringify(registro))
      if (vistos.has(assinaturaRegistro)) continue
      vistos.add(assinaturaRegistro)
      if (registro?.type === 'user' && Number.isInteger(registro.prompt_index)) turnoAtual = registro.prompt_index
      const timestamp = turnos.get(turnoAtual) || null
      if (!timestamp || !dentroDaJanela(timestamp, ctx.janela)) continue
      if (precisas.promptIndices.has(turnoAtual)) continue

      if (registro?.type === 'user' || registro?.type === 'assistant') {
        const partes = partesDoConteudo(registro.content)
        const automaticas = []
        const humanas = []
        if (registro.type === 'assistant') {
          humanas.push(...partes)
        } else {
          for (const parte of partes) {
            const texto = textoDeConteudo(parte)
            const envelope = desmontarPromptGrokDailyWork(texto)
            if (registro.synthetic_reason || conteudoAutomatico(parte) || envelope) {
              automaticas.push(parte)
              if (envelope) {
                for (const pedido of textosHumanosDoPedido(texto)) {
                  humanas.push({ type: 'text', text: pedido })
                }
              }
              continue
            }
            humanas.push(parte)
          }
        }
        for (const parte of automaticas) {
          const texto = textoDeConteudo(parte)
          if (!texto) continue
          const chave = `system\u0000context\u0000${texto}`
          const usados = consumidos.get(chave) || 0
          consumidos.set(chave, usados + 1)
          if (usados < (precisas.contagens.get(chave) || 0)) continue
          mensagens.push(criarMensagem({
            source: 'grok-cli',
            conversationId: sessionId,
            recordId: `history-context:${turnoAtual}:${indice}:${assinaturaRegistro.slice(0, 10)}`,
            timestamp,
            timestampBasis: 'turn',
            role: 'system',
            kind: 'context',
            text: texto,
            content: parte,
            provenance: { path: snapshot.path, recordIndex: indice, promptIndex: turnoAtual },
          }))
        }
        const texto = textoDeConteudo(humanas)
        if (texto || humanas.some((parte) => parte?.type === 'image')) {
          const role = registro.type
          const chave = `${role}\u0000message\u0000${texto}`
          const usados = consumidos.get(chave) || 0
          consumidos.set(chave, usados + 1)
          if (usados >= (precisas.contagens.get(chave) || 0)) {
            mensagens.push(criarMensagem({
              source: 'grok-cli',
              conversationId: sessionId,
              recordId: `history:${turnoAtual}:${indice}:${assinaturaRegistro.slice(0, 10)}`,
              timestamp,
              timestampBasis: 'turn',
              role,
              kind: 'message',
              text: texto,
              content: humanas.length === 1 ? humanas[0] : humanas,
              provenance: { path: snapshot.path, recordIndex: indice, promptIndex: turnoAtual },
            }))
          }
        }
        if (registro.type === 'assistant' && Array.isArray(registro.tool_calls)) {
          for (let callIndex = 0; callIndex < registro.tool_calls.length; callIndex += 1) {
            const call = registro.tool_calls[callIndex]
            const callId = call?.id || `${turnoAtual}:${indice}:${callIndex}`
            mensagens.push(criarMensagem({
              source: 'grok-cli',
              conversationId: sessionId,
              recordId: `history-tool-call:${callId}`,
              timestamp,
              timestampBasis: 'turn',
              role: 'tool',
              kind: 'tool_call',
              text: textoDeConteudo(call?.function?.arguments || call?.arguments),
              content: call,
              provenance: { path: snapshot.path, recordIndex: indice, promptIndex: turnoAtual },
            }))
          }
        }
        continue
      }

      if (registro?.type === 'tool_result') {
        mensagens.push(criarMensagem({
          source: 'grok-cli',
          conversationId: sessionId,
          recordId: `history-tool-result:${registro.tool_call_id || assinaturaRegistro.slice(0, 16)}`,
          timestamp,
          timestampBasis: 'turn',
          role: 'tool',
          kind: 'tool_result',
          text: textoDeConteudo(registro.content),
          content: registro.content,
          provenance: { path: snapshot.path, recordIndex: indice, promptIndex: turnoAtual },
        }))
      } else if (registro?.type === 'reasoning' && registro.summary) {
        mensagens.push(criarMensagem({
          source: 'grok-cli',
          conversationId: sessionId,
          recordId: `history-reasoning:${registro.id || assinaturaRegistro.slice(0, 16)}`,
          timestamp,
          timestampBasis: 'turn',
          role: 'assistant',
          kind: 'reasoning_summary',
          text: textoDeConteudo(registro.summary),
          content: registro.summary,
          provenance: { path: snapshot.path, recordIndex: indice, promptIndex: turnoAtual },
        }))
      }
    }
  }
  return mensagens
}

async function coletarGrokCli(ctx) {
  const raiz = path.join(ctx.homeDir, '.grok', 'sessions')
  const discovered = fs.existsSync(raiz)
  const historicos = discovered
    ? listarArquivos(raiz, (_arquivo, nome) => nome === 'chat_history.jsonl')
    : []
  const diretorios = [...new Set(historicos.map((arquivo) => path.dirname(arquivo)))].filter((diretorio) => {
    const summary = lerJsonSeguro(path.join(diretorio, 'summary.json'), {})
    const inicio = timestampMs(summary.created_at)
    const fim = timestampMs(summary.last_active_at || summary.updated_at)
    if (inicio != null && fim != null) return inicio < ctx.janela.fimMs && fim >= ctx.janela.inicioMs
    try { return arquivoIntersectaJanela(fs.statSync(path.join(diretorio, 'chat_history.jsonl')), ctx.janela) } catch { return false }
  })
  const conversas = []
  const errors = []
  let records = 0
  let files = 0

  for (const diretorio of diretorios) {
    const sessionId = idSessao(diretorio)
    const summary = lerJsonSeguro(path.join(diretorio, 'summary.json'), {})
    const cwd = summary.git_root_dir || decodeURIComponent(path.basename(path.dirname(diretorio)))
    const precisas = await mensagensPrecisas(diretorio, sessionId, ctx, errors)
    const eventos = await turnosDaSessao(diretorio).catch((erro) => {
      errors.push(`${path.basename(diretorio)} events: ${String(erro.message || erro)}`)
      return { turnos: new Map(), files: 0, records: 0 }
    })
    const historicas = mensagensHistoricas(diretorio, sessionId, ctx, eventos.turnos, precisas)
    let diretorioDecodificado = diretorio
    try { diretorioDecodificado = decodeURIComponent(diretorio) } catch {}
    const tarefaDelegada = (
      String(summary.session_kind || '').startsWith('subagent')
      || /(^|[\\/])\.buzz(?:[\\/]|$)/i.test(String(cwd))
      || /(^|[\\/])\.maestri[\\/]roles(?:[\\/]|$)/i.test(diretorioDecodificado)
    )
    const messages = [...precisas.mensagens, ...historicas].map((mensagem) => (
      tarefaDelegada && mensagem.role === 'user' && mensagem.kind === 'message'
        ? { ...mensagem, role: 'system', kind: 'delegated_task' }
        : mensagem
    ))
    records += precisas.records + eventos.records
    files += precisas.files + eventos.files + historicosDaSessao(diretorio).length
    if (!messages.length) continue
    const primeira = messages.find((item) => (
      item.role === 'user' && item.kind === 'message' && item.text
    ))?.text
    conversas.push({
      id: `grok-cli:${sessionId}`,
      source: 'grok-cli',
      app: 'Grok CLI',
      title: summary.generated_title || primeira?.slice(0, 120) || `Sessão ${sessionId.slice(0, 8)}`,
      cwd,
      startedAt: summary.created_at || null,
      updatedAt: summary.last_active_at || summary.updated_at || null,
      sourcePath: diretorio,
      messages,
    })
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'grok-cli',
      label: 'Grok CLI',
      discovered,
      conversations: normalizadas,
      files,
      records,
      errors,
      notes: ['Updates temporizados + snapshots de recap e histórico atual para sobreviver à compactação.'],
    }),
  }
}

module.exports = { coletarGrokCli }
