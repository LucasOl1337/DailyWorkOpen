// Caça referências visuais reais para a Image Factory. Sem arquivo
// existente (ou captura pública), devolve vazio — nunca inventa pixels.

const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash } = require('node:crypto')

const execFileAsync = promisify(execFile)
const EXT = /\.(png|jpe?g|webp)$/i
const ALIASES = {
  dailywork: ['dailywork', 'daily work', 'daily-work', 'daily worker', 'agentic-ops', 'agentic ops'],
  ramdog: ['ramdog', 'ram dog', 'ram-dog'],
  sussurro: ['sussurro'],
  sonora: ['sonora'],
  sfr: ['sfr', 'sfr resgate', 'resgate digital', 'sft-resgate', 'sft resgate'],
  nexsales: ['nexsales', 'nex sales', 'nex-sales'],
  nexarq: ['nexarq'],
  lojasync: ['lojasync', 'loja sync', 'loja-sync'],
  'simpl-ai': ['simpl-ai', 'simpl ai', 'simple-ai', 'simpleai', 'simple ai'],
  videogen: ['videogen', 'video gen', 'vídeo gen'],
  'the-last-arrow': ['the-last-arrow', 'last arrow', 'lastarrow', 'the last arrow'],
}

function slug(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function textoDoItem(item) {
  const fontes = Array.isArray(item?.fontes) ? item.fontes : []
  return [
    item?.origem?.projeto,
    item?.titulo,
    item?.texto,
    item?.pautaId,
    ...fontes.flatMap((fonte) => [fonte?.rotulo, fonte?.url]),
  ].filter(Boolean).join(' ').toLowerCase()
}

function chavesDoItem(item) {
  const bruto = textoDoItem(item)
  const chaves = new Set()
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => bruto.includes(alias))) chaves.add(canon)
  }
  const projeto = slug(item?.origem?.projeto)
  if (projeto) chaves.add(projeto)
  return [...chaves]
}

function urlCapturavel(valor) {
  let url
  try { url = new URL(String(valor || '')) } catch { return null }
  if (url.protocol !== 'https:') return null
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) return null
  if (url.hostname === 'github.com' || url.hostname.endsWith('.github.com')) return null
  return url.href
}

const FONTES_CONHECIDAS = {}

function urlsDoItem(item) {
  const vistas = new Set()
  const saida = []
  for (const fonte of (item?.fontes || [])) {
    if (fonte?.ambiente !== 'produto-real') continue
    const href = urlCapturavel(fonte?.url)
    if (href && !vistas.has(href)) { vistas.add(href); saida.push(href) }
  }
  return saida
}

function metadadosProdutoReal(arquivo) {
  try {
    const meta = JSON.parse(fs.readFileSync(`${arquivo}.json`, 'utf8'))
    if (meta.ambiente !== 'produto-real' || meta.dados !== 'reais' || typeof meta.descricao !== 'string') return null
    const sha256 = createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
    if (meta.sha256 !== sha256) return null
    return meta
  } catch { return null }
}

function listarImagens(dir, { limite = 80, profundidadeMax = 5 } = {}) {
  if (!dir || !fs.existsSync(dir)) return []
  const saida = []
  const walk = (pasta, profundidade) => {
    if (profundidade > profundidadeMax || saida.length >= limite) return
    let nomes
    try { nomes = fs.readdirSync(pasta) } catch { return }
    for (const nome of nomes) {
      if (nome.startsWith('.')) continue
      const arquivo = path.join(pasta, nome)
      let stat
      try { stat = fs.statSync(arquivo) } catch { continue }
      if (stat.isDirectory()) walk(arquivo, profundidade + 1)
      else if (stat.isFile() && EXT.test(nome) && stat.size > 0) saida.push(arquivo)
      if (saida.length >= limite) return
    }
  }
  walk(dir, 0)
  return saida
}

