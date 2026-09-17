import {
  createShapeId,
  type Editor,
  type TLShape,
  type TLShapeId,
} from 'tldraw'
import {
  organizarPainelEssencial,
  organizarLayoutConhecimento,
} from './layout-conhecimento'

export const KNOWLEDGE_SHAPE_TYPE = 'dailywork-knowledge-card' as const

export interface PosicaoConhecimento {
  x: number
  y: number
}

export interface NotaConhecimentoResumo {
  caminho: string
  titulo: string
  resumo: string
  grupo: string
  links: string[]
  modificadaEm: string
  noMapa: boolean
  posicao?: PosicaoConhecimento
}

export interface NotaConhecimento extends NotaConhecimentoResumo {
  conteudo: string
  corpo: string
  frontmatter: string
  etag: string
}

export interface CatalogoConhecimento {
  disponivel: boolean
  raiz: string
  notas: NotaConhecimentoResumo[]
}

export interface ContextoPrincipal {
  portfolio: Array<{
    id: string
    tipo: string
    titulo: string
    status: string
    corpo: string
    midia?: string
    conexoes: string[]
  }>
  conhecimento: {
    disponivel: boolean
    raiz: string
    total: number
    orientacao: NotaConhecimento | null
    painelEssencial: NotaConhecimentoResumo[]
  }
}

export interface ConhecimentoMeta {
  dailyworkKind: 'knowledge'
  caminho: string
}

export interface SistemaPrincipalMeta {
  dailyworkKind: 'principal-system'
  papel: 'knowledge-edge'
}

export const OFFSET_CONHECIMENTO = { x: 7600, y: 2050 }

