import {
  AssetRecordType,
  Editor,
  renderPlaintextFromRichText,
  toRichText,
  TLGeoShape,
  TLImageShape,
  TLShape,
  TLShapeId,
} from 'tldraw'
import { novoBlocoId, type Bloco, type StatusBloco, type TipoBloco } from './md'
import { TIPOS_INFO } from './tipos'
import { carregarFoto, carregarMidiaPortfolio, salvarMidiaPortfolio } from './api'
import { ehShapeDoSistemaPrincipal, metaDoConhecimento } from './conhecimento'
import { PORTFOLIO_SHAPE_TYPE } from '../components/PrincipalShapes'

// Blocos são shapes NATIVAS do tldraw (geo para textos, image para pessoa) —
// arrastar, redimensionar e editar texto ficam por conta do tldraw. Nossos
// dados vivem em shape.meta, e o id da shape é 'shape:<blockId>' (o .md).
export interface BlocoMeta {
  blockId: string
  tipo: TipoBloco
  status: StatusBloco
  corpo: string
  titulo: string // usado pela shape image (pessoa); geo guarda o título no texto
  midia?: string
}

// O canvas precisa funcionar como painel operacional, não como um índice de
// caixas vazias. Em blocos de texto exibimos título + corpo; o primeiro
// parágrafo continua sendo o título e o restante continua sendo o markdown.
export function textoVisivelDoBloco(titulo: string, corpo: string): string {
  const conteudo = corpo.trim()
  return conteudo ? `${titulo.trim()}\n\n${conteudo}` : titulo.trim()
}

function partesDoTextoVisivel(editor: Editor, shape: TLShape) {
  if (shape.type !== 'geo' && shape.type !== 'text') return null
  const richText = (shape as TLGeoShape).props.richText
  const texto = renderPlaintextFromRichText(editor, richText).replace(/\r/g, '').trim()
  const [titulo = '', ...restante] = texto.split('\n')
  return { titulo: titulo.trim(), corpo: restante.join('\n').trim() }
}

export function shapeIdDeBloco(blockId: string): TLShapeId {
  return `shape:${blockId}` as TLShapeId
}

function corDoBloco(tipo: TipoBloco, blockId?: string) {
  if (!blockId?.includes('-entrevista-')) return TIPOS_INFO[tipo].corTldraw
  if (blockId.endsWith('-command-center') || blockId.endsWith('-guardrails')) return 'yellow'
  if (blockId.endsWith('-telepatia') || blockId.endsWith('-pergunta-ampla')) return 'blue'
  if (blockId.endsWith('-provas') || blockId.endsWith('-rpa')) return 'violet'
  return 'green'
}

const TIPOS: TipoBloco[] = ['nota', 'tarefa', 'projeto', 'link', 'pessoa', 'imagem']
const STATUS: StatusBloco[] = ['pendente', 'fazendo', 'feito']

// Lê o meta de bloco de uma shape (null se não for um bloco nosso).
export function metaDoBloco(shape: TLShape): BlocoMeta | null {
  if (
    shape.type !== 'geo' &&
    shape.type !== 'image' &&
    shape.type !== 'text' &&
    shape.type !== PORTFOLIO_SHAPE_TYPE
  ) return null
  const m = shape.meta as Partial<BlocoMeta> | undefined
  if (!m || typeof m.blockId !== 'string' || !m.blockId) return null
  return {
    blockId: m.blockId,
    tipo: TIPOS.includes(m.tipo as TipoBloco) ? (m.tipo as TipoBloco) : 'nota',
    status: STATUS.includes(m.status as StatusBloco) ? (m.status as StatusBloco) : 'pendente',
    corpo: typeof m.corpo === 'string' ? m.corpo : '',
    titulo: typeof m.titulo === 'string' ? m.titulo : '',
    ...(typeof m.midia === 'string' && m.midia ? { midia: m.midia } : {}),
  }
}

export function tituloDoShape(editor: Editor, shape: TLShape): string {
  if (shape.type === 'geo' || shape.type === 'text') {
    return partesDoTextoVisivel(editor, shape)?.titulo || '(sem título)'
  }
  return metaDoBloco(shape)?.titulo || '(sem título)'
}

export function corpoDoShape(editor: Editor, shape: TLShape): string {
  if (shape.type === 'geo' || shape.type === 'text') {
    return partesDoTextoVisivel(editor, shape)?.corpo ?? ''
  }
  return metaDoBloco(shape)?.corpo || ''
}

