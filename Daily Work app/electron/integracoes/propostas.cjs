// Propostas de publicação: toda escrita externa nasce como proposta, mostra o
// conteúdo exato, expira em dez minutos e só é enviada após confirmação.

const crypto = require('node:crypto')
const stringify = require('fast-json-stable-stringify')

const TTL_PADRAO_MS = 10 * 60 * 1000
const MAX_PENDENTES = 50

function criarPropostas({ now = () => Date.now(), ttlMs = TTL_PADRAO_MS } = {}) {
  const pendentes = new Map()

  function limpar() {
    for (const [id, proposta] of pendentes) {
      if (proposta.expiraEm <= now()) pendentes.delete(id)
    }
    while (pendentes.size >= MAX_PENDENTES) {
      const primeiro = pendentes.keys().next().value
      if (!primeiro) break
      pendentes.delete(primeiro)
    }
  }

  function criar({ conta, tipo, resumo, payload, preview }) {
    limpar()
    const proposalId = crypto.randomUUID()
    const expiraEm = now() + ttlMs
    const hash = crypto.createHash('sha256').update(stringify({ conta, tipo, payload })).digest('hex')
    pendentes.set(proposalId, { proposalId, conta, tipo, resumo, payload, preview, hash, expiraEm })
    return publica(pendentes.get(proposalId))
  }

  function publica(proposta) {
    return {
      proposalId: proposta.proposalId,
      conta: proposta.conta,
      tipo: proposta.tipo,
      resumo: proposta.resumo,
      preview: proposta.preview,
      hash: proposta.hash,
      expiresAt: new Date(proposta.expiraEm).toISOString(),
    }
  }

  function obter(proposalId) {
    limpar()
    const proposta = pendentes.get(String(proposalId || ''))
    return proposta ? publica(proposta) : null
  }

  function consumir(proposalId) {
    limpar()
    const proposta = pendentes.get(String(proposalId || ''))
    if (!proposta) throw new Error('proposta de publicação inexistente, expirada ou já consumida')
    pendentes.delete(proposta.proposalId)
    return proposta
  }

  function cancelar(proposalId) {
    return pendentes.delete(String(proposalId || ''))
  }

  function listar() {
    limpar()
    return [...pendentes.values()].map(publica)
  }

  return { criar, obter, consumir, cancelar, listar }
}

module.exports = { criarPropostas, TTL_PADRAO_MS }
