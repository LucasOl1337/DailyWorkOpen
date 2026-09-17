const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes, timingSafeEqual } = require('node:crypto')
const { contratos } = require('./lib-contratos-api.cjs')

function erro(codigo, mensagem, status = 400) {
  return Object.assign(new Error(mensagem), { codigo, status })
}
function origemLocal(req) {
  const ip = req.socket.remoteAddress || ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return false
  try {
    const host = new URL(`http://${req.headers.host}`)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    return !req.headers.origin || new URL(req.headers.origin).origin === host.origin
  } catch { return false }
}
async function lerJson(req, limite = 36 * 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw erro('FORMATO_INVALIDO', 'Use application/json.', 415)
  const partes = []
  let tamanho = 0
  for await (const parte of req) {
    tamanho += parte.length
    if (tamanho > limite) throw erro('CORPO_MUITO_GRANDE', 'Corpo excede 36 MB.', 413)
    partes.push(parte)
  }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')) }
  catch { throw erro('JSON_INVALIDO', 'Envie um objeto JSON válido.') }
}
// Valida o subconjunto de JSON Schema emitido pelos contratos deste módulo.
function validarValor(valor, schema = {}, caminho = 'args') {
  if (schema.anyOf) {
    if (schema.anyOf.some(s => { try { validarValor(valor, s, caminho); return true } catch { return false } })) return
    throw erro('ARGUMENTOS_INVALIDOS', `${caminho}: tipo incompatível.`)
  }
  if (schema.enum && !schema.enum.includes(valor)) throw erro('ARGUMENTOS_INVALIDOS', `${caminho}: valor fora do catálogo.`)
  const tipo = valor === null ? 'null' : Array.isArray(valor) ? 'array' : typeof valor
  if (schema.type && tipo !== schema.type) throw erro('ARGUMENTOS_INVALIDOS', `${caminho}: esperado ${schema.type}.`)
  if (schema.pattern && !new RegExp(schema.pattern).test(valor)) throw erro('ARGUMENTOS_INVALIDOS', `${caminho}: formato inválido.`)
  if (schema.type === 'object') {
    for (const k of schema.required || []) if (!(k in valor)) throw erro('ARGUMENTOS_INVALIDOS', `${caminho}.${k}: obrigatório.`)
    for (const [k, v] of Object.entries(valor)) if (schema.properties?.[k]) validarValor(v, schema.properties[k], `${caminho}.${k}`)
  }
  if (schema.type === 'array' && schema.items) valor.forEach((v, i) => validarValor(v, schema.items, `${caminho}[${i}]`))
}
function caminhoOperacao(nome) { return `/api/v1/operacoes/${nome.replaceAll(':', '/')}` }
const SOMENTE_DESKTOP = new Set(['editorial:configurar-publicacao'])
const CANAL_API = new Set(['editorial:publicar', 'editorial:agendar'])
function criarApiLocal({ operacoes, canvas, docsDir = path.resolve(__dirname, '../../docs'), ambiente = 'desktop', token = randomBytes(32).toString('hex'), auditar = () => {}, notificar = () => {} }) {
  const catalogo = () => [...operacoes.keys()].map((nome) => ({
    nome, metodo: 'POST', rota: caminhoOperacao(nome), ...(contratos[nome] || {}),
  }))
  function openapi() {
    const paths = {}
    for (const item of catalogo()) {
      paths[item.rota] = { post: {
        operationId: item.nome.replaceAll(':', '_'), summary: item.descricao,
        description: item.instrucoes || 'Argumentos posicionais, na ordem declarada em x-argumentos. Validação de domínio compartilhada com o desktop.',
        'x-argumentos': item.argumentos,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['args'], additionalProperties: false, properties: { args: { type: 'array', minItems: item.minArgs, maxItems: item.argumentos?.length || 0, prefixItems: (item.argumentos || []).map((a, i) => ({ title: a, ...(item.esquemas?.[i] || {}) })) } } }, ...(item.exemplo ? { example: { args: item.exemplo } } : {}) } } },
        responses: { 200: { description: 'Envelope {ok:true,data}.' }, 400: { description: 'Argumentos inválidos; envelope {ok:false,erro:{codigo,mensagem}}.' }, 409: { description: 'Conflito; releia antes de escrever.' }, 503: { description: 'Recurso indisponível neste ambiente.' } },
      } }
    }
    for (const [rota, method, summary] of [
      ['/api/v1/capacidades', 'get', 'Catálogo completo de operações e canvas'],
      ['/api/v1/canvas/estado', 'get', 'Editor ativo, revisão, páginas, formas, texto, geometria e câmera'],
      ['/api/v1/canvas/comandos', 'post', 'Comando tipado do Editor; alvo e revisão explícitos'],
      ['/api/v1/interface/navegar', 'post', 'Abre uma view do app e espera o canvas ficar pronto'],
      ['/api/v1/interface/estado', 'get', 'View e disponibilidade do editor'],
    ]) paths[rota] = { [method]: { summary, ...(method === 'post' ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } } : {}), responses: { 200: { description: 'Envelope padrão. Consulte /api/v1/instrucoes para contratos e exemplos.' } } } }
    return { openapi: '3.1.0', info: { title: 'DailyWork API local', version: '1.0.0' }, servers: [{ url: '/' }], security: [{ bearerAuth: [] }], components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }, paths }
  }
  async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/llms.txt') return next ? next() : responder(res, 404, { ok: false, erro: { codigo: 'ROTA_INEXISTENTE', mensagem: 'Use /llms.txt.' } })
    res.setHeader('Cache-Control', 'no-store')
    try {
      if (!origemLocal(req)) throw erro('ORIGEM_NAO_PERMITIDA', 'API disponível somente em loopback e origem local.', 403)
      if (req.method === 'GET' && ['/llms.txt', '/api/v1/instrucoes', '/api/v1/referencia', '/api/v1/openapi.json'].includes(url.pathname)) {
        if (url.pathname.endsWith('openapi.json')) return responder(res, 200, openapi())
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        return res.end(fs.readFileSync(path.join(docsDir, 'api.md'), 'utf8'))
      }
      const recebido = Buffer.from(String(req.headers.authorization || ''))
      const esperado = Buffer.from(`Bearer ${token}`)
      if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw erro('NAO_AUTORIZADO', 'Leia api-local.json no userData do DailyWork e envie Authorization: Bearer <token>.', 401)
      let data
      if (req.method === 'GET' && url.pathname === '/api/v1/capacidades') data = { versao: 1, ambiente, operacoes: catalogo(), canvas: require('./canvas-comandos.json'), instrucoes: '/api/v1/instrucoes' }
      else if (req.method === 'GET' && url.pathname === '/api/v1/interface/estado') data = await canvas.solicitar({ tipo: 'interface.estado' })
      else if (req.method === 'POST' && url.pathname === '/api/v1/interface/navegar') data = await canvas.solicitar({ tipo: 'interface.navegar', entrada: await lerJson(req) })
      else if (req.method === 'GET' && url.pathname === '/api/v1/canvas/estado') data = await canvas.solicitar({ tipo: 'canvas.estado', entrada: { alvo: url.searchParams.get('alvo'), limite: url.searchParams.get('limite'), offset: url.searchParams.get('offset') } })
      else if (req.method === 'POST' && url.pathname === '/api/v1/canvas/comandos') {
        const entrada = await lerJson(req)
        data = await canvas.solicitar({ tipo: 'canvas.comando', entrada })
        auditar('canvas:comando', { alvo: entrada.alvo, comando: entrada.comando, revisao: data?.revisao })
      } else {
        const item = catalogo().find(item => item.rota === url.pathname)
        if (!item) throw erro('ROTA_INEXISTENTE', 'Consulte /api/v1/capacidades.', 404)
        if (req.method !== 'POST') throw erro('METODO_NAO_SUPORTADO', 'Use POST com {args:[...]}.', 405)
        const body = await lerJson(req)
        if (!body || !Array.isArray(body.args) || Object.keys(body).some(k => k !== 'args') || body.args.length > item.argumentos.length || body.args.length < item.minArgs) throw erro('ARGUMENTOS_INVALIDOS', 'Use {args:[...]} na ordem do catálogo.')
        body.args.forEach((arg, i) => validarValor(arg, item.esquemas?.[i], `args[${i}]`))
        // Quem chega por HTTP é agente: publicar e agendar passam pelo portão
        // da fila com canal api, e a política de publicação só muda no app.
        if (SOMENTE_DESKTOP.has(item.nome)) throw erro('SOMENTE_DESKTOP', 'Esta operação só existe na interface do DailyWork.', 403)
        if (CANAL_API.has(item.nome)) body.args[1] = { ...(body.args[1] && typeof body.args[1] === 'object' ? body.args[1] : {}), canal: 'api' }
        // O renderer que mantém a sessão aberta é o único escritor do snapshot.
        if (['sessoes:salvar', 'sessoes:excluir'].includes(item.nome)) {
          const ativo = await canvas.solicitar({ tipo: 'interface.estado' }).catch(e => {
            if (e.codigo === 'EDITOR_INDISPONIVEL') return null
            throw e
          })
          if (ativo?.view === `sessao:${body.args[0]}`) throw erro('SESSAO_ABERTA', 'Use os comandos do canvas ou feche esta lousa antes de substituir/arquivar o snapshot.', 409)
        }
        data = await operacoes.get(item.nome)(...body.args.map(a => a === null ? undefined : a))
        notificar(item.nome, body.args)
      }
      return responder(res, 200, { ok: true, data })
    } catch (e) {
      const conflito = String(e.message).includes('CONFLITO:')
      return responder(res, e.status || (conflito ? 409 : 500), { ok: false, erro: { codigo: e.codigo || (conflito ? 'CONFLITO' : 'ERRO_INTERNO'), mensagem: String(e.message || e) } })
    }
  }
  return { middleware, token, catalogo, openapi }
}
function responder(res, status, valor) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(valor))
}
async function iniciarApiLocal(opcoes) {
  const api = criarApiLocal(opcoes)
  const servidor = http.createServer(api.middleware)
  servidor.requestTimeout = 120_000
  await new Promise((resolve, reject) => {
    servidor.once('error', reject)
    servidor.listen(opcoes.porta ?? 47833, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`
  const arquivo = path.join(opcoes.userDataDir, 'api-local.json')
  fs.mkdirSync(opcoes.userDataDir, { recursive: true })
  fs.writeFileSync(arquivo, JSON.stringify({ baseUrl, token: api.token, pid: process.pid, ambiente: 'desktop', instrucoes: `${baseUrl}/llms.txt` }, null, 2), { mode: 0o600 })
  fs.chmodSync(arquivo, 0o600)
  return { baseUrl, fechar() { servidor.close(); servidor.closeAllConnections(); if (fs.existsSync(arquivo) && JSON.parse(fs.readFileSync(arquivo, 'utf8')).pid === process.pid) fs.unlinkSync(arquivo) } }
}
module.exports = { criarApiLocal, iniciarApiLocal, erro, origemLocal, lerJson }
