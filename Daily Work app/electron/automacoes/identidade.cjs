const fs = require('node:fs')
const path = require('node:path')

const PALETAS = [
  { fundo: '#101114', tinta: '#f2ebe0' },
  { fundo: '#0d1722', tinta: '#e6eef5' },
  { fundo: '#17120e', tinta: '#f3e4cf' },
  { fundo: '#121614', tinta: '#e7eee7' },
  { fundo: '#1a1014', tinta: '#f4e6ea' },
]
const MARCA = { logo: 'marca-logo.local', banner: 'marca-banner.local', meta: 'marca.json.local' }
const SEMENTES = {
  cognition: {
    produto: 'Devin',
    resumo: 'Opera o Devin, engenheiro de software autônomo. Planeja, escreve, testa e entrega código no fluxo que a equipe já usa.',
    fundo: '#efebe3',
    tinta: '#161616',
    logo: 'https://cognition.com/apple-icon.png',
    banner: 'https://cognition.com/opengraph-image.jpg',
    fatos: [
      { rotulo: 'Vaga em SP', texto: 'Deployed Engineer LATAM, on-site São Paulo. Português nativo é obrigatório.' },
      { rotulo: 'Gancho', texto: 'Dos primeiros 35 contratados, 21 tinham fundado empresa.' },
      { rotulo: 'Canal', texto: 'Ashby direto e Silver, pipeline BR/MX/AR separada.' },
      { rotulo: 'Email', texto: 'Domínio cognition.ai. Confirme o formato com um envio, sem lista.' },
    ],
  },
}

function cortar(valor, max) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}
function urlHttps(valor, base) {
  if (!valor || typeof valor !== 'string' || valor.length > 2000) return ''
  let u
  try { u = new URL(valor, base) } catch { return '' }
  if (u.protocol !== 'https:' || u.username || u.password) return ''
  u.hash = ''
  return u.href
}
function corHex(valor) {
  const t = cortar(valor, 32)
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return t.toLowerCase()
  if (/^#([0-9a-f]{8})$/i.test(t)) return `#${t.slice(1, 7).toLowerCase()}`
  return ''
}
function luminancia(hex) {
  const n = hex.length === 4 ? hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex.slice(1)
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function paletaDaEmpresa(id) {
  let n = 0
  for (const c of String(id || '')) n = (n + c.charCodeAt(0) * 17) % 4096
  return PALETAS[n % PALETAS.length]
}
function fatosValidos(lista) {
  if (!Array.isArray(lista)) return []
  return lista.slice(0, 4).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const rotulo = cortar(item.rotulo, 40), texto = cortar(item.texto, 280)
    return rotulo && texto ? [{ rotulo, texto }] : []
  })
}
function meta(html, nomes) {
  for (const nome of nomes) {
    const prop = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const a = html.match(new RegExp(`<meta\\b[^>]+(?:property|name)=["']${prop}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i'))
    if (a) return a[1]
    const b = html.match(new RegExp(`<meta\\b[^>]+\\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))
    if (b) return b[1]
  }
  return ''
}
function icone(html) {
  const blocos = html.match(/<link\b[^>]*>/gi) || []
  const hrefDe = teste => {
    const achado = blocos.find(l => teste(l) && /href=["'][^"']+["']/i.test(l))
    return achado?.match(/href=["']([^"']+)["']/i)?.[1] || ''
  }
  return hrefDe(l => /rel=["'][^"']*apple-touch-icon/i.test(l))
    || hrefDe(l => /rel=["'][^"']*\bicon\b/i.test(l) && /type=["']image\/svg/i.test(l))
    || hrefDe(l => /rel=["'][^"']*\bicon\b/i.test(l))
}

async function coletarIdentidade(site, fetchIdentidade) {
  if (typeof fetchIdentidade !== 'function') return {}
  const origem = urlHttps(site)
  if (!origem) return {}
  try {
    const r = await fetchIdentidade(origem, { signal: AbortSignal.timeout(5000), headers: { Accept: 'text/html', 'User-Agent': 'DailyWork/campanha' } })
    const html = r?.ok && typeof r.text === 'function' ? await r.text() : ''
    if (!html || html.length > 1_500_000) return {}
    const tema = corHex(meta(html, ['theme-color']))
    const fundo = tema && luminancia(tema) < 160 ? tema : ''
    return {
      resumo: cortar(meta(html, ['og:description', 'description']), 400),
      fundo,
      tinta: fundo && luminancia(fundo) < 160 ? '#f4f1ea' : '',
      logo: urlHttps(icone(html), origem),
      banner: urlHttps(meta(html, ['og:image', 'twitter:image']), origem),
    }
  } catch { return {} }
}

function fundirIdentidade(cadastro = {}) {
  const semente = SEMENTES[cadastro.id] || {}
  const propria = cadastro.identidade && typeof cadastro.identidade === 'object' && !Array.isArray(cadastro.identidade) ? cadastro.identidade : {}
  const paleta = paletaDaEmpresa(cadastro.id)
  const fundo = corHex(propria.fundo) || corHex(semente.fundo) || paleta.fundo
  const logo = urlHttps(propria.logo) || urlHttps(semente.logo) || (cadastro.site ? urlHttps('/favicon.ico', cadastro.site) : '')
  return {
    produto: cortar(propria.produto || semente.produto, 80),
    resumo: cortar(propria.resumo || semente.resumo || cadastro.objetivo, 400),
    fundo,
    tinta: corHex(propria.tinta) || corHex(semente.tinta) || paleta.tinta,
    clara: luminancia(fundo) >= 160,
    logo,
    banner: urlHttps(propria.banner) || urlHttps(semente.banner) || '',
    fatos: fatosValidos(propria.fatos).length ? fatosValidos(propria.fatos) : fatosValidos(semente.fatos),
  }
}

function tipoImagem(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) return ''
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[0] === 0x52 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
  if (/<svg[\s>]/i.test(buf.subarray(0, 256).toString('utf8'))) return 'image/svg+xml'
  return ''
}

function lerMetaMarca(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, MARCA.meta), 'utf8')) } catch { return {} }
}

