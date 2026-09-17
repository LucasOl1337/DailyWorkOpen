// Geração de uma imagem pelas sessões nativas já logadas neste PC:
// Grok CLI (~/.grok/auth.json) → xAI Imagine Image 2.0
// Codex / 9Router cx/gpt-5.5-image → ChatGPT Images 2.5 (sessão Codex)
// Sem token no corpo de erro. Testes injetam fetch e caminhos de auth.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const GROK_MODELO = 'grok-imagine-image-2.0'
const GROK_QUALIDADE = 'medium'
const CODEX_MODELO_9ROUTER = 'cx/gpt-5.5-image'
const CODEX_MODELO_SESSAO = 'gpt-image-2.5-sunburst'
const CODEX_CHAT = 'gpt-5.5'
const CODEX_UA = 'codex_cli_rs/0.0.0 (DailyWork)'
const NINEROUTER_PADRAO = 'http://127.0.0.1:20128'
const { resolverChaveNoveRouter } = require('./lib-chave-9router.cjs')

function erro(codigo, mensagem) {
  const valor = new Error(mensagem)
  valor.codigo = codigo
  return valor
}

function dataUrl(arquivo) {
  const buffer = fs.readFileSync(arquivo)
  const ext = path.extname(arquivo).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function tamanhoDoAspecto(aspectRatio = '1:1') {
  const [esquerda, direita] = String(aspectRatio).split(':').map(Number)
  if (!esquerda || !direita) return { size: '1024x1024', ratio: '1:1' }
  if (esquerda === direita) return { size: '1024x1024', ratio: '1:1' }
  return esquerda > direita ? { size: '1536x1024', ratio: '3:2' } : { size: '1024x1536', ratio: '2:3' }
}

function tokenGrok(arquivo) {
  let bruto
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) } catch { return null }
  if (!bruto || typeof bruto !== 'object') return null
  const entradas = Object.values(bruto).filter((valor) => valor && typeof valor === 'object' && (valor.key || valor.access_token))
  if (!entradas.length) return null
  const entrada = entradas.sort((a, b) => String(b.expires_at || '').localeCompare(String(a.expires_at || '')))[0]
  const token = String(entrada.key || entrada.access_token || '')
  return token || null
}

function sessaoCodex(arquivo) {
  let bruto
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) } catch { return null }
  if (!bruto || typeof bruto !== 'object') return null
  const tokens = bruto.tokens && typeof bruto.tokens === 'object' ? bruto.tokens : {}
  const token = String(tokens.access_token || bruto.OPENAI_API_KEY || '')
  if (!token) return null
  return { token, accountId: tokens.account_id ? String(tokens.account_id) : null }
}

function mimeDaImagem(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function gravarBytes(dest, bytes) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const mime = mimeDaImagem(bytes)
  if (/\.png$/i.test(dest) && mime === 'image/jpeg') {
    const tmp = `${dest}.src.jpg`
    fs.writeFileSync(tmp, bytes)
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, dest], { windowsHide: true })
    } catch {
      fs.writeFileSync(dest, bytes)
    } finally {
      try { fs.unlinkSync(tmp) } catch {}
    }
    return { ok: true, path: dest, bytes: fs.statSync(dest).size, mime: mimeDaImagem(fs.readFileSync(dest)) || mime }
  }
  fs.writeFileSync(dest, bytes)
  return { ok: true, path: dest, bytes: bytes.length, mime }
}

