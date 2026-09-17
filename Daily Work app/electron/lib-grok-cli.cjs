// Transporte do DailyWork pelo Grok CLI (headless `grok -p`).
// O renderer nunca vê o binário, as credenciais nem o prompt montado.

const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')

const execFileAsync = promisify(execFile)
const FERRAMENTAS_GROK_NEGADAS = [
  'read_file',
  'grep',
  'list_dir',
  'search_replace',
  'write_file',
  'run_terminal_cmd',
  'web_search',
  'web_fetch',
  'Agent',
].join(',')

function resolverBinarioGrok(binario) {
  if (binario) return binario
  if (process.env.DAILYWORK_GROK_BIN) return process.env.DAILYWORK_GROK_BIN
  const candidatos = [
    path.join(os.homedir(), '.local', 'bin', 'grok'),
    path.join(os.homedir(), '.grok', 'bin', 'grok'),
    '/usr/bin/grok',
  ]
  for (const candidato of candidatos) {
    try {
      if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato
    } catch {
      // tenta o próximo
    }
  }
  return 'grok'
}

function diretorioScratch() {
  const diretorio = path.join(os.tmpdir(), 'dailywork-grok-scratch')
  fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 })
  fs.chmodSync(diretorio, 0o700)
  return diretorio
}

function textoDeConteudo(conteudo) {
  if (typeof conteudo === 'string') return conteudo
  if (!Array.isArray(conteudo)) return String(conteudo ?? '')
  return conteudo.map((parte) => {
    if (typeof parte === 'string') return parte
    if (parte?.type === 'text') return parte.text || ''
    if (parte?.type === 'image_url') return '[imagem anexada]'
    return ''
  }).filter(Boolean).join('\n')
}

function achatarMensagens(mensagens) {
  const sistema = []
  const conversa = []
  for (const mensagem of mensagens || []) {
    const texto = textoDeConteudo(mensagem?.content).trim()
    if (mensagem?.role === 'system') {
      if (texto) sistema.push(texto)
      continue
    }
    if (mensagem?.role === 'tool') {
      conversa.push(`tool_result ${mensagem.tool_call_id || ''}: ${texto || JSON.stringify(mensagem.content || '')}`)
      continue
    }
    if (Array.isArray(mensagem?.tool_calls) && mensagem.tool_calls.length) {
      conversa.push(`assistant: ${texto}\ntool_calls: ${JSON.stringify(mensagem.tool_calls)}`)
      continue
    }
    conversa.push(`${mensagem?.role || 'user'}: ${texto}`)
  }
  return { sistema: sistema.join('\n\n'), conversa: conversa.join('\n\n') }
}

function schemaDasFerramentas(ferramentas) {
  const nomes = (ferramentas || [])
    .map((item) => item?.function?.name)
    .filter((nome) => typeof nome === 'string' && nome)
  if (!nomes.length) return null
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      message: {
        type: 'string',
        description: 'Resposta final para a pessoa. Deixe vazio quando for chamar ferramentas.',
      },
      tool_calls: {
        type: 'array',
        description: 'Ações do DailyWork. Vazio quando a resposta já estiver completa.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', enum: nomes },
            arguments: { type: 'object' },
          },
          required: ['name', 'arguments'],
          oneOf: ferramentas.map(({ function: f }) => ({
            properties: {
              name: { enum: [f.name], description: f.description || '' },
              arguments: f.parameters || { type: 'object' },
            },
          })),
        },
      },
    },
  }
}

function respostaParaOpenAI(saida) {
  let data
  try {
    data = JSON.parse(String(saida || '').trim() || '{}')
  } catch {
    return {
      choices: [{ message: { role: 'assistant', content: String(saida || '').trim() } }],
    }
  }
  if (data.type === 'error' || data.is_error) {
    const erro = new Error(data.message || 'O Grok CLI devolveu um erro.')
    erro.codigo = 'FALHA_GROK_CLI'
    throw erro
  }
  const estruturado = data.structured_output || data.structuredOutput
  let objeto = estruturado
  if (!objeto && typeof data.text === 'string') {
    const texto = data.text.trim()
    if (texto.startsWith('{') && texto.endsWith('}')) {
      try { objeto = JSON.parse(texto) } catch { objeto = null }
    }
  }
  const chamadas = Array.isArray(objeto?.tool_calls) ? objeto.tool_calls : []
  if (chamadas.length) {
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: typeof objeto.message === 'string' ? objeto.message : '',
          tool_calls: chamadas.map((chamada, indice) => ({
            id: chamada.id || `grok-${randomUUID()}-${indice}`,
            type: 'function',
            function: {
              name: String(chamada.name || ''),
              arguments: typeof chamada.arguments === 'string'
                ? chamada.arguments
                : JSON.stringify(chamada.arguments || {}),
            },
          })),
        },
      }],
    }
  }
  const texto = typeof objeto?.message === 'string' && objeto.message.trim()
    ? objeto.message
    : String(data.text || '').trim()
  return {
    choices: [{ message: { role: 'assistant', content: texto } }],
  }
}

