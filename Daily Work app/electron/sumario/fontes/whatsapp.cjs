const fs = require('node:fs')
const path = require('node:path')
const {
  cobertura,
  criarMensagem,
  dentroDaJanela,
  idEstavel,
  listarArquivos,
  mesclarConversas,
  podarVazios,
} = require('../shared.cjs')

const VERSAO = 2
const FONTE = 'WhatsApp Web'
const FUSO = 'America/Sao_Paulo'
const DIRECOES = new Set(['in', 'out', 'system'])
const TIPOS = new Set(['text', 'audio', 'image', 'video', 'document', 'sticker', 'system'])

async function coletarWhatsApp(ctx) {
  const raiz = ctx.whatsappExportDir
  const discovered = fs.existsSync(raiz)
  const leitura = discovered
    ? lerExecucoes(raiz, ctx.janela)
    : { execucoes: [], errors: [], incompletas: 0, legadas: 0, records: 0 }
  const conversas = leitura.execucoes
    .map((execucao) => conversaDaExecucao(execucao, ctx.janela))
    .filter(Boolean)
  const normalizadas = mesclarConversas(conversas)
  const notes = ['Extrações locais WhatsApp Web v2 concluídas e validadas; somente direction=out é autoria da pessoa.']
  if (leitura.incompletas) notes.push(`Execuções incompletas ignoradas: ${leitura.incompletas}.`)
  if (leitura.legadas) notes.push(`Execuções legadas ignoradas: ${leitura.legadas}.`)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'whatsapp',
      label: 'WhatsApp',
      discovered,
      conversations: normalizadas,
      files: leitura.execucoes.length,
      records: leitura.records,
      errors: leitura.errors,
      notes,
    }),
  }
}

function lerJson(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'))
}

function timestampMsComFuso(valor, campo) {
  const texto = String(valor || '')
  const timestamp = Date.parse(texto)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(texto) || !Number.isFinite(timestamp)) {
    throw new Error(`${campo} precisa ser um timestamp ISO com fuso`)
  }
  return timestamp
}

function validarArquivoLocal(runDir, referencia, campo) {
  if (typeof referencia !== 'string' || !referencia.trim() || path.isAbsolute(referencia)) {
    throw new Error(`${campo} precisa ser um caminho relativo`)
  }
  const arquivo = path.resolve(runDir, referencia)
  const relativo = path.relative(runDir, arquivo)
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error(`${campo} aponta para fora da execução`)
  }
  if (!fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    throw new Error(`${campo} aponta para um arquivo ausente`)
  }
}

function validarMensagem(mensagem, indice, runDir, inicioMs, fimMs, ids) {
  const prefixo = `messages[${indice}]`
  if (!mensagem || typeof mensagem !== 'object' || Array.isArray(mensagem)) {
    throw new Error(`${prefixo} precisa ser um objeto`)
  }
  const id = String(mensagem.id || '').trim()
  if (!id || ids.has(id)) throw new Error(`${prefixo}.id está ausente ou duplicado`)
  ids.add(id)

  const timestampMs = timestampMsComFuso(mensagem.timestamp, `${prefixo}.timestamp`)
  if (timestampMs < inicioMs || timestampMs > fimMs) {
    throw new Error(`${id} está fora da janela declarada`)
  }
  if (!DIRECOES.has(mensagem.direction)) throw new Error(`${id} tem direção inválida`)
  if (!TIPOS.has(mensagem.type)) throw new Error(`${id} tem tipo inválido`)
  if (!String(mensagem.sender || '').trim()) throw new Error(`${id} não possui remetente`)

  for (const campo of ['media_file', 'audio_file', 'transcript_file']) {
    if (mensagem[campo] != null) validarArquivoLocal(runDir, mensagem[campo], `${id}.${campo}`)
  }
  if (mensagem.type === 'audio') {
    if (!mensagem.audio_file || !mensagem.transcript_file) {
      throw new Error(`${id} é áudio sem arquivo ou transcrição local`)
    }
    if (!['ok', 'no-speech'].includes(mensagem.transcription_status)) {
      throw new Error(`${id} não possui transcrição concluída`)
    }
    if (mensagem.transcription_status === 'ok' && !String(mensagem.transcript || '').trim()) {
      throw new Error(`${id} tem transcrição vazia`)
    }
    if (mensagem.transcription_status === 'no-speech' && !String(mensagem.transcription_note || '').trim()) {
      throw new Error(`${id} precisa explicar a ausência de fala`)
    }
  }
  return mensagem
}