function criarGeradorImagensCli({
  fetchImpl = globalThis.fetch,
  grokAuthPath = path.join(os.homedir(), '.grok', 'auth.json'),
  codexAuthPath = path.join(os.homedir(), '.codex', 'auth.json'),
  nineRouterUrl = process.env.NINEROUTER_URL || NINEROUTER_PADRAO,
  nineRouterKey = process.env.NINE_ROUTER_API_KEY || process.env.NINEROUTER_KEY || resolverChaveNoveRouter(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('gerador de imagens precisa de fetch')

  async function requisitar(url, init, timeoutMs = 180_000) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const resposta = await fetchImpl(url, { ...init, signal: ac.signal })
      const texto = await resposta.text()
      let json = null
      try { json = texto ? JSON.parse(texto) : null } catch { json = null }
      return { ok: resposta.ok, status: resposta.status, texto, json }
    } catch (causa) {
      if (causa?.name === 'AbortError') throw erro('GERACAO_TIMEOUT', 'a geração de imagem estourou o prazo')
      throw causa
    } finally {
      clearTimeout(timer)
    }
  }

  async function gerarGrok({ prompt, refs = [], dest, aspectRatio = '1:1' }) {
    const token = tokenGrok(grokAuthPath)
    if (!token) throw erro('GROK_CLI_SEM_SESSAO', 'Grok CLI sem sessão. Rode `grok login` neste PC.')
    const { ratio } = tamanhoDoAspecto(aspectRatio)
    const payload = { model: GROK_MODELO, prompt, aspect_ratio: ratio, quality: GROK_QUALIDADE }
    const campos = refs.slice(0, 3).map((arquivo) => ({ url: dataUrl(arquivo), type: 'image_url' }))
    const endpoint = campos.length
      ? 'https://api.x.ai/v1/images/edits'
      : 'https://api.x.ai/v1/images/generations'
    if (campos.length === 1) payload.image = campos[0]
    else if (campos.length > 1) payload.images = campos
    const resposta = await requisitar(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': CODEX_UA },
      body: JSON.stringify(payload),
    })
    if (!resposta.ok) throw erro('GROK_GERACAO_FALHOU', `Grok Imagine 2.0 recusou a geração (HTTP ${resposta.status})`)
    const url = resposta.json?.data?.[0]?.url
    const b64 = resposta.json?.data?.[0]?.b64_json
    if (b64) return { ...gravarBytes(dest, Buffer.from(b64, 'base64')), modelo: GROK_MODELO, via: 'grok-cli' }
    if (!url) throw erro('GROK_SEM_IMAGEM', 'Grok Imagine 2.0 não devolveu imagem')
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 120_000)
    try {
      const baixada = await fetchImpl(url, { method: 'GET', headers: { 'User-Agent': CODEX_UA, Accept: 'image/*,*/*;q=0.8' }, signal: ac.signal })
      if (!baixada.ok) throw erro('GROK_DOWNLOAD_FALHOU', 'falha ao baixar a imagem do Grok')
      return { ...gravarBytes(dest, Buffer.from(await baixada.arrayBuffer())), modelo: GROK_MODELO, via: 'grok-cli' }
    } finally {
      clearTimeout(timer)
    }
  }

  async function gerarCodexVia9Router({ prompt, refs = [], dest, aspectRatio = '1:1' }) {
    const { size } = tamanhoDoAspecto(aspectRatio)
    const headers = { 'Content-Type': 'application/json' }
    if (nineRouterKey) headers.Authorization = `Bearer ${nineRouterKey}`
    const payload = { model: CODEX_MODELO_9ROUTER, prompt, size, n: 1, response_format: 'b64_json' }
    if (refs.length === 1) payload.image = dataUrl(refs[0])
    else if (refs.length > 1) payload.images = refs.slice(0, 3).map(dataUrl)
    const origem = String(nineRouterUrl).replace(/\/$/, '')
    const resposta = await requisitar(`${origem}/v1/images/generations`, { method: 'POST', headers, body: JSON.stringify(payload) })
    if (!resposta.ok) throw erro('NINEROUTER_GERACAO_FALHOU', `9Router/Codex recusou a geração (HTTP ${resposta.status})`)
    const b64 = resposta.json?.data?.[0]?.b64_json
    if (!b64) throw erro('NINEROUTER_SEM_IMAGEM', '9Router não devolveu imagem Codex')
    return { ...gravarBytes(dest, Buffer.from(b64, 'base64')), modelo: CODEX_MODELO_9ROUTER, via: '9router' }
  }

  async function gerarCodexViaSessao({ prompt, refs = [], dest, aspectRatio = '1:1' }) {
    const sessao = sessaoCodex(codexAuthPath)
    if (!sessao) throw erro('CODEX_CLI_SEM_SESSAO', 'Codex CLI sem sessão. Rode `codex login` neste PC.')
    const { size } = tamanhoDoAspecto(aspectRatio)
    const headers = {
      'User-Agent': CODEX_UA,
      originator: 'codex_cli_rs',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${sessao.token}`,
      'Content-Type': 'application/json',
    }
    if (sessao.accountId) headers['ChatGPT-Account-ID'] = sessao.accountId
    const content = [{ type: 'input_text', text: prompt }, ...refs.slice(0, 3).map((arquivo) => ({ type: 'input_image', image_url: dataUrl(arquivo) }))]
    const payload = {
      model: CODEX_CHAT,
      store: false,
      instructions: 'Fulfill the request by using the image_generation tool. Treat attached references as controlling. Generate only the requested output.',
      input: [{ type: 'message', role: 'user', content }],
      tools: [{ type: 'image_generation', model: CODEX_MODELO_SESSAO, size, quality: 'high', output_format: 'png', background: 'opaque', partial_images: 1 }],
      stream: false,
    }
    const resposta = await requisitar('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers, body: JSON.stringify(payload) })
    if (!resposta.ok) throw erro('CODEX_GERACAO_FALHOU', `sessão Codex recusou a geração (HTTP ${resposta.status})`)
    const bruto = JSON.stringify(resposta.json || {})
    const match = bruto.match(/"result"\s*:\s*"(data:image\/[a-zA-Z]+;base64,)?([A-Za-z0-9+/=]{80,})"/)
      || bruto.match(/"b64_json"\s*:\s*"([A-Za-z0-9+/=]{80,})"/)
    const b64 = match ? (match[2] || match[1]) : null
    if (!b64) throw erro('CODEX_SEM_IMAGEM', 'sessão Codex não devolveu imagem')
    return { ...gravarBytes(dest, Buffer.from(b64, 'base64')), modelo: CODEX_MODELO_SESSAO, via: 'codex-cli' }
  }

  async function gerar({ provedor, prompt, refs = [], dest, aspectRatio = '1:1' } = {}) {
    if (!prompt || !dest) throw erro('GERACAO_INVALIDA', 'prompt e dest são obrigatórios')
    if (provedor === 'grok') return gerarGrok({ prompt, refs, dest, aspectRatio })
    if (provedor !== 'codex') throw erro('PROVEDOR_INVALIDO', 'provedor de imagem deve ser grok ou codex')
    try {
      return await gerarCodexVia9Router({ prompt, refs, dest, aspectRatio })
    } catch (causa) {
      if (causa?.codigo === 'CODEX_CLI_SEM_SESSAO') throw causa
      return gerarCodexViaSessao({ prompt, refs, dest, aspectRatio })
    }
  }

  return {
    gerar,
    modelos: { grok: GROK_MODELO, codex: CODEX_MODELO_9ROUTER, codexSessao: CODEX_MODELO_SESSAO },
  }
}

module.exports = { criarGeradorImagensCli, GROK_MODELO, CODEX_MODELO_9ROUTER, CODEX_MODELO_SESSAO, tokenGrok, sessaoCodex, tamanhoDoAspecto, promptDoPlano, mimeDaImagem }

function promptDoPlano(plano = {}, item = {}) {
  const avoid = Array.isArray(plano.avoid) ? plano.avoid.filter(Boolean).join('; ') : ''
  return [
    plano.title, plano.scene, plano.action, plano.composition,
    plano.camera && `Camera: ${plano.camera}`,
    plano.lighting && `Lighting: ${plano.lighting}`,
    plano.styling && `Styling: ${plano.styling}`,
    plano.palette && `Palette: ${plano.palette}`,
    plano.mood && `Mood: ${plano.mood}`,
    plano.style_direction && `Style: ${plano.style_direction}`,
    plano.text_content && `Text in image: ${plano.text_content}`,
    avoid && `Avoid: ${avoid}`,
    item.titulo && `Subject: ${item.titulo}`,
    item.texto && String(item.texto).slice(0, 1_200),
  ].filter(Boolean).join('\n')
}
