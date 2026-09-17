const fs = require('node:fs')
const path = require('node:path')
const { registrarOperacoes } = require('./lib-operacoes.cjs')
const { criarApiLocal, erro, origemLocal } = require('./lib-api-local.cjs')
const { criarPonteCanvas } = require('./lib-ponte-canvas.cjs')
const { criarCanvasPrincipal } = require('./lib-canvas-principal.cjs')
function apiAgentesDev(servicos) {
  return {
    name: 'dailywork-api-agentes',
    configureServer(server) {
      const canvas = criarPonteCanvas()
      servicos.agente.definirFontes({ canvas })
      const operacoes = new Map()
      const agenda = require('./agenda/runtime.cjs').criarRuntimeAgenda(servicos,{arquivo:path.join(servicos.lib.DATA_DIR,'.agenda-dev','estado.sqlite'),modoCaptura:true})
      servicos.agenda=agenda
      server.middlewares.use('/api/agenda',require('./agenda/runtime.cjs').middlewareAgenda(agenda))
      server.httpServer?.once('close',()=>agenda.close())
      const indisponivel = () => { throw erro('SOMENTE_DESKTOP', 'Esta operação requer a API do app Electron (api-local.json).', 503) }
      const siteIntegration = { status: indisponivel, configurar: indisponivel, metricas: indisponivel, prepararPublicacao: indisponivel, confirmarPublicacao: indisponivel }
      registrarOperacoes({ ...servicos, registrar: (nome, fn) => operacoes.set(nome, fn),
        siteIntegration, prepararSessaoConexao: indisponivel, session: { fromPartition: indisponivel },
        estadoEscala: indisponivel, alterarEscala: indisponivel, resetarEscala: indisponivel,
        coletarSumarioENotificar: async dia => { const resultado = await servicos.sumario.coletar(dia); server.ws.send('dailywork:sumario-atualizado', { dia }); return resultado },
        analisarSumarioENotificar: (dia, perfilId) => servicos.analiseSumario.analisar(dia, { perfilId }),
      })
      const api = criarApiLocal({ operacoes, canvas, ambiente: 'dev', notificar: nome => {
        if (/^blocos:(criar|atualizar|excluir|salvar)$/.test(nome) || /^fluxo:confirmar-/.test(nome)) server.ws.send('dailywork:blocos-externos', {})
        if (nome === 'conhecimento:salvar') server.ws.send('dailywork:conhecimento-externo', {})
      }, auditar: (acao, dados) => {
        fs.mkdirSync(servicos.lib.DATA_DIR, { recursive: true })
        fs.appendFileSync(path.join(servicos.lib.DATA_DIR, '_log.ndjson'), JSON.stringify({ ts: new Date().toISOString(), acao, ...dados }) + '\n')
      } })
      server.middlewares.use(api.middleware)
      const principal = criarCanvasPrincipal({ dataDir: servicos.lib.DATA_DIR })
      server.middlewares.use('/api/principal/canvas', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (!origemLocal(req)) { res.statusCode = 403; return res.end(JSON.stringify({ ok: false })) }
        try {
          let data
          if (req.method === 'GET') data = principal.carregar()
          else if (req.method === 'PUT' && /^application\/json/.test(req.headers['content-type'] || '')) {
            let bytes = 0
            const partes = []
            for await (const c of req) { bytes += c.length; if (bytes > 36 * 1024 * 1024) throw erro('CORPO_MUITO_GRANDE', 'Limite de 36 MB.', 413); partes.push(c) }
            data = principal.salvar(JSON.parse(Buffer.concat(partes).toString('utf8')))
          } else throw erro('METODO_NAO_SUPORTADO', 'Use GET ou PUT application/json.', 405)
          res.end(JSON.stringify({ ok: true, data }))
        } catch (e) { res.statusCode = e.status || 400; res.end(JSON.stringify({ ok: false, erro: { codigo: e.codigo || 'SNAPSHOT_INVALIDO', mensagem: e.message } })) }
      })
      const clientes = new WeakSet()
      server.ws.on('dailywork:canvas-conectar', (_data, client) => {
        try { canvas.conectar(client, mensagem => client.send('dailywork:canvas-comando', mensagem)) }
        catch { return }
        if (!clientes.has(client)) { clientes.add(client); client.socket.on('close', () => canvas.desconectar(client)) }
      })
      server.ws.on('dailywork:canvas-resposta', (resposta, client) => canvas.responder(client, resposta))
      const arquivo = path.join(servicos.userDataDir, 'api-dev.json')
      server.httpServer?.once('listening', () => {
        const endereco = server.httpServer.address()
        fs.mkdirSync(servicos.userDataDir, { recursive: true })
        fs.writeFileSync(arquivo, JSON.stringify({ baseUrl: `http://127.0.0.1:${endereco.port}`, token: api.token, pid: process.pid, ambiente: 'dev' }, null, 2), { mode: 0o600 })
        fs.chmodSync(arquivo, 0o600)
      })
      server.httpServer?.once('close', () => { if (fs.existsSync(arquivo) && JSON.parse(fs.readFileSync(arquivo, 'utf8')).pid === process.pid) fs.unlinkSync(arquivo) })
    },
  }
}
module.exports = { apiAgentesDev }
