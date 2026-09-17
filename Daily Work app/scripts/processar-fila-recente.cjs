#!/usr/bin/env node
// Recusa acervo inativo e cola stills reais nos posts dos projetos mexidos no último mês.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')

const RAIZ = path.resolve(__dirname, '..')
const DATA = path.join(RAIZ, 'data')
const ITENS = path.join(DATA, 'editorial', 'itens')
const STILLS = path.join(DATA, 'editorial', 'midias', 'stills-reais-20260909')
const INATIVOS = new Set(['the-last-arrow', 'videogen'])
const RECENTES = new Set(['dailywork', 'nexarq', 'lojasync', 'simpl-ai'])

const FONTES = {
  dailywork: path.join(DATA, 'editorial', 'midias', 'refs', 'dailywork-fila-fonte.png'),
  nexarq: path.join(RAIZ, 'assets', 'portfolio', '01-nexarq-real-landing-cover-4x3-b34df83ecd47991e.png'),
  lojasync: path.join(DATA, 'editorial', 'midias', 'refs', 'lojasync-painel.png'),
  'simpl-ai': path.join(DATA, 'editorial', 'midias', 'refs', 'simpl-ai-app.png'),
}

const TITULOS = {
  dailywork: {
    'pt-BR': 'DailyWork: separar produzir de distribuir',
    en: 'DailyWork: separate producing from distributing',
  },
  nexarq: {
    'pt-BR': 'SaaS multi-tenant de verdade, não filtro no banco',
    en: 'Real multi-tenant SaaS, not a database filter',
  },
  lojasync: {
    'pt-BR': 'O ERP não tinha API. O cadastro tinha que continuar.',
    en: 'The ERP had no API. Product registration still had to move.',
  },
  'simpl-ai': {
    'pt-BR': 'O difícil não era a resposta. Era virar conversa em site.',
    en: 'The hard part was not the reply. It was turning talk into a site.',
  },
}

function sha256(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
}

function api(metodo, rota, corpo) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '::1',
      port: 5173,
      family: 6,
      path: rota,
      method: metodo,
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let bruto = ''
      res.on('data', (c) => { bruto += c })
      res.on('end', () => {
        let json
        try { json = JSON.parse(bruto) } catch { return reject(new Error(`${rota} ${res.statusCode}: ${bruto.slice(0, 400)}`)) }
        if (!json.ok) return reject(new Error(`${rota}: ${json.erro?.codigo || res.statusCode} ${json.erro?.mensagem || ''}`))
        resolve(json.data)
      })
    })
    req.on('error', reject)
    if (corpo) req.write(JSON.stringify(corpo))
    req.end()
  })
}

function midiaDo(projeto) {
  const origem = FONTES[projeto]
  if (!origem || !fs.existsSync(origem)) throw new Error(`still ausente: ${projeto}`)
  fs.mkdirSync(STILLS, { recursive: true })
  const nome = `${projeto}${path.extname(origem)}`
  const dest = path.join(STILLS, nome)
  fs.copyFileSync(origem, dest)
  return {
    id: `still-${projeto}-20260909`,
    tipo: 'imagem',
    arquivo: `midias/stills-reais-20260909/${nome}`,
    mime: origem.endsWith('.jpg') || origem.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
    sha256: sha256(dest),
    tamanho: fs.statSync(dest).size,
  }
}

function lerItens() {
  return fs.readdirSync(ITENS).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(ITENS, n), 'utf8')))
}

async function main() {
  const midias = Object.fromEntries([...RECENTES].map((p) => [p, midiaDo(p)]))
  const itens = lerItens()
  const recusados = []
  const atualizados = []

  for (const item of itens) {
    const projeto = String(item.origem?.projeto || '')
    const lixo = INATIVOS.has(projeto) || String(item.titulo || '').startsWith('Selected Work')
    if (lixo && item.estado === 'pendente') {
      await api('POST', `/api/editorial/itens/${item.id}/recusar`, { revisao: item.revisao })
      recusados.push(item.id)
    }
  }

  const depois = lerItens()
  for (const item of depois) {
    const projeto = String(item.origem?.projeto || '')
    if (!RECENTES.has(projeto)) continue
    if (item.estado === 'publicado') continue
    if (item.estado === 'erro') {
      await api('POST', `/api/editorial/itens/${item.id}/reabrir`, { revisao: item.revisao })
    }
    const fresco = (await api('GET', `/api/editorial/itens/${item.id}`))
    const titulo = TITULOS[projeto][item.idioma] || item.titulo
    const campos = { ...(fresco.campos || {}), texto: fresco.texto }
    delete campos.linkUrl
    delete campos.linkTitulo
    await api('PATCH', `/api/editorial/itens/${fresco.id}`, {
      revisao: fresco.revisao,
      titulo,
      formato: 'imagem',
      campos,
      midias: [midias[projeto]],
    })
    atualizados.push(`${projeto} ${item.conta} ${item.idioma}`)
  }

  process.stdout.write(JSON.stringify({ recusados: recusados.length, atualizados, stills: Object.keys(midias) }, null, 2) + '\n')
}

main().catch((erro) => {
  console.error(erro)
  process.exit(1)
})
