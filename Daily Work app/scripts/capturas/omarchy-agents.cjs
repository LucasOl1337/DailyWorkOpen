const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)
const BENCH = path.join(os.homedir(), '.agents/bin/agent-bench')
const SHELL = '/usr/share/omarchy/shell'
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const erro = mensagem => Object.assign(new Error(mensagem), { codigo: 'CAPTURA_FALHOU' })

// Os arquivos de UI vêm do produto. Só a hospedagem do popup é adaptada de
// layer-shell Wayland para o X11 da bancada; nenhum controle é redesenhado.
function prepararRuntime(repositorio, runtime) {
  const plugin = JSON.parse(fs.readFileSync(path.join(repositorio, 'manifest.json')))
  if (plugin.id !== 'lol.agents') throw erro('O repositório não contém o plugin Omarchy Agents esperado.')
  const hashes = {}
  const native = path.join(runtime, 'Native')
  fs.mkdirSync(native, { recursive: true })
  const qmls = fs.readdirSync(repositorio).filter(n => n.endsWith('.qml'))
  for (const nome of qmls) {
    const bytes = fs.readFileSync(path.join(repositorio, nome))
    hashes[nome] = digest(bytes)
    fs.writeFileSync(path.join(native, nome === 'Panel.qml' ? 'AgentsPanel.qml' : nome), bytes)
  }
  fs.writeFileSync(path.join(native, 'qmldir'), qmls.map(n => {
    const nome = n === 'Panel.qml' ? 'AgentsPanel.qml' : n
    return `${path.parse(nome).name} 1.0 ${nome}`
  }).join('\n'))
  fs.cpSync(path.join(repositorio, 'assets'), path.join(native, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(native, 'bin'))
  // O painel lê o estado real da máquina, mas esta instância editorial não
  // atualiza coletores: o clique em refresh não pode alterar o snapshot.
  fs.writeFileSync(path.join(native, 'bin/update'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  for (const dir of ['Ui', 'Commons']) fs.cpSync(path.join(SHELL, dir), path.join(runtime, dir), { recursive: true })
  const hostFile = path.join(runtime, 'Ui/KeyboardPanel.qml')
  const original = fs.readFileSync(hostFile, 'utf8')
  hashes['Ui/KeyboardPanel.qml'] = digest(original)
  if (!original.includes('WlrLayershell.keyboardFocus: open') || !original.includes('id: card')) throw erro('O host do popup mudou; revise a adaptação X11 antes de capturar.')
  const adaptado = original.replace('import Quickshell.Wayland\n', '')
    .replace(/^\s*WlrLayershell.keyboardFocus: open\n\s*\?.*\n\s*:.*\n/m, '\n')
    .replace(/^\s*WlrLayershell\..*\n/gm, '\n')
    .replace('  id: root', '  id: root\n  property alias editorialCaptureItem: card')
    .replace('height: root.contentHeight', 'height: root.contentHeight + Style.space(28)')
    .replace('anchors.bottomMargin: card.contentBottomInset', 'anchors.bottomMargin: card.contentBottomInset + Style.space(28)')

  fs.writeFileSync(hostFile, adaptado)
  hashes['Ui/KeyboardPanel.x11.qml'] = digest(adaptado)
  fs.writeFileSync(path.join(runtime, 'shell.qml'), fs.readFileSync(path.join(__dirname, 'omarchy-host.qml')))
  return { versao: `${plugin.version} · QML ${digest(JSON.stringify(hashes)).slice(0, 12)}`, hashes }
}

function resolverEstadoReal(stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state')) {
  const raiz = fs.realpathSync(path.resolve(stateHome))
  const usageDir = fs.realpathSync(path.join(raiz, 'omarchy/agents/usage'))
  const arquivos = fs.readdirSync(usageDir).filter(nome => /^[a-z0-9-]+\.json$/.test(nome)).sort()
  if (!arquivos.length) throw erro('O Omarchy Agents não tem estado real de uso para capturar.')
  const atualizacoes = arquivos.map(nome => {
    const arquivo = path.join(usageDir, nome)
    const bruto = fs.readFileSync(arquivo, 'utf8')
    if (/\b(?:demo|demonstracao|demonstração|fixture|mock|sintetico|sintético)\b/i.test(bruto)) throw erro(`O estado ${nome} foi identificado como artificial.`)
    JSON.parse(bruto)
    return fs.statSync(arquivo).mtimeMs
  })
  return { stateHome: raiz, usageDir, arquivos, atualizadoEm: new Date(Math.max(...atualizacoes)).toISOString() }
}

async function capturar({ pedido, outputDir, verificarCancelamento = () => {} }) {
  if (!path.isAbsolute(pedido.repositorio || '')) throw erro('A receita precisa do caminho absoluto do repositório.')
  const abas = new Set(['all', 'codex', 'claude', 'grok', 'antigravity', 'hermes', 'cursor', 'opencode', 'devin'])
  for (const c of pedido.cenas) if (!abas.has(c.aba || c.id) || !['day', 'week', 'month', 'total'].includes(c.periodo || 'day')) throw erro('Cena ou período não suportado pelo executor Omarchy Agents.')
  const estadoReal = resolverEstadoReal()
  const runtime = path.join(outputDir, 'runtime')
  const versao = prepararRuntime(pedido.repositorio, runtime)
  const nome = `dw-cap-${crypto.randomBytes(6).toString('hex')}`
  const bench = async args => {
    const r = await run(BENCH, args, { timeout: 30000, maxBuffer: 512000 })
    return r.stdout.trim()
  }
  let iniciado = false
  const cenas = []
  try {
    verificarCancelamento()
    await bench(['start', nome]); iniciado = true
    const { pid } = JSON.parse(await bench(['launch', nome, '--', 'env', 'QT_QPA_PLATFORM=xcb', 'QT_QUICK_BACKEND=software', `XDG_STATE_HOME=${estadoReal.stateHome}`, 'quickshell', '-p', path.join(runtime, 'shell.qml')]))
    const ipc = (...args) => bench(['exec', nome, '--', 'quickshell', 'ipc', '--pid', String(pid), 'call', 'capture', ...args])
    const esperar = async fn => {
      const fim = Date.now() + 20000
      let ultimoErro
      while (Date.now() < fim) {
        verificarCancelamento()
        try { const result = await fn(); if (result) return result } catch (e) { ultimoErro = e }
        await new Promise(r => setTimeout(r, 200))
      }
      throw erro(`O painel não confirmou a cena${ultimoErro ? `: ${ultimoErro.message}` : '.'}`)
    }
    await esperar(async () => (await ipc('ready')) === 'ready')
    for (const c of pedido.cenas) {
      const aba = c.aba || c.id
      const periodo = c.periodo || 'day'
      if (await ipc('select', aba, periodo) !== 'ok') throw erro(`Não foi possível selecionar ${aba}.`)
      const estado = await esperar(async () => {
        const e = JSON.parse(await ipc('state'))
        return e.aba === aba && e.periodo === periodo && e.modelos > 0 && e.largura >= 300 && e.altura >= 400 ? e : null
      })
      // Aguarde layout e transições do controle antes de renderizar o frame.
      await new Promise(r => setTimeout(r, 350)); verificarCancelamento()
      const arquivo = path.join(outputDir, `${c.id}.png`)
      if (await ipc('shot', arquivo) !== 'capturing') throw erro(`A captura ${c.id} não iniciou.`)
      await esperar(async () => fs.existsSync(arquivo) && fs.statSync(arquivo).size > 200)
      await run('ffmpeg', ['-v', 'error', '-i', arquivo, '-f', 'null', '-'], { timeout: 10000 })
      cenas.push({ id: c.id, observado: true, estado })
    }
    return { ...versao, ambiente: 'produto-real', dados: { tipo: 'reais', origem: 'estado local do Omarchy Agents', atualizadoEm: estadoReal.atualizadoEm, arquivos: estadoReal.arquivos }, cenas, metodo: 'Componente QML original em host X11 de captura; estado local real lido sem refresh; renderização da área do painel em 2x', bancada: nome }
  } finally {
    if (iniciado) await bench(['stop', nome])
  }
}
module.exports = { capturar, prepararRuntime, resolverEstadoReal }