function validarExecucao(arquivoManifesto, manifesto) {
  const runDir = path.dirname(arquivoManifesto)
  if (manifesto.source !== FONTE) throw new Error(`source precisa ser ${FONTE}`)
  if (manifesto.timezone !== FUSO) throw new Error(`timezone precisa ser ${FUSO}`)
  if (!String(manifesto.contact || '').trim()) throw new Error('contact está ausente')
  if (!Number.isInteger(manifesto.window_hours) || manifesto.window_hours <= 0) {
    throw new Error('window_hours precisa ser um inteiro positivo')
  }
  const inicioMs = timestampMsComFuso(manifesto.window_start, 'window_start')
  const fimMs = timestampMsComFuso(manifesto.window_end, 'window_end')
  timestampMsComFuso(manifesto.created_at, 'created_at')
  timestampMsComFuso(manifesto.completed_at, 'completed_at')
  if (fimMs < inicioMs) throw new Error('window_end é anterior a window_start')
  if (!fs.existsSync(path.join(runDir, 'log.md')) || !fs.existsSync(path.join(runDir, 'relatorio-dev.md'))) {
    throw new Error('log.md ou relatorio-dev.md está ausente')
  }

  const payload = lerJson(path.join(runDir, 'messages.json'))
  for (const campo of ['version', 'contact', 'window_hours', 'window_start', 'window_end']) {
    if (payload[campo] !== manifesto[campo]) throw new Error(`${campo} diverge entre os arquivos`)
  }
  if (!Array.isArray(payload.messages)) throw new Error('messages precisa ser uma lista')
  if (manifesto.counts?.messages !== payload.messages.length) {
    throw new Error('a contagem validada de mensagens diverge do arquivo')
  }
  const audios = payload.messages.filter((mensagem) => mensagem?.type === 'audio').length
  if (manifesto.counts?.audios !== audios) {
    throw new Error('a contagem validada de áudios diverge do arquivo')
  }
  const ids = new Set()
  const messages = payload.messages.map((mensagem, indice) => (
    validarMensagem(mensagem, indice, runDir, inicioMs, fimMs, ids)
  ))
  return { runDir, messages }
}

function intersectaDia(manifesto, janela) {
  try {
    const inicioMs = timestampMsComFuso(manifesto.window_start, 'window_start')
    const fimMs = timestampMsComFuso(manifesto.window_end, 'window_end')
    return fimMs >= janela.inicioMs && inicioMs < janela.fimMs
  } catch {
    return true
  }
}

function identidadeDoContato(contato) {
  return contato.trim().normalize('NFKC').toLocaleLowerCase('pt-BR')
}

function textoDaMensagem(mensagem) {
  if (mensagem.type === 'audio') return String(mensagem.transcript || mensagem.text || '')
  return String(mensagem.text || '')
}

function conteudoDaMensagem(mensagem) {
  return podarVazios({
    type: mensagem.type,
    ...(mensagem.text ? { text: mensagem.text } : {}),
    ...(mensagem.reply_to ? { reply_to: mensagem.reply_to } : {}),
    ...(mensagem.media_file ? { media_file: mensagem.media_file } : {}),
    ...(mensagem.audio_file ? { audio_file: mensagem.audio_file } : {}),
    ...(mensagem.transcript_file ? { transcript_file: mensagem.transcript_file } : {}),
    ...(mensagem.transcript ? { transcript: mensagem.transcript } : {}),
    ...(mensagem.transcription_status ? { transcription_status: mensagem.transcription_status } : {}),
    ...(mensagem.transcription_note ? { transcription_note: mensagem.transcription_note } : {}),
  })
}

