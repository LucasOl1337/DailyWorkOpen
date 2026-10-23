// Só tipos no topo: o App importa este módulo e o tldraw fica no chunk dos canvases.
import type { Editor, TLShape, TLShapeId, toRichText } from 'tldraw'
import comandos from '../../electron/canvas-comandos.json'

type Mensagem = { id: string; tipo: string; entrada?: Record<string, any> }
type Resposta = { id: string; ok: boolean; data?: unknown; erro?: { codigo: string; mensagem: string; status: number } }
declare global {
  interface Window {
    dailyworkCanvas?: { conectar: (cb: (m: Mensagem) => void) => () => void; responder: (r: Resposta) => void }
  }
}
function falhar(codigo: string, mensagem: string, status = 400): never {
  throw Object.assign(new Error(mensagem), { codigo, status })
}
let ativo: { alvo: string; editor: Editor; revisao: string; atualizarRevisao: () => void; salvar: () => Promise<unknown> } | null = null
let viewAtual = ''
let navegar: ((view: string) => void) | null = null

export function registrarCanvasAgentes(editor: Editor, alvo: string, salvar: () => Promise<unknown>) {
  if (editor.isDisposed) return () => {}
  let versao = 0
  const instancia = crypto.randomUUID()
  let anterior = JSON.stringify(editor.store.getStoreSnapshot())
  const registro = { alvo, editor, salvar, revisao: `${instancia}:0`, atualizarRevisao() {
    const atual = JSON.stringify(editor.store.getStoreSnapshot())
    if (atual !== anterior) { anterior = atual; registro.revisao = `${instancia}:${++versao}` }
  } }
  ativo = registro
  return () => { if (ativo === registro) ativo = null }
}
export function atualizarViewAgentes(view: string, mudar: (view: string) => void) { viewAtual = view; navegar = mudar }

