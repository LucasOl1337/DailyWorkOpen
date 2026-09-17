#!/usr/bin/env node
// Captura stills reais do Daily Work (Fila + Agente) em instância isolada,
// no mesmo esquema da vitrine: sem Factory, sem inventar pixels.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RAIZ = path.resolve(__dirname, '..')
const DATA = process.env.DAILYWORK_DATA_DIR || path.join(RAIZ, 'data')
const DEST_REFS = path.join(DATA, 'editorial', 'midias', 'refs')
const DEST_ART = path.join(RAIZ, 'artifacts', 'provas-midia-2026-09-09')
const ISOLADO = path.join(RAIZ, 'artifacts', 'provas-midia-2026-09-09', 'isolado')
const ELECTRON = path.join(RAIZ, 'node_modules', 'electron', 'dist', 'electron')
const RECENTES = new Set(['dailywork', 'ramdog', 'sussurro', 'sonora', 'sfr', 'nexsales'])

function copiarArquivo(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.copyFileSync(origem, destino)
}

function semear() {
  fs.rmSync(ISOLADO, { recursive: true, force: true })
  const dataIso = path.join(ISOLADO, 'data')
  const itensOrig = path.join(DATA, 'editorial', 'itens')
  const itensDest = path.join(dataIso, 'editorial', 'itens')
  fs.mkdirSync(itensDest, { recursive: true })
  for (const nome of fs.readdirSync(itensOrig).filter((n) => n.endsWith('.json'))) {
    const item = JSON.parse(fs.readFileSync(path.join(itensOrig, nome), 'utf8'))
    const projeto = String(item?.origem?.projeto || '').toLowerCase()
    if (!RECENTES.has(projeto) || item.estado !== 'pendente') continue
    fs.writeFileSync(path.join(itensDest, nome), JSON.stringify(item, null, 2))
    for (const midia of item.midias || []) {
      const arquivo = path.join(DATA, 'editorial', midia.arquivo)
      if (fs.existsSync(arquivo)) copiarArquivo(arquivo, path.join(dataIso, 'editorial', midia.arquivo))
    }
  }
  fs.writeFileSync(path.join(dataIso, 'editorial', 'producao-config.json'), JSON.stringify({
    ativa: false, midiaAutomatica: false, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'],
  }))
  return {
    dataDir: dataIso,
    userData: path.join(ISOLADO, 'user-data'),
  }
}

function capturar({ view, saida, dataDir, userData }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(saida), { recursive: true })
    const filho = spawn(ELECTRON, ['.'], {
      cwd: RAIZ,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0',
        DAILYWORK_USER_DATA_DIR: userData,
        DAILYWORK_DATA_DIR: dataDir,
        DAILYWORK_ASSETS_DIR: path.join(ISOLADO, 'assets'),
        DAILYWORK_SESSOES_DIR: path.join(ISOLADO, 'sessoes'),
        DAILYWORK_GH_BIN: '/usr/bin/false',
        DAILYWORK_GROK_BIN: '/usr/bin/false',
        GH_CONFIG_DIR: path.join(ISOLADO, 'empty-gh'),
        DAILYWORK_CHROMIUM_PROFILE: path.join(ISOLADO, 'empty-chromium'),
        DAILYWORK_CAPTURE_PATH: saida,
        DAILYWORK_CAPTURE_VIEW: view,
        DAILYWORK_CAPTURE_WIDTH: '1600',
        DAILYWORK_CAPTURE_HEIGHT: '1000',
        ELECTRON_OZONE_PLATFORM: 'x11',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let saidaTxt = ''
    filho.stdout.on('data', (buf) => { saidaTxt += buf })
    filho.stderr.on('data', (buf) => { saidaTxt += buf })
    const timer = setTimeout(() => {
      filho.kill('SIGTERM')
      reject(new Error(`captura ${view} estourou o tempo\n${saidaTxt.slice(-800)}`))
    }, 45000)
    filho.on('exit', (codigo) => {
      clearTimeout(timer)
      if (fs.existsSync(saida) && fs.statSync(saida).size > 200) return resolve(saida)
      reject(new Error(`captura ${view} falhou (code ${codigo})\n${saidaTxt.slice(-800)}`))
    })
  })
}

async function main() {
  if (!fs.existsSync(ELECTRON)) throw new Error(`electron ausente: ${ELECTRON}`)
  const { dataDir, userData } = semear()
  const cenas = [
    { view: 'fila', nome: 'dailywork-fila-fonte.png' },
    { view: 'agente', nome: 'dailywork-agente-fonte.png' },
  ]
  const gravados = []
  for (const cena of cenas) {
    const tmp = path.join(ISOLADO, 'captures', cena.nome)
    await capturar({ view: cena.view, saida: tmp, dataDir, userData })
    copiarArquivo(tmp, path.join(DEST_REFS, cena.nome))
    copiarArquivo(tmp, path.join(DEST_ART, cena.nome))
    gravados.push(cena.nome)
    process.stdout.write(`${cena.nome}\n`)
  }
  return gravados
}

main().catch((erro) => {
  console.error(erro)
  process.exit(1)
})