function aplicarMarcaLocal(dir, identidade) {
  const out = { ...identidade }
  const meta = lerMetaMarca(dir)
  for (const chave of ['logo', 'banner']) {
    const arquivo = path.join(dir, MARCA[chave])
    if (!fs.existsSync(arquivo)) continue
    const buf = fs.readFileSync(arquivo)
    const tipo = tipoImagem(buf) || (typeof meta[`${chave}Tipo`] === 'string' ? meta[`${chave}Tipo`] : '')
    if (!tipo.startsWith('image/') || !buf.length) continue
    out[chave] = `data:${tipo};base64,${buf.toString('base64')}`
  }
  return out
}

async function baixarMarca(dir, identidade, fetchIdentidade) {
  if (typeof fetchIdentidade !== 'function') return aplicarMarcaLocal(dir, identidade)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const meta = lerMetaMarca(dir)
  let mudou = false
  for (const chave of ['logo', 'banner']) {
    const url = identidade[chave]
    if (!url || !url.startsWith('https:')) continue
    const dest = path.join(dir, MARCA[chave])
    if (meta[chave] === url && fs.existsSync(dest) && fs.statSync(dest).size > 32) continue
    try {
      const r = await fetchIdentidade(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'image/*,*/*', 'User-Agent': 'DailyWork/campanha' } })
      if (!r?.ok || typeof r.arrayBuffer !== 'function') continue
      const buf = Buffer.from(await r.arrayBuffer())
      const tipo = tipoImagem(buf)
      if (!tipo) continue
      fs.writeFileSync(dest, buf, { mode: 0o600 })
      meta[chave] = url
      meta[`${chave}Tipo`] = tipo
      mudou = true
    } catch {}
  }
  if (mudou) fs.writeFileSync(path.join(dir, MARCA.meta), JSON.stringify(meta, null, 2), { mode: 0o600 })
  return aplicarMarcaLocal(dir, identidade)
}

module.exports = { coletarIdentidade, fundirIdentidade, aplicarMarcaLocal, baixarMarca, SEMENTES }