function hashEstavel(valor: string) {
  let hash = 2166136261
  for (let i = 0; i < valor.length; i += 1) {
    hash ^= valor.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function shapeIdDaNota(caminho: string): TLShapeId {
  return createShapeId(`conhecimento-${hashEstavel(caminho)}`)
}

export function metaDoConhecimento(shape: TLShape): ConhecimentoMeta | null {
  const meta = shape.meta as Partial<ConhecimentoMeta> | undefined
  if (meta?.dailyworkKind !== 'knowledge' || typeof meta.caminho !== 'string') return null
  return { dailyworkKind: 'knowledge', caminho: meta.caminho }
}

export function ehShapeDoSistemaPrincipal(shape: TLShape): boolean {
  const meta = shape.meta as Partial<SistemaPrincipalMeta> | undefined
  return meta?.dailyworkKind === 'principal-system'
}

function tomDaNota(caminho: string): string {
  if (caminho === 'LUCAS.md') return 'lucas'
  if (caminho.startsWith('Painel Essencial/Acertos')) return 'acerto'
  if (caminho.startsWith('Painel Essencial/Erros')) return 'erro'
  if (caminho.startsWith('Painel Essencial/Alertas')) return 'alerta'
  if (caminho.startsWith('Painel Essencial/')) return 'painel'
  if (caminho.startsWith('Inteligência Artificial/')) return 'ia'
  if (caminho.startsWith('Desenvolvimento de Software/')) return 'software'
  if (caminho.startsWith('Núcleo de Identidade/')) return 'identidade'
  return 'neutro'
}

function destaqueDaNota(nota: NotaConhecimentoResumo): 'raiz' | 'hub' | 'item' {
  if (nota.caminho === 'LUCAS.md') return 'raiz'
  const nome = nota.caminho.split('/').at(-1)?.replace(/\.md$/i, '') || ''
  const pasta = nota.caminho.split('/').at(-2) || ''
  if (nome === pasta || nota.links.length >= 3 || nota.caminho.split('/').length === 1) return 'hub'
  return 'item'
}

export function dimensoesDaNota(destaque: 'raiz' | 'hub' | 'item') {
  if (destaque === 'raiz') return { w: 380, h: 154 }
  if (destaque === 'hub') return { w: 310, h: 116 }
  return { w: 280, h: 96 }
}

export function removerProjecaoConhecimento(editor: Editor) {
  const ids = editor
    .getCurrentPageShapes()
    .filter((shape) => metaDoConhecimento(shape) || ehShapeDoSistemaPrincipal(shape))
    .map((shape) => shape.id)
  if (ids.length) editor.deleteShapes(ids)
}

export function carregarConhecimentoNoCanvas(editor: Editor, catalogo: CatalogoConhecimento) {
  removerProjecaoConhecimento(editor)
  if (!catalogo.disponivel) return

  const visiveis = catalogo.notas.filter((nota) => nota.noMapa && nota.posicao)
  const dimensoes = new Map(
    visiveis.map((nota) => {
      const destaque = destaqueDaNota(nota)
      return [nota.caminho, { destaque, ...dimensoesDaNota(destaque) }] as const
    })
  )
  const posicoesPreferidas = organizarPainelEssencial(
    visiveis.map((nota) => ({ chave: nota.caminho, ...nota.posicao! }))
  )
  const posicoes = organizarLayoutConhecimento(
    visiveis.map((nota) => {
      const dimensao = dimensoes.get(nota.caminho)!
      const preferida = posicoesPreferidas.get(nota.caminho) || nota.posicao!
      return {
        chave: nota.caminho,
        x: preferida.x,
        y: preferida.y,
        w: dimensao.w,
        h: dimensao.h,
        peso: dimensao.destaque === 'raiz' ? 12 : dimensao.destaque === 'hub' ? 4 : 1,
        ancora: dimensao.destaque === 'raiz',
      }
    })
  )

  for (const nota of visiveis) {
    const { destaque, w, h } = dimensoes.get(nota.caminho)!
    const posicao = posicoes.get(nota.caminho) || nota.posicao!
    editor.createShape({
      id: shapeIdDaNota(nota.caminho),
      type: KNOWLEDGE_SHAPE_TYPE as never,
      x: OFFSET_CONHECIMENTO.x + posicao.x - w / 2,
      y: OFFSET_CONHECIMENTO.y + posicao.y - h / 2,
      isLocked: false,
      props: {
        w,
        h,
        titulo: nota.titulo,
        resumo: destaque === 'item' ? '' : nota.resumo,
        grupo: nota.grupo,
        caminho: nota.caminho,
        tom: tomDaNota(nota.caminho),
        destaque,
        filhos: nota.links.length,
      },
      meta: { dailyworkKind: 'knowledge', caminho: nota.caminho } satisfies ConhecimentoMeta,
    } as never)
  }

  const porCaminho = new Map(visiveis.map((nota) => [nota.caminho, nota]))
  const arestas = new Set<string>()
  const idsArestas: TLShapeId[] = []
  for (const origem of visiveis) {
    for (const destinoCaminho of origem.links) {
      if (!porCaminho.has(destinoCaminho)) continue
      const chave = [origem.caminho, destinoCaminho].sort().join('::')
      if (arestas.has(chave)) continue
      arestas.add(chave)
      const origemId = shapeIdDaNota(origem.caminho)
      const destinoId = shapeIdDaNota(destinoCaminho)
      const origemShape = editor.getShape(origemId)
      const destinoShape = editor.getShape(destinoId)
      if (!origemShape || !destinoShape) continue
      const setaId = createShapeId(`conhecimento-ligacao-${hashEstavel(chave)}`)
      editor.createShape({
        id: setaId,
        type: 'arrow',
        x: origemShape.x,
        y: origemShape.y,
        isLocked: true,
        props: {
          start: { x: 0, y: 0 },
          end: { x: destinoShape.x - origemShape.x, y: destinoShape.y - origemShape.y },
          color: 'grey',
          dash: 'dashed',
          size: 's',
          arrowheadStart: 'none',
          arrowheadEnd: 'none',
        },
        meta: {
          dailyworkKind: 'principal-system',
          papel: 'knowledge-edge',
        } satisfies SistemaPrincipalMeta,
      } as never)
      editor.createBindings([
        { type: 'arrow', fromId: setaId, toId: origemId, props: { terminal: 'start' } },
        { type: 'arrow', fromId: setaId, toId: destinoId, props: { terminal: 'end' } },
      ] as never)
      idsArestas.push(setaId)
    }
  }
  if (idsArestas.length) editor.sendToBack(idsArestas)
}
