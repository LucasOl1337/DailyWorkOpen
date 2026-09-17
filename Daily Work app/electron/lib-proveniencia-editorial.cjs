// Proveniência editorial: o que o agente usou e quando a peça foi produzida.
// Funções puras — a Fila deriva o mesmo texto para itens antigos e novos.

const NOMES_PROJETO = Object.freeze({
  videogen: 'VIDEOGEN',
  nexarq: 'NexARQ',
  lojasync: 'LojaSync',
  'simpl-ai': 'Simpl AI',
  'the-last-arrow': 'The Last Arrow',
  dailywork: 'DailyWork',
  ramdog: 'RamDog',
  sussurro: 'Sussurro',
  sonora: 'Sonora',
  sfr: 'SFR Resgate',
  nexsales: 'NexSales',
})

const TZ = 'America/Sao_Paulo'

function nomeProjeto(slug) {
  const chave = String(slug || '').trim()
  if (!chave) return ''
  if (NOMES_PROJETO[chave]) return NOMES_PROJETO[chave]
  return chave
    .split(/[-_]/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ')
}

function formatarDia(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return ''
  const [, mes, diaNum] = String(dia).split('-')
  const ano = String(dia).slice(0, 4)
  return `${diaNum}/${mes}/${ano}`
}

function formatarProducao(iso, completo = false) {
  if (!iso) return ''
  const data = new Date(iso)
  if (Number.isNaN(data.valueOf())) return String(iso)
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    ...(completo
      ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  }).format(data)
}

function montarOrigem({
  tipo,
  projeto,
  dia,
  loteDia,
  titulo,
  analiseUsada = false,
  partePrincipal,
} = {}) {
  const tipoOrigem = ['acervo', 'pedido', 'manual'].includes(tipo) ? tipo : 'dia'
  const principal = partePrincipal || (tipoOrigem === 'acervo' ? 'ficha-publica' : tipoOrigem === 'pedido' ? 'pedido' : tipoOrigem === 'manual' ? 'manual' : 'bloco')
  const rotuloPadrao = tipoOrigem === 'acervo'
    ? (nomeProjeto(projeto) || titulo || 'Acervo')
    : tipoOrigem === 'pedido'
      ? (titulo || 'Pedido direto')
      : tipoOrigem === 'manual'
        ? (titulo || 'Escrito à mão')
        : (titulo || 'Bloco do dia')
  const partes = [{
    tipo: principal,
    rotulo: rotuloPadrao,
    ...(tipoOrigem === 'dia' && dia ? { dia } : {}),
    ...(projeto ? { projeto } : {}),
  }]
  if (loteDia && ['inputs', 'estudo'].includes(principal)) partes.push({ tipo: 'sumario', rotulo: `Sumário ${formatarDia(loteDia)}`, dia: loteDia })
  if (analiseUsada && loteDia) partes.push({ tipo: 'analise', rotulo: 'Análise do dia', dia: loteDia })
  const origem = { tipo: tipoOrigem, partes }
  if (projeto) origem.projeto = projeto
  if ((tipoOrigem === 'dia' || tipoOrigem === 'pedido' || tipoOrigem === 'manual') && dia) origem.dia = dia
  if (loteDia) origem.loteDia = loteDia
  return origem
}

function inferirPartes(item, origem, projeto, sumarioDia) {
  const partes = []
  if (origem.tipo === 'acervo') {
    partes.push({ tipo: 'ficha-publica', rotulo: projeto || item?.titulo || 'Acervo', projeto: origem.projeto })
  } else if (origem.tipo === 'pedido') {
    partes.push({ tipo: 'pedido', rotulo: item?.titulo || 'Pedido direto', projeto: origem.projeto, dia: origem.dia || sumarioDia })
  } else if (origem.tipo === 'manual') {
    partes.push({ tipo: 'manual', rotulo: item?.titulo || 'Escrito à mão', projeto: origem.projeto })
  } else if (origem.tipo === 'dia' && (origem.dia || sumarioDia)) {
    partes.push({
      tipo: 'bloco',
      rotulo: item?.titulo || 'Bloco do dia',
      dia: origem.dia || sumarioDia,
      projeto: origem.projeto,
    })
  }
  if (sumarioDia) partes.push({ tipo: 'sumario', rotulo: `Sumário ${formatarDia(sumarioDia)}`, dia: sumarioDia })
  for (const fonte of Array.isArray(item?.fontes) ? item.fontes : []) {
    if (fonte?.rotulo) partes.push({ tipo: 'fonte', rotulo: fonte.rotulo, url: fonte.url })
  }
  return partes
}

