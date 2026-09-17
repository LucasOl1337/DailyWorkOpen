import { useEffect, useState } from 'react'
import type { TipoBloco } from '../lib/md'
import { TIPOS_INFO } from '../lib/tipos'

// Menu de criação estilo ComfyUI: abre no botão direito sobre o canvas.
// Campo de nome opcional ("personalizado") + botões de tipo. Esc/clique fora fecha.
export function MenuCriacao({
  x,
  y,
  onEscolher,
  onFechar,
}: {
  x: number
  y: number
  onEscolher: (tipo: TipoBloco, nome: string) => void
  onFechar: () => void
}) {
  const [nome, setNome] = useState('')

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  // Garante que o menu não saia da tela
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 300)

  return (
    <div
      data-principal-ui
      style={{ position: 'fixed', inset: 0, zIndex: 600 }}
      onPointerDown={onFechar}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        data-testid="menu-criacao"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left,
          top,
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: 6,
          minWidth: 180,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <input
          data-testid="menu-criacao-nome"
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            // Enter cria uma nota com o nome digitado (fluxo rápido)
            if (e.key === 'Enter') onEscolher('nota', nome.trim())
          }}
          placeholder="Nome personalizado…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 13,
            marginBottom: 6,
            outline: 'none',
          }}
        />
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#999',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            padding: '2px 8px 4px',
          }}
        >
          Criar bloco
        </div>
        {(Object.keys(TIPOS_INFO) as TipoBloco[]).filter((tipo) => tipo !== 'imagem').map((tipo) => (
          <button
            key={tipo}
            data-testid={`menu-criar-${tipo}`}
            onClick={() => onEscolher(tipo, nome.trim())}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              border: 'none',
              background: 'transparent',
              borderRadius: 6,
              padding: '7px 8px',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = TIPOS_INFO[tipo].fundo)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: TIPOS_INFO[tipo].hex,
                flexShrink: 0,
              }}
            />
            {TIPOS_INFO[tipo].rotulo}
          </button>
        ))}
      </div>
    </div>
  )
}
