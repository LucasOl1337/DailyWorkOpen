// Processo principal do Electron: janela do DailyWork + hotkey global (estilo KamuiT).
// IPC e API local compartilham as mesmas operações de domínio.
// Agent-First: watch em data/ avisa o renderer quando um agente escreve em disco.

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { fileURLToPath } = require('node:url')
const { registrarOperacoes } = require('./lib-operacoes.cjs')
const { criarServicoAutomacoes } = require('./lib-automacoes.cjs')
const { criarServicoCandidaturas } = require('./lib-candidaturas.cjs')
const { criarServicoSkills } = require('./lib-skills.cjs')
const { criarCanvasPrincipal } = require('./lib-canvas-principal.cjs')
const operacoes = new Map()
const { iniciarApiLocal } = require('./lib-api-local.cjs')
const { criarPonteCanvas } = require('./lib-ponte-canvas.cjs')
const ponteCanvas = criarPonteCanvas()
let apiLocal = null
let agenda = null
let servicoCandidaturas = null
const escalaJanela = require('./lib-escala-janela.cjs')

// Perfil de dados alternativo: permite abrir uma segunda instância isolada
// (bancada de testes) sem disputar o lock nem o cofre da instância principal.
if (process.env.DAILYWORK_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.DAILYWORK_USER_DATA_DIR))
const lib = require('./lib-md.cjs')
const { criarServicoAgente } = require('./lib-agente-9router.cjs')
const { criarServicoExecutorNativo } = require('./lib-executor-nativo.cjs')
const { criarServicoAnaliseSumario } = require('./lib-analise-sumario.cjs')
const { criarFluxoLucasOL } = require('./lib-fluxo-lucasol.cjs')
const { criarRotinaSumario } = require('./lib-rotina-sumario.cjs')
const { criarIntegracaoSite } = require('./lib-site-integration.cjs')
const { criarServicoSumario } = require('./lib-sumario-diario.cjs')
const { criarRegistroIntegracoes } = require('./integracoes/registro.cjs')
const { criarLogicaEditorial } = require('./lib-logica-editorial.cjs')
const { criarRedatorPublicacoes } = require('./lib-redator-publicacoes.cjs')
const { criarFilaEditorial } = require('./lib-fila-editorial.cjs')
const { criarJobsMidiasEditoriais } = require('./lib-jobs-midias-editoriais.cjs')
const { criarImportadorSessaoChromium, hostPertence } = require('./integracoes/sessao-chromium.cjs')
const { version: VERSAO_APP } = require('../package.json')
const ID_JOB_MIDIA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
function exigirIdJobMidia(id) {
  if (typeof id !== 'string' || !ID_JOB_MIDIA.test(id)) throw Object.assign(new Error('identificador de job inválido.'), { codigo: 'ID_INVALIDO', status: 400 })
  return id
}
let analiseSumario = null
let sumario = null
const fluxoLucasOL = criarFluxoLucasOL({
  daily: lib,
  obterAnaliseSumario: (dia) => (analiseSumario ? analiseSumario.obter(dia) : null),
  obterInputsSumario: (dia) => (sumario ? sumario.obterInputs(dia) : null),
})

// Conexões externas (GitHub, LinkedIn, X, Reddit): cofre cifrado em userData,
// webviews com partição persistente por conta e publicação só por confirmação.
const integracoes = criarRegistroIntegracoes({
  habilitarSessoes: !process.env.DAILYWORK_CAPTURE_PATH || process.env.DAILYWORK_CAPTURE_VISUAL_SESSION === '1',
  userDataDir: app.getPath('userData'),
  dataDir: lib.DATA_DIR,
  safeStorage,
  versaoApp: VERSAO_APP,
  abrirAutorizacao: ({ url, partition }) => abrirJanelaAutorizacao(url, partition),
})
const PARTICOES_PERMITIDAS = new Set(integracoes.partitions())
const agente = criarServicoAgente({ lib, fluxo: fluxoLucasOL, integracoes })
const executorNativo = criarServicoExecutorNativo({
  lib,
  executarComFerramentas: (entrada) => agente.executarComFerramentas(entrada),
  onUpdate: (estado) => janela?.webContents.send('executor:atualizado', estado),
})
sumario = criarServicoSumario({ appRoot: path.resolve(__dirname, '..'), fontesExtras: integracoes.fontesSumario() })
analiseSumario = criarServicoAnaliseSumario({
  sumario,
  completar: (entrada) => agente.completar(entrada),
})
const logicaEditorial = criarLogicaEditorial({ dataDir: lib.DATA_DIR })
const redator = criarRedatorPublicacoes({
  completar: (entrada) => agente.completar(entrada),
  registro: integracoes,
  lib,
  sumario,
  analiseSumario,
  logica: () => logicaEditorial.obter(),
})
const filaEditorial = criarFilaEditorial({
  dataDir: lib.DATA_DIR,
  registro: integracoes,
  onUpdate: (item) => janela?.webContents.send('editorial:atualizado', item),
})
// Visão global do agente: a Fila editorial entra como fonte somente leitura.
agente.definirFontes({ fila: filaEditorial, canvas: ponteCanvas })
const jobsMidiasEditoriais = criarJobsMidiasEditoriais({
  fila: filaEditorial,
  dataDir: lib.DATA_DIR,
  completar: (entrada) => agente.completar(entrada),
  completarComImagens: (entrada) => agente.completarComImagens(entrada),
  logica: () => logicaEditorial.obter(),
  onUpdate: (job) => janela?.webContents.send('editorial:midia-job-atualizado', job),
})
let producaoEditorial = null
try {
  const { criarProducaoEditorial } = require('./lib-producao-editorial.cjs')
  producaoEditorial = criarProducaoEditorial({
    fila: filaEditorial,
    registro: integracoes,
    lib,
    sumario,
    analiseSumario,
    completar: (entrada) => agente.completar(entrada),
    jobsMidias: jobsMidiasEditoriais,
    logica: () => logicaEditorial.obter(),
    onUpdate: (estado) => janela?.webContents.send('editorial:producao-atualizada', estado),
  })
} catch (erro) {
  if (erro?.code !== 'MODULE_NOT_FOUND' || !String(erro?.message || '').includes('lib-producao-editorial')) throw erro
}

