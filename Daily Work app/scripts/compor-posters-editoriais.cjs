#!/usr/bin/env node
// Pôsteres 1:1 a partir da UI real. Sem Factory, sem chrome inventado.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

const RAIZ = path.resolve(__dirname, '..')
const DATA = process.env.DAILYWORK_DATA_DIR || path.join(RAIZ, 'data')
const ITENS = path.join(DATA, 'editorial', 'itens')
const REFS = path.join(DATA, 'editorial', 'midias', 'refs')
const POSTERS = path.join(DATA, 'editorial', 'midias', 'posters-20260909')
const TRABALHO = path.join(RAIZ, 'artifacts', 'posters-20260909')
const CHROMIUM = '/usr/bin/chromium'
const MANTER = new Set(['dailywork', 'ramdog', 'sussurro', 'sonora', 'sfr', 'nexsales'])

const PECAS = {
  dailywork: {
    fonte: path.join(REFS, 'dailywork-agente-fonte.png'),
    fallback: path.join(REFS, 'dailywork-fila-fonte.png'),
    fundo: '#eef4f1',
    tinta: '#e8f4ee',
    faixa: '#1d2d28',
    modo: 'janela',
    nome: 'Daily Work',
    linha: { 'pt-BR': 'Separar produzir de distribuir', en: 'Separate making from publishing' },
  },
  ramdog: {
    fonte: path.join(REFS, 'ramdog-fonte.png'),
    fundo: '#141414',
    tinta: '#f4f1ea',
    faixa: '#0d0d0d',
    modo: 'janela',
    nome: 'RamDog',
    linha: { 'pt-BR': 'Quem lançou o processo', en: 'Who launched the process' },
  },
  sussurro: {
    fonte: path.join(REFS, 'sussurro-fonte.png'),
    fundo: '#161412',
    tinta: '#f6efe6',
    faixa: '#11100e',
    modo: 'janela',
    nome: 'Sussurro',
    linha: { 'pt-BR': 'O áudio não sai desta máquina', en: 'Audio never leaves this machine' },
  },
  sonora: {
    fonte: path.join(REFS, 'sonora-fonte.png'),
    fundo: '#171513',
    tinta: '#f6efe6',
    faixa: '#11100e',
    modo: 'conter',
    nome: 'Sonora',
    linha: { 'pt-BR': 'O HDMI que a NVIDIA esconde', en: 'The HDMI NVIDIA hides' },
  },
  sfr: {
    fonte: path.join(REFS, 'sfr-fonte.png'),
    fundo: '#071428',
    tinta: '#f7e27a',
    faixa: '#05101f',
    modo: 'telefone',
    nome: 'SFR Resgate',
    linha: { 'pt-BR': 'A ficha sobrevive sem rede', en: 'The record survives offline' },
  },
  nexsales: {
    fonte: path.join(REFS, 'nexsales-fonte.jpg'),
    fundo: '#f3eef8',
    tinta: '#f6edff',
    faixa: '#2a1450',
    modo: 'janela',
    nome: 'NexSales',
    linha: { 'pt-BR': 'Um agente por cliente', en: 'One agent per client' },
  },
}

function sha256(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
}

function api(metodo, rota, corpo) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '::1', port: 5173, family: 6, path: rota, method: metodo,
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let bruto = ''
      res.on('data', (c) => { bruto += c })
      res.on('end', () => {
        let json
        try { json = JSON.parse(bruto) } catch { return reject(new Error(`${rota} ${res.statusCode}: ${bruto.slice(0, 300)}`)) }
        if (!json.ok) return reject(new Error(`${rota}: ${json.erro?.codigo} ${json.erro?.mensagem}`))
        resolve(json.data)
      })
    })
    req.on('error', reject)
    if (corpo) req.write(JSON.stringify(corpo))
    req.end()
  })
}

function prepararFontes() {
  const copias = [
    ['/tmp/stills-live-20260909/ramdog-live.png', path.join(REFS, 'ramdog-fonte.png')],
    [path.join(os.homedir(), 'Projects', 'sussurro', 'docs', 'media', 'tab-aovivo.png'), path.join(REFS, 'sussurro-fonte.png')],
    [path.join(os.homedir(), 'Projects', 'sonora', 'preview.png'), path.join(REFS, 'sonora-fonte.png')],
    [path.join(os.homedir(), 'Projects', 'sfr-fonte.png'), path.join(REFS, 'sfr-fonte.png')],
    [path.join(os.homedir(), 'Projects', 'nexsales-fonte.jpg'), path.join(REFS, 'nexsales-fonte.jpg')],
  ]
  fs.mkdirSync(REFS, { recursive: true })
  for (const [origem, dest] of copias) {
    if (fs.existsSync(origem)) fs.copyFileSync(origem, dest)
  }
}

