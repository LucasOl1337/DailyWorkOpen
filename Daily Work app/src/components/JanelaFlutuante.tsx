import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import './janela-flutuante.css'

type Geom = { x: number; y: number; w: number; h: number }
type Borda = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface JanelaFlutuanteProps {
  id: string
  aberta: boolean
  children: ReactNode
  tamanhoInicial?: { w: number; h: number }
  minimo?: { w: number; h: number }
  folha?: boolean
}

const BORDAS: Borda[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function chave(id: string) {
  return `dailywork:janela:${id}`
}

function padrao(tamanho: { w: number; h: number }): Geom {
  const w = Math.min(tamanho.w, Math.max(360, window.innerWidth - 24))
  const h = Math.min(tamanho.h, Math.max(420, window.innerHeight - 36))
  return {
    x: Math.max(12, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(56, Math.round((window.innerHeight - h) / 2)),
    w,
    h,
  }
}

function clampar(geom: Geom, minimo: { w: number; h: number }): Geom {
  const w = Math.min(Math.max(Math.round(geom.w), minimo.w), window.innerWidth - 16)
  const h = Math.min(Math.max(Math.round(geom.h), minimo.h), window.innerHeight - 16)
  const x = Math.min(Math.max(Math.round(geom.x), 8), Math.max(8, window.innerWidth - w - 8))
  const y = Math.min(Math.max(Math.round(geom.y), 8), Math.max(8, window.innerHeight - h - 8))
  return { x, y, w, h }
}

function lerGeom(id: string, tamanho: { w: number; h: number }, minimo: { w: number; h: number }): Geom {
  try {
    const valor = JSON.parse(localStorage.getItem(chave(id)) || 'null')
    if (
      valor &&
      Number.isFinite(valor.x) &&
      Number.isFinite(valor.y) &&
      Number.isFinite(valor.w) &&
      Number.isFinite(valor.h)
    ) {
      return clampar(valor, minimo)
    }
  } catch {
    // Sem persistência, abre centralizada.
  }
  return clampar(padrao(tamanho), minimo)
}

function gravarGeom(id: string, geom: Geom) {
  try {
    localStorage.setItem(chave(id), JSON.stringify(geom))
  } catch {
    // Preferência local é opcional.
  }
}

function alvoInterativo(alvo: EventTarget | null) {
  return alvo instanceof Element && Boolean(alvo.closest('button, a, input, select, textarea, label'))
}

export function JanelaFlutuante({
  id,
  aberta,
  children,
  tamanhoInicial = { w: 520, h: 640 },
  minimo = { w: 360, h: 420 },
  folha = false,
}: JanelaFlutuanteProps) {
  const [geom, setGeom] = useState<Geom>(() =>
    typeof window === 'undefined' ? { x: 24, y: 64, ...tamanhoInicial } : lerGeom(id, tamanhoInicial, minimo)
  )
  const geomRef = useRef(geom)
  const minimoRef = useRef(minimo)
  minimoRef.current = minimo
  const arrasto = useRef<{
    tipo: 'mover' | Borda
    inicio: Geom
    x: number
    y: number
  } | null>(null)

  const aplicar = useCallback(
    (proxima: Geom, persistir = false) => {
      const limitada = clampar(proxima, minimoRef.current)
      geomRef.current = limitada
      setGeom(limitada)
      if (persistir) gravarGeom(id, limitada)
    },
    [id]
  )

  useEffect(() => {
    if (!aberta) return
    aplicar(geomRef.current)
    function aoRedimensionar() {
      aplicar(geomRef.current, true)
    }
    window.addEventListener('resize', aoRedimensionar)
    return () => window.removeEventListener('resize', aoRedimensionar)
  }, [aberta, aplicar])

  function ajustar() {
    aplicar(padrao(tamanhoInicial), true)
  }

  function iniciar(evento: ReactPointerEvent, tipo: 'mover' | Borda) {
    if (folha || evento.button !== 0) return
    evento.preventDefault()
    const inicio = {
      tipo,
      inicio: geomRef.current,
      x: evento.clientX,
      y: evento.clientY,
    }
    arrasto.current = inicio
    function mover(move: PointerEvent) {
      if (!arrasto.current) return
      const dx = move.clientX - inicio.x
      const dy = move.clientY - inicio.y
      const proxima = { ...inicio.inicio }
      if (tipo === 'mover') {
        proxima.x = inicio.inicio.x + dx
        proxima.y = inicio.inicio.y + dy
      } else {
        if (tipo.includes('n')) {
          proxima.y = inicio.inicio.y + dy
          proxima.h = inicio.inicio.h - dy
        }
        if (tipo.includes('s')) proxima.h = inicio.inicio.h + dy
        if (tipo.includes('w')) {
          proxima.x = inicio.inicio.x + dx
          proxima.w = inicio.inicio.w - dx
        }
        if (tipo.includes('e')) proxima.w = inicio.inicio.w + dx
      }
      aplicar(proxima)
    }
    function terminar() {
      arrasto.current = null
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', terminar)
      window.removeEventListener('pointercancel', terminar)
      aplicar(geomRef.current, true)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', terminar)
    window.addEventListener('pointercancel', terminar)
  }

  function aoPointerDownCorpo(evento: ReactPointerEvent) {
    const alvo = evento.target
    if (!(alvo instanceof Element)) return
    if (alvo.closest('[data-janela-ajustar]')) {
      evento.preventDefault()
      ajustar()
      return
    }
    if (!alvo.closest('[data-janela-alca]') || alvoInterativo(alvo)) return
    iniciar(evento, 'mover')
  }

  if (!aberta) return null

  return (
    <div
      className={`janela-flutuante ${folha ? 'janela-flutuante--folha' : ''}`}
      data-testid="janela-flutuante"
      style={folha ? undefined : { left: geom.x, top: geom.y, width: geom.w, height: geom.h }}
    >
      {!folha &&
        BORDAS.map((borda) => (
          <span
            key={borda}
            className={`janela-resize janela-resize--${borda}`}
            onPointerDown={(evento) => iniciar(evento, borda)}
          />
        ))}
      <div
        className="janela-flutuante-corpo"
        onPointerDown={aoPointerDownCorpo}
        onDoubleClick={(evento) => {
          const alvo = evento.target
          if (!(alvo instanceof Element) || !alvo.closest('[data-janela-alca]') || alvoInterativo(alvo)) return
          ajustar()
        }}
      >
        {children}
      </div>
    </div>
  )
}
