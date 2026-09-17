// Peças compartilhadas pelas conexões externas: HTTP com timeout, validação
// de formulários declarativos e normalização dos sinais do dia.

const TIMEOUT_PADRAO_MS = 12_000
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { validarArtefato } = require('../../scripts/editorial-media-runner.cjs')

class ErroConexao extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem)
    this.name = 'ErroConexao'
    this.codigo = codigo
    this.status = status
  }
}

async function requisitar(fetchImpl, url, init = {}, timeoutMs = TIMEOUT_PADRAO_MS) {
  const resposta = await fetchImpl(url, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs) })
  const tipo = String(resposta.headers?.get?.('content-type') || '')
  let corpo = null
  if (typeof resposta.json === 'function' && tipo.includes('json')) {
    try { corpo = await resposta.json() } catch { corpo = null }
  } else if (typeof resposta.text === 'function') {
    const texto = await resposta.text()
    try { corpo = texto ? JSON.parse(texto) : null } catch { corpo = texto }
  }
  return { status: resposta.status, ok: resposta.ok, corpo, headers: resposta.headers }
}

function textoLimitado(valor, limite) {
  return String(valor ?? '').trim().slice(0, limite)
}

function contarCaracteres(texto) {
  return [...String(texto || '')].length
}

// Valida um formulário conforme o esquema declarado pela conexão. Devolve
// apenas os campos conhecidos, já aparados, e recusa ausências obrigatórias.
function validarCampos(esquema, entrada = {}) {
  const resultado = {}
  for (const campo of esquema) {
    const bruto = entrada?.[campo.campo]
    if (campo.tipo === 'boolean') {
      resultado[campo.campo] = bruto === true || bruto === 'true'
      continue
    }
    const valor = textoLimitado(bruto, 200_000)
    if (!valor) {
      if (campo.opcional) {
        if (campo.padrao !== undefined) resultado[campo.campo] = campo.padrao
        continue
      }
      throw new ErroConexao('CAMPO_OBRIGATORIO', `${campo.rotulo} é obrigatório.`)
    }
    if (campo.tipo === 'select' && Array.isArray(campo.opcoes) && !campo.opcoes.some((opcao) => opcao.valor === valor)) {
      throw new ErroConexao('CAMPO_INVALIDO', `${campo.rotulo} recebeu um valor não permitido.`)
    }
    if (campo.max && contarCaracteres(valor) > campo.max) {
      throw new ErroConexao('CAMPO_LONGO', `${campo.rotulo} excede ${campo.max} caracteres.`)
    }
    if (campo.padrao_regex && !new RegExp(campo.padrao_regex).test(valor)) {
      throw new ErroConexao('CAMPO_INVALIDO', `${campo.rotulo} está em um formato inválido.`)
    }
    resultado[campo.campo] = valor
  }
  return resultado
}

function sinal({ id, timestamp, tipo, titulo, texto = '', url = null, extra = {} }) {
  return {
    id: String(id),
    timestamp: timestamp ? new Date(timestamp).toISOString() : null,
    tipo,
    titulo: textoLimitado(titulo, 200),
    texto: textoLimitado(texto, 4_000),
    url,
    ...extra,
  }
}

function dentroDaJanela(valor, janela) {
  const ms = typeof valor === 'number' ? valor : Date.parse(String(valor || ''))
  return Number.isFinite(ms) && ms >= janela.inicioMs && ms < janela.fimMs
}

function ordenarSinais(itens) {
  return [...itens].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
}

const MIDIA_MIME = Object.freeze({
  imagem: new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
})

