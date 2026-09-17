// Escala da interface: a UI foi desenhada para ~1440×900. Em monitores
// grandes com escala 1 (mesa Omarchy), o Chromium abre em 100% e tudo
// fica minúsculo. O zoom automático preenche esse quadro; o manual
// persiste o fator que a pessoa escolheu.

const ZOOM_MIN = 0.75
const ZOOM_MAX = 2.5
const ZOOM_PASSO = 0.1
const LARGURA_REFERENCIA = 1440
const ALTURA_REFERENCIA = 900

function limitarZoom(valor) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return 1
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100
}

function zoomAutomaticoParaArea(area) {
  const width = Number(area?.width)
  const height = Number(area?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 1
  const escala = Math.min(width / LARGURA_REFERENCIA, height / ALTURA_REFERENCIA)
  return limitarZoom(Math.max(1, escala))
}

function proximoZoom(atual, direcao) {
  const passo = Number(direcao) < 0 ? -ZOOM_PASSO : ZOOM_PASSO
  return limitarZoom((Number(atual) || 1) + passo)
}

function lerPreferencia(texto) {
  if (!texto || !String(texto).trim()) return { modo: 'automatico', zoom: null }
  try {
    const dados = JSON.parse(texto)
    if (dados?.modo === 'manual' && Number.isFinite(Number(dados.zoom))) {
      return { modo: 'manual', zoom: limitarZoom(dados.zoom) }
    }
  } catch {
    // arquivo corrompido ou de outra versão: volta ao automático
  }
  return { modo: 'automatico', zoom: null }
}

function serializarPreferencia(pref) {
  if (pref?.modo === 'manual') {
    return `${JSON.stringify({ modo: 'manual', zoom: limitarZoom(pref.zoom) })}\n`
  }
  return `${JSON.stringify({ modo: 'automatico' })}\n`
}

function resolverZoom(pref, area) {
  if (pref?.modo === 'manual' && pref.zoom != null) return limitarZoom(pref.zoom)
  return zoomAutomaticoParaArea(area)
}

function atalhoDeEscala(input) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return null
  if (!(input.control || input.meta)) return null
  if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd') return 'aumentar'
  if (input.key === '-' || input.code === 'NumpadSubtract') return 'diminuir'
  if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') return 'resetar'
  return null
}

module.exports = {
  ALTURA_REFERENCIA,
  LARGURA_REFERENCIA,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PASSO,
  atalhoDeEscala,
  lerPreferencia,
  limitarZoom,
  proximoZoom,
  resolverZoom,
  serializarPreferencia,
  zoomAutomaticoParaArea,
}
