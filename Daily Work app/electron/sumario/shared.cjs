const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { criarProvenienciaMaestri } = require('./proveniencia-maestri.cjs')

const PAPEIS = new Set(['user', 'assistant', 'system', 'developer', 'tool', 'participant'])
const CHAVE_SECRETA = /^(?:password|passwd|secret(?:[_-]?key)?|client[_-]?secret|api[_-]?key|authorization|credential|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?token|railway[_-]?token|private[_-]?key|cookie)$/i
const MAX_CARACTERES_TEXTO_TECNICO = 4_000
const MAX_CARACTERES_CONTEUDO = 24_000
const MAX_CARACTERES_CONTEUDO_TECNICO = 4_000
const MAX_ITENS_CONTEUDO = 500
const MAX_ITENS_POR_COLECAO = 100
const MAX_EVENTOS_TECNICOS_POR_CONVERSA = 80

function hash(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest('hex')
}

function idEstavel(prefixo, valor) {
  return `${prefixo}:${hash(typeof valor === 'string' ? valor : JSON.stringify(valor)).slice(0, 24)}`
}

function dataValida(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return false
  const [ano, mes, data] = dia.split('-').map(Number)
  const valor = new Date(ano, mes - 1, data, 12)
  return (
    valor.getFullYear() === ano &&
    valor.getMonth() === mes - 1 &&
    valor.getDate() === data
  )
}

function diaLocal(agora = new Date()) {
  return [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, '0'),
    String(agora.getDate()).padStart(2, '0'),
  ].join('-')
}

function janelaDoDia(dia) {
  if (!dataValida(dia)) throw new Error(`data inválida: ${dia}`)
  const [ano, mes, data] = dia.split('-').map(Number)
  const inicio = new Date(ano, mes - 1, data, 0, 0, 0, 0)
  const fim = new Date(ano, mes - 1, data + 1, 0, 0, 0, 0)
  return {
    dia,
    inicio,
    fim,
    inicioMs: inicio.getTime(),
    fimMs: fim.getTime(),
    inicioIso: inicio.toISOString(),
    fimIso: fim.toISOString(),
    inicioUnix: Math.floor(inicio.getTime() / 1000),
    fimUnix: Math.floor(fim.getTime() / 1000),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  }
}

function timestampMs(valor) {
  if (valor == null || valor === '') return null
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null
    return valor < 10_000_000_000 ? Math.round(valor * 1000) : Math.round(valor)
  }
  const numerico = Number(valor)
  if (String(valor).trim() && Number.isFinite(numerico)) return timestampMs(numerico)
  const data = Date.parse(String(valor))
  return Number.isFinite(data) ? data : null
}

function dentroDaJanela(valor, janela) {
  const ms = timestampMs(valor)
  return ms != null && ms >= janela.inicioMs && ms < janela.fimMs
}

function isoOuNulo(valor) {
  const ms = timestampMs(valor)
  return ms == null ? null : new Date(ms).toISOString()
}

function arquivoIntersectaJanela(stat, janela) {
  // Um transcript pode ser movido ou restaurado depois do dia que contém.
  // O mtime serve só para podar arquivos antigos; os registros decidem o dia.
  return stat.mtimeMs >= janela.inicioMs
}