function dentroDaRaiz(arquivo, raiz) {
  const rel = path.relative(path.resolve(raiz), path.resolve(arquivo))
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

// Valida e calcula o hash do arquivo aprovado sem expor o caminho real ou os
// bytes ao renderer. Preparação só lê o disco; o upload acontece na confirmação.
async function validarMidiaLocal(midia, { dataDir, maxBytes = 512 * 1024 * 1024, tipos = ['imagem', 'video'], mimes = null, incluirDados = false } = {}) {
  if (!dataDir) throw new ErroConexao('MIDIA_SEM_AREA', 'A área editorial de mídia não está configurada.', 500)
  if (!midia || typeof midia !== 'object' || !['imagem', 'video'].includes(midia.tipo)) throw new ErroConexao('MIDIA_INVALIDA', 'Tipo de mídia inválido.')
  if (!tipos.includes(midia.tipo)) throw new ErroConexao('MIDIA_NAO_SUPORTADA', `Este conector não suporta ${midia.tipo}.`)
  const mime = String(midia.mime || '').toLowerCase()
  if (!MIDIA_MIME[midia.tipo].has(mime)) throw new ErroConexao('MIME_INVALIDO', `MIME não permitido para ${midia.tipo}: ${mime || '(vazio)'}.`)
  if (Array.isArray(mimes) && !mimes.includes(mime)) throw new ErroConexao('MIME_NAO_SUPORTADO', `Este conector não suporta ${mime}.`)
  if (typeof midia.arquivo !== 'string' || !midia.arquivo || midia.arquivo.includes('\0')) throw new ErroConexao('MIDIA_INVALIDA', 'Referência de mídia inválida.')
  const raiz = path.join(path.resolve(dataDir), 'editorial', 'midias')
  const lexical = path.resolve(path.resolve(dataDir), 'editorial', midia.arquivo)
  if (!dentroDaRaiz(lexical, raiz)) throw new ErroConexao('MIDIA_FORA_DA_AREA', 'A mídia precisa estar em editorial/midias.')
  let real
  try { real = await fs.promises.realpath(lexical) } catch { throw new ErroConexao('MIDIA_NAO_ENCONTRADA', 'Arquivo de mídia não encontrado.', 404) }
  let raizReal
  try { raizReal = await fs.promises.realpath(raiz) } catch { raizReal = raiz }
  if (!dentroDaRaiz(real, raizReal)) throw new ErroConexao('MIDIA_FORA_DA_AREA', 'A mídia precisa estar em editorial/midias.')
  const stat = await fs.promises.stat(real)
  if (!stat.isFile() || stat.size <= 0) throw new ErroConexao('MIDIA_INVALIDA', 'Arquivo de mídia vazio ou inválido.')
  if (stat.size > maxBytes) throw new ErroConexao('MIDIA_MUITO_GRANDE', `Arquivo de mídia excede ${maxBytes} bytes.`, 413)
  const dados = await fs.promises.readFile(real)
  try {
    if (midia.tipo === 'video') validarArtefato(real, { kind: 'video', mime })
    else validarArtefato(real, { kind: 'image', mime })
  } catch (causa) {
    throw new ErroConexao(causa?.codigo || 'MIDIA_INVALIDA', causa?.message || 'arquivo de mídia não reconhecido.', 400)
  }
  const sha256 = crypto.createHash('sha256').update(dados).digest('hex')
  if (midia.sha256 && String(midia.sha256).toLowerCase() !== sha256) throw new ErroConexao('MIDIA_HASH_INVALIDO', 'A mídia mudou desde a aprovação.', 409)
  return { id: String(midia.id || ''), tipo: midia.tipo, mime, arquivo: midia.arquivo, sha256, tamanho: stat.size, ...(incluirDados ? { dados } : {}) }
}

async function lerMidiaLocal(midia, opcoes = {}) {
  return validarMidiaLocal(midia, { ...opcoes, incluirDados: true })
}

module.exports = {
  ErroConexao,
  TIMEOUT_PADRAO_MS,
  contarCaracteres,
  dentroDaJanela,
  ordenarSinais,
  requisitar,
  sinal,
  textoLimitado,
  validarCampos,
  validarMidiaLocal,
  lerMidiaLocal,
  MIDIA_MIME,
}
