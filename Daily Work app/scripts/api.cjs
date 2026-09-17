#!/usr/bin/env node
// Cliente local: carrega o token do descritor sem imprimi-lo nem passá-lo no argv.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
async function main() {
  const [comando = 'capacidades', json = '[]'] = process.argv.slice(2)
  const userData = process.env.DAILYWORK_USER_DATA_DIR || (process.platform === 'win32' ? path.join(process.env.APPDATA, 'DailyWork') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/DailyWork') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'DailyWork'))
  const candidatos = [path.join(userData, 'api-local.json'), path.join(path.dirname(userData), 'dailywork', 'api-local.json')]
  const arquivo = process.env.DAILYWORK_API_DESCRIPTOR || candidatos.find(p => fs.existsSync(p)) || candidatos[0]
  const { baseUrl, token } = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  const endereco = new URL(baseUrl)
  if (endereco.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endereco.hostname)) throw new Error('Descritor deve apontar para HTTP loopback.')
  let rota, body
  const valor = () => JSON.parse(json === '-' ? fs.readFileSync(0, 'utf8') : json.startsWith('@') ? fs.readFileSync(json.slice(1), 'utf8') : json)
  if (comando === 'instrucoes') rota = '/llms.txt'
  else if (comando === 'openapi') rota = '/api/v1/openapi.json'
  else if (comando === 'capacidades') rota = '/api/v1/capacidades'
  else if (comando === 'interface') rota = '/api/v1/interface/estado'
  else if (comando === 'navegar') { rota = '/api/v1/interface/navegar'; body = valor() }
  else if (comando === 'canvas-estado') rota = `/api/v1/canvas/estado?alvo=${encodeURIComponent(process.argv[3] || 'principal')}`
  else if (comando === 'canvas') { rota = '/api/v1/canvas/comandos'; body = valor() }
  else { rota = `/api/v1/operacoes/${comando.split(':').map(encodeURIComponent).join('/')}`; body = { args: valor() } }
  const r = await fetch(`${endereco.origin}${rota}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300_000), redirect: 'error' })
  process.stdout.write(await r.text() + '\n')
  if (!r.ok) process.exitCode = 1
}
main().catch(e => { console.error(`DailyWork API: ${e.message}`); process.exitCode = 1 })