function htmlDoPoster(peca, fonte) {
  const still = `file://${fonte}`
  const conter = peca.modo === 'conter'
  const foco = peca.modo === 'telefone' ? '50% 0%' : '50% 40%'
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 1080px; height: 1080px; overflow: hidden; background: ${peca.fundo}; }
  .quadro { position: relative; width: 1080px; height: 1080px; display: grid; place-items: center; background: ${peca.fundo}; }
  img.cover { position: absolute; inset: 0; width: 1080px; height: 1080px; object-fit: cover; object-position: ${foco}; }
  img.conter { width: 1000px; height: auto; max-height: 1000px; object-fit: contain; border-radius: 18px; box-shadow: 0 22px 60px rgba(0,0,0,.35); }
  .anel { position: absolute; inset: 0; box-shadow: inset 0 0 0 10px ${peca.fundo}; pointer-events: none; }
</style>
</head>
<body>
  <div class="quadro">
    <img class="${conter ? 'conter' : 'cover'}" src="${still}" alt="">
    ${conter ? '' : '<div class="anel"></div>'}
  </div>
</body>
</html>`
}

function renderizar(htmlPath, pngPath) {
  execFileSync(CHROMIUM, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=1080,1080',
    `--screenshot=${pngPath}`,
    '--virtual-time-budget=2500',
    `file://${htmlPath}`,
  ], { timeout: 25000, stdio: 'pipe' })
  if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size < 8000) {
    throw new Error(`poster vazio: ${pngPath}`)
  }
}

function midiaDo(projeto, arquivo, idioma) {
  const sufixo = idioma === 'en' ? '-en' : ''
  const marca = sha256(arquivo).slice(0, 8)
  return {
    id: `poster-${projeto}${sufixo}-${marca}`,
    tipo: 'imagem',
    arquivo: `midias/posters-20260909/${path.basename(arquivo)}`,
    mime: 'image/png',
    sha256: sha256(arquivo),
    tamanho: fs.statSync(arquivo).size,
  }
}

function lerItens() {
  return fs.readdirSync(ITENS).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(ITENS, n), 'utf8')))
}

function fontePronta(projeto, peca) {
  const origem = fs.existsSync(peca.fonte) ? peca.fonte : peca.fallback
  if (!origem || !fs.existsSync(origem)) throw new Error(`fonte ausente: ${projeto}`)
  const dest = path.join(TRABALHO, `${projeto}-fonte.png`)
  execFileSync('magick', [origem, '-filter', 'Lanczos', '-resize', '1800x1800>', dest], { timeout: 15000 })
  return dest
}

function gerarPosters() {
  fs.mkdirSync(POSTERS, { recursive: true })
  fs.mkdirSync(TRABALHO, { recursive: true })
  const gerados = {}
  for (const [projeto, peca] of Object.entries(PECAS)) {
    const fonte = fontePronta(projeto, peca)
    gerados[projeto] = {}
    for (const idioma of ['pt-BR', 'en']) {
      const html = path.join(TRABALHO, `${projeto}-${idioma}.html`)
      const png = path.join(POSTERS, `${projeto}${idioma === 'en' ? '-en' : ''}.png`)
      fs.writeFileSync(html, htmlDoPoster(peca, fonte))
      renderizar(html, png)
      gerados[projeto][idioma] = png
      process.stdout.write(`${projeto} ${idioma} ${fs.statSync(png).size}\n`)
    }
  }
  return gerados
}

async function anexar(gerados) {
  const atualizados = []
  for (const item of lerItens()) {
    const projeto = String(item.origem?.projeto || '')
    if (!MANTER.has(projeto) || item.estado !== 'pendente') continue
    const arquivo = gerados[projeto]?.[item.idioma] || gerados[projeto]?.['pt-BR']
    if (!arquivo) throw new Error(`poster ausente para ${projeto} ${item.idioma}`)
    const fresco = await api('GET', `/api/editorial/itens/${item.id}`)
    await api('PATCH', `/api/editorial/itens/${fresco.id}`, {
      revisao: fresco.revisao,
      formato: 'imagem',
      midias: [midiaDo(projeto, arquivo, fresco.idioma)],
    })
    atualizados.push(`${projeto} ${fresco.conta} ${fresco.idioma}`)
  }
  return atualizados
}

async function main() {
  const soGerar = process.argv.includes('--gerar')
  const soAnexar = process.argv.includes('--anexar')
  if (!soAnexar) prepararFontes()
  const gerados = soAnexar
    ? Object.fromEntries(Object.keys(PECAS).map((p) => [p, {
      'pt-BR': path.join(POSTERS, `${p}.png`),
      en: path.join(POSTERS, `${p}-en.png`),
    }]))
    : gerarPosters()
  if (soGerar) return
  const atualizados = await anexar(gerados)
  process.stdout.write(`${JSON.stringify({ atualizados }, null, 2)}\n`)
}

main().catch((erro) => {
  console.error(erro)
  process.exit(1)
})
