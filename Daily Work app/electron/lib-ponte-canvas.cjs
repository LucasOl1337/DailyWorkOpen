const { randomUUID } = require('node:crypto')
const { erro } = require('./lib-api-local.cjs')
// Uma ponte por renderer. Identidade do remetente impede outra aba de responder.
function criarPonteCanvas({ timeoutMs = 20_000 } = {}) {
  let conexao = null
  const pendentes = new Map()
  function desconectar(id) {
    if (conexao?.id !== id) return
    conexao = null
    for (const [key, p] of pendentes) {
      clearTimeout(p.timer)
      p.reject(erro('EDITOR_INDISPONIVEL', 'O editor desconectou; releia o estado antes de repetir.', 503))
      pendentes.delete(key)
    }
  }
  return {
    conectar(id, enviar) {
      if (conexao && conexao.id !== id) throw erro('EDITOR_OCUPADO', 'Já existe um renderer controlando esta API.', 409)
      conexao = { id, enviar }
    },
    desconectar,
    responder(id, resposta) {
      if (conexao?.id !== id) return
      const p = pendentes.get(resposta?.id)
      if (!p) return
      pendentes.delete(resposta.id)
      clearTimeout(p.timer)
      if (resposta.ok) p.resolve(resposta.data)
      else p.reject(erro(resposta.erro?.codigo || 'ERRO_CANVAS', resposta.erro?.mensagem || 'Falha no editor.', resposta.erro?.status || 400))
    },
    solicitar(comando) {
      if (!conexao) return Promise.reject(erro('EDITOR_INDISPONIVEL', 'Abra o DailyWork e aguarde o editor conectar.', 503))
      if (pendentes.size >= 32) return Promise.reject(erro('FILA_CHEIA', 'Aguarde as chamadas em andamento.', 429))
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendentes.delete(id)
          reject(erro('TEMPO_ESGOTADO', 'Resultado incerto: consulte o estado antes de reenviar uma mutação.', 504))
        }, timeoutMs)
        pendentes.set(id, { resolve, reject, timer })
        try { conexao.enviar({ id, ...comando }) }
        catch (e) { clearTimeout(timer); pendentes.delete(id); reject(e) }
      })
    },
  }
}
module.exports = { criarPonteCanvas }
