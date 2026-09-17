import type { Box, Editor } from 'tldraw'

export const SESSAO_PORTFOLIO = 'selected-work'
export const PREFIXO_PAGINAS_PORTFOLIO = 'portfolio-pagina-v3-'

export function ehDestaquePortfolio(id: string) {
  return id.startsWith('portfolio-destaque-') ||
    id === `${SESSAO_PORTFOLIO}-capa`
}

export function enquadrarAreaPortfolio(editor: Editor, bounds: Box, duracao: number) {
  const viewport = editor.getViewportScreenBounds()
  const navegacao = document.querySelector('.principal-navigator')?.getBoundingClientRect()
  const topo = Math.max(174, (navegacao?.bottom || 158) - viewport.y + 16)
  const largura = Math.max(200, viewport.width - 192)
  const altura = Math.max(200, viewport.height - topo - 90)
  const zoom = Math.max(0.05, Math.min(largura / bounds.w, altura / bounds.h, 1))
  editor.setCamera({
    x: -bounds.x + (16 + (largura - bounds.w * zoom) / 2) / zoom,
    y: -bounds.y + (topo + (altura - bounds.h * zoom) / 2) / zoom,
    z: zoom,
  }, { animation: { duration: duracao } })
}