function idDaMensagem(contato, mensagem, ocorrencias) {
  const idOriginal = String(mensagem.id).trim()
  if (!/^msg-\d+$/i.test(idOriginal)) {
    return idEstavel('message', { contact: contato, id: idOriginal })
  }
  // IDs msg-0001 reiniciam em cada extração; o conteúdo e a ocorrência
  // permitem cruzar janelas sobrepostas sem apagar mensagens iguais de verdade.
  const identidade = {
    contact: contato,
    timestamp: new Date(Date.parse(mensagem.timestamp)).toISOString(),
    direction: mensagem.direction,
    sender: mensagem.sender,
    type: mensagem.type,
    text: mensagem.text || '',
    transcript: mensagem.transcript || '',
    replyTo: mensagem.reply_to || '',
  }
  const base = idEstavel('message', identidade)
  const ocorrencia = (ocorrencias.get(base) || 0) + 1
  ocorrencias.set(base, ocorrencia)
  return `${base}:${ocorrencia}`
}

function lerExecucoes(raiz, janela) {
  const manifestos = listarArquivos(raiz, (_arquivo, nome) => nome === 'manifest.json').sort()
  const execucoes = []
  const errors = []
  let incompletas = 0
  let legadas = 0
  let records = 0

  for (const arquivo of manifestos) {
    let manifesto
    try {
      manifesto = lerJson(arquivo)
    } catch (erro) {
      errors.push(`${path.relative(raiz, arquivo)}: ${String(erro.message || erro)}`)
      continue
    }
    if (!intersectaDia(manifesto, janela)) continue
    if (manifesto.version !== VERSAO) {
      legadas += 1
      continue
    }
    if (manifesto.status !== 'complete') {
      incompletas += 1
      continue
    }
    try {
      const execucao = validarExecucao(arquivo, manifesto)
      records += execucao.messages.length
      execucoes.push({
        ...execucao,
        manifesto,
        completedAtMs: Date.parse(manifesto.completed_at),
      })
    } catch (erro) {
      errors.push(`${path.relative(raiz, arquivo)}: ${String(erro.message || erro)}`)
    }
  }

  execucoes.sort((a, b) => b.completedAtMs - a.completedAtMs)
  return { execucoes, errors, incompletas, legadas, records }
}

function conversaDaExecucao({ manifesto, messages, runDir }, janela) {
  const contato = String(manifesto.contact).trim()
  const contatoId = identidadeDoContato(contato)
  const conversationId = idEstavel('whatsapp', contatoId)
  const ocorrencias = new Map()
  const selecionadas = messages
    .filter((mensagem) => dentroDaJanela(mensagem.timestamp, janela))
    .map((mensagem) => {
      const role = mensagem.direction === 'out'
        ? 'user'
        : mensagem.direction === 'in' ? 'participant' : 'system'
      return criarMensagem({
        source: 'whatsapp',
        conversationId,
        recordId: idDaMensagem(contatoId, mensagem, ocorrencias),
        timestamp: mensagem.timestamp,
        role,
        kind: role === 'system' ? 'event' : 'message',
        text: textoDaMensagem(mensagem),
        content: conteudoDaMensagem(mensagem),
        provenance: {
          path: path.join(runDir, 'messages.json'),
          recordId: mensagem.id,
          contact: contato,
          direction: mensagem.direction,
          messageType: mensagem.type,
          completedAt: manifesto.completed_at,
        },
      })
    })
  if (!selecionadas.length) return null
  return {
    id: conversationId,
    source: 'whatsapp',
    app: 'WhatsApp',
    title: contato,
    cwd: null,
    sourcePath: path.join(runDir, 'messages.json'),
    messages: selecionadas,
  }
}

module.exports = { coletarWhatsApp }
