import { useEffect, useRef } from 'react'

export interface DestinoPagina { view: string; secao?: string; campanhaId?: string }
export type AlvoPendencia =
  | { tipo: 'agenda'; modulo: string; ocorrenciaId: string; dia: string }
  | ({ tipo: 'secao' } & DestinoPagina)

export function navegarPara(destino: DestinoPagina) {
  window.dispatchEvent(new CustomEvent('app:navegar', { detail: destino }))
}
export function abrirAgenda() { window.dispatchEvent(new CustomEvent('agenda:abrir')) }
export function resolverPendencia(pendencia: { titulo: string; alvo: AlvoPendencia }) {
  window.dispatchEvent(new CustomEvent('app:resolver', { detail: pendencia }))
}

// O destino é lido também na montagem: navegar entre módulos não perde o evento.
export function useDestinoPagina(view: string, aplicar: (destino: DestinoPagina) => void, pronto = true) {
  const atual = useRef(aplicar)
  atual.current = aplicar
  useEffect(() => {
    if (!pronto) return
    const ler = () => {
      const p = new URLSearchParams(location.search)
      if (p.get('view') === view) atual.current({ view, secao: p.get('secao') || undefined, campanhaId: p.get('campanha') || undefined })
    }
    ler()
    window.addEventListener('app:destino', ler)
    return () => window.removeEventListener('app:destino', ler)
  }, [view, pronto])
}

export function destacarSecao(id: string) {
  requestAnimationFrame(() => {
    const alvo = document.getElementById(id)
    if (!alvo) return
    for (let pai = alvo.parentElement; pai; pai = pai.parentElement) if (pai instanceof HTMLDetailsElement) pai.open = true
    alvo.setAttribute('tabindex', '-1')
    alvo.focus({ preventScroll: true })
    alvo.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