const metodos = [
  'createShapes', 'updateShapes', 'deleteShapes', 'duplicateShapes', 'groupShapes', 'ungroupShapes',
  'alignShapes', 'distributeShapes', 'stackShapes', 'packShapes', 'rotateShapesBy', 'resizeShape',
  'flipShapes', 'bringToFront', 'sendToBack', 'bringForward', 'sendBackward', 'reparentShapes',
  'createBindings', 'updateBindings', 'deleteBindings', 'createAssets', 'updateAssets', 'deleteAssets',
  'createPage', 'updatePage', 'deletePage', 'duplicatePage', 'setCurrentPage', 'setCamera',
  'zoomToFit', 'zoomToSelection', 'zoomToBounds', 'setSelectedShapes', 'selectAll', 'selectNone',
  'setCurrentTool', 'updateInstanceState', 'updateDocumentSettings', 'undo', 'redo',
] as const satisfies readonly (keyof Editor)[]
const semDocumento = new Set(['setCurrentPage', 'setCamera', 'zoomToFit', 'zoomToSelection', 'zoomToBounds', 'setSelectedShapes', 'selectAll', 'selectNone', 'setCurrentTool', 'updateInstanceState'])
function projetada(s: TLShape) { return Boolean(s.meta.blockId || s.meta.dailyworkKind === 'knowledge' || s.meta.dailyworkKind === 'principal-system') }
function estado(entrada: Record<string, any> = {}) {
  if (!ativo || ativo.alvo !== viewAtual) falhar('EDITOR_INDISPONIVEL', 'Abra Principal ou uma lousa e aguarde a carga.', 503)
  ativo.atualizarRevisao()
  const e = ativo.editor
  const shapes = e.store.allRecords().filter((r): r is TLShape => r.typeName === 'shape')
  const offset = Number(entrada.offset || 0)
  const limite = Number(entrada.limite || 200)
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limite) || limite < 1 || limite > 500) falhar('PAGINACAO_INVALIDA', 'Use offset >= 0 e limite de 1 a 500.')
  return {
    totalFormas: shapes.length, offset, limite, proximoOffset: offset + limite < shapes.length ? offset + limite : null,
    alvo: ativo.alvo, revisao: ativo.revisao, paginaId: e.getCurrentPageId(), paginas: e.getPages(),
    camera: e.getCamera(), viewport: e.getViewportPageBounds().toJson(), selecionados: e.getSelectedShapeIds(),
    ferramenta: e.getCurrentToolId(), somenteLeitura: e.getInstanceState().isReadonly,
    formas: shapes.slice(offset, offset + limite).map(s => ({ ...s, texto: e.getShapeUtil(s).getText(s) || '', bounds: e.getShapePageBounds(s)?.toJson(), projetada: projetada(s) })),
    bindings: e.store.allRecords().filter(r => r.typeName === 'binding'),
    assets: e.getAssets().map(a => ({ ...a, props: { ...a.props, ...('src' in a.props && a.props.src?.startsWith('data:') ? { src: '[data URL: use snapshot para obter]' } : {}) } })),
    tipos: Object.keys(e.shapeUtils), comandos,
  }
}
function executar(e: Editor, comando: string, args: any[], principal: boolean, richText: typeof toRichText) {
  if (!metodos.includes(comando as never)) falhar('COMANDO_INVALIDO', `Comando não permitido: ${comando}`)
  if (!Array.isArray(args) || args.length > 4) falhar('ARGUMENTOS_INVALIDOS', 'args deve ser uma lista de até quatro argumentos.')
  if (comando === 'updateInstanceState' && Object.keys(args[0] || {}).some(k => !['isReadonly', 'isGridMode', 'isFocusMode', 'isDebugMode'].includes(k))) falhar('ARGUMENTOS_INVALIDOS', 'Estado permite apenas isReadonly, isGridMode, isFocusMode e isDebugMode.')
  if (comando === 'createShapes') {
    if (!Array.isArray(args[0]) || args[0].length > 500) falhar('ARGUMENTOS_INVALIDOS', 'Envie até 500 formas.')
    args = [args[0].map((s: any) => {
      if (typeof s?.id !== 'string' || !s.id.startsWith('shape:') || e.getShape(s.id)) falhar('ID_INVALIDO', 'Cada criação exige um novo id shape:<id>.')
      if (s.meta?.blockId || s.meta?.dailyworkKind || s.type?.startsWith('dailywork-')) falhar('FORMA_PROJETADA', 'Crie cards por blocos:criar; conhecimento pelo vault.')
      const { text, ...shape } = s
      return { ...shape, meta: { ...shape.meta, dailyworkNative: true }, ...(text !== undefined ? { props: { ...shape.props, richText: richText(String(text)) } } : {}) }
    })]
  }
  if (comando === 'updateShapes') args = [args[0]?.map((s: any) => {
    if (!e.getShape(s.id)) falhar('NAO_ENCONTRADO', `Forma ausente: ${s.id}`, 404)
    const { text, ...shape } = s
    return { ...shape, ...(text !== undefined ? { props: { ...shape.props, richText: richText(String(text)) } } : {}) }
  })]
  if (e.getInstanceState().isReadonly && !semDocumento.has(comando)) falhar('SOMENTE_LEITURA', 'Lousa em apresentação. Altere isReadonly explicitamente antes de editar.', 409)
  // Nenhuma chamada dinâmica fora desta lista alcança o Editor.
  const fn = e[comando as typeof metodos[number]] as (...args: any[]) => unknown
  const resultado = fn.apply(e, args)
  // A projeção canônica é gerenciada por CRUD. Rollback cobre efeitos indiretos
  // como deletePage, groupShapes, bindings e tentativas de forjar metadados.
  if (principal) {
    for (const s of e.store.allRecords().filter((r): r is TLShape => r.typeName === 'shape')) {
      if (!projetada(s) && !s.meta.dailyworkNative) e.updateShape({ id: s.id, type: s.type, meta: { ...s.meta, dailyworkNative: true } })
    }
  }
  return resultado === e ? null : resultado
}
export async function atenderCanvas(m: Mensagem) {
  const entrada = m.entrada || {}
  if (m.tipo === 'interface.estado') return { view: viewAtual, canvasPronto: ativo?.alvo === viewAtual }
  if (m.tipo === 'interface.navegar') {
    const view = entrada.view
    if (typeof view !== 'string' || !/^(principal|site|fila|agente|conexao:[a-z0-9-]+|(?:dia|sumario):\d{4}-\d{2}-\d{2}|sessao:[a-z0-9][a-z0-9-]{0,60})$/.test(view)) falhar('VIEW_INVALIDA', 'Informe uma view válida do DailyWork.')
    if (ativo?.alvo === viewAtual) await ativo.salvar()
    navegar?.(view)
    const prazo = Date.now() + 15_000
    while (viewAtual !== view || ((view === 'principal' || view.startsWith('sessao:')) && ativo?.alvo !== view)) {
      if (Date.now() > prazo) falhar('EDITOR_INDISPONIVEL', 'A view não ficou pronta.', 503)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return { view, canvasPronto: ativo?.alvo === view }
  }
  if (!ativo || ativo.alvo !== viewAtual) falhar('EDITOR_INDISPONIVEL', 'Nenhum canvas pronto nesta view.', 503)
  if (entrada.alvo !== ativo.alvo) falhar('ALVO_DIVERGENTE', `Canvas ativo: ${ativo.alvo}. Envie alvo explícito ou navegue primeiro.`, 409)
  if (m.tipo === 'canvas.estado') return estado(entrada)
  if (m.tipo !== 'canvas.comando') falhar('COMANDO_INVALIDO', 'Tipo de mensagem desconhecido.')
  const registro = ativo
  const { getSnapshot, loadSnapshot, toRichText } = await import('tldraw')
  registro.atualizarRevisao()
  const e = registro.editor
  if (entrada.comando === 'snapshot') return { alvo: registro.alvo, revisao: registro.revisao, snapshot: getSnapshot(e.store) }
  if (entrada.comando === 'export') {
    const ids = entrada.args?.[0] || e.getCurrentPageShapeIds()
    const opcoes = entrada.args?.[1] || { format: 'svg' }
    if (opcoes.format === 'svg') return { alvo: registro.alvo, revisao: registro.revisao, ...(await e.getSvgString([...ids], opcoes)) }
    if (!['png', 'jpeg', 'webp'].includes(opcoes.format) || (opcoes.scale && (opcoes.scale > 4 || opcoes.scale <= 0))) falhar('ARGUMENTOS_INVALIDOS', 'Exporte svg, png, jpeg ou webp com escala até 4.')
    const { blob, ...dimensoes } = await e.toImage([...ids], opcoes)
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
    return { alvo: registro.alvo, revisao: registro.revisao, dataUrl, ...dimensoes }
  }
  if (entrada.revisao !== registro.revisao) falhar('CONFLITO', 'Revisão ausente ou desatualizada; releia canvas/estado.', 409)
  const antes = getSnapshot(e.store)
  const principal = registro.alvo === 'principal'
  const projecao = () => {
    const registros = e.store.allRecords()
    const shapes = registros.filter((r): r is TLShape => r.typeName === 'shape').filter(projetada)
    const ids = new Set(shapes.map(s => s.id))
    const assets = new Set(shapes.flatMap(s => 'assetId' in s.props ? [s.props.assetId] : []))
    return JSON.stringify([...shapes, ...registros.filter(r =>
      (r.typeName === 'binding' && (ids.has(r.fromId) || ids.has(r.toId))) || (r.typeName === 'asset' && assets.has(r.id))
    )].sort((a,b) => a.id.localeCompare(b.id)))
  }
  const canonicoAntes = principal ? projecao() : ''
  try {
    if (entrada.comando === 'save') {
      // Reintenta somente a persistência, sem repetir uma mutação.
    } else if (entrada.comando === 'loadSnapshot') {
      if (e.getInstanceState().isReadonly) falhar('SOMENTE_LEITURA', 'Retire o modo apresentação antes de importar.', 409)
      if (principal) falhar('FORMA_PROJETADA', 'Snapshot completo só pode substituir lousas livres. No Principal use CRUD e comandos tipados.')
      if (!entrada.args?.[0]?.document) falhar('ARGUMENTOS_INVALIDOS', 'Informe snapshot com document e schema nativos.')
      loadSnapshot(e.store, entrada.args[0])
    } else {
      const lote = entrada.comando === 'batch' ? entrada.args?.[0] : [{ comando: entrada.comando, args: entrada.args || [] }]
      if (!Array.isArray(lote) || !lote.length || lote.length > 100) falhar('ARGUMENTOS_INVALIDOS', 'Lote exige entre 1 e 100 comandos.')
      if (!['undo', 'redo'].includes(entrada.comando)) e.markHistoryStoppingPoint('DailyWork agent')
      if (entrada.comando === 'batch' && lote.some(a => ['undo', 'redo'].includes(a.comando))) falhar('COMANDO_INVALIDO', 'Use undo/redo fora de batch.')
      let falhaLote: unknown
      // Erros de entrada precisam ser tratados dentro da transação externa:
      // o HistoryManager do SDK considera exceções que escapam dela um crash.
      e.run(() => {
        try { for (const acao of lote) executar(e, acao.comando, acao.args || [], principal, toRichText) }
        catch (err) { falhaLote = err; loadSnapshot(e.store, antes) }
      })
      if (falhaLote) throw falhaLote
      if (principal && projecao() !== canonicoAntes) falhar('FORMA_PROJETADA', 'Use blocos ou conhecimento para alterar conteúdo canônico. Comandos do Editor operam os desenhos livres do Principal.', 409)
    }
  } catch (err) { loadSnapshot(e.store, antes); throw err }
  try { await registro.salvar() }
  catch { falhar('PERSISTENCIA_FALHOU', 'Canvas alterado em memória, mas a gravação falhou. Não repita a mutação; consulte o estado e salve novamente.', 500) }
  registro.atualizarRevisao()
  return { alvo: registro.alvo, revisao: registro.revisao, persistido: true }
}
export function conectarControleAgentes() {
  let fila = Promise.resolve()
  let vivo = true
  const responder = (resposta: Resposta) => {
    if (window.dailyworkCanvas) window.dailyworkCanvas.responder(resposta)
    else import.meta.hot?.send('dailywork:canvas-resposta', resposta)
  }
  const receber = (m: Mensagem) => {
    fila = fila.then(async () => {
      if (!vivo) return
      try { responder({ id: m.id, ok: true, data: await atenderCanvas(m) }) }
      catch (e: any) { responder({ id: m.id, ok: false, erro: { codigo: e.codigo || 'ERRO_CANVAS', mensagem: String(e.message || e), status: e.status || 400 } }) }
    })
  }
  if (window.dailyworkCanvas) { const cancelar = window.dailyworkCanvas.conectar(receber); return () => { vivo = false; cancelar() } }
  const reconectar = () => import.meta.hot?.send('dailywork:canvas-conectar', {})
  import.meta.hot?.on('vite:ws:connect', reconectar)
  import.meta.hot?.on('dailywork:canvas-comando', receber)
  import.meta.hot?.send('dailywork:canvas-conectar', {})
  return () => { vivo = false; import.meta.hot?.off('dailywork:canvas-comando', receber); import.meta.hot?.off('vite:ws:connect', reconectar) }
}
