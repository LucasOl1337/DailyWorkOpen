const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { erro, lerJson, gravarJson, comTrava } = require('./arquivos.cjs')
const NOME_BANCADA = 'dailywork-campanhas'
const executar = promisify(execFile)
const DOMINIOS = ['x.com', 'twitter.com', 'linkedin.com', 'google.com', 'cognition.com', 'cognition.ai', 'ashbyhq.com']
function sessaoCobreDominios(sessao, dominios) {
  const importados = new Set(Array.isArray(sessao?.dominios) ? sessao.dominios : [])
  return dominios.every(dominio => importados.has(dominio))
}

function criarNavegador({ home = os.homedir(), executarComando = executar, fetchImpl = globalThis.fetch, nomeBancada = NOME_BANCADA, dominios = DOMINIOS, conferirAlvos = require('./cdp-saude.cjs').conferirAlvosResponsivos, esperaConexao = { tentativas: 150, intervalo: 300, reemitirACada: 50 }, spawnImpl = spawn } = {}) {
  const bench = path.join(home, '.agents/bin/agent-bench')
  const perfil = path.join(home, '.agents/desktop/sessions', nomeBancada, 'chromium')
  const registro = path.join(path.dirname(perfil), 'dailywork-sessao.json')
  const trava = path.join(path.dirname(perfil), 'dailywork-navegador.lock')
  const listaDominios = () => typeof dominios === 'function' ? dominios() : dominios
  function opcoesComando(extra = {}) {
    return { timeout: 35000, maxBuffer: 1024 * 1024, env: { ...process.env, AGENT_BENCH_OWNER: 'dailywork' }, ...extra }
  }
  async function comando(acao, args = []) {
    try {
      const { stdout } = await executarComando(bench, [acao, nomeBancada, ...args], opcoesComando())
      return JSON.parse(stdout)
    } catch (e) { throw erro('BANCADA_INDISPONIVEL', String(e.stderr || 'A bancada do DailyWork não está disponível.').slice(0, 500), 503) }
  }
  async function preservarLogin() {
    try { await executarComando(bench, ['keep', nomeBancada, 'login DailyWork persistente'], opcoesComando({ timeout: 10000 })) } catch {}
  }
  async function estado() {
    let bancada
    try { bancada = await comando('status') } catch { return { nome: nomeBancada, conectado: false, controle: 'indisponivel', workspace: null, sessao: lerJson(registro) } }
    let porta = null, endpoint = null, conectado = false
    try {
      const [numero, identidade] = fs.readFileSync(path.join(perfil, 'DevToolsActivePort'), 'utf8').trim().split('\n')
      porta = Number(numero)
      if (Number.isInteger(porta) && porta >= 1024 && porta <= 65535) {
        const r = await fetchImpl(`http://127.0.0.1:${porta}/json/version`, { signal: AbortSignal.timeout(1500) })
        const d = r.ok && await r.json()
        conectado = Boolean(d?.Browser && identidade?.startsWith('/devtools/browser/') && new URL(d.webSocketDebuggerUrl).pathname === identidade)
        if (conectado) endpoint = `ws://127.0.0.1:${porta}${identidade}`
      }
    } catch {}
    return { nome: nomeBancada, conectado, porta: conectado ? porta : null, endpoint, workspace: bancada.workspace || null, controle: bancada.control_mode || 'indisponivel', sessao: lerJson(registro) }
  }
  async function conectar() {
    let atual = await estado()
    if (atual.controle === 'humano') throw erro('CONTROLE_HUMANO', 'Você está com o controle da bancada. Devolva ao agente pelo painel da bancada para continuar.', 409)
    if (!atual.conectado) {
      try { await comando('cdp') } catch {
        try { await comando('ensure') } catch {}
      }
      atual = await estado()
      if (!atual.conectado) {
        await comando('browser', ['about:blank'])
        const tentativas = esperaConexao.tentativas ?? 150
        const intervalo = esperaConexao.intervalo ?? 300
        const reemitir = esperaConexao.reemitirACada ?? 50
        for (let n = 0; n < tentativas; n++) {
          atual = await estado()
          if (atual.conectado) break
          if (n > 0 && n % reemitir === 0) {
            try { await comando('browser', ['about:blank']) } catch {}
          }
          await new Promise(resolve => setTimeout(resolve, intervalo))
        }
      }
    }
    if (!atual.conectado) throw erro('NAVEGADOR_INDISPONIVEL', 'O navegador da bancada ainda não respondeu.', 503)
    await preservarLogin()
    return atual
  }
  async function comControle(fn) {
    const recusarHumano = async () => {
      const atual = await estado()
      if (atual.controle === 'humano') throw erro('CONTROLE_HUMANO', 'Você está com o controle da bancada. Devolva ao agente pelo painel da bancada para continuar.', 409)
      return atual
    }
    await recusarHumano()
    const runtime = path.join('/run/user', String(process.getuid?.() || os.userInfo().uid), 'agent-bench', nomeBancada)
    const codigo = 'import fcntl, sys\nfrom pathlib import Path\nruntime = Path(sys.argv[1])\nif (runtime / "human-control").exists():\n raise SystemExit(2)\ntry:\n lock = (runtime / "input.lock").open("a")\nexcept OSError:\n raise SystemExit(1)\nwith lock:\n fcntl.flock(lock, fcntl.LOCK_SH)\n if (runtime / "human-control").exists():\n  raise SystemExit(2)\n print("pronto", flush=True)\n sys.stdin.read()\n'
    const filho = spawnImpl('/usr/bin/python3', ['-c', codigo, runtime], { stdio: ['pipe', 'pipe', 'pipe'] })
    filho.stdin.on('error', () => {})
    let codigoSaida
    const fim = new Promise(resolve => { filho.once('exit', code => { codigoSaida = code; resolve(code) }); filho.once('error', () => resolve(null)) })
    try {
      await new Promise(resolve => {
        const prazo = setTimeout(() => { try { filho.kill('SIGTERM') } catch {} resolve(false) }, 5000)
        const acabar = () => { clearTimeout(prazo); resolve() }
        filho.stdout.once('data', acabar)
        filho.once('error', acabar)
        filho.once('exit', acabar)
      })
      if (codigoSaida === 2) throw erro('CONTROLE_HUMANO', 'Você está com o controle da bancada. Devolva ao agente pelo painel da bancada para continuar.', 409)
      await recusarHumano()
      return await fn()
    } finally { try { filho.stdin.end() } catch {} await fim }
  }
  async function importarSessao() {
    await conectar()
    return comTrava(trava, () => comControle(async () => {
      // Import only the work sites requested by this feature. Secrets remain in memory.
      const { criarImportadorSessaoChromium } = require('../integracoes/sessao-chromium.cjs')
      const importador = criarImportadorSessaoChromium({ home, lerLinhas: arquivo => {
        const { DatabaseSync } = require('node:sqlite')
        const db = new DatabaseSync(arquivo, { readOnly: true, readBigInts: true })
        try { return db.prepare('select host_key, name, value, encrypted_value, path, expires_utc, has_expires, is_secure, is_httponly, samesite from cookies').all() } finally { db.close() }
      } })
      const alvos = listaDominios()
      const dados = await importador.lerCookies(alvos)
      if (!dados.cookies.length) throw erro('SESSAO_AUSENTE', dados.motivo || 'Não há sessão dos sites de trabalho no Chromium. Você pode entrar na bancada.', 409)
      const estadoAtual = await estado()
      if (estadoAtual.controle !== 'agente') throw erro('CONTROLE_HUMANO', 'A bancada está com você. A importação foi interrompida.', 409)
      const { chromium } = require('playwright-core')
      const browser = await conectarPlaywright(chromium, estadoAtual)
      try {
        const cookies = dados.cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain || new URL(c.url).hostname, path: c.path, secure: c.secure, httpOnly: c.httpOnly, ...(c.expirationDate ? { expires: c.expirationDate } : {}), sameSite: ({ lax: 'Lax', strict: 'Strict', no_restriction: 'None' })[c.sameSite] || 'Lax' }))
        await browser.contexts()[0].addCookies(cookies)
        const sessao = { importadaEm: new Date().toISOString(), origem: dados.navegador, dominios: alvos, cookies: cookies.length, verificacao: 'Confira a conta nas páginas; importar cookies não garante login válido.' }
        gravarJson(registro, sessao)
        return { ...await estado(), sessao }
      } finally { await browser.close() }
    }))
  }
  async function preparar() {
    const atual = await conectar()
    return sessaoCobreDominios(atual.sessao, listaDominios()) ? atual : importarSessao()
  }
  async function abrirPagina(entrada = {}) {
    const url = require('./campanhas.cjs').urlPublica(entrada.url)
    if (!url) throw erro('URL_INVALIDA', 'Informe o link que deseja abrir.')
    await preparar()
    return comTrava(trava, async () => { await comando('browser', [url]); return estado() })
  }
  async function conectarPlaywright(chromium, estadoConhecido = null) {
    const estadoAtual = estadoConhecido || await estado()
    if (!estadoAtual.conectado || !estadoAtual.endpoint) throw erro('NAVEGADOR_INDISPONIVEL', 'O navegador da bancada ainda não respondeu.', 503)
    if (estadoAtual.controle !== 'agente') throw erro('CONTROLE_HUMANO', 'A bancada está com você. A operação foi interrompida.', 409)
    if (estadoAtual.porta) await conferirAlvos(estadoAtual.porta)
    return chromium.connectOverCDP(estadoAtual.endpoint, { timeout: 15000 })
  }
  return { estado, conectar, preparar, conectarPlaywright, comControle, importarSessao, abrirPagina, mostrar: () => comando('view'), trava, bench, perfil }
}