export async function criarBlocoNativo(
  editor: Editor,
  opts: {
    blockId?: string
    tipo: TipoBloco
    titulo: string
    status?: StatusBloco
    corpo?: string
    x: number
    y: number
    w?: number
    h?: number
    midia?: string
    visual?: 'portfolio' | 'operacional'
  }
): Promise<void> {
  const blockId = opts.blockId ?? novoBlocoId()
  const meta: BlocoMeta = {
    blockId,
    tipo: opts.tipo,
    status: opts.status ?? 'pendente',
    corpo: opts.corpo ?? '',
    titulo: opts.titulo,
    ...(opts.midia ? { midia: opts.midia } : {}),
  }

  // Imagens do portfólio são arquivos reais em assets/portfolio/. O canvas
  // recebe um data URL somente para renderização; o Markdown guarda o caminho.
  if (opts.tipo === 'imagem' && opts.midia) {
    const imagem = await carregarMidiaPortfolio(opts.midia).catch(() => null)
    if (imagem) {
      const w = opts.w ?? 420
      const h = opts.h ?? 280
      const mimeType = imagem.slice(5, imagem.indexOf(';')) || 'image/png'
      const assetId = AssetRecordType.createId()
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: { name: opts.titulo || 'imagem', src: imagem, w, h, mimeType, isAnimated: false },
          meta: {},
        },
      ])
      editor.createShape<TLImageShape>({
        id: shapeIdDeBloco(blockId),
        type: 'image',
        x: opts.x,
        y: opts.y,
        props: { w, h, assetId },
        meta: meta as never,
      })
      return
    }
  }

  // Pessoa vira shape de imagem nativa com a foto de assets/eu.* (se houver).
  if (opts.tipo === 'pessoa') {
    const foto = await carregarFoto().catch(() => null)
    if (foto) {
      const w = opts.w ?? 220
      const h = opts.h ?? 220
      const mimeType = foto.slice(5, foto.indexOf(';')) || 'image/png'
      const assetId = AssetRecordType.createId()
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: { name: 'eu', src: foto, w, h, mimeType, isAnimated: false },
          meta: {},
        },
      ])
      editor.createShape<TLImageShape>({
        id: shapeIdDeBloco(blockId),
        type: 'image',
        x: opts.x,
        y: opts.y,
        props: { w, h, assetId },
        meta: meta as never, // BlocoMeta é JSON-serializável; o cast satisfaz JsonObject
      })
      return
    }
    // Sem foto: cai pro retângulo normal com o nome.
  }

  if (opts.visual === 'portfolio') {
    editor.createShape({
      id: shapeIdDeBloco(blockId),
      type: PORTFOLIO_SHAPE_TYPE as never,
      x: opts.x,
      y: opts.y,
      props: { w: opts.w ?? 360, h: opts.h ?? 220 },
      meta: meta as never,
    } as never)
    return
  }

  editor.createShape<TLGeoShape>({
    id: shapeIdDeBloco(blockId),
    type: 'geo',
    x: opts.x,
    y: opts.y,
    props: {
      geo: 'rectangle',
      w: opts.w ?? 260,
      h: opts.h ?? 140,
      color: corDoBloco(opts.tipo, opts.blockId) as never,
      fill: 'semi',
      dash: 'solid',
      labelColor: 'black',
      size: opts.blockId?.includes('-entrevista-')
        ? opts.blockId.endsWith('-command-center')
          ? 'l'
          : 'm'
        : 's',
      font: 'sans',
      align: 'start',
      verticalAlign: 'start',
      growY: 0,
      richText: toRichText(textoVisivelDoBloco(opts.titulo, opts.corpo ?? '')),
    },
    meta: meta as never, // BlocoMeta é JSON-serializável; o cast satisfaz JsonObject
  })
}

// Recria o canvas a partir dos blocos lidos dos .md. Idempotente.
export async function carregarBlocosNoCanvas(
  editor: Editor,
  blocos: Bloco[],
  opts?: { portfolio?: boolean }
) {
  for (const b of blocos) {
    if (editor.getShape(shapeIdDeBloco(b.id))) continue
    await criarBlocoNativo(editor, {
      blockId: b.id,
      tipo: b.tipo,
      titulo: b.titulo,
      status: b.status,
      corpo: b.corpo,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      midia: b.midia,
      visual: opts?.portfolio ? 'portfolio' : 'operacional',
    })
  }

  // Setas a partir das conexões registradas no frontmatter.
  for (const b of blocos) {
    for (const destinoId of b.conexoes) {
      try {
        const origemShape = shapeIdDeBloco(b.id)
        const destinoShape = shapeIdDeBloco(destinoId)
        const o = editor.getShape(origemShape)
        const d = editor.getShape(destinoShape)
        if (!o || !d) continue
        const setaId = shapeIdDeBloco(`seta-${b.id}-para-${destinoId}`)
        if (editor.getShape(setaId)) continue
        editor.createShape({
          id: setaId,
          type: 'arrow',
          x: o.x,
          y: o.y,
          props: { start: { x: 0, y: 0 }, end: { x: d.x - o.x, y: d.y - o.y } },
        })
        editor.createBindings([
          { type: 'arrow', fromId: setaId, toId: origemShape, props: { terminal: 'start' } },
          { type: 'arrow', fromId: setaId, toId: destinoShape, props: { terminal: 'end' } },
        ] as never)
      } catch (err) {
        console.error(`[DailyWork] falha ao criar seta ${b.id} -> ${destinoId}:`, err)
      }
    }
  }
}

