import { Editor, getSnapshot, loadSnapshot, type TLShape } from 'tldraw'
import { metaDoBloco } from './blocos'
import { metaDoConhecimento, ehShapeDoSistemaPrincipal } from './conhecimento'

declare global {
  interface Window {
    dailyworkPrincipal?: {
      carregar: () => Promise<{ok: boolean; data?: unknown; erro?: {mensagem: string}}>
      salvar: (snapshot: unknown) => Promise<{ok: boolean; data?: unknown; erro?: {mensagem: string}}>
    }
  }
}
async function api(acao: 'carregar' | 'salvar', snapshot?: unknown) {
  const r = window.dailyworkPrincipal
    ? await (acao === 'carregar' ? window.dailyworkPrincipal.carregar() : window.dailyworkPrincipal.salvar(snapshot))
    : await fetch('/api/principal/canvas', acao === 'carregar' ? {} : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) }).then(r => r.json())
  if (!r.ok) throw new Error(r.erro?.mensagem || 'Falha no canvas do Principal.')
  return r.data
}
export async function carregarCanvasPrincipal(e: Editor) {
  const snapshot = await api('carregar')
  if (snapshot) {
    loadSnapshot(e.store, snapshot as never)
    // A projeção dos arquivos sempre é montada na primeira página.
    e.setCurrentPage(e.getPages()[0].id)
  }
}
export async function salvarCanvasPrincipal(e: Editor) {
  const snapshot = getSnapshot(e.store)
  const shapes = e.store.allRecords().filter((r): r is TLShape => r.typeName === 'shape')
  const omitidos = new Set(shapes.filter(s => metaDoBloco(s) || metaDoConhecimento(s) || ehShapeDoSistemaPrincipal(s) || (s.type === 'arrow' && s.id.startsWith('shape:seta-'))).map(s => s.id))
  const assetsProjetados = new Set(shapes.filter(s => omitidos.has(s.id)).flatMap(s => 'assetId' in s.props ? [s.props.assetId] : []))
  const assetsLivres = new Set(shapes.filter(s => !omitidos.has(s.id)).flatMap(s => 'assetId' in s.props ? [s.props.assetId] : []))
  snapshot.document.store = Object.fromEntries(Object.entries(snapshot.document.store).filter(([, r]) => {
    if (r.typeName === 'shape') return !omitidos.has(r.id)
    if (r.typeName === 'asset') return !assetsProjetados.has(r.id) || assetsLivres.has(r.id)
    if (r.typeName === 'binding') return !omitidos.has(r.fromId) && !omitidos.has(r.toId)
    return true
  })) as typeof snapshot.document.store
  return api('salvar', snapshot)
}
