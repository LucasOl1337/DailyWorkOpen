// Resolve a chave do 9Router desta máquina. Env primeiro; senão a Default
// Key ativa em ~/.9router. Nunca loga o valor. Electron 43 não tem
// node:sqlite — o sqlite3 CLI é o fallback que funciona nos dois runtimes.

const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const DB_PADRAO = path.join(os.homedir(), '.9router', 'db', 'data.sqlite')

function chaveDoSqliteNativo(dbPath) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare('select key from apiKeys where isActive = 1 limit 1').get()
    return String(row?.key || '').trim()
  } finally {
    db.close()
  }
}

function chaveDoSqliteCli(dbPath, execFile = execFileSync) {
  const saida = execFile('sqlite3', ['-readonly', dbPath, 'select key from apiKeys where isActive = 1 limit 1'], {
    encoding: 'utf8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return String(saida || '').trim()
}

function resolverChaveNoveRouter({ env = process.env, dbPath = DB_PADRAO, execFileImpl = execFileSync } = {}) {
  const envKey = String(env.NINE_ROUTER_API_KEY || env.NINEROUTER_KEY || env.NINEROUTER_API_KEY || '').trim()
  if (envKey) return envKey
  try { return chaveDoSqliteNativo(dbPath) } catch { /* Electron e testes sem node:sqlite */ }
  try { return chaveDoSqliteCli(dbPath, execFileImpl) } catch { return '' }
}

module.exports = { resolverChaveNoveRouter, DB_PADRAO }
