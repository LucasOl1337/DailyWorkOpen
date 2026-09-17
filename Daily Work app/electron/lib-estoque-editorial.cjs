// Shared inventory semantics for scheduled and legacy production.
function classificarEstoqueEditorial(itens) {
  const estoque = { prontas: 0, emAndamento: 0, bloqueadas: 0, semAvaliacao: 0, ocupado: 0 }
  for (const item of itens) {
    if (['agendado', 'publicando', 'aguardando_executor'].includes(item.estado)) estoque.emAndamento++
    else if (item.estado === 'pendente') {
      if (!item.prontidao) estoque.semAvaliacao++
      else if (item.prontidao.pronta === true) estoque.prontas++
      else estoque.bloqueadas++
    }
  }
  // Older integrations without readiness remain reserved until evaluated.
  estoque.ocupado = estoque.prontas + estoque.emAndamento + estoque.semAvaliacao
  return estoque
}
module.exports = { classificarEstoqueEditorial }