async function acaoNavegador(entrada) {
  if (!Object.hasOwn(entrada.origem || {}, 'agenda')) throw erro('AGENDA_VINCULO_AUSENTE', 'A ação não trouxe o vínculo da agenda. Inicie novamente a operação.')
  const autorizar = () => require('../agenda/guarda.cjs').conferir(entrada.origem.agenda)
  autorizar()
  const navegador = criarNavegador()
  const estado = await navegador.estado()
  if (!estado.conectado) throw erro('NAVEGADOR_INDISPONIVEL', 'Abra o navegador pelo DailyWork antes de continuar.')
  if (estado.controle !== 'agente') throw erro('CONTROLE_HUMANO', 'Aguarde a devolução do controle pelo humano.')
  const { chromium } = require('playwright-core')
  const browser = await navegador.conectarPlaywright(chromium, estado)
  try {
    const context = browser.contexts()[0]
    const pages = context.pages()
    const paginas = async () => Promise.all(context.pages().map(async p => { const cdp = await context.newCDPSession(p); try { const { targetInfo } = await cdp.send('Target.getTargetInfo'); return { id: targetInfo.targetId, titulo: await p.title(), url: p.url() } } finally { await cdp.detach() } }))
    if (entrada.acao === 'abas') return await paginas()
    if (entrada.acao === 'abrir') { const url = require('./campanhas.cjs').urlPublica(entrada.url); if (!url) throw erro('URL_INVALIDA', 'Informe a URL.'); const existente = pages.find(p => p.url() === url); if (!existente) { autorizar(); const p = await context.newPage(); await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }) } return await paginas() }
    const ids = await paginas()
    const page = pages[ids.findIndex(p => p.id === entrada.aba)]
    if (!page) throw erro('ABA_INVALIDA', 'Liste as abas e use o id atual.')
    const alvo = () => entrada.role ? page.getByRole(entrada.role, { name: entrada.nome, exact: true }) : page.locator(entrada.seletor)
    if (entrada.acao === 'ler') return { url: page.url(), titulo: await page.title(), conteudo: await page.locator('body').ariaSnapshot() }
    autorizar()
    if (entrada.acao === 'clicar') await alvo().click({ timeout: 10000 })
    else if (entrada.acao === 'preencher') await alvo().fill(entrada.texto, { timeout: 10000 })
    else if (entrada.acao === 'tecla') await alvo().press(entrada.tecla, { timeout: 10000 })
    else if (entrada.acao === 'capturar') { if (!path.isAbsolute(entrada.arquivo || '')) throw erro('ARQUIVO_INVALIDO', 'Use um caminho absoluto.'); await page.screenshot({ path: entrada.arquivo }); return { arquivo: entrada.arquivo } }
    else if (entrada.acao === 'fechar') { await page.close(); return await paginas() }
    else throw erro('ACAO_INVALIDA', 'Use abas, abrir, ler, clicar, preencher, tecla, capturar ou fechar.')
    return { url: page.url(), conteudo: await page.locator('body').ariaSnapshot() }
  } finally { await browser.close() }
}