// O app pode ser iniciado por outro processo que encerra o pipe de stdout.
// Logs posteriores do watcher não devem derrubar o Electron com EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (erro) => {
    if (erro.code !== 'EPIPE') throw erro
  })
}

// Tecla global de abre/fecha no Windows. No Omarchy/Hyprland a tecla fica
// no compositor (Super+D) e o Electron só recebe --toggle da segunda instância.
const TECLA_TOGGLE = process.platform === 'win32' ? 'Home' : ''
const CAMINHO_CAPTURA = process.env.DAILYWORK_CAPTURE_PATH || ''
const MODO_CAPTURA = Boolean(CAMINHO_CAPTURA)
const MODO_BACKGROUND = !MODO_CAPTURA && process.argv.includes('--background')
const VIEW_ARGUMENTO = process.argv.find((argumento) => argumento.startsWith('--view='))
const VIEW_INICIAL = VIEW_ARGUMENTO ? VIEW_ARGUMENTO.slice('--view='.length) : ''
const MANTER_EM_SEGUNDO_PLANO = process.platform === 'win32' || process.platform === 'linux'

if (process.platform === 'linux') {
  app.setName('DailyWork')
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}
const CAMINHO_INDEX = path.resolve(__dirname, '..', 'dist', 'index.html')
const INSTANCIA_PRINCIPAL = MODO_CAPTURA || app.requestSingleInstanceLock()
let siteIntegration = null

function dimensaoCaptura(nome, padrao) {
  const valor = Number(process.env[nome])
  return Number.isFinite(valor) && valor >= 640 ? Math.round(valor) : padrao
}

async function capturarPagina(janelaAlvo, incluirFramesRemotos) {
  if (!incluirFramesRemotos) return janelaAlvo.capturePage()

  const depurador = janelaAlvo.webContents.debugger
  const anexadoAqui = !depurador.isAttached()
  try {
    if (anexadoAqui) depurador.attach('1.3')
    const captura = await depurador.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    return nativeImage.createFromBuffer(Buffer.from(captura.data, 'base64'))
  } finally {
    if (anexadoAqui && depurador.isAttached()) depurador.detach()
  }
}

let janela = null
let retryTimer = null
let encerrando = false
let preferenciaEscala = { modo: 'automatico', zoom: null }
let timerEscala = null

function arquivoEscala() {
  return path.join(app.getPath('userData'), 'interface-escala.json')
}

function carregarPreferenciaEscala() {
  try {
    return escalaJanela.lerPreferencia(fs.readFileSync(arquivoEscala(), 'utf8'))
  } catch (erro) {
    if (erro.code !== 'ENOENT') console.warn('[DailyWork] não li a preferência de escala', erro)
    return escalaJanela.lerPreferencia('')
  }
}

function gravarPreferenciaEscala(pref) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(arquivoEscala(), escalaJanela.serializarPreferencia(pref))
  } catch (erro) {
    console.warn('[DailyWork] não gravei a preferência de escala', erro)
  }
}

function areaConteudoJanela() {
  if (!janela || janela.isDestroyed()) return { width: 0, height: 0 }
  const [width, height] = janela.getContentSize()
  return { width, height }
}

function areaParaEscala() {
  const conteudo = areaConteudoJanela()
  if (preferenciaEscala.modo !== 'automatico' || !janela || janela.isDestroyed()) return conteudo
  // Antes do mosaico do Hyprland a janela ainda nasce em 1440×900.
  if (conteudo.width > 1460 || conteudo.height > 920) return conteudo
  try {
    const area = screen.getDisplayMatching(janela.getBounds()).workAreaSize
    if (area.width > conteudo.width + 40 && area.height > conteudo.height + 40) return area
  } catch {
    // screen indisponível no bootstrap
  }
  return conteudo
}

function estadoEscala() {
  const zoom = janela && !janela.isDestroyed()
    ? janela.webContents.getZoomFactor()
    : escalaJanela.resolverZoom(preferenciaEscala, areaConteudoJanela())
  return { modo: preferenciaEscala.modo, zoom: escalaJanela.limitarZoom(zoom) }
}

function publicarEscala() {
  if (MODO_CAPTURA || !janela || janela.isDestroyed()) return estadoEscala()
  const zoom = escalaJanela.resolverZoom(preferenciaEscala, areaParaEscala())
  janela.webContents.setZoomFactor(zoom)
  const estado = { modo: preferenciaEscala.modo, zoom }
  janela.webContents.send('interface:escala', estado)
  return estado
}

