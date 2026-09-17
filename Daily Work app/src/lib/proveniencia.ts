import type { ItemEditorial } from './editorial'

export interface ParteOrigemEditorial {
  tipo: string
  rotulo: string
  dia?: string
  url?: string
  projeto?: string
}

export interface ProvenienciaEditorial {
  quando: string
  quandoCompleto: string
  projeto: string
  sumarioDia: string
  sumario: string
  base: string
  capa: string
  partes: ParteOrigemEditorial[]
}

const NOMES_PROJETO: Record<string, string> = {
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
}

const TZ = 'America/Sao_Paulo'

export function nomeProjeto(slug?: string): string {
  const chave = String(slug || '').trim()
  if (!chave) return ''
  if (NOMES_PROJETO[chave]) return NOMES_PROJETO[chave]
  return chave
    .split(/[-_]/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ')
}

export function formatarDia(dia?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return ''
  const [ano, mes, diaNum] = String(dia).split('-')
  return `${diaNum}/${mes}/${ano}`
}

export function formatarProducao(iso?: string, completo = false): string {
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

function inferirPartes(item: ItemEditorial | undefined, origem: ItemEditorial['origem'], projeto: string, sumarioDia: string): ParteOrigemEditorial[] {
  const partes: ParteOrigemEditorial[] = []
  if (origem?.tipo === 'acervo') {
    partes.push({ tipo: 'ficha-publica', rotulo: projeto || item?.titulo || 'Acervo', projeto: origem.projeto })
  } else if (origem?.tipo === 'pedido') {
    partes.push({ tipo: 'pedido', rotulo: item?.titulo || 'Pedido direto', projeto: origem.projeto, dia: origem.dia || sumarioDia })
  } else if (origem?.tipo === 'manual') {
    partes.push({ tipo: 'manual', rotulo: item?.titulo || 'Escrito à mão', projeto: origem.projeto })
  } else if (origem?.tipo === 'dia' && (origem.dia || sumarioDia)) {
    partes.push({
      tipo: 'bloco',
      rotulo: item?.titulo || 'Bloco do dia',
      dia: origem.dia || sumarioDia,
      projeto: origem.projeto,
    })
  }
  if (sumarioDia) partes.push({ tipo: 'sumario', rotulo: `Sumário ${formatarDia(sumarioDia)}`, dia: sumarioDia })
  for (const fonte of item?.fontes || []) {
    if (fonte?.rotulo) partes.push({ tipo: 'fonte', rotulo: fonte.rotulo, url: fonte.url })
  }
  return partes
}

export function descreverProveniencia(item: Pick<ItemEditorial, 'titulo' | 'criadoEm' | 'origem' | 'fontes'> | ItemEditorial): ProvenienciaEditorial {
  const origem = item?.origem && typeof item.origem === 'object' ? item.origem : { tipo: 'dia' as const }
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
    : inferirPartes(item as ItemEditorial, origem, projeto, sumarioDia)

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

export function textoBuscaEditorial(item: ItemEditorial): string {
  const prova = descreverProveniencia(item)
  return [
    item.titulo,
    item.texto,
    item.pautaId,
    item.conta,
    prova.base,
    prova.projeto,
    prova.sumario,
    prova.sumarioDia,
    item.origem?.projeto,
    item.origem?.dia,
    item.origem?.loteDia,
    ...(item.fontes || []).map((fonte) => fonte.rotulo),
    ...prova.partes.map((parte) => parte.rotulo),
  ].filter(Boolean).join(' ')
}