function origemViva(origem) {
  if (!Number.isInteger(origem?.pid) || origem.pid < 2 || typeof origem.inicio !== 'string') return false
  try {
    const stat = fs.readFileSync(`/proc/${origem.pid}/stat`, 'utf8').split(') ')[1].split(' ')
    return stat[0] !== 'Z' && stat[19] === origem.inicio
  } catch { return false }
}
// Bench commands run under the bench server, outside the CLI process group.
// Address only browser commands bearing this exact execution id.
async function encerrarOperacoes(execucaoId) {
  function filhos() {
    return fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).flatMap(n => {
      try {
        const args = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').split('\0')
        const interno = args.indexOf('--interno')
        if (!args.includes(__filename) || interno < 0) return []
        const origem = JSON.parse(args[interno + 1]).origem
        return origem?.execucaoId === execucaoId ? [Number(n)] : []
      } catch { return [] }
    })
  }
  for (const pid of filhos()) { try { process.kill(pid, 'SIGTERM') } catch (e) { if (e.code !== 'ESRCH') throw e } }
  await new Promise(resolve => setTimeout(resolve, 150))
  for (const pid of filhos()) { try { process.kill(pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e } }
  for (let n = 0; n < 20 && filhos().length; n++) await new Promise(resolve => setTimeout(resolve, 50))
  if (filhos().length) throw erro('CANCELAMENTO_PENDENTE', 'Uma operação do navegador ainda não encerrou.', 409)
}

