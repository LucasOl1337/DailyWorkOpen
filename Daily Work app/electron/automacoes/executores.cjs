const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { erro } = require('./arquivos.cjs')
const EXECUTORES = [
  { id: 'codex', nome: 'Codex CLI', bin: 'codex' },
  { id: 'grok', nome: 'Grok', bin: 'grok' },
  { id: 'devin', nome: 'Devin CLI', bin: 'devin' },
  { id: 'claude', nome: 'Claude Code', bin: 'claude' },
  { id: 'hermes', nome: 'Hermes', bin: 'hermes' },
  { id: 'opencode', nome: 'OpenCode', bin: 'opencode' },
  { id: 'cursor', nome: 'Cursor Agent', bin: 'cursor-agent' },
  { id: 'pi', nome: 'Pi', bin: 'pi' },
  { id: 'omp', nome: 'OMP', bin: 'omp' },
  { id: 'gemini', nome: 'Gemini CLI', bin: 'gemini' },
  { id: 'jcode', nome: 'Jcode', bin: 'jcode' },
  { id: 'copilot', nome: 'GitHub Copilot', bin: 'copilot' },
  { id: 'crush', nome: 'Crush', bin: 'crush' },
]
function localizarBin(bin, env = process.env) {
  const override = env[`DAILYWORK_${bin.toUpperCase().replaceAll('-', '_')}_BIN`]
  const candidatos = override ? [override] : [...(env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local/bin'), '/usr/bin'].filter(Boolean).map(p => path.join(p, bin))
  return candidatos.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false } }) || null
}
function listarExecutores() {
  return EXECUTORES.map(e => ({ id: e.id, nome: e.nome, instalado: Boolean(localizarBin(e.bin)), navegador: 'Bancada compartilhada', autenticacao: 'Usa o login e as permissões da CLI' }))
}
function comandoExecutor(id, { cwd, promptPath, resultadoPath }) {
  const e = EXECUTORES.find(e => e.id === id)
  const bin = e && localizarBin(e.bin)
  if (!bin) throw erro('EXECUTOR_INDISPONIVEL', 'O executor escolhido não está instalado neste computador.', 503)
  const pedido = `Leia o pedido completo no arquivo ${JSON.stringify(promptPath)} e execute-o. Use exclusivamente o navegador da bancada descrito nesse pedido.`
  const args = {
    codex: ['exec', '--cd', cwd, '--skip-git-repo-check', '--output-last-message', resultadoPath, '-'],
    grok: ['--cwd', cwd, '--prompt-file', promptPath, '--output-format', 'plain', '--no-subagents'],
    devin: ['--prompt-file', promptPath, '-p'],
    claude: ['-p', pedido],
    hermes: ['--in', cwd, '-z', pedido],
    opencode: ['run', '--dir', cwd, pedido],
    cursor: ['--print', pedido],
    pi: ['--print', pedido],
    omp: ['--print', pedido],
    gemini: ['--prompt', pedido],
    jcode: ['--no-update', '--cwd', cwd, 'run', pedido],
    copilot: ['-C', cwd, '--prompt', pedido, '--silent'],
    crush: ['run', '--cwd', cwd, '--quiet', pedido],
  }[id]
  return { bin, args, env: id === 'crush' ? { CRUSH_CLIENT_SERVER: '0' } : {}, stdin: id === 'codex' ? fs.readFileSync(promptPath, 'utf8') : '', nome: e.nome }
}
module.exports = { EXECUTORES, listarExecutores, comandoExecutor, localizarBin }
