import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
} from 'tldraw'
import { KNOWLEDGE_SHAPE_TYPE } from '../lib/conhecimento'
import type { BlocoMeta } from '../lib/blocos'

export const PORTFOLIO_SHAPE_TYPE = 'dailywork-portfolio-card' as const

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [PORTFOLIO_SHAPE_TYPE]: { w: number; h: number }
    [KNOWLEDGE_SHAPE_TYPE]: {
      w: number
      h: number
      titulo: string
      resumo: string
      grupo: string
      caminho: string
      tom: string
      destaque: string
      filhos: number
    }
  }
}

export type PortfolioCardShape = TLShape<typeof PORTFOLIO_SHAPE_TYPE>
export type KnowledgeCardShape = TLShape<typeof KNOWLEDGE_SHAPE_TYPE>

const STATUS: Record<string, string> = {
  pendente: 'Em construção',
  fazendo: 'Em destaque',
  feito: 'Consolidado',
}

const TIPO: Record<string, string> = {
  nota: 'Nota de bastidor',
  tarefa: 'Frente',
  projeto: 'Projeto',
  link: 'Referência',
  pessoa: 'Pessoa',
  imagem: 'Imagem',
}

function trecho(corpo: string) {
  return corpo
    .replace(/^objetivo\s*:\s*/im, '')
    .replace(/^pronto\s*=.*$/gim, '')
    .replace(/^\s*[-*•]\s*/gm, '')
    .replace(/[\*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function abrirEvento(nome: string, detail: Record<string, string>) {
  window.dispatchEvent(new CustomEvent(nome, { detail }))
}

export class PortfolioCardShapeUtil extends BaseBoxShapeUtil<PortfolioCardShape> {
  static override type = PORTFOLIO_SHAPE_TYPE
  static override props: RecordProps<PortfolioCardShape> = {
    w: T.number,
    h: T.number,
  }

  override getText(shape: PortfolioCardShape) {
    const meta = shape.meta as unknown as BlocoMeta
    return [meta?.titulo, meta?.corpo].filter(Boolean).join('\n\n')
  }

  override getDefaultProps(): PortfolioCardShape['props'] {
    return { w: 360, h: 220 }
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return true
  }

  override isAspectRatioLocked() {
    return false
  }

  component(shape: PortfolioCardShape) {
    const meta = shape.meta as unknown as BlocoMeta
    const descricao = trecho(meta.corpo || '')
    const ehStack = meta.blockId.startsWith('principal-stack-')
    return (
      <HTMLContainer
        id={shape.id}
        className={`portfolio-shape portfolio-shape--${meta.tipo || 'nota'}${
          ehStack ? ' portfolio-shape--stack' : ''
        }`}
        data-testid={`portfolio-card-${meta.blockId}`}
        onDoubleClick={(event) => {
          event.stopPropagation()
          abrirEvento('dailywork:editar-bloco', { blockId: meta.blockId })
        }}
      >
        <article>
          <header>
            <span>{ehStack ? 'Stack' : TIPO[meta.tipo] || 'Registro'}</span>
            <small>{STATUS[meta.status] || meta.status}</small>
          </header>
          <h2>{meta.titulo || '(sem título)'}</h2>
          {descricao && <p>{descricao}</p>}
          <footer>
            <span>
              {ehStack
                ? 'Tecnologias e capacidades'
                : meta.tipo === 'projeto'
                  ? 'Caso e evidências'
                  : 'Conteúdo do portfólio'}
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => abrirEvento('dailywork:editar-bloco', { blockId: meta.blockId })}
            >
              Editar
            </button>
          </footer>
        </article>
      </HTMLContainer>
    )
  }

  indicator(shape: PortfolioCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx="20" />
  }
}

export class KnowledgeCardShapeUtil extends BaseBoxShapeUtil<KnowledgeCardShape> {
  static override type = KNOWLEDGE_SHAPE_TYPE
  static override props: RecordProps<KnowledgeCardShape> = {
    w: T.number,
    h: T.number,
    titulo: T.string,
    resumo: T.string,
    grupo: T.string,
    caminho: T.string,
    tom: T.string,
    destaque: T.string,
    filhos: T.number,
  }

  override getText(shape: KnowledgeCardShape) {
    return [shape.props.titulo, shape.props.resumo].filter(Boolean).join('\n\n')
  }

  override getDefaultProps(): KnowledgeCardShape['props'] {
    return {
      w: 280,
      h: 96,
      titulo: 'Conhecimento',
      resumo: '',
      grupo: 'Knowledge do workspace',
      caminho: '',
      tom: 'neutro',
      destaque: 'item',
      filhos: 0,
    }
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override isAspectRatioLocked() {
    return true
  }

  component(shape: KnowledgeCardShape) {
    const { titulo, resumo, grupo, caminho, tom, destaque, filhos } = shape.props
    const abrir = () => abrirEvento('dailywork:abrir-conhecimento', { caminho })
    const editar = () => abrirEvento('dailywork:editar-conhecimento', { caminho })
    const excluir = () => abrirEvento('dailywork:excluir-conhecimento', { caminho, titulo })

    return (
      <HTMLContainer
        id={shape.id}
        className={`knowledge-shape knowledge-shape--${tom} knowledge-shape--${destaque}`}
        data-testid={`knowledge-card-${caminho}`}
        onDoubleClick={(event) => {
          event.stopPropagation()
          editar()
        }}
      >
        <article>
          <header>
            <span>{grupo}</span>
            {filhos > 0 && <small>{filhos}</small>}
            {caminho !== 'LUCAS.md' && (
              <button
                type="button"
                className="knowledge-btn-remover"
                title="Remover do mapa ou arquivar nota"
                aria-label={`Remover nota ${titulo}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  excluir()
                }}
              >
                ×
              </button>
            )}
          </header>
          <h2>{titulo}</h2>
          {resumo && <p>{resumo}</p>}
          <footer className="knowledge-acoes">
            <button
              type="button"
              className="knowledge-btn-ler"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                abrir()
              }}
              aria-label={`Abrir nota ${titulo}`}
            >
              Ler nota
            </button>
            {caminho !== 'LUCAS.md' && (
              <button
                type="button"
                className="knowledge-btn-editar"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  editar()
                }}
                aria-label={`Editar nota ${titulo}`}
              >
                Editar
              </button>
            )}
          </footer>
        </article>
      </HTMLContainer>
    )
  }

  indicator(shape: KnowledgeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx="16" />
  }
}

// Nunca declarar este array dentro de um componente: a identidade estável evita
// que o tldraw remonte o editor e descarte o canvas durante a navegação.
export const PRINCIPAL_SHAPE_UTILS = [PortfolioCardShapeUtil, KnowledgeCardShapeUtil]