// Batimento da ação mais imediata do executor: a tela mostra o que o agente está fazendo agora.
function registrarAtividade(entrada) {
  const campanhaId = process.env.AUTOMACOES_CAMPANHA_ID
  if (!campanhaId || !/^[a-z0-9-]+$/.test(campanhaId)) return
  try {
    const lucasOlDir = process.env.LUCASOL_DIR || path.resolve(__dirname, '../../../LucasOL')
    const runs = path.join(lucasOlDir, 'Portfolio', 'empresas', campanhaId, 'runs')
    fs.mkdirSync(runs, { recursive: true, mode: 0o700 })
    const arquivo = path.join(runs, 'atividade.local.json')
    let url = entrada.url || ''
    try { url = url ? new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.slice(0, 40) : '' } catch {}
    fs.writeFileSync(arquivo + '.tmp', JSON.stringify({ execucaoId: process.env.AUTOMACOES_EXECUCAO_ID || null, acao: String(entrada.acao || ''), aba: entrada.aba || null, url, alvo: entrada.nome || entrada.seletor || null, em: new Date().toISOString() }), { mode: 0o600 })
    fs.renameSync(arquivo + '.tmp', arquivo)
  } catch {}
}
async function cli() {
  if (process.argv[2] === '--interno') {
    const entrada = JSON.parse(process.argv[3])
    if (!origemViva(entrada.origem)) throw erro('EXECUCAO_ENCERRADA', 'O comando que abriu esta operação já encerrou.')
    const timer = setInterval(() => { if (!origemViva(entrada.origem)) process.exit(1) }, 100)
    try { return await acaoNavegador(entrada) } finally { clearInterval(timer) }
  }
  const entrada = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : { acao: 'abas' }
  entrada.origem = { pid: process.pid, inicio: fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(') ')[1].split(' ')[19], execucaoId: process.env.AUTOMACOES_EXECUCAO_ID || null, agenda: require('../agenda/guarda.cjs').ambiente() }
  // agent-bench holds its human-control lease for the entire browser action.
  registrarAtividade(entrada)
  const { stdout } = await executar(path.join(os.homedir(), '.agents/bin/agent-bench'), ['exec', NOME_BANCADA, '--', process.versions.electron ? require('./executores.cjs').localizarBin('node') : process.execPath, __filename, '--interno', JSON.stringify(entrada)], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  return JSON.parse(stdout)
}
if (require.main === module) cli().then(data => process.stdout.write(JSON.stringify(data) + '\n')).catch(e => { process.stderr.write(JSON.stringify({ codigo: e.codigo || 'ERRO', mensagem: e.message }) + '\n'); process.exitCode = 1 })
module.exports = { criarNavegador, NOME_BANCADA, origemViva, encerrarOperacoes, sessaoCobreDominios, DOMINIOS }