function pontuar(arquivo, chaves, raiz) {
  const nome = path.basename(arquivo).toLowerCase()
  const pastaRel = path.relative(raiz || path.dirname(arquivo), path.dirname(arquivo)).toLowerCase()
  let pontos = 0
  for (const chave of chaves) {
    const compacto = chave.replace(/-/g, '')
    if (nome.includes(chave) || nome.includes(compacto)) pontos += 10
    if (pastaRel && (pastaRel.includes(chave) || pastaRel.includes(compacto))) pontos += 4
    const partes = chave.split('-').filter((parte) => parte.length > 2)
    if (partes.length && partes.every((parte) => nome.includes(parte))) pontos += 6
  }
  if (/editorial-proof|factory-output|grok-t\d|codex-t\d/.test(nome)) pontos -= 4
  return pontos
}

function pastasPadrao({ dataDir, portfolioDir, acervoDir }) {
  const editorial = path.join(path.resolve(dataDir), 'editorial')
  const raizApp = path.resolve(__dirname, '..')
  return [
    { dir: path.join(editorial, 'midias', 'refs'), origem: 'refs-editoriais', bonus: 8 },
    { dir: portfolioDir || path.resolve(raizApp, '../LucasOL/Portfolio/assets/publicaveis'), origem: 'portfolio', bonus: 4 },
    { dir: acervoDir || path.join(raizApp, 'assets', 'portfolio'), origem: 'acervo-local', bonus: 2 },
    { dir: path.join(editorial, 'midias'), origem: 'midias-anteriores', bonus: 0 },
  ]
}

function relativoEditorial(arquivo, editorial) {
  const rel = path.relative(editorial, arquivo)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replace(/\\/g, '/')
  return null
}

function copiarParaRefs(origem, editorial, chave) {
  const refs = path.join(editorial, 'midias', 'refs')
  fs.mkdirSync(refs, { recursive: true })
  const nome = `${slug(chave || 'fonte')}-${slug(path.parse(origem).name)}${path.extname(origem).toLowerCase()}`
  const destino = path.join(refs, nome)
  if (!fs.existsSync(destino)) fs.copyFileSync(origem, destino)
  if (fs.existsSync(`${origem}.json`) && !fs.existsSync(`${destino}.json`)) fs.copyFileSync(`${origem}.json`, `${destino}.json`)
  return `midias/refs/${nome}`
}

function resolverReferencias({ item, dataDir, portfolioDir = null, acervoDir = null } = {}) {
  if (!dataDir) throw new Error('resolver referências precisa de dataDir')
  const editorial = path.join(path.resolve(dataDir), 'editorial')
  const chaves = chavesDoItem(item)
  const achados = []

  for (const midia of (item?.midias || [])) {
    if (midia?.tipo !== 'imagem' || !midia.arquivo) continue
    const arquivo = path.isAbsolute(midia.arquivo) ? midia.arquivo : path.join(editorial, midia.arquivo)
    if (!fs.existsSync(arquivo)) continue
    const relativo = relativoEditorial(arquivo, editorial) || midia.arquivo
    achados.push({ arquivo: relativo, origem: 'item', rotulo: 'mídia já anexada', pontos: 100 })
  }
  if (achados.length) {
    return { references: achados.slice(0, 3).map((itemRef) => itemRef.arquivo), achados: achados.slice(0, 3), chaves }
  }

  if (!chaves.length) return { references: [], achados: [], chaves }

  const candidatos = []
  const vistos = new Set()
  for (const pasta of pastasPadrao({ dataDir, portfolioDir, acervoDir })) {
    for (const arquivo of listarImagens(pasta.dir)) {
      if (!metadadosProdutoReal(arquivo)) continue
      const real = path.resolve(arquivo)
      if (vistos.has(real)) continue
      vistos.add(real)
      const base = pontuar(arquivo, chaves, pasta.dir)
      if (base <= 0) continue
      const pontos = base + (pasta.bonus || 0)
      if (pontos < 8) continue
      candidatos.push({ arquivo: real, origem: pasta.origem, pontos, rotulo: path.basename(arquivo) })
    }
  }
  candidatos.sort((a, b) => b.pontos - a.pontos)
  const escolhidos = []
  for (const candidato of candidatos) {
    const relativo = relativoEditorial(candidato.arquivo, editorial) || copiarParaRefs(candidato.arquivo, editorial, chaves[0])
    escolhidos.push({ ...candidato, arquivo: relativo })
    if (escolhidos.length >= 2) break
  }
  return { references: escolhidos.map((itemRef) => itemRef.arquivo), achados: escolhidos, chaves }
}