function criarTransporteGrokCli({
  binario,
  execFileImpl = execFileAsync,
  agora = () => Date.now(),
} = {}) {
  const executavel = resolverBinarioGrok(binario)

  async function executar(args, timeoutMs) {
    const env = {
      ...process.env,
      PATH: `${path.join(os.homedir(), '.local', 'bin')}${path.delimiter}${process.env.PATH || ''}`,
      GROK_DISABLE_AUTOUPDATER: '1',
    }
    try {
      const resultado = await execFileImpl(executavel, args, {
        timeout: Math.max(5_000, Number(timeoutMs) || 120_000),
        maxBuffer: 8 * 1024 * 1024,
        env,
        windowsHide: true,
      })
      return { stdout: String(resultado.stdout || ''), stderr: String(resultado.stderr || '') }
    } catch (erro) {
      if (erro?.killed || erro?.signal === 'SIGTERM' || /ETIMEDOUT|timeout/i.test(String(erro?.message || ''))) {
        const estourado = new Error('O Grok CLI demorou mais que o limite desta conversa.')
        estourado.codigo = 'TIMEOUT_GROK_CLI'
        throw estourado
      }
      const stderr = String(erro?.stderr || erro?.message || erro)
      const falha = new Error(stderr.split('\n').find((linha) => linha.trim()) || 'Não foi possível executar o Grok CLI.')
      falha.codigo = /not found|ENOENT/i.test(stderr) ? 'GROK_CLI_INDISPONIVEL' : 'FALHA_GROK_CLI'
      throw falha
    }
  }

  async function completarChat({ perfil, messages, tools, timeoutMs }) {
    const { sistema, conversa } = achatarMensagens(messages)
    const schema = schemaDasFerramentas(tools)
    const scratch = diretorioScratch()
    const arquivo = path.join(scratch, `prompt-${agora()}-${randomUUID()}.txt`)
    const instrucaoFerramentas = schema
      ? [
          'Responda somente no JSON do schema.',
          'Use somente os nomes, parâmetros, campos obrigatórios e valores enum descritos em FERRAMENTAS. Não invente ações ou aliases.',
          'Não use ferramentas de filesystem, shell ou web do Grok CLI.',
          'Se a resposta para a pessoa já estiver pronta, preencha message e deixe tool_calls vazio.',
        ].join('\n')
      : 'Responda em texto corrido para a pessoa. Não use ferramentas.'
    const prompt = [
      sistema ? `=== SYSTEM ===\n${sistema}` : '',
      schema ? `=== FERRAMENTAS ===\n${JSON.stringify(tools.map(t=>t.function))}` : '',
      conversa ? `=== CONVERSATION ===\n${conversa}` : '',
      `=== INSTRUCTION ===\n${instrucaoFerramentas}`,
    ].filter(Boolean).join('\n\n')
    fs.writeFileSync(arquivo, prompt, {encoding:'utf8',mode:0o600,flag:'wx'})
    try {
      const args = [
        '--prompt-file', arquivo,
        '-m', perfil.rota,
        '--output-format', 'json',
        '--verbatim',
        '--no-plan',
        '--no-subagents',
        '--disable-web-search',
        '--no-auto-update',
        '--no-alt-screen',
        '--cwd', scratch,
        '--disallowed-tools', FERRAMENTAS_GROK_NEGADAS,
        '--system-prompt-override',
        'You are the DailyWork language model. Follow SYSTEM and INSTRUCTION in the prompt. Never use filesystem, shell, or web tools.',
      ]
      if (perfil.effort) args.push('--reasoning-effort', perfil.effort)
      if (schema) args.push('--json-schema', JSON.stringify(schema))
      const { stdout } = await executar(args, timeoutMs)
      return respostaParaOpenAI(stdout)
    } finally {
      try { fs.unlinkSync(arquivo) } catch { /* prompt temporário */ }
    }
  }

  async function sondar() {
    try {
      const { stdout } = await executar(['models'], 8_000)
      const ids = [...String(stdout).matchAll(/\b(grok-[\w.]+)\b/g)].map((match) => match[1])
      return { ok: true, modelos: [...new Set(ids)] }
    } catch (erro) {
      return { ok: false, modelos: [], erro: String(erro.message || erro) }
    }
  }

  return { completarChat, sondar, binario: executavel }
}

module.exports = {
  criarTransporteGrokCli,
  resolverBinarioGrok,
  achatarMensagens,
  schemaDasFerramentas,
  respostaParaOpenAI,
}
