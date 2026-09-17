const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')

const hash = (valor) => createHash('sha256').update(valor).digest('hex')
const erro = (codigo, mensagem, status = 400) => Object.assign(new Error(mensagem), { codigo, status })

function lerJson(arquivo, ausente = null) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')) }
  catch (e) {
    if (e.code === 'ENOENT') return ausente
    throw erro('ESTADO_INVALIDO', `Não foi possível ler ${path.basename(arquivo)}. O arquivo foi preservado.`, 409)
  }
}

function gravarJson(arquivo, valor, { backup = false } = {}) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 })
  const temporario = `${arquivo}.${randomUUID()}.tmp`
  try {
    if (backup && fs.existsSync(arquivo)) {
      const destino = path.join(path.dirname(arquivo), '_arquivo', `${Date.now()}-${randomUUID()}-${path.basename(arquivo)}`)
      fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 })
      fs.copyFileSync(arquivo, destino)
      fs.chmodSync(destino, 0o600)
    }
    const fd = fs.openSync(temporario, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(valor, null, 2)); fs.fsyncSync(fd) }
    finally { fs.closeSync(fd) }
    fs.renameSync(temporario, arquivo)
  } finally { if (fs.existsSync(temporario)) fs.unlinkSync(temporario) }
}

function listarJson(pasta) {
  if (!fs.existsSync(pasta)) return []
  return fs.readdirSync(pasta).filter(n => /^[a-zA-Z0-9-]+\.json\.local$/.test(n))
    .map(n => lerJson(path.join(pasta, n)))
}

function arquivoPorId(pasta, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw erro('ID_INVALIDO', 'Identificador inválido.')
  return path.join(pasta, `${id}.json.local`)
}

// O kernel libera a trava mesmo se um dos processos morrer. O stdin mantém
// o detentor vivo somente durante a transação, inclusive entre Electron e Vite.
async function comTrava(arquivo, fn) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 })
  const filho = spawn('flock', ['--no-fork', '-n', '-E', '75', arquivo, process.execPath, '-e',
    'process.stdout.write("pronto\\n"); process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  filho.stdin.on('error', () => {})
  const fim = new Promise(resolve => { filho.once('exit', resolve); filho.once('error', () => resolve(null)) })
  try {
    await new Promise((resolve, reject) => {
      filho.stdout.once('data', resolve)
      filho.once('error', () => reject(erro('TRAVA_INDISPONIVEL', 'A automação requer flock disponível neste computador.', 503)))
      filho.once('exit', code => reject(erro(code === 75 ? 'EM_EXECUCAO' : 'TRAVA_INDISPONIVEL', code === 75 ? 'Outra operação está em andamento. Aguarde e tente novamente.' : 'Não foi possível adquirir a trava da campanha.', 409)))
    })
    return await fn()
  } finally { filho.stdin.end(); await fim }
}

function validarEstado(valor) {
  const objeto = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!objeto(valor)) throw erro('ESTADO_INVALIDO', 'O estado da campanha precisa ser um objeto. O arquivo foi preservado.', 409)
  for (const campo of ['toques', 'candidaturas']) {
    if (valor[campo] !== undefined && (!objeto(valor[campo]) || Object.values(valor[campo]).some(v => !objeto(v)))) throw erro('ESTADO_INVALIDO', `O campo ${campo} precisa conter registros válidos. O arquivo foi preservado.`, 409)
  }
  for (const campo of ['fila_argumentos', 'fila_alvos_email', 'bloqueios', 'threads_abertas', 'fila_manual']) {
    if (valor[campo] !== undefined && !Array.isArray(valor[campo])) throw erro('ESTADO_INVALIDO', `O campo ${campo} precisa ser uma lista. O arquivo foi preservado.`, 409)
  }
  for (const campo of ['fila_argumentos', 'fila_alvos_email']) if (valor[campo]?.some(v => typeof v !== 'string')) throw erro('ESTADO_INVALIDO', `A lista ${campo} precisa conter textos. O arquivo foi preservado.`, 409)
  for (const campo of ['bloqueios', 'fila_manual']) if (valor[campo]?.some(v => !objeto(v))) throw erro('ESTADO_INVALIDO', `A lista ${campo} precisa conter registros. O arquivo foi preservado.`, 409)
  return valor
}

function validarCampanhaId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) throw erro('CAMPANHA_INVALIDA', 'Identificador de campanha inválido.')
  return id
}

function criarArquivos({ lucasOlDir, dataDir, campanhaId = 'cognition' }) {
  validarCampanhaId(campanhaId)
  const base = path.join(lucasOlDir, 'Portfolio', 'empresas', campanhaId)
  const raiz = fs.realpathSync(lucasOlDir)
  let atual = lucasOlDir
  for (const parte of ['Portfolio', 'empresas', campanhaId]) {
    atual = path.join(atual, parte)
    if (fs.existsSync(atual) && (fs.lstatSync(atual).isSymbolicLink() || !fs.realpathSync(atual).startsWith(raiz + path.sep))) throw erro('CAMPANHA_INVALIDA', 'A pasta da campanha precisa estar dentro do portfólio.')
  }
  const runs = path.join(base, 'runs')
  function auditar(acao, dados = {}) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    fs.appendFileSync(path.join(dataDir, '_log.ndjson'), JSON.stringify({ ts: new Date().toISOString(), acao: `automacoes:${acao}`, escopo: 'automacoes', campanhaId, ...dados }) + '\n', { mode: 0o600 })
  }
  function lerEstado() {
    const valor = lerJson(path.join(base, 'estado.json.local'), {})
    return validarEstado(valor)
  }
  return { base, runs, auditar, lerEstado, lucasOlDir, dataDir, campanhaId }
}

module.exports = { hash, erro, lerJson, gravarJson, listarJson, arquivoPorId, comTrava, criarArquivos, validarEstado, validarCampanhaId }
