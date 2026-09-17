// Apoio compartilhado pelos testes das conexões externas.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarCofreCredenciais } = require('../electron/integracoes/credenciais.cjs')

function temporario(t, prefixo = 'dailywork-integracoes-') {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), prefixo))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  return raiz
}

function json(corpo, status = 200, headers = {}) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...headers } })
}

// fetch falso roteado por (método, trecho da URL). Registra cada chamada.
function redeFalsa(rotas) {
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    const chamada = { url: String(url), metodo: init.method || 'GET', init, headers: init.headers || {}, body: init.body }
    chamadas.push(chamada)
    for (const rota of rotas) {
      if ((rota.metodo || 'GET') === chamada.metodo && chamada.url.includes(rota.trecho)) {
        if (typeof rota.resposta === 'function') return rota.resposta(chamada)
        // Uma Response só pode ser lida uma vez; cada chamada recebe uma cópia.
        return rota.resposta instanceof Response ? rota.resposta.clone() : rota.resposta
      }
    }
    return json({ message: `sem rota para ${chamada.metodo} ${chamada.url}` }, 404)
  }
  return { fetchImpl, chamadas }
}

function cofreEmMemoria(t) {
  return criarCofreCredenciais({ userDataDir: temporario(t) })
}

module.exports = { temporario, json, redeFalsa, cofreEmMemoria }