function listarArquivos(raiz, aceitar, opcoes = {}) {
  if (!raiz || !fs.existsSync(raiz)) return []
  const limite = Number.isFinite(opcoes.limite) ? opcoes.limite : 250_000
  const encontrados = []
  const pilha = [raiz]
  while (pilha.length > 0 && encontrados.length < limite) {
    const atual = pilha.pop()
    let entradas
    try {
      entradas = fs.readdirSync(atual, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entrada of entradas) {
      const completo = path.join(atual, entrada.name)
      if (entrada.isDirectory()) {
        if (!opcoes.ignorarDiretorio?.(completo, entrada.name)) pilha.push(completo)
      } else if (entrada.isFile() && aceitar(completo, entrada.name)) {
        encontrados.push(completo)
      }
    }
  }
  return encontrados
}

async function lerJsonl(arquivo, visitar) {
  const stream = fs.createReadStream(arquivo, { encoding: 'utf8' })
  const linhas = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let numero = 0
  let invalidas = 0
  try {
    for await (const linha of linhas) {
      numero += 1
      if (!linha.trim()) continue
      let valor
      try {
        valor = JSON.parse(linha)
      } catch {
        invalidas += 1
        continue
      }
      await visitar(valor, numero)
    }
  } finally {
    linhas.close()
    stream.destroy()
  }
  return { linhas: numero, invalidas }
}

function textoDeConteudo(valor) {
  if (valor == null) return ''
  if (typeof valor === 'string') return valor
  if (Array.isArray(valor)) {
    return valor
      .map((item) => textoDeConteudo(item))
      .filter(Boolean)
      .join('\n')
  }
  if (typeof valor !== 'object') return ''
  for (const chave of ['text', 'content', 'message', 'output', 'result']) {
    if (typeof valor[chave] === 'string' && valor[chave]) return valor[chave]
  }
  if (Array.isArray(valor.content)) return textoDeConteudo(valor.content)
  if (Array.isArray(valor.parts)) return textoDeConteudo(valor.parts)
  return ''
}

function pedidoAutomaticoDoSumario(valor) {
  const texto = String(valor ?? '')
  if (!texto) return false
  if (/<corpus-jsonl>|<notas-parciais>|<metricas-canonicas>/i.test(texto)) return true
  if (/Você é o analista (?:final )?do Sumário Diário do DailyWork/i.test(texto)) return true
  if (/^Leia o dia inteiro e me conte, em português simples e de forma breve/i.test(texto)) return true
  return /Dia \d{4}-\d{2}-\d{2}\. Fragmento \d+ de \d+\./.test(texto)
    && /"conversationId"/.test(texto)
}

function desmontarPromptGrokDailyWork(valor) {
  const texto = String(valor ?? '')
  if (!/^=== SYSTEM ===/m.test(texto) || !/=== CONVERSATION ===/.test(texto)) return null
  const marca = /\n=== CONVERSATION ===\s*\n/.exec(texto)
  if (!marca) return null
  const conversa = texto
    .slice(marca.index + marca[0].length)
    .replace(/\n=== INSTRUCTION ===[\s\S]*$/, '')
  const humanas = []
  for (const bloco of conversa.split(/^(?=user: |assistant: |system: )/m)) {
    const pedido = bloco.match(/^user:\s*([\s\S]*)$/)?.[1]?.trim()
    if (pedido) humanas.push(pedido)
  }
  return { humanas }
}

function textosHumanosDoPedido(valor) {
  const texto = String(valor ?? '')
  const envelope = desmontarPromptGrokDailyWork(texto)
  const candidatos = envelope ? envelope.humanas : [texto]
  return candidatos.filter((item) => item && !pedidoAutomaticoDoSumario(item))
}

function textoVisivelDoPedido(valor) {
  const texto = String(valor ?? '')
  const humanas = textosHumanosDoPedido(texto)
  if (humanas.length) return humanas.join('\n')
  if (pedidoAutomaticoDoSumario(texto) || desmontarPromptGrokDailyWork(texto)) return null
  return texto
}

function classificarPedidosDoAnalista(conversas) {
  return (conversas || []).map((conversa) => ({
    ...conversa,
    messages: (conversa.messages || []).map((mensagem) => {
      if (mensagem.role !== 'user' || mensagem.kind !== 'message') return mensagem
      const humanas = textosHumanosDoPedido(mensagem.text)
      if (!humanas.length) {
        return pedidoAutomaticoDoSumario(mensagem.text) || desmontarPromptGrokDailyWork(mensagem.text)
          ? { ...mensagem, role: 'system', kind: 'context' }
          : mensagem
      }
      const texto = humanas.join('\n')
      return texto === mensagem.text ? mensagem : { ...mensagem, text: texto }
    }),
  }))
}

function redigirSegredos(valor) {
  let texto = String(valor ?? '')
  texto = texto.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[CHAVE PRIVADA REMOVIDA POR SEGURANÇA]'
  )
  texto = texto.replace(
    /(?:github_pat_[A-Za-z0-9_]{20,}|gh[oprsu]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|sk-(?:proj-|ant-|live_|test_)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,})/gi,
    '[TOKEN REMOVIDO POR SEGURANÇA]'
  )
  texto = texto.replace(
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    '[JWT REMOVIDO POR SEGURANÇA]'
  )
  texto = texto.replace(
    /((?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|railway[_ -]?token|secret|password|passwd|private[_ -]?key|credential)\s*[:=]\s*["']?(?:Bearer\s+)?)([A-Za-z0-9_./+=:-]{12,})/gi,
    '$1[REMOVIDO POR SEGURANÇA]'
  )
  texto = texto.replace(
    /(https?:\/\/[^:\s/@]+:)([^@\s/]{8,})(@)/gi,
    '$1[REMOVIDO POR SEGURANÇA]$3'
  )
  return texto
}

function removerBinariosDoTexto(valor) {
  const original = String(valor ?? '')
  const dataUrlCompleta = original.match(/^data:([^;,\s]+);base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (dataUrlCompleta) {
    return `[DADO ${dataUrlCompleta[1]} OMITIDO: ${dataUrlCompleta[2].length} caracteres base64]`
  }
  if (original.length >= 4_096 && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(original)) {
    return `[BASE64 OMITIDO: ${original.length} caracteres]`
  }
  return original
    .replace(
      /data:([^;,\s]+);base64,([A-Za-z0-9+/=\r\n]{256,})/gi,
      (_trecho, mime, dados) => `[DADO ${mime} OMITIDO: ${dados.length} caracteres base64]`
    )
    .replace(
      /[A-Za-z0-9+/]{4096,}={0,2}/g,
      (trecho) => `[BASE64 OMITIDO: ${trecho.length} caracteres]`
    )
}

function sanitizarTexto(valor) {
  return removerBinariosDoTexto(redigirSegredos(valor))
}

function limitarTexto(valor, limite) {
  const texto = sanitizarTexto(valor)
  if (texto.length <= limite) return texto
  const omitidos = texto.length - limite
  return `${texto.slice(0, limite)}\n[... ${omitidos} caracteres omitidos]`
}

function podarValor(valor, profundidade, estado) {
  if (profundidade > 30) return '[profundidade limitada]'
  if (valor == null || valor === '') return undefined
  if (estado.itens >= MAX_ITENS_CONTEUDO || estado.restante <= 0) {
    return undefined
  }
  estado.itens += 1
  if (Buffer.isBuffer(valor)) return `[BINÁRIO OMITIDO: ${valor.length} bytes]`
  if (typeof valor === 'string') {
    const texto = sanitizarTexto(valor)
    const disponivel = Math.max(0, estado.restante)
    estado.restante -= Math.min(texto.length, disponivel)
    if (texto.length <= disponivel) return texto
    return `${texto.slice(0, disponivel)}\n[... ${texto.length - disponivel} caracteres omitidos]`
  }
  if (Array.isArray(valor)) {
    const itens = []
    const limite = Math.min(valor.length, MAX_ITENS_POR_COLECAO)
    let processados = 0
    for (; processados < limite; processados += 1) {
      const limpo = podarValor(valor[processados], profundidade + 1, estado)
      if (limpo !== undefined) itens.push(limpo)
      if (estado.itens >= MAX_ITENS_CONTEUDO || estado.restante <= 0) {
        processados += 1
        break
      }
    }
    const omitidos = valor.length - processados
    if (omitidos > 0) {
      itens.push(`[... ${omitidos} item(ns) omitido(s)]`)
    }
    return itens.length ? itens : undefined
  }
  if (typeof valor !== 'object') return valor
  const resultado = {}
  const entradas = Object.entries(valor)
  const limite = Math.min(entradas.length, MAX_ITENS_POR_COLECAO)
  let processados = 0
  for (; processados < limite; processados += 1) {
    const [chave, item] = entradas[processados]
    if (CHAVE_SECRETA.test(chave)) {
      resultado[chave] = '[REMOVIDO POR SEGURANÇA]'
      continue
    }
    const limpo = podarValor(item, profundidade + 1, estado)
    if (limpo !== undefined) resultado[chave] = limpo
    if (estado.itens >= MAX_ITENS_CONTEUDO || estado.restante <= 0) {
      processados += 1
      break
    }
  }
  const omitidos = entradas.length - processados
  if (omitidos > 0) {
    resultado.__dailywork_omitido = `${omitidos} campo(s) omitido(s)`
  }
  return Object.keys(resultado).length ? resultado : undefined
}

function podarVazios(valor, limite = MAX_CARACTERES_CONTEUDO) {
  return podarValor(valor, 0, {
    itens: 0,
    restante: limite,
  })
}

const provenienciaMaestri = criarProvenienciaMaestri({ hash, sanitizarTexto, timestampMs })

function criarMensagem({
  source,
  conversationId,
  recordId,
  timestamp,
  timestampBasis = 'source',
  role,
  kind = 'message',
  text = '',
  content,
  provenance = {},
}) {
  const papel = PAPEIS.has(role) ? role : 'participant'
  const mensagemConversacional = kind === 'message' && ['user', 'assistant', 'participant'].includes(papel)
  const texto = mensagemConversacional
    ? sanitizarTexto(text)
    : limitarTexto(text, MAX_CARACTERES_TEXTO_TECNICO)
  const guardarConteudo = content !== undefined && (mensagemConversacional || !texto)
  const conteudoLimpo = guardarConteudo
    ? podarVazios(content, mensagemConversacional ? MAX_CARACTERES_CONTEUDO : MAX_CARACTERES_CONTEUDO_TECNICO)
    : undefined
  const id = recordId
    ? `${source}:${String(recordId)}`
    : idEstavel(source, { conversationId, timestamp, papel, kind, texto, content: conteudoLimpo })
  return provenienciaMaestri.anotarMensagem({
    id,
    timestamp: isoOuNulo(timestamp),
    timestampBasis,
    role: papel,
    kind,
    text: texto,
    ...(guardarConteudo ? { content: conteudoLimpo ?? null } : {}),
    provenance: { source, ...provenance },
  }, { text, content })
}

function escolherAmostraUniforme(itens, limite) {
  if (itens.length <= limite) return itens
  if (limite === 1) return [itens[itens.length - 1]]
  return Array.from({ length: limite }, (_item, indice) => {
    const posicao = Math.round((indice * (itens.length - 1)) / (limite - 1))
    return itens[posicao]
  })
}

function compactarEventosTecnicos(mensagens) {
  const conversacionais = []
  const tecnicas = []
  for (const mensagem of mensagens) {
    const conversa = mensagem.kind === 'delegated_task'
      || (mensagem.kind === 'message' && ['user', 'assistant', 'participant'].includes(mensagem.role))
    ;(conversa ? conversacionais : tecnicas).push(mensagem)
  }
  const amostra = escolherAmostraUniforme(tecnicas, MAX_EVENTOS_TECNICOS_POR_CONVERSA)
  const messages = [...conversacionais, ...amostra]
  messages.sort((a, b) => {
    const ta = timestampMs(a.timestamp) ?? Number.MAX_SAFE_INTEGER
    const tb = timestampMs(b.timestamp) ?? Number.MAX_SAFE_INTEGER
    return ta - tb || String(a.id).localeCompare(String(b.id))
  })
  return {
    messages,
    technicalEvents: {
      total: tecnicas.length,
      kept: amostra.length,
      omitted: tecnicas.length - amostra.length,
    },
  }
}

function mesclarConversas(conversas) {
  const porId = new Map()
  for (const conversa of conversas) {
    if (!conversa?.id || !Array.isArray(conversa.messages)) continue
    const enviosMaestri = provenienciaMaestri.enviosDaConversa(conversa)
    const existente = porId.get(conversa.id)
    if (!existente) {
      porId.set(conversa.id, provenienciaMaestri.anexarEnvios({
        ...conversa,
        messages: [...conversa.messages],
        __eventosTecnicosOmitidos: Number(conversa.technicalEvents?.omitted || 0),
      }, enviosMaestri))
    } else {
      existente.messages.push(...conversa.messages)
      existente.__eventosTecnicosOmitidos += Number(conversa.technicalEvents?.omitted || 0)
      provenienciaMaestri.adicionarEnvios(existente, enviosMaestri)
      if (!existente.title && conversa.title) existente.title = conversa.title
      if (!existente.cwd && conversa.cwd) existente.cwd = conversa.cwd
    }
  }

  const resultado = []
  for (const conversa of porId.values()) {
    const mensagens = []
    const ids = new Set()
    for (const mensagem of conversa.messages) {
      if (!mensagem?.id || ids.has(mensagem.id)) continue
      ids.add(mensagem.id)
      mensagens.push(provenienciaMaestri.limparMensagem(mensagem))
    }
    mensagens.sort((a, b) => {
      const ta = timestampMs(a.timestamp) ?? Number.MAX_SAFE_INTEGER
      const tb = timestampMs(b.timestamp) ?? Number.MAX_SAFE_INTEGER
      return ta - tb || String(a.id).localeCompare(String(b.id))
    })
    if (!mensagens.length) continue
    const compactada = compactarEventosTecnicos(mensagens)
    const tempos = compactada.messages.map((item) => timestampMs(item.timestamp)).filter((item) => item != null)
    const omitidosAnteriores = Number(conversa.__eventosTecnicosOmitidos || 0)
    const enviosMaestri = provenienciaMaestri.enviosDaConversa(conversa)
    const { __eventosTecnicosOmitidos: _omitidos, ...dadosConversa } = conversa
    resultado.push(provenienciaMaestri.anexarEnvios({
      ...dadosConversa,
      startedAt: conversa.startedAt || (tempos.length ? new Date(Math.min(...tempos)).toISOString() : null),
      updatedAt: conversa.updatedAt || (tempos.length ? new Date(Math.max(...tempos)).toISOString() : null),
      messages: compactada.messages,
      technicalEvents: {
        total: compactada.technicalEvents.total + omitidosAnteriores,
        kept: compactada.technicalEvents.kept,
        omitted: compactada.technicalEvents.omitted + omitidosAnteriores,
      },
    }, enviosMaestri))
  }
  resultado.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')))
  return resultado
}

const classificarDelegacoesMaestri = provenienciaMaestri.classificar
function cobertura({ id, label, discovered, conversations, files = 0, records = 0, errors = [], notes = [] }) {
  const totalMensagens = conversations.reduce((total, conversa) => total + conversa.messages.length, 0)
  let status = 'complete'
  if (!discovered) status = 'not_found'
  else if (errors.length) status = 'partial'
  else if (!totalMensagens) status = 'empty'
  return {
    id,
    label,
    discovered: Boolean(discovered),
    status,
    files,
    records,
    conversations: conversations.length,
    messages: totalMensagens,
    errors,
    notes,
  }
}

module.exports = {
  arquivoIntersectaJanela,
  cobertura,
  classificarDelegacoesMaestri,
  classificarPedidosDoAnalista,
  criarMensagem,
  dataValida,
  diaLocal,
  dentroDaJanela,
  hash,
  idEstavel,
  isoOuNulo,
  janelaDoDia,
  lerJsonl,
  listarArquivos,
  mesclarConversas,
  desmontarPromptGrokDailyWork,
  pedidoAutomaticoDoSumario,
  textosHumanosDoPedido,
  textoVisivelDoPedido,
  podarVazios,
  redigirSegredos,
  textoDeConteudo,
  timestampMs,
}