function agendarEscalaAutomatica() {
  if (MODO_CAPTURA || preferenciaEscala.modo !== 'automatico') return
  if (timerEscala) clearTimeout(timerEscala)
  timerEscala = setTimeout(() => {
    timerEscala = null
    publicarEscala()
  }, 120)
}

function alterarEscala(direcao) {
  const atual = estadoEscala().zoom
  preferenciaEscala = { modo: 'manual', zoom: escalaJanela.proximoZoom(atual, direcao) }
  gravarPreferenciaEscala(preferenciaEscala)
  return publicarEscala()
}

function resetarEscala() {
  preferenciaEscala = { modo: 'automatico', zoom: null }
  gravarPreferenciaEscala(preferenciaEscala)
  return publicarEscala()
}

function tratarAtalhoEscala(evento, input) {
  const acao = escalaJanela.atalhoDeEscala(input)
  if (!acao) return
  evento.preventDefault()
  if (acao === 'aumentar') alterarEscala(1)
  else if (acao === 'diminuir') alterarEscala(-1)
  else resetarEscala()
}

// A autorização OAuth abre em uma janela própria do DailyWork, na mesma
// partição do viewer da conta: a sessão logada do webview é reaproveitada e
// o navegador da pessoa não é tocado.
function abrirJanelaAutorizacao(url, partition) {
  if (!PARTICOES_PERMITIDAS.has(partition)) throw new Error('partição de autorização não permitida')
  const janelaAuth = new BrowserWindow({
    width: 560,
    height: 760,
    parent: janela || undefined,
    autoHideMenuBar: true,
    title: 'Autorizar conta · DailyWork',
    backgroundColor: '#171a1b',
    webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  janelaAuth.webContents.setWindowOpenHandler(({ url: destino }) => {
    abrirLinkExterno(destino)
    return { action: 'deny' }
  })
  void janelaAuth.loadURL(url).catch(() => {})
  return {
    fechar() {
      if (!janelaAuth.isDestroyed()) janelaAuth.close()
    },
  }
}

// Webviews das conexões: sem preload, sem Node, só partições conhecidas e https.
// Provedores de login (Google, Microsoft, Apple) recusam OAuth em user agents
// com "Electron"; as partições das contas se apresentam como o Chrome
// embutido, sem o nome do app nem do Electron.
const UA_CONEXOES = app.userAgentFallback.replace(/ DailyWork\/\S+/i, '').replace(/ Electron\/\S+/, '')
const DEBUG_CONEXOES = process.env.DAILYWORK_DEBUG_CONEXOES === '1'

function logConexoes(...args) {
  if (DEBUG_CONEXOES) console.error('[DailyWork conexões]', ...args)
}

// Popups de login costumam nascer vazios (about:blank) e só depois navegar
// para o provedor; a navegação continua restrita a http(s) em will-navigate.
function popupPermitido(url) {
  return url === '' || url === 'about:blank' || /^https:\/\//.test(url)
}

function vigiarConteudoDeConexao(contents) {
  contents.setWindowOpenHandler(({ url, frameName, disposition }) => {
    logConexoes('window-open', { url, frameName, disposition })
    if (!popupPermitido(url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: janela || undefined,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      },
    }
  })
  contents.on('did-create-window', (filha, detalhes) => {
    logConexoes('popup criado', detalhes?.url || '')
    // Popups de popups (Google abre um segundo nível em alguns fluxos).
    vigiarConteudoDeConexao(filha.webContents)
  })
  contents.on('will-navigate', (evento, url) => {
    if (!/^https?:\/\//.test(url)) evento.preventDefault()
  })
  contents.on('console-message', (detalhes) => {
    logConexoes('console', detalhes?.level, String(detalhes?.message || '').slice(0, 300))
  })
  contents.on('did-fail-load', (_evento, codigo, descricao, url, principal) => {
    if (principal && codigo !== -3) logConexoes('falha de carga', codigo, descricao, url)
  })
}

// Sessão do Chromium instalado no viewer: na primeira abertura de cada
// conexão (ou quando a pessoa pede), os cookies do navegador entram na
// partição. O marcador evita reimportar a cada abertura.
const importadorSessao = criarImportadorSessaoChromium()
const ARQUIVO_MARCADOR_SESSOES = () => path.join(app.getPath('userData'), 'integracoes-sessoes.json')

function lerMarcadorSessoes() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_MARCADOR_SESSOES(), 'utf8')) || {} } catch { return {} }
}

function gravarMarcadorSessoes(marcador) {
  try { fs.writeFileSync(ARQUIVO_MARCADOR_SESSOES(), JSON.stringify(marcador, null, 2), { mode: 0o600 }) } catch { /* marcador é só conveniência */ }
}

