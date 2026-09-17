const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { coletarBuzz } = require('./sumario/fontes/buzz.cjs')
const { coletarClaude } = require('./sumario/fontes/claude.cjs')
const { coletarCodex } = require('./sumario/fontes/codex.cjs')
const { coletarCursor } = require('./sumario/fontes/cursor.cjs')
const { coletarGrokBot } = require('./sumario/fontes/grok-bot.cjs')
const { coletarGrokCli } = require('./sumario/fontes/grok-cli.cjs')
const { coletarLeague } = require('./sumario/fontes/league-of-legends.cjs')
const { coletarOpenCode } = require('./sumario/fontes/opencode.cjs')
const { coletarPi } = require('./sumario/fontes/pi.cjs')
const { coletarWhatsApp } = require('./sumario/fontes/whatsapp.cjs')
const {
  classificarDelegacoesMaestri,
  classificarPedidosDoAnalista,
  dataValida,
  janelaDoDia,
  mesclarConversas,
  textoVisivelDoPedido,
  timestampMs,
} = require('./sumario/shared.cjs')

const SCHEMA_VERSION = 2
const INPUTS_SCHEMA_VERSION = 3
const PRAZO_TRAVA_MS = 120_000
const IDADE_TRAVA_SEM_DONO_MS = 10 * 60_000
const ESCOPO_INPUTS = Object.freeze({
  included: 'Todas as mensagens classificadas como autoria humana (role=user e kind=message), sem amostragem nem resumo.',
  excluded: 'Respostas de IA, participantes, ferramentas, contexto automático e tarefas delegadas comprovadas pela proveniência das fontes.',
})
const FONTES = Object.freeze([
  coletarCodex,
  coletarClaude,
  coletarCursor,
  coletarGrokCli,
  coletarGrokBot,
  coletarOpenCode,
  coletarPi,
  coletarBuzz,
  coletarWhatsApp,
  coletarLeague,
])