// Converte o estado atual do canvas em snapshot de blocos para gravar nos .md.
// REGRA DA CASA: tudo que está na Principal vira arquivo. Shapes soltas de
// conteúdo (geo, text, image) sem meta são "adotadas" como blocos de nota —
// o canvas sempre reflete nos .md. Apenas traços livres (draw, line, arrow
// solta) ficam de fora.
export function snapshotDoCanvas(editor: Editor): Bloco[] {
  const shapes = editor.store.allRecords().filter((r): r is TLShape => r.typeName === 'shape')

  const blocoPorShape = new Map<TLShapeId, { shape: TLShape; meta: BlocoMeta }>()
  for (const s of shapes) {
    if (s.meta.dailyworkNative || metaDoConhecimento(s) || ehShapeDoSistemaPrincipal(s)) continue
    let meta = metaDoBloco(s)
    if (!meta && (s.type === 'geo' || s.type === 'text')) {
      meta = { blockId: novoBlocoId(), tipo: 'nota', status: 'pendente', corpo: '', titulo: '' }
      editor.updateShape({ id: s.id, type: s.type, meta: { ...s.meta, ...meta } })
    }
    if (meta) blocoPorShape.set(s.id, { shape: s, meta })
  }

  // Conexões = setas nativas ligadas a dois blocos.
  const conexoesPorBloco = new Map<string, string[]>()
  for (const s of shapes) {
    if (s.type !== 'arrow') continue
    const bindings = editor.getBindingsFromShape(s.id, 'arrow')
    const inicio = bindings.find((b) => b.props.terminal === 'start')
    const fim = bindings.find((b) => b.props.terminal === 'end')
    if (!inicio || !fim) continue
    const origem = blocoPorShape.get(inicio.toId)
    const destino = blocoPorShape.get(fim.toId)
    if (!origem || !destino || origem.shape.id === destino.shape.id) continue
    const lista = conexoesPorBloco.get(origem.meta.blockId) ?? []
    if (!lista.includes(destino.meta.blockId)) lista.push(destino.meta.blockId)
    conexoesPorBloco.set(origem.meta.blockId, lista)
  }

  return [...blocoPorShape.values()].map(({ shape, meta }) => {
    const props = shape.props as { w?: number; h?: number }
    const bloco: Bloco = {
      id: meta.blockId,
      tipo: meta.tipo,
      titulo: tituloDoShape(editor, shape),
      status: meta.status,
      x: shape.x,
      y: shape.y,
      w: props.w ?? 260,
      h: props.h ?? 140,
      conexoes: conexoesPorBloco.get(meta.blockId) ?? [],
      corpo: corpoDoShape(editor, shape) || meta.corpo,
    }
    if (meta.midia) bloco.midia = meta.midia
    return bloco
  })
}

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(leitor.error || new Error('falha ao ler imagem'))
    leitor.onload = () => resolve(String(leitor.result || '').split(',')[1] || '')
    leitor.readAsDataURL(blob)
  })
}

// Antes de salvar o snapshot, transforma imagens nativas inseridas pelo
// toolbar/drag-and-drop do tldraw em arquivos auditáveis do portfólio.
export async function prepararMidiasDoCanvas(editor: Editor): Promise<void> {
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.meta.dailyworkNative || shape.type !== 'image' || metaDoConhecimento(shape) || ehShapeDoSistemaPrincipal(shape)) {
      continue
    }
    const atual = metaDoBloco(shape)
    if (atual?.tipo === 'pessoa' || atual?.midia) continue
    const assetId = (shape as TLImageShape).props.assetId
    if (!assetId) continue
    const asset = editor.getAsset(assetId)
    if (!asset || asset.type !== 'image' || typeof asset.props.src !== 'string') continue

    const resposta = await fetch(asset.props.src)
    if (!resposta.ok) throw new Error(`não foi possível ler a imagem ${asset.props.name}`)
    const blob = await resposta.blob()
    const salva = await salvarMidiaPortfolio({
      nome: asset.props.name || 'imagem',
      mimeType: blob.type || asset.props.mimeType || 'image/png',
      base64: await blobParaBase64(blob),
    })
    const meta: BlocoMeta = {
      blockId: atual?.blockId || novoBlocoId(),
      tipo: 'imagem',
      status: atual?.status || 'pendente',
      corpo: atual?.corpo || '',
      titulo: atual?.titulo || asset.props.name || 'Imagem do portfólio',
      midia: salva.caminho,
    }
    editor.updateShape({
      id: shape.id,
      type: 'image',
      meta: { ...shape.meta, ...meta },
    })
  }
}