async function prepararSessaoConexao(id, { forcar = false } = {}) {
  const conexao = integracoes.obterConexao(id)
  const marcador = lerMarcadorSessoes()
  if (!forcar && marcador[conexao.id]) return { origem: 'viewer', importados: 0, navegador: marcador[conexao.id].navegador || null, em: marcador[conexao.id].em }
  const sessao = session.fromPartition(conexao.partition)
  const dominios = conexao.dominiosSessao || [conexao.dominio]
  const resultado = await importadorSessao.importar({ sessao, dominios, forcar: true })
  logConexoes('sessão do Chromium', conexao.id, { navegador: resultado.navegador, importados: resultado.importados, removidos: resultado.removidos, motivo: resultado.motivo, erros: resultado.erros })
  const temSessaoDoDominio = (await sessao.cookies.get({})).some((cookie) => hostPertence(cookie.domain, dominios))
  // Sem importação (keyring indisponível, navegador sem sessão) não marca:
  // a próxima abertura tenta de novo.
  if (resultado.importados > 0) {
    marcador[conexao.id] = { em: new Date().toISOString(), navegador: resultado.navegador, importados: resultado.importados }
    gravarMarcadorSessoes(marcador)
  }
  return {
    origem: resultado.importados ? 'chromium' : 'nenhuma',
    navegador: resultado.navegador,
    perfil: resultado.perfil,
    importados: resultado.importados,
    removidos: resultado.removidos || 0,
    sessaoDoDominio: temSessaoDoDominio,
    motivo: resultado.motivo || null,
    erros: resultado.erros || [],
  }
}

function protegerWebviews() {
  for (const particao of PARTICOES_PERMITIDAS) session.fromPartition(particao).setUserAgent(UA_CONEXOES)
  app.on('web-contents-created', (_evento, contents) => {
    contents.on('will-attach-webview', (evento, webPreferences, params) => {
      delete webPreferences.preload
      delete webPreferences.preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      const origemOk = /^https:\/\//.test(String(params.src || ''))
      if (!PARTICOES_PERMITIDAS.has(String(params.partition || '')) || !origemOk) evento.preventDefault()
    })
    if (contents.getType() === 'webview') vigiarConteudoDeConexao(contents)
  })
}

async function coletarSumarioENotificar(dia) {
  const resultado = await sumario.coletar(dia)
  janela?.webContents.send('sumario:atualizado', { dia, resultado })
  return resultado
}

async function analisarSumarioENotificar(dia, perfilId, opcoes = {}) {
  const resultado = await analiseSumario.analisar(dia, {
    perfilId,
    ...opcoes,
    onProgress: (progresso) => {
      janela?.webContents.send('sumario:analise-progresso', { dia, progresso })
    },
  })
  janela?.webContents.send('sumario:analise-atualizada', { dia, resultado })
  return resultado
}

const rotinaSumario = criarRotinaSumario({
  coletar: (dia) => coletarSumarioENotificar(dia),
  obterAnalise: (dia) => analiseSumario.obter(dia),
  analisar: (dia, opcoes) => analisarSumarioENotificar(dia, undefined, opcoes),
})

function abrirLinkExterno(url) {
  try {
    const destino = new URL(url)
    if (destino.protocol === 'http:' || destino.protocol === 'https:') {
      void shell.openExternal(destino.toString()).catch(() => {})
    }
  } catch {
    // Link inválido permanece bloqueado dentro do app.
  }
}

function ehOrigemDailyWork(url) {
  try {
    const origem = new URL(url)
    return origem.protocol === 'file:' && path.resolve(fileURLToPath(origem)) === CAMINHO_INDEX
  } catch {
    return false
  }
}

function toggleJanela() {
  if (!janela) return
  if (janela.isVisible() && !janela.isMinimized()) {
    janela.hide() // o compositor devolve o foco à janela anterior
  } else {
    mostrarJanela()
  }
}

function mostrarJanela() {
  if (!janela) return
  janela.show()
  if (janela.isMinimized()) janela.restore()
  // Omarchy suprime maximize; o mosaico do Hyprland é o enquadramento nativo.
  if (process.platform === 'win32') janela.maximize()
  janela.focus()
}

// Mesma estratégia do KamuiT: se outro app segura a tecla, tenta de novo a cada 3s.
function registrarHotkey() {
  if (!TECLA_TOGGLE) return
  const ok = globalShortcut.register(TECLA_TOGGLE, toggleJanela)
  if (ok) {
    console.log(`[DailyWork] hotkey global registrada: ${TECLA_TOGGLE}`)
    return
  }
  console.warn(`[DailyWork] ${TECLA_TOGGLE} ocupada por outro app; tentando a cada 3s…`)
  if (!retryTimer) {
    retryTimer = setInterval(() => {
      if (globalShortcut.register(TECLA_TOGGLE, toggleJanela)) {
        clearInterval(retryTimer)
        retryTimer = null
        console.log('[DailyWork] hotkey registrada após retry')
      }
    }, 3000)
  }
}

function instalarMenuEdicao() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
  ]))
}

