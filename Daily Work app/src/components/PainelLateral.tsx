import { useState } from 'react'
import { Editor, toRichText, useValue } from 'tldraw'
import { type StatusBloco, type TipoBloco } from '../lib/md'
import {
  criarBlocoNativo,
  metaDoBloco,
  textoVisivelDoBloco,
  tituloDoShape,
  type BlocoMeta,
} from '../lib/blocos'
import { ROTULO_STATUS, TIPOS_INFO } from '../lib/tipos'

// Menu interativo de acesso rápido: lista de blocos, busca, criação e edição
// do bloco selecionado. Os blocos são shapes nativas; os dados vivem no meta.
export function PainelLateral({
  editor,
  onSalvar,
  portfolio = false,
}: {
  editor: Editor
  onSalvar?: () => void
  portfolio?: boolean
}) {
  const [busca, setBusca] = useState('')

  const blocos = useValue(
    'blocos',
    () =>
      editor
        .getCurrentPageShapes()
        .map((s) => ({ shape: s, meta: metaDoBloco(s) }))
        .filter((b): b is { shape: (typeof b)['shape']; meta: BlocoMeta } => b.meta !== null)
        .map((b) => ({ ...b, titulo: tituloDoShape(editor, b.shape) }))
        .sort((a, b) => a.titulo.localeCompare(b.titulo)),
    [editor]
  )

  const selecionado = useValue(
    'selecionado',
    () => {
      const sel = editor
        .getSelectedShapes()
        .map((s) => ({ shape: s, meta: metaDoBloco(s) }))
        .filter((b): b is { shape: (typeof b)['shape']; meta: BlocoMeta } => b.meta !== null)
      if (sel.length !== 1) return null
      return { ...sel[0], titulo: tituloDoShape(editor, sel[0].shape) }
    },
    [editor]
  )

  const filtrados = blocos.filter((b) =>
    (b.titulo + ' ' + b.meta.corpo).toLowerCase().includes(busca.toLowerCase())
  )

  function irParaBloco(id: (typeof blocos)[number]['shape']['id']) {
    editor.select(id)
    editor.zoomToSelection({ animation: { duration: 250 } })
  }

  function criarBloco(tipo: TipoBloco) {
    const ponto = editor.screenToPage(editor.getViewportScreenCenter())
    const w = tipo === 'pessoa' ? 220 : portfolio ? 360 : 260
    const h = tipo === 'pessoa' ? 220 : portfolio ? 220 : 140
    void criarBlocoNativo(editor, {
      tipo,
      titulo: tipo === 'pessoa' ? 'Eu' : 'Novo bloco',
      x: ponto.x - w / 2,
      y: ponto.y - h / 2,
      w,
      h,
      visual: portfolio ? 'portfolio' : 'operacional',
    })
  }

  function atualizarMeta(novos: Partial<BlocoMeta>) {
    if (!selecionado) return
    const meta = { ...selecionado.meta, ...novos }
    if (selecionado.shape.type === 'geo') {
      editor.updateShape({
        id: selecionado.shape.id,
        type: 'geo',
        meta,
        ...(novos.corpo !== undefined
          ? { props: { richText: toRichText(textoVisivelDoBloco(selecionado.titulo, meta.corpo)) } }
          : {}),
      })
      return
    }
    editor.updateShape({ id: selecionado.shape.id, type: selecionado.shape.type, meta } as never)
  }

  function atualizarTitulo(titulo: string) {
    if (!selecionado) return
    if (selecionado.shape.type === 'geo') {
      editor.updateShape({
        id: selecionado.shape.id,
        type: 'geo',
        props: { richText: toRichText(textoVisivelDoBloco(titulo, selecionado.meta.corpo)) },
        meta: { ...selecionado.meta, titulo },
      })
    } else {
      atualizarMeta({ titulo })
    }
  }

  const estiloInput: React.CSSProperties = {
    padding: '6px 8px',
    border: '1px solid #ddd',
    borderRadius: 6,
  }

  return (
    <aside
      data-testid="painel-lateral"
      data-principal-ui
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        bottom: 8,
        width: 280,
        zIndex: 400,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 15 }}>DailyWork</strong>
          {onSalvar && (
            <button
              data-testid="salvar-agora"
              onClick={onSalvar}
              title="Salvar agora nos arquivos .md"
              style={{
                fontSize: 11,
                border: '1px solid #bbb',
                background: '#f5f5f5',
                borderRadius: 6,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              💾 Salvar
            </button>
          )}
        </div>
        <input
          data-testid="busca-bloco"
          placeholder="Buscar bloco…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ ...estiloInput, width: '100%', marginTop: 8, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {(Object.keys(TIPOS_INFO) as TipoBloco[]).filter((tipo) => tipo !== 'imagem').map((tipo) => (
            <button
              key={tipo}
              data-testid={`criar-bloco-${tipo}`}
              onClick={() => criarBloco(tipo)}
              style={{
                fontSize: 11,
                border: `1px solid ${TIPOS_INFO[tipo].hex}`,
                color: TIPOS_INFO[tipo].hex,
                background: TIPOS_INFO[tipo].fundo,
                borderRadius: 6,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              + {TIPOS_INFO[tipo].rotulo}
            </button>
          ))}
        </div>
        {portfolio && (
          <p style={{ margin: '9px 0 0', color: '#6b746f', fontSize: 10, lineHeight: 1.4 }}>
            Imagens: use o botão de imagem na barra inferior ou arraste um arquivo. O DailyWork
            salva a mídia em <code>assets/portfolio/</code>.
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {filtrados.map((b) => (
          <button
            key={b.shape.id}
            data-testid={`bloco-item-${b.meta.blockId}`}
            onClick={() => irParaBloco(b.shape.id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              borderLeft: `3px solid ${TIPOS_INFO[b.meta.tipo].hex}`,
              background: selecionado?.shape.id === b.shape.id ? '#f0f0f0' : 'transparent',
              borderRadius: 4,
              padding: '6px 8px',
              marginBottom: 2,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600 }}>{b.titulo}</div>
            <div style={{ fontSize: 11, color: '#888' }}>
              {TIPOS_INFO[b.meta.tipo].rotulo} · {b.meta.status}
            </div>
          </button>
        ))}
        {filtrados.length === 0 && (
          <div style={{ fontSize: 12, color: '#999', padding: 8 }}>Nenhum bloco encontrado.</div>
        )}
      </div>

      {selecionado && (
        <div
          style={{
            borderTop: '1px solid #eee',
            padding: 12,
            maxHeight: '45%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>Editar bloco</strong>
          <input
            data-testid="editar-titulo"
            value={selecionado.titulo === '(sem título)' ? '' : selecionado.titulo}
            placeholder="Título"
            onChange={(e) => atualizarTitulo(e.target.value)}
            style={estiloInput}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              data-testid="editar-tipo"
              value={selecionado.meta.tipo}
              onChange={(e) => atualizarMeta({ tipo: e.target.value as TipoBloco })}
              style={{ ...estiloInput, flex: 1 }}
            >
              {(Object.keys(TIPOS_INFO) as TipoBloco[]).map((t) => (
                <option key={t} value={t}>
                  {TIPOS_INFO[t].rotulo}
                </option>
              ))}
            </select>
            <select
              data-testid="editar-status"
              value={selecionado.meta.status}
              onChange={(e) => atualizarMeta({ status: e.target.value as StatusBloco })}
              style={{ ...estiloInput, flex: 1 }}
            >
              {(Object.keys(ROTULO_STATUS) as StatusBloco[]).map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </option>
              ))}
            </select>
          </div>
          <textarea
            data-testid="editar-corpo"
            value={selecionado.meta.corpo}
            onChange={(e) => atualizarMeta({ corpo: e.target.value })}
            placeholder="Conteúdo em markdown…"
            rows={8}
            style={{
              ...estiloInput,
              resize: 'vertical',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
            }}
          />
          <div style={{ fontSize: 10, color: '#aaa' }}>data/{selecionado.meta.blockId}.md</div>
        </div>
      )}
    </aside>
  )
}
