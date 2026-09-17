// Utilitários OAuth 2.0 para as conexões que exigem autorização no navegador:
// PKCE, estado anti-CSRF e um servidor de retorno em loopback que vive só
// enquanto a autorização está em andamento.

const crypto = require('node:crypto')
const http = require('node:http')

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function gerarPkce() {
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function gerarEstado() {
  return base64url(crypto.randomBytes(24))
}

function montarUrl(base, parametros) {
  const url = new URL(base)
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor == null || valor === '') continue
    url.searchParams.set(chave, String(valor))
  }
  return url.toString()
}

const PAGINA_RETORNO = (titulo, texto) => `<!doctype html><meta charset="utf-8"><title>${titulo}</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:Inter,system-ui,sans-serif;background:#171a1b;color:#d8e2df">
<main style="max-width:420px;text-align:center;padding:32px"><h1 style="font-size:20px;margin:0 0 12px">${titulo}</h1><p style="margin:0;color:#909b98">${texto}</p></main></body>`

// Abre um servidor local para receber o "code". Resolve na primeira chamada
// válida e encerra o servidor. Nunca aceita conexões fora do loopback.
function aguardarCallback({ porta, caminho = '/callback', estado, timeoutMs = 5 * 60 * 1000, onRequisicao }) {
  return new Promise((resolve, reject) => {
    let finalizado = false
    const servidor = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${porta}`)
      if (url.pathname !== caminho) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGINA_RETORNO('Rota inválida', 'Esta página só recebe o retorno da autorização.'))
        return
      }
      const recebido = Object.fromEntries(url.searchParams.entries())
      onRequisicao?.(recebido)
      if (recebido.state !== estado) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGINA_RETORNO('Autorização não reconhecida', 'O estado recebido não corresponde ao pedido do DailyWork.'))
        return
      }
      if (recebido.error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGINA_RETORNO('Autorização recusada', recebido.error_description || recebido.error))
        concluir(new Error(recebido.error_description || recebido.error))
        return
      }
      if (!recebido.code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGINA_RETORNO('Retorno incompleto', 'Nenhum código de autorização foi recebido.'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGINA_RETORNO('Conta conectada', 'Pode voltar ao DailyWork. Esta janela fecha sozinha.'))
      concluir(null, { code: recebido.code })
    })
    const timer = setTimeout(() => concluir(new Error('a autorização expirou sem retorno do provedor')), timeoutMs)

    function concluir(erro, valor) {
      if (finalizado) return
      finalizado = true
      clearTimeout(timer)
      setTimeout(() => servidor.close(), 150)
      if (erro) reject(erro)
      else resolve(valor)
    }

    servidor.on('error', (erro) => concluir(erro))
    servidor.listen(porta, '127.0.0.1')
  })
}

module.exports = { aguardarCallback, gerarEstado, gerarPkce, montarUrl, base64url }