function criarJanela() {
  const largura = MODO_CAPTURA ? dimensaoCaptura('DAILYWORK_CAPTURE_WIDTH', 1200) : 1440
  const altura = MODO_CAPTURA ? dimensaoCaptura('DAILYWORK_CAPTURE_HEIGHT', 800) : 900
  janela = new BrowserWindow({
    width: largura,
    height: altura,
    show: MODO_CAPTURA || !MODO_BACKGROUND,
    useContentSize: MODO_CAPTURA,
    resizable: !MODO_CAPTURA,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'DailyWork',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webviewTag: true,
    },
  })
  janela.webContents.setWindowOpenHandler(({ url }) => {
    abrirLinkExterno(url)
    return { action: 'deny' }
  })
  janela.webContents.on('will-navigate', (evento, url) => {
    if (!ehOrigemDailyWork(url)) {
      evento.preventDefault()
      abrirLinkExterno(url)
    }
  })
  if (MODO_CAPTURA && process.env.DAILYWORK_CAPTURE_DEBUG === '1') {
    janela.webContents.on('console-message', (evento) => {
      console.log(`[DailyWork renderer] ${evento.message}`)
    })
  }
  if (!MODO_CAPTURA && !MODO_BACKGROUND && process.platform === 'win32') janela.maximize()
  const query = {}
  if (VIEW_INICIAL) query.view = VIEW_INICIAL
  if (MODO_CAPTURA) {
    query.view = process.env.DAILYWORK_CAPTURE_VIEW || 'principal'
    if (process.env.DAILYWORK_CAPTURE_MODULO === 'candidaturas') { query.moduloAutomacoes = 'candidaturas'; if (query.view === 'automacoes') query.view = 'candidaturas' }
    if (process.env.DAILYWORK_CAPTURE_CAMPANHA_CONFIG === '1') query.configCampanha = '1'
    if (process.env.DAILYWORK_CAPTURE_CAMPANHA_NOVA === '1') query.novaCampanha = '1'
    if (['pesquisa', 'biblioteca', 'materiais', 'operacao'].includes(process.env.DAILYWORK_CAPTURE_AUTOMACOES_TAB)) query.abaAutomacoes = process.env.DAILYWORK_CAPTURE_AUTOMACOES_TAB
    for (const [variavel, parametro] of [['DAILYWORK_CAPTURE_AUTOMACOES_CONTEXT', 'contextoAutomacao'], ['DAILYWORK_CAPTURE_AUTOMACOES_MATERIAL', 'materialAutomacao']]) {
      if (/^[a-f0-9-]{36}$/.test(process.env[variavel] || '')) query[parametro] = process.env[variavel]
    }
    if (process.env.DAILYWORK_CAPTURE_MODE) query.mode = process.env.DAILYWORK_CAPTURE_MODE
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(process.env.DAILYWORK_CAPTURE_EDITORIAL_ITEM || '')) {
      query.item = process.env.DAILYWORK_CAPTURE_EDITORIAL_ITEM
    }
    if (['resumo', 'inputs', 'estudos', 'conversa'].includes(process.env.DAILYWORK_CAPTURE_SUMMARY_TAB)) {
      query.abaSumario = process.env.DAILYWORK_CAPTURE_SUMMARY_TAB
    }
    if (process.env.DAILYWORK_CAPTURE_ASSISTANT === 'open') query.assistente = 'open'
    if (process.env.DAILYWORK_CAPTURE_PREPARATION === 'open') query.preparacao = 'open'
    if (process.env.DAILYWORK_CAPTURE_CLOSING === 'open') query.fechamento = 'open'
    if (['preparacao', 'fechamento', 'sumario-inputs', 'sumario-quiz', 'sumario-chat', 'editorial-revisao', 'editorial-midia'].includes(process.env.DAILYWORK_CAPTURE_FOCUS)) {
      query.captura = process.env.DAILYWORK_CAPTURE_FOCUS
    }
    if (['start', 'end'].includes(process.env.DAILYWORK_CAPTURE_ALIGN)) {
      query.capturaAlinhamento = process.env.DAILYWORK_CAPTURE_ALIGN
    }
    if (/^[a-z0-9-]+$/i.test(process.env.DAILYWORK_CAPTURE_INPUT_SOURCE || '')) {
      query.fonteInputs = process.env.DAILYWORK_CAPTURE_INPUT_SOURCE
    }
    if (process.env.DAILYWORK_CAPTURE_INPUT_COVERAGE === 'open') {
      query.coberturaInputs = 'open'
    }
    if (process.env.DAILYWORK_CAPTURE_SITE_INTEGRATION === 'open') {
      query.integracao = 'open'
    }
    if (['conta', 'publicar', 'atividade'].includes(process.env.DAILYWORK_CAPTURE_CONNECTION_TAB)) {
      query.abaConexao = process.env.DAILYWORK_CAPTURE_CONNECTION_TAB
    }
  }
  if(MODO_CAPTURA&&process.env.DAILYWORK_CAPTURE_ZOOM)janela.webContents.setZoomFactor(escalaJanela.limitarZoom(Number(process.env.DAILYWORK_CAPTURE_ZOOM)))
  const paginaCarregada = janela.loadFile(CAMINHO_INDEX, { query })
  if (!MODO_CAPTURA) {
    preferenciaEscala = carregarPreferenciaEscala()
    janela.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})
    publicarEscala()
    janela.on('resize', agendarEscalaAutomatica)
    janela.on('moved', agendarEscalaAutomatica)
    janela.webContents.on('did-finish-load', publicarEscala)
    janela.webContents.on('before-input-event', tratarAtalhoEscala)
  }
  if (MODO_CAPTURA && process.env.DAILYWORK_CAPTURE_HOLD !== '1') {
    paginaCarregada.then(() => {
      if(process.env.DAILYWORK_CAPTURE_ZOOM)janela.webContents.setZoomFactor(escalaJanela.limitarZoom(Number(process.env.DAILYWORK_CAPTURE_ZOOM)))
      // Blocos, imagens e a projeção do vault carregam depois do HTML. O
      // harness espera o próprio React declarar a tela pronta, em vez de
      // depender da velocidade do disco em uma inicialização fria.
      setTimeout(async () => {
        try {
          const limite = Date.now() + 15000
          while (Date.now() < limite) {
            const pronto = await janela.webContents.executeJavaScript(`
              (() => {
                if (new URLSearchParams(location.search).get('assistente') === 'open') {
                  const assistente = document.querySelector('[data-testid="assistente-dia"]')
                  if (assistente?.getAttribute('data-assistente-ready') !== 'true') return false
                }
                if (new URLSearchParams(location.search).get('preparacao') === 'open') {
                  const preparacao = document.querySelector('[data-testid="preparacao-dia"]')
                  if (preparacao?.getAttribute('data-preparacao-ready') !== 'true') return false
                }
                if (new URLSearchParams(location.search).get('fechamento') === 'open') {
                  const fechamento = document.querySelector('[data-testid="fechamento-dia"]')
                  if (fechamento?.getAttribute('data-fechamento-ready') !== 'true') return false
                }
                const agenda = document.querySelector('[data-agenda-ready]')
                if(agenda&&agenda.getAttribute('data-agenda-ready')!=='true')return false
                const automacoes = document.querySelector('[data-automacoes-ready]')
                if (automacoes) return automacoes.getAttribute('data-automacoes-ready') === 'true' && !automacoes.querySelector('[aria-busy="true"]') && (!new URLSearchParams(location.search).get('contextoAutomacao') || Boolean(automacoes.querySelector('.auto-dialog[open]')))
                const canvas = document.querySelector('[data-dailywork-ready]')
                if (canvas) {
                  if (canvas.getAttribute('data-dailywork-ready') !== 'true') return false
                  if (document.querySelector('.tl-loading')) return false
                  const view = new URLSearchParams(location.search).get('view')
                  if (view === 'principal' && canvas.classList.contains('principal-root')) {
                    const imagens = [...document.querySelectorAll('img.tl-image')]
                    return document.querySelectorAll('.portfolio-shape').length >= 3 &&
                      imagens.length >= 3 && imagens.every((imagem) => imagem.complete && imagem.naturalWidth > 0)
                  }
                  return true
                }
                const resumo = document.querySelector('.dia-grade-principal')
                if (resumo) {
                  if (resumo.getAttribute('aria-busy') !== 'false') return false
                  return true
                }
                const sumario = document.querySelector('[data-sumario-ready]')
                if (sumario) {
                  if (sumario.getAttribute('data-sumario-ready') !== 'true') return false
                  if (new URLSearchParams(location.search).get('abaSumario') === 'inputs') {
                    return document.querySelector('[data-inputs-ready]')?.getAttribute('data-inputs-ready') === 'true'
                  }
                  return true
                }
                return false
              })()
            `)
            if (pronto) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          let fonteEstavel = query.fonteInputs ? 0 : 2
          for (let tentativa = 0; tentativa < 10 && fonteEstavel < 2; tentativa += 1) {
            const aplicada = await janela.webContents.executeJavaScript(`
              (() => {
                const fonte = new URLSearchParams(location.search).get('fonteInputs')
                if (!fonte) return true
                const seletor = document.querySelector('[aria-label="Filtrar inputs por fonte"]')
                if (!seletor || ![...seletor.options].some((opcao) => opcao.value === fonte)) return false
                if (seletor.value === fonte) return true
                seletor.value = fonte
                seletor.dispatchEvent(new Event('change', { bubbles: true }))
                return false
              })()
            `)
            fonteEstavel = aplicada ? fonteEstavel + 1 : 0
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
          if (query.coberturaInputs === 'open') {
            await janela.webContents.executeJavaScript(`
              document.querySelector('[data-testid="cobertura-inputs"]')?.setAttribute('open', '')
            `)
          }
          await janela.webContents.executeJavaScript(`
            (() => {
              const parametros = new URLSearchParams(location.search)
              const foco = parametros.get('captura')
              const alinhamento = parametros.get('capturaAlinhamento')
              if (foco === 'editorial-revisao' || foco === 'editorial-midia') {
                const alvo = document.querySelector(foco === 'editorial-revisao' ? '[data-testid="fila-revisao-editorial"]' : '.fila-media-jobs')
                if (foco === 'editorial-midia') alvo?.setAttribute('open', '')
                alvo?.scrollIntoView({ block: 'start' })
                return
              }
              const seletor = foco === 'preparacao'
                ? '[data-testid="preparacao-dia"]'
                : foco === 'fechamento'
                  ? '[data-testid="fechamento-dia"]'
                  : foco === 'sumario-inputs'
                    ? '[data-testid="sumario-inputs"]'
                  : foco === 'sumario-quiz'
                    ? '.sumario-quiz'
                    : foco === 'sumario-chat'
                      ? '.sumario-conversation-chat__composer'
                      : null
              if (!seletor) return
              const fim = alinhamento === 'end' || (!alinhamento && ['fechamento', 'sumario-chat'].includes(foco))
              document.querySelector(seletor)?.scrollIntoView({ block: fim ? 'end' : 'start' })
              document.querySelector('.dia-painel')?.scrollBy(0, fim ? 48 : -64)
            })()
          `)
          // Não espere por requestAnimationFrame aqui: o Chromium pode pausar
          // frames de uma janela compacta ou momentaneamente ocluída.
          await new Promise((resolve) => setTimeout(resolve, 80))
          await new Promise((resolve) => setTimeout(resolve, 900))
          if (process.env.DAILYWORK_CAPTURE_DEBUG === '1') {
            for (const frame of janela.webContents.mainFrame.framesInSubtree) {
              console.log('[DailyWork frame]', frame.url, await frame.executeJavaScript('document.body.innerText.slice(0, 80)'))
            }
          }
          let imagem = null
          let ultimoErro = null
          for (let tentativa = 0; tentativa < 5 && !imagem; tentativa += 1) {
            try {
              janela.webContents.invalidate()
              await new Promise((resolve) => setTimeout(resolve, 250))
              imagem = await capturarPagina(janela, query.view === 'site' || String(query.view || '').startsWith('conexao:'))
            } catch (erro) {
              ultimoErro = erro
              await new Promise((resolve) => setTimeout(resolve, 450))
            }
          }
          if (!imagem) throw ultimoErro || new Error('Captura sem imagem')
          fs.mkdirSync(path.dirname(CAMINHO_CAPTURA), { recursive: true })
          fs.writeFileSync(CAMINHO_CAPTURA, imagem.toPNG())
          console.log(`[DailyWork] captura salva: ${CAMINHO_CAPTURA}`)
        } catch (erro) {
          console.error('[DailyWork] falha ao capturar janela:', erro)
          process.exitCode = 1
        } finally {
          app.quit()
        }
      }, 250)
    }).catch((erro) => {
      console.error('[DailyWork] falha ao carregar janela para captura:', erro)
      process.exitCode = 1
      app.quit()
    })
  } else {
    void paginaCarregada.catch((erro) => console.error('[DailyWork] falha ao carregar janela:', erro))
  }
  janela.on('close', (evento) => {
    if (!MODO_CAPTURA && !encerrando) {
      evento.preventDefault()
      janela.hide()
    }
  })
  janela.on('closed', () => {
    janela = null
  })
}

// Watch em data/: se a mudança NÃO foi escrita própria (UI salvando snapshot),
// avisa o renderer para recarregar o canvas do disco (escrita de agente).
function iniciarWatcher() {
  fs.mkdirSync(lib.DATA_DIR, { recursive: true })
  let timer = null
  fs.watch(lib.DATA_DIR, { recursive: true }, (_evento, nome) => {
    const relativo = String(nome || '').replace(/\\/g, '/').toLowerCase()
    if (relativo.startsWith('sumarios/')) return
    if (!lib.foiEscritaExterna()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      console.log('[DailyWork] mudança externa em data/ — avisando renderer')
      janela?.webContents.send('blocos:externos')
    }, 400)
  })
}