// Descrições de capturas inspecionadas pelo agente, vinculadas aos bytes.
// A pauta escolhe o que já pode ser mostrado antes de pedir sua imagem.
function referenciasDescritas({ item, dataDir }) {
  const editorial = path.join(path.resolve(dataDir), 'editorial')
  const refs = path.join(editorial, 'midias/refs')
  const chaves = chavesDoItem(item)
  return listarImagens(refs).filter(arquivo => pontuar(arquivo, chaves, refs) > 0).flatMap(arquivo => {
    const meta = `${arquivo}.json`
    if (!fs.existsSync(meta)) return []
    const valor = metadadosProdutoReal(arquivo)
    if (!valor || valor.descricao.length > 1800) return []
    return [{ arquivo: relativoEditorial(arquivo, editorial), descricao: valor.descricao, sha256: valor.sha256 }]
  }).slice(0, 8)
}

function acharChromium() {
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']
    .find((bin) => fs.existsSync(bin)) || null
}

async function urlViva(url, fetchImpl = fetch) {
  const href = urlCapturavel(url)
  if (!href) return false
  try {
    const resposta = await fetchImpl(href, { redirect: 'follow', signal: AbortSignal.timeout(12_000) })
    return resposta?.ok === true
  } catch { return false }
}

async function capturarUrlPadrao({ url, dest, execFileImpl = execFileAsync, chromiumBin = acharChromium(), fetchImpl = fetch } = {}) {
  const href = urlCapturavel(url)
  if (!href || !chromiumBin) return null
  if (!(await urlViva(href, fetchImpl))) return null
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  try {
    await execFileImpl(chromiumBin, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1280,800',
      `--screenshot=${dest}`,
      '--virtual-time-budget=8000',
      href,
    ], { timeout: 25_000, windowsHide: true })
  } catch { return null }
  try {
    const stat = fs.statSync(dest)
    if (!stat.isFile() || stat.size < 200) return null
  } catch { return null }
  return dest
}

async function resolverReferenciasComCaptura({
  item,
  dataDir,
  portfolioDir = null,
  acervoDir = null,
  capturarUrl = capturarUrlPadrao,
} = {}) {
  const local = resolverReferencias({ item, dataDir, portfolioDir, acervoDir })
  if (local.references.length) return local
  if (typeof capturarUrl !== 'function') return local
  const urls = urlsDoItem(item)
  if (!urls.length) return local
  const editorial = path.join(path.resolve(dataDir), 'editorial')
  const chave = chavesDoItem(item)[0] || slug(item?.titulo) || 'fonte'
  for (const href of urls) {
    const dest = path.join(editorial, 'midias', 'refs', `${slug(chave)}-fonte.png`)
    const capturado = await capturarUrl({ url: href, dest, item })
    if (!capturado || !fs.existsSync(capturado)) continue
    const relativo = relativoEditorial(path.resolve(capturado), editorial) || copiarParaRefs(capturado, editorial, chave)
    const arquivoFinal = path.join(editorial, relativo)
    const meta = { ambiente: 'produto-real', dados: 'reais', descricao: `Produto real aberto em ${href}.`, sha256: createHash('sha256').update(fs.readFileSync(arquivoFinal)).digest('hex') }
    fs.writeFileSync(`${arquivoFinal}.json`, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 })
    const achado = { arquivo: relativo, origem: 'captura-fonte', rotulo: href, pontos: 9 }
    return { references: [relativo], achados: [achado], chaves: local.chaves }
  }
  return local
}

module.exports = {
  ALIASES,
  FONTES_CONHECIDAS,
  chavesDoItem,
  urlCapturavel,
  urlViva,
  urlsDoItem,
  resolverReferencias,
  referenciasDescritas,
  resolverReferenciasComCaptura,
  capturarUrlPadrao,
  acharChromium,
  metadadosProdutoReal,
}