function diretorioPadraoAppData() {
  if (process.env.APPDATA) return process.env.APPDATA
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

function diretorioPadraoLocalAppData() {
  if (process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Local')
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
}

function diretorioPadraoProgramData() {
  if (process.env.ProgramData) return process.env.ProgramData
  if (process.platform === 'win32') return 'C:\\ProgramData'
  return '/usr/share'
}

function resolverDiretorios(opcoes) {
  const appRoot = path.resolve(opcoes.appRoot || path.join(__dirname, '..'))
  const homeDir = path.resolve(opcoes.homeDir || os.homedir())
  const codexHomeDir = opcoes.homeDir
    ? path.join(homeDir, '.codex')
    : process.env.CODEX_HOME || path.join(homeDir, '.codex')
  return {
    appRoot,
    homeDir,
    appDataDir: path.resolve(opcoes.appDataDir || diretorioPadraoAppData()),
    localAppDataDir: path.resolve(opcoes.localAppDataDir || diretorioPadraoLocalAppData()),
    programDataDir: path.resolve(opcoes.programDataDir || diretorioPadraoProgramData()),
    outputDir: path.resolve(opcoes.outputDir || path.join(appRoot, 'data', 'sumarios')),
    whatsappExportDir: path.resolve(opcoes.whatsappExportDir || path.join(
      codexHomeDir,
      'exports',
      'extrair-daily-work-whatsapp'
    )),
  }
}

function caminhoDoArquivo(outputDir, dia) {
  if (!dataValida(dia)) throw new Error(`data inválida: ${dia}`)
  const diretorio = path.resolve(outputDir, dia)
  const relativo = path.relative(path.resolve(outputDir), diretorio)
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) throw new Error('destino do sumário fora da raiz permitida')
  return path.join(diretorio, 'conversas.json')
}

function caminhoDoResumo(outputDir, dia) {
  return path.join(path.dirname(caminhoDoArquivo(outputDir, dia)), 'resumo.json')
}

function caminhoDosInputs(outputDir, dia) {
  return path.join(path.dirname(caminhoDoArquivo(outputDir, dia)), 'inputs.json')
}

function inputsNaoColetados(dia) {
  return {
    schemaVersion: INPUTS_SCHEMA_VERSION,
    day: dia,
    generatedAt: null,
    completeness: 'not_collected',
    scope: ESCOPO_INPUTS,
    stats: {
      inputs: 0,
      characters: 0,
      conversations: 0,
      sources: 0,
    },
    sources: [],
    inputs: [],
  }
}

function estatisticas(conversas) {
  const stats = {
    conversations: conversas.length,
    messages: 0,
    userMessages: 0,
    agentMessages: 0,
    participantMessages: 0,
    toolEvents: 0,
    omittedTechnicalEvents: 0,
    characters: 0,
  }
  for (const conversa of conversas) {
    stats.omittedTechnicalEvents += Number(conversa.technicalEvents?.omitted || 0)
    for (const mensagem of conversa.messages) {
      stats.messages += 1
      stats.characters += String(mensagem.text || '').length
      if (mensagem.role === 'user' && mensagem.kind === 'message') stats.userMessages += 1
      else if (mensagem.role === 'assistant' && mensagem.kind === 'message') stats.agentMessages += 1
      else if (mensagem.role === 'participant') stats.participantMessages += 1
      else if (mensagem.role === 'tool' || mensagem.kind.startsWith('tool_')) stats.toolEvents += 1
    }
  }
  return stats
}

function statusGeral(coberturas) {
  const descobertas = coberturas.filter((item) => item.discovered)
  if (descobertas.some((item) => item.status === 'partial')) return 'partial'
  return 'complete'
}

function substituirArquivoAtomico(temporario, destino) {
  if (!fs.existsSync(destino)) {
    fs.renameSync(temporario, destino)
    return
  }

  const anterior = `${destino}.${process.pid}.${Date.now()}.previous`
  fs.renameSync(destino, anterior)
  try {
    fs.renameSync(temporario, destino)
    fs.rmSync(anterior, { force: true })
  } catch (erro) {
    if (!fs.existsSync(destino) && fs.existsSync(anterior)) fs.renameSync(anterior, destino)
    throw erro
  } finally {
    fs.rmSync(temporario, { force: true })
  }
}

function gravarJsonAtomico(destino, valor) {
  const temporario = `${destino}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  substituirArquivoAtomico(temporario, destino)
}

function versaoDoArquivo(arquivo) {
  try {
    const stat = fs.statSync(arquivo)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}

function processoAtivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return erro?.code === 'EPERM'
  }
}

function travaAbandonada(arquivo) {
  const idade = Date.now() - fs.statSync(arquivo).mtimeMs
  try {
    const dono = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    return !processoAtivo(Number(dono?.pid))
  } catch {
    return idade > IDADE_TRAVA_SEM_DONO_MS
  }
}

async function adquirirTrava(arquivo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  const limite = Date.now() + PRAZO_TRAVA_MS
  let esperou = false
  while (Date.now() < limite) {
    try {
      const fd = fs.openSync(arquivo, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
      return { fd, esperou }
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro
      esperou = true
      try {
        if (travaAbandonada(arquivo)) {
          fs.rmSync(arquivo, { force: true })
          continue
        }
      } catch {
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error('outra coleta do Sumário Diário não terminou dentro do prazo')
}

function liberarTrava(arquivo, fd) {
  try { fs.closeSync(fd) } catch {}
  fs.rmSync(arquivo, { force: true })
}

function projetar(artefato) {
  return {
    schemaVersion: artefato.schemaVersion,
    day: artefato.day,
    timezone: artefato.timezone,
    window: artefato.window,
    generatedAt: artefato.generatedAt,
    completeness: artefato.completeness,
    scope: artefato.scope,
    stats: artefato.stats,
    coverage: artefato.coverage,
    file: artefato.file,
    conversations: artefato.conversations.map((conversa) => {
      const visiveis = conversa.messages.filter((mensagem) => mensagem.text && ['user', 'assistant', 'participant'].includes(mensagem.role))
      return {
        id: conversa.id,
        source: conversa.source,
        app: conversa.app,
        title: conversa.title,
        cwd: conversa.cwd,
        startedAt: conversa.startedAt,
        updatedAt: conversa.updatedAt,
        messageCount: conversa.messages.length,
        technicalEvents: conversa.technicalEvents,
        preview: visiveis.slice(-6).map(({ id, timestamp, role, kind, text }) => ({
          id,
          timestamp,
          role,
          kind,
          text: text.slice(0, 800),
        })),
      }
    }),
  }
}

function projetarInputs(artefato) {
  const inputs = []
  for (const conversa of artefato.conversations) {
    for (const mensagem of conversa.messages) {
      if (mensagem.role !== 'user' || mensagem.kind !== 'message') continue
      const text = textoVisivelDoPedido(mensagem.text)
      if (text == null) continue
      inputs.push({
        id: mensagem.id,
        source: conversa.source,
        app: conversa.app,
        conversationId: conversa.id,
        conversationTitle: conversa.title,
        cwd: conversa.cwd || null,
        timestamp: mensagem.timestamp || null,
        text,
        ...(Object.hasOwn(mensagem, 'content') && text === mensagem.text
          ? { content: mensagem.content }
          : {}),
      })
    }
  }
  inputs.sort((a, b) => {
    const tempoA = timestampMs(a.timestamp)
    const tempoB = timestampMs(b.timestamp)
    if (tempoA == null && tempoB == null) return String(a.id).localeCompare(String(b.id))
    if (tempoA == null) return 1
    if (tempoB == null) return -1
    return tempoA - tempoB || String(a.id).localeCompare(String(b.id))
  })
  inputs.forEach((input, indice) => { input.sequence = indice + 1 })

  const contagemPorFonte = new Map()
  const conversas = new Set()
  let characters = 0
  for (const input of inputs) {
    contagemPorFonte.set(input.source, (contagemPorFonte.get(input.source) || 0) + 1)
    conversas.add(input.conversationId)
    characters += input.text.length
  }

  return {
    schemaVersion: INPUTS_SCHEMA_VERSION,
    day: artefato.day,
    timezone: artefato.timezone,
    window: artefato.window,
    generatedAt: artefato.generatedAt,
    completeness: artefato.completeness,
    scope: ESCOPO_INPUTS,
    stats: {
      inputs: inputs.length,
      characters,
      conversations: conversas.size,
      sources: contagemPorFonte.size,
    },
    sources: artefato.coverage.map((fonte) => ({
      id: fonte.id,
      label: fonte.label,
      status: fonte.status,
      conversations: Number(fonte.conversations || 0),
      messages: Number(fonte.messages || 0),
      errorCount: Array.isArray(fonte.errors) ? fonte.errors.length : 0,
      inputCount: contagemPorFonte.get(fonte.id) || 0,
    })),
    inputs,
  }
}

function limparInputsPersistidos(indice) {
  const originais = Array.isArray(indice.inputs) ? indice.inputs : []
  const limpos = []
  let mudou = false
  for (const input of originais) {
    const text = textoVisivelDoPedido(input.text)
    if (text == null) {
      mudou = true
      continue
    }
    if (text !== input.text) {
      mudou = true
      limpos.push({ ...input, text })
    } else {
      limpos.push(input)
    }
  }
  if (!mudou) return indice
  const contagemPorFonte = new Map()
  const conversas = new Set()
  let characters = 0
  const renumerados = limpos.map((input, indiceSeq) => {
    contagemPorFonte.set(input.source, (contagemPorFonte.get(input.source) || 0) + 1)
    conversas.add(input.conversationId)
    characters += String(input.text || '').length
    return { ...input, sequence: indiceSeq + 1 }
  })
  return {
    ...indice,
    stats: {
      ...indice.stats,
      inputs: renumerados.length,
      characters,
      conversations: conversas.size,
      sources: contagemPorFonte.size,
    },
    sources: (indice.sources || []).map((fonte) => ({
      ...fonte,
      inputCount: contagemPorFonte.get(fonte.id) || 0,
    })),
    inputs: renumerados,
  }
}

function criarServicoSumario(opcoes = {}) {
  const diretorios = resolverDiretorios(opcoes)
  const fontes = [...(opcoes.fontes || FONTES), ...(opcoes.fontesExtras || [])]
  const emAndamento = new Map()

  function lerArtefato(dia) {
    const arquivo = caminhoDoArquivo(diretorios.outputDir, dia)
    if (!fs.existsSync(arquivo)) return null
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  }

  function obter(dia) {
    const arquivoResumo = caminhoDoResumo(diretorios.outputDir, dia)
    if (!fs.existsSync(arquivoResumo)) {
      return {
        day: dia,
        generatedAt: null,
        completeness: 'not_collected',
        stats: null,
        coverage: [],
        file: caminhoDoArquivo(diretorios.outputDir, dia),
        conversations: [],
      }
    }
    return JSON.parse(fs.readFileSync(arquivoResumo, 'utf8'))
  }

  function obterInputs(dia) {
    const arquivo = caminhoDosInputs(diretorios.outputDir, dia)
    if (!fs.existsSync(arquivo)) return inputsNaoColetados(dia)
    const indice = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    return indice.schemaVersion === INPUTS_SCHEMA_VERSION
      ? limparInputsPersistidos(indice)
      : inputsNaoColetados(dia)
  }

  async function executarColeta(dia) {
    const janela = janelaDoDia(dia)
    const ctx = {
      ...diretorios,
      janela,
      now: opcoes.now || (() => new Date()),
      readBuzzIdentity: opcoes.readBuzzIdentity,
      runBuzz: opcoes.runBuzz,
    }
    const resultados = await Promise.all(fontes.map(async (fonte) => {
      try {
        return await fonte(ctx)
      } catch (erro) {
        const id = fonte.name.replace(/^coletar/, '').toLowerCase() || 'fonte'
        return {
          conversations: [],
          coverage: {
            id,
            label: id,
            discovered: true,
            status: 'partial',
            files: 0,
            records: 0,
            conversations: 0,
            messages: 0,
            errors: [String(erro.message || erro)],
            notes: [],
          },
        }
      }
    }))
    const conversations = classificarPedidosDoAnalista(
      classificarDelegacoesMaestri(
        mesclarConversas(resultados.flatMap((item) => item.conversations))
      )
    )
    const coverage = resultados.map((item) => {
      const conversasDaFonte = conversations.filter((conversa) => conversa.source === item.coverage.id)
      return {
        ...item.coverage,
        conversations: conversasDaFonte.length,
        messages: conversasDaFonte.reduce((total, conversa) => total + conversa.messages.length, 0),
      }
    })
    const arquivo = caminhoDoArquivo(diretorios.outputDir, dia)
    const gerado = (opcoes.now || (() => new Date()))()
    const artefato = {
      schemaVersion: SCHEMA_VERSION,
      day: dia,
      timezone: janela.timezone,
      window: { start: janela.inicioIso, end: janela.fimIso },
      generatedAt: gerado.toISOString(),
      completeness: statusGeral(coverage),
      scope: {
        included: 'Texto integral das conversas: falas da pessoa, respostas, mensagens de participantes e tarefas delegadas. Eventos técnicos associados entram como amostra uniforme com trechos limitados.',
        excluded: 'Credenciais, tokens, chaves, conteúdo binário, eventos técnicos excedentes, telemetria diagnóstica sem conteúdo conversacional e raciocínio criptografado.',
      },
      stats: estatisticas(conversations),
      coverage,
      file: arquivo,
      conversations,
    }
    fs.mkdirSync(path.dirname(arquivo), { recursive: true })
    let serializado = ''
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      serializado = `${JSON.stringify(artefato, null, 2)}\n`
      const bytes = Buffer.byteLength(serializado)
      if (artefato.stats.bytes === bytes) break
      artefato.stats.bytes = bytes
    }
    const resultado = projetar(artefato)
    const inputs = projetarInputs(artefato)
    const temporario = `${arquivo}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporario, serializado, { encoding: 'utf8', mode: 0o600 })
    substituirArquivoAtomico(temporario, arquivo)
    const arquivoInputs = caminhoDosInputs(diretorios.outputDir, dia)
    gravarJsonAtomico(arquivoInputs, inputs)
    const arquivoResumo = caminhoDoResumo(diretorios.outputDir, dia)
    gravarJsonAtomico(arquivoResumo, resultado)
    return resultado
  }

  async function executarComTrava(dia) {
    const arquivoResumo = caminhoDoResumo(diretorios.outputDir, dia)
    const versaoInicial = versaoDoArquivo(arquivoResumo)
    const arquivoTrava = path.join(path.dirname(arquivoResumo), '.coleta.lock')
    const trava = await adquirirTrava(arquivoTrava)
    try {
      if (trava.esperou && versaoDoArquivo(arquivoResumo) !== versaoInicial) return obter(dia)
      return await executarColeta(dia)
    } finally {
      liberarTrava(arquivoTrava, trava.fd)
    }
  }

  function coletar(dia) {
    if (!dataValida(dia)) return Promise.reject(new Error(`data inválida: ${dia}`))
    if (emAndamento.has(dia)) return emAndamento.get(dia)
    const promessa = executarComTrava(dia).finally(() => emAndamento.delete(dia))
    emAndamento.set(dia, promessa)
    return promessa
  }

  return {
    coletar,
    obter,
    obterInputs,
    lerArtefato,
    caminhoDoArquivo: (dia) => caminhoDoArquivo(diretorios.outputDir, dia),
  }
}

module.exports = {
  criarServicoSumario,
  caminhoDoArquivo,
  caminhoDoResumo,
  estatisticas,
  projetar,
  substituirArquivoAtomico,
  resolverDiretorios,
}