// O vault permanece a fonte canônica. Mudanças feitas pelo Obsidian, por um
// agente ou pelo editor do DailyWork atualizam somente a projeção visual.
function iniciarWatcherConhecimento() {
  if (!fs.existsSync(lib.CONHECIMENTO_DIR)) return
  let timer = null
  fs.watch(lib.CONHECIMENTO_DIR, { recursive: true }, (_evento, nome) => {
    const alterado = String(nome || '').replace(/\\/g, '/').toLowerCase()
    const ehNota = alterado.endsWith('.md')
    const ehLayout = alterado.endsWith('.obsidian/plugins/lucas-hierarchy-graph/data.json')
    if (nome && !ehNota && !ehLayout) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      console.log('[DailyWork] Knowledge do workspace mudou — atualizando projeção')
      janela?.webContents.send('conhecimento:externo')
    }, 400)
  })
}

// Envelope padrão de resposta IPC: { ok, data?, erro? } — mesmo do HTTP.
function lidarAgente(fn) {
  return async (evento, ...args) => {
    try {
      const origem = String(evento.senderFrame?.url || evento.sender?.getURL?.() || '')
      if (!ehOrigemDailyWork(origem)) {
        return {
          ok: false,
          erro: { codigo: 'ORIGEM_NAO_PERMITIDA', mensagem: 'Origem IPC não permitida.' },
        }
      }
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return {
        ok: false,
        erro: {
          codigo: typeof e?.codigo === 'string' ? e.codigo : 'ERRO_INTERNO',
          mensagem:
            typeof e?.codigo === 'string'
              ? String(e.message || 'Falha ao executar o agente.')
              : 'O agente encontrou uma falha interna.',
        },
      }
    }
  }
}

