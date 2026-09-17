const http = require('node:http')
// Um renderer lento pode conter formulário ou envio incerto. A sondagem informa
// o impedimento; nunca descarta abas com base somente em um timeout.
function json(porta, caminho) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: caminho, timeout: 4000 }, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)) } catch (e) { reject(e) } }) })
    req.on('timeout', () => req.destroy(new Error('CDP HTTP sem resposta.'))); req.on('error', reject)
  })
}
function comando(wsUrl, metodo, params = {}, timeoutMs = 3000) {
  return new Promise(resolve => {
    let ws
    const fim = setTimeout(() => { try { ws?.close() } catch {} resolve(null) }, timeoutMs)
    try { ws = new WebSocket(wsUrl) } catch { clearTimeout(fim); return resolve(null) }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: metodo, params }))
    ws.onmessage = m => { clearTimeout(fim); try { resolve(JSON.parse(String(m.data))) } catch { resolve(null) } try { ws.close() } catch {} }
    ws.onerror = () => { clearTimeout(fim); resolve(null) }
  })
}
async function conferirAlvosResponsivos(porta, { timeoutMs = 3000, lerJson = json, enviar = comando } = {}) {
  let alvos
  try { alvos = await lerJson(porta, '/json') } catch(cause) { throw Object.assign(new Error('O endpoint local do Chromium não respondeu. A agenda tentará novamente sem chamar a IA.', {cause}), {codigo:'CHROMIUM_CONEXAO_AUSENTE'}) }
  const semResposta = []
  await Promise.all(alvos.filter(t => t.type === 'page' && t.webSocketDebuggerUrl).map(async alvo => {
    const resposta = await enviar(alvo.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: '1', returnByValue: true }, timeoutMs)
    if (!resposta) semResposta.push(alvo.id)
  }))
  if (semResposta.length) throw Object.assign(new Error('Uma aba da bancada não respondeu. O trabalho aberto foi preservado; confira a aba antes de retomar.'), { codigo: 'CHROMIUM_ABA_SEM_RESPOSTA', alvos: semResposta })
  return { verificadas: alvos.filter(t => t.type === 'page').length }
}
module.exports = { conferirAlvosResponsivos }
