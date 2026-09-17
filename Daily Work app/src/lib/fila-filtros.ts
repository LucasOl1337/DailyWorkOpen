import type { ContaEditorial, FormatoEditorial, IdiomaEditorial, ItemEditorial } from './editorial'

export type SituacaoFila = 'todas' | 'prontas' | 'pendentes' | 'agendadas' | 'atencao' | 'recusadas'
export type OrdemFila = 'recente' | 'antiga'

export interface FiltrosListaFila {
  situacao?: SituacaoFila
  conta?: ContaEditorial
  idioma?: IdiomaEditorial
  formato?: FormatoEditorial
  projeto?: string
  pautaId?: string
  busca?: string
  ordem?: OrdemFila
}

export const SITUACOES_FILA: Array<{ id: SituacaoFila; nome: string }> = [
  { id: 'todas', nome: 'Todas' },
  { id: 'prontas', nome: 'Prontas' },
  { id: 'pendentes', nome: 'Pendentes' },
  { id: 'agendadas', nome: 'Agendadas' },
  { id: 'atencao', nome: 'Precisam de você' },
  { id: 'recusadas', nome: 'Recusadas' },
]

const AGENDADAS = new Set(['agendado', 'aguardando_executor', 'publicando'])

export function pecaPronta(item: Pick<ItemEditorial, 'estado' | 'prontidao'>): boolean {
  return item.estado === 'pendente' && item.prontidao?.pronta === true
}

export function projetoDaPeca(item: Pick<ItemEditorial, 'origem'>): string {
  return String(item.origem?.projeto || '').trim()
}

function textoBuscaFila(item: ItemEditorial): string {
  return [
    item.titulo,
    item.texto,
    item.pautaId,
    item.conta,
    item.idioma,
    item.formato,
    item.origem?.tipo,
    item.origem?.projeto,
    item.origem?.dia,
    item.origem?.loteDia,
    ...(item.fontes || []).map((fonte) => fonte.rotulo),
    ...(item.origem?.partes || []).flatMap((parte) => [parte.rotulo, parte.projeto]),
  ].filter(Boolean).join(' ')
}

export function instantePeca(item: Pick<ItemEditorial, 'criadoEm' | 'atualizadoEm'>): number {
  const criado = Date.parse(item.criadoEm)
  if (Number.isFinite(criado)) return criado
  const atualizado = Date.parse(item.atualizadoEm)
  return Number.isFinite(atualizado) ? atualizado : 0
}

export function pecaNaSituacao(item: Pick<ItemEditorial, 'estado' | 'prontidao'>, situacao: SituacaoFila = 'todas'): boolean {
  if (!situacao || situacao === 'todas') return true
  if (situacao === 'prontas') return pecaPronta(item)
  if (situacao === 'pendentes') return item.estado === 'pendente' && !pecaPronta(item)
  if (situacao === 'agendadas') return AGENDADAS.has(item.estado)
  if (situacao === 'atencao') return item.estado === 'erro' || item.estado === 'incerto'
  if (situacao === 'recusadas') return item.estado === 'recusado'
  return true
}

export function ordenarFila<T extends Pick<ItemEditorial, 'id' | 'criadoEm' | 'atualizadoEm'>>(itens: T[], ordem: OrdemFila = 'recente'): T[] {
  const dir = ordem === 'antiga' ? 1 : -1
  return [...itens].sort((a, b) => {
    const delta = instantePeca(a) - instantePeca(b)
    if (delta) return delta * dir
    const atualizado = Date.parse(a.atualizadoEm) - Date.parse(b.atualizadoEm)
    if (Number.isFinite(atualizado) && atualizado) return atualizado * dir
    return a.id.localeCompare(b.id) * dir
  })
}

export function filtrarFila(itens: ItemEditorial[], filtros: FiltrosListaFila = {}): ItemEditorial[] {
  const termo = (filtros.busca || '').trim().toLocaleLowerCase()
  const situacao = filtros.situacao || 'todas'
  const filtrados = itens.filter((item) => {
    if (item.estado === 'publicado') return false
    if (!pecaNaSituacao(item, situacao)) return false
    if (filtros.conta && item.conta !== filtros.conta) return false
    if (filtros.idioma && item.idioma !== filtros.idioma) return false
    if (filtros.formato && item.formato !== filtros.formato) return false
    if (filtros.projeto && projetoDaPeca(item) !== filtros.projeto) return false
    if (filtros.pautaId && item.pautaId !== filtros.pautaId) return false
    if (termo && !textoBuscaFila(item).toLocaleLowerCase().includes(termo)) return false
    return true
  })
  return ordenarFila(filtrados, filtros.ordem || 'recente')
}

export function contarSituacoes(itens: ItemEditorial[]): Record<SituacaoFila, number> {
  const fila = itens.filter((item) => item.estado !== 'publicado')
  return {
    todas: fila.length,
    prontas: fila.filter((item) => pecaNaSituacao(item, 'prontas')).length,
    pendentes: fila.filter((item) => pecaNaSituacao(item, 'pendentes')).length,
    agendadas: fila.filter((item) => pecaNaSituacao(item, 'agendadas')).length,
    atencao: fila.filter((item) => pecaNaSituacao(item, 'atencao')).length,
    recusadas: fila.filter((item) => pecaNaSituacao(item, 'recusadas')).length,
  }
}

export function filtrosFilaAtivos(filtros: FiltrosListaFila, busca = '', pautaId = ''): boolean {
  return Boolean(
    (filtros.situacao && filtros.situacao !== 'todas')
    || filtros.conta
    || filtros.idioma
    || filtros.formato
    || filtros.projeto
    || filtros.ordem === 'antiga'
    || busca.trim()
    || pautaId,
  )
}