if (!INSTANCIA_PRINCIPAL) app.quit()

app.on('second-instance', (_evento, commandLine) => {
  if (commandLine.includes('--toggle')) {
    toggleJanela()
    return
  }
  if (!commandLine.includes('--background')) mostrarJanela()
})

app.whenReady().then(async () => {
  if (!INSTANCIA_PRINCIPAL) return
  siteIntegration = criarIntegracaoSite({
    rootDir: path.resolve(__dirname, '..', '..'),
    userDataDir: app.getPath('userData'),
    safeStorage,
  })
  const automacoes = criarServicoAutomacoes({ dataDir: lib.DATA_DIR, completar: entrada => agente.completar(entrada) })
  const candidaturas = criarServicoCandidaturas({ privateDir: MODO_CAPTURA ? path.join(lib.DATA_DIR, '.candidaturas') : undefined, desabilitarExecucao: MODO_CAPTURA })
  servicoCandidaturas = candidaturas
  agenda = require('./agenda/runtime.cjs').criarRuntimeAgenda({lib,agente,sumario,analiseSumario,rotinaSumario,automacoes,candidaturas,filaEditorial,producaoEditorial,integracoes},{modoCaptura:MODO_CAPTURA,onError: erro => {
    console.error('[agenda]',erro.mensagem || erro.message || erro)
    if(!MODO_CAPTURA && require('electron').Notification.isSupported())new (require('electron').Notification)({title:'DailyWork · automações',body:erro.mensagem || erro.message || 'Uma rotina precisa de atenção.'}).show()
  }})
  registrarOperacoes({
    registrar: (nome, fn) => {
      operacoes.set(nome, fn)
      ipcMain.handle(nome, lidarAgente(fn))
    },
    lib, fluxoLucasOL, agente, executorNativo, sumario, analiseSumario, coletarSumarioENotificar, analisarSumarioENotificar, integracoes, redator, filaEditorial, producaoEditorial, jobsMidiasEditoriais, logicaEditorial, exigirIdJobMidia, prepararSessaoConexao, session, estadoEscala, alterarEscala, resetarEscala, siteIntegration, automacoes, candidaturas, agenda, modoCaptura: MODO_CAPTURA,
  })
  if (!MODO_CAPTURA) screen.on('display-metrics-changed', agendarEscalaAutomatica)
  const skills = criarServicoSkills()
  ipcMain.handle('skills:dashboard', lidarAgente(entrada => skills.dashboard(entrada || {})))
  const principalCanvas = criarCanvasPrincipal({ dataDir: lib.DATA_DIR })
  ipcMain.handle('principal:canvas-carregar', lidarAgente(() => principalCanvas.carregar()))
  ipcMain.handle('principal:canvas-salvar', lidarAgente(snapshot => principalCanvas.salvar(snapshot)))
  ipcMain.on('canvas:conectar', (evento) => {
    if (evento.sender !== janela?.webContents || evento.senderFrame !== evento.sender.mainFrame) return
    ponteCanvas.conectar(evento.sender.id, (mensagem) => evento.sender.send('canvas:comando', mensagem))
  })
  ipcMain.on('canvas:resposta', (evento, resposta) => {
    if (evento.sender !== janela?.webContents || evento.senderFrame !== evento.sender.mainFrame) return
    ponteCanvas.responder(evento.sender.id, resposta)
  })
  protegerWebviews()
  instalarMenuEdicao()
  criarJanela()
  const rendererId = janela.webContents.id
  janela.webContents.on('render-process-gone', () => ponteCanvas.desconectar(rendererId))
  janela.webContents.on('destroyed', () => ponteCanvas.desconectar(rendererId))
  if (process.env.DAILYWORK_API_DISABLED !== '1') {
    void iniciarApiLocal({
      operacoes, canvas: ponteCanvas, userDataDir: app.getPath('userData'),
      notificar: (nome) => {
        if (/^blocos:(criar|atualizar|excluir|salvar)$/.test(nome) || /^fluxo:confirmar-/.test(nome)) janela?.webContents.send('blocos:externos')
        if (nome === 'conhecimento:salvar') janela?.webContents.send('conhecimento:externo')
      },
      porta: Number(process.env.DAILYWORK_API_PORT ?? (MODO_CAPTURA ? 0 : 47833)),
      auditar: (acao, dados) => {
        fs.mkdirSync(lib.DATA_DIR, { recursive: true })
        fs.appendFileSync(path.join(lib.DATA_DIR, '_log.ndjson'), JSON.stringify({ ts: new Date().toISOString(), acao, ...dados }) + '\n')
      },
    }).then(api => { apiLocal = api }).catch(e => console.error('[DailyWork] API local indisponível:', e.message))
  }
  if (!MODO_CAPTURA) {
    registrarHotkey()
    iniciarWatcher()
    iniciarWatcherConhecimento()
    try { await jobsMidiasEditoriais.reconciliarPendentes() } catch(erro) { console.error('[DailyWork] Falha na reconciliação de mídia:', erro.message) }
    agenda.iniciar()
    void jobsMidiasEditoriais.retentarSemReferencia()
  }
}).catch(erro => {
  console.error('[DailyWork] Falha na inicialização:', erro)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (MODO_CAPTURA || !MANTER_EM_SEGUNDO_PLANO) app.quit()
})

app.on('before-quit', () => {
  encerrando = true
  apiLocal?.fechar()
})

app.on('will-quit', () => {
  if (retryTimer) clearInterval(retryTimer)
  // Antes de revogar o coordenador, deixe a missão marcada como reinício para a agenda
  // retomá-la sozinha em vez de bloquear esperando alguém.
  try { servicoCandidaturas?.interromperPorReinicio() } catch (e) { console.error('[candidaturas]', e.message) }
  agenda?.parar()
  rotinaSumario.parar()
  filaEditorial.parar()
  producaoEditorial?.parar?.()
  globalShortcut.unregisterAll()
})

// A supervised shutdown revokes scheduler authority before Electron exits.
process.on('SIGTERM', () => app.quit())
