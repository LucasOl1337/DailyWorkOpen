const { criarServicoSessoes } = require('./servico.cjs')

function criarHubSessoes(opcoes = {}) {
  const servicos = new Map([
    ['linkedin', criarServicoSessoes({ ...opcoes, conta: 'linkedin' })],
    ['x', criarServicoSessoes({ ...opcoes, conta: 'x' })],
  ])
  function achar(metodo, valor) {
    for (const servico of servicos.values()) {
      const resultado = servico[metodo](valor)
      if (resultado) return resultado
    }
    return null
  }
  return {
    para: (conta) => servicos.get(conta) || null,
    obterJob: (id) => achar('obterJob', id),
    porOrigem: (chave) => achar('porOrigem', chave),
    listarJobs: () => [...servicos.values()].flatMap((servico) => servico.listarJobs()),
    confirmar({ proposalId } = {}) {
      const conta = String(proposalId || '').startsWith('sv-x-') ? 'x' : 'linkedin'
      return servicos.get(conta).confirmar({ proposalId })
    },
    cancelarProposta(proposalId) {
      const conta = String(proposalId || '').startsWith('sv-x-') ? 'x' : 'linkedin'
      return servicos.get(conta).cancelarProposta(proposalId)
    },
    cancelar(id) {
      const servico = [...servicos.values()].find((candidate) => candidate.obterJob(id))
      if (!servico) return servicos.get('linkedin').cancelar(id)
      return servico.cancelar(id)
    },
    iniciar() { for (const servico of servicos.values()) servico.iniciar() },
    parar() { for (const servico of servicos.values()) servico.parar() },
    fechar() { for (const servico of servicos.values()) servico.fechar() },
  }
}

module.exports = { criarHubSessoes }
