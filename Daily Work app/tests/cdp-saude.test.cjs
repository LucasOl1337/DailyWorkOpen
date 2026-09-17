const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { conferirAlvosResponsivos } = require('../electron/automacoes/cdp-saude.cjs')
// Fixture HTTP local; conexão WebSocket recusada deve preservar a página.
test('diagnostica página sem resposta e ignora iframe sem tentar fechar alvos', async t => {
  const servidor = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/json/version') return res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/x' }))
    res.end(JSON.stringify([{ id: 'A', type: 'page', url: 'https://x.com/travada', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/A' }, { id: 'B', type: 'iframe', url: 'https://c.com', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/B' }]))
  })
  await new Promise(r => servidor.listen(0, '127.0.0.1', r)); t.after(() => servidor.close())
  await assert.rejects(conferirAlvosResponsivos(servidor.address().port, { timeoutMs: 300 }), e=>e.codigo==='CHROMIUM_ABA_SEM_RESPOSTA' && e.alvos.join(',')==='A')
})