function descreverProveniencia(item) {
  const origem = item?.origem && typeof item.origem === 'object' ? item.origem : {}
  const projeto = nomeProjeto(origem.projeto)
  const sumarioDia = origem.loteDia || (origem.tipo === 'dia' ? origem.dia : '') || ''
  const partes = Array.isArray(origem.partes) && origem.partes.length
    ? origem.partes.map((parte) => ({
      tipo: parte.tipo,
      rotulo: parte.rotulo || parte.tipo,
      dia: parte.dia,
      url: parte.url,
      projeto: parte.projeto,
    }))
    : inferirPartes(item, origem, projeto, sumarioDia)

  let base = 'Daily Work'
  if (origem.tipo === 'pedido') base = projeto ? `Pedido direto · ${projeto}` : 'Pedido direto'
  else if (origem.tipo === 'manual') base = projeto ? `Escrito à mão · ${projeto}` : 'Escrito à mão'
  else if (origem.tipo === 'acervo' && projeto) base = `Acervo · ${projeto}`
  else if (origem.tipo === 'acervo') base = 'Acervo do Principal'
  else if (sumarioDia && projeto) base = `Sumário ${formatarDia(sumarioDia)} · ${projeto}`
  else if (sumarioDia) base = `Sumário ${formatarDia(sumarioDia)}`
  else if (projeto) base = `Projeto ${projeto}`

  const titulo = String(item?.titulo || '').trim().toLocaleLowerCase('pt-BR')
  const projetoNoTitulo = Boolean(projeto && titulo.includes(projeto.toLocaleLowerCase('pt-BR')))
  let capa = base
  if (origem.tipo === 'pedido' || origem.tipo === 'manual') {
    capa = base
  } else if (origem.tipo === 'acervo') {
    capa = projetoNoTitulo ? 'Acervo · ficha pública' : (projeto ? `Acervo · ${projeto}` : 'Acervo do Principal')
  } else if (sumarioDia) {
    capa = projeto && !projetoNoTitulo ? `Sumário ${formatarDia(sumarioDia)} · ${projeto}` : `Sumário ${formatarDia(sumarioDia)}`
  }

  return {
    quando: formatarProducao(item?.criadoEm),
    quandoCompleto: formatarProducao(item?.criadoEm, true),
    projeto,
    sumarioDia,
    sumario: sumarioDia ? `Sumário ${formatarDia(sumarioDia)}` : '',
    base,
    capa,
    partes,
  }
}

function textoBusca(item) {
  const prova = descreverProveniencia(item)
  return [
    item?.titulo,
    item?.texto,
    item?.pautaId,
    item?.conta,
    prova.base,
    prova.projeto,
    prova.sumario,
    prova.sumarioDia,
    origemCampo(item),
    ...(Array.isArray(item?.fontes) ? item.fontes.map((fonte) => fonte?.rotulo) : []),
    ...prova.partes.map((parte) => parte.rotulo),
  ].filter(Boolean).join(' ')
}

function origemCampo(item) {
  const origem = item?.origem || {}
  return [origem.projeto, origem.dia, origem.loteDia].filter(Boolean).join(' ')
}

module.exports = {
  nomeProjeto,
  formatarDia,
  formatarProducao,
  montarOrigem,
  descreverProveniencia,
  textoBusca,
}
