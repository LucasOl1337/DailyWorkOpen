const assert = require('node:assert/strict')
const test = require('node:test')
const {
  atalhoDeEscala,
  lerPreferencia,
  limitarZoom,
  proximoZoom,
  resolverZoom,
  serializarPreferencia,
  zoomAutomaticoParaArea,
} = require('../electron/lib-escala-janela.cjs')

test('zoom automático preenche o quadro de 1440×900 sem encolher janelas menores', () => {
  assert.equal(zoomAutomaticoParaArea({ width: 2560, height: 1440 }), 1.6)
  assert.equal(zoomAutomaticoParaArea({ width: 1920, height: 1080 }), 1.2)
  assert.equal(zoomAutomaticoParaArea({ width: 1440, height: 900 }), 1)
  assert.equal(zoomAutomaticoParaArea({ width: 900, height: 700 }), 1)
  assert.equal(zoomAutomaticoParaArea({ width: 3840, height: 2160 }), 2.4)
})

test('limitarZoom rejeita valor inválido e respeita o teto', () => {
  assert.equal(limitarZoom('nope'), 1)
  assert.equal(limitarZoom(0.2), 0.75)
  assert.equal(limitarZoom(4), 2.5)
  assert.equal(limitarZoom(1.234), 1.23)
})

test('proximoZoom anda de 10 em 10 por cento', () => {
  assert.equal(proximoZoom(1, 1), 1.1)
  assert.equal(proximoZoom(1.1, -1), 1)
  assert.equal(proximoZoom(2.5, 1), 2.5)
  assert.equal(proximoZoom(0.75, -1), 0.75)
})

test('preferência manual persiste; o resto volta ao automático', () => {
  assert.deepEqual(lerPreferencia(''), { modo: 'automatico', zoom: null })
  assert.deepEqual(lerPreferencia('{'), { modo: 'automatico', zoom: null })
  assert.deepEqual(lerPreferencia('{"modo":"manual","zoom":1.4}'), { modo: 'manual', zoom: 1.4 })
  assert.equal(serializarPreferencia({ modo: 'automatico' }), '{"modo":"automatico"}\n')
  assert.equal(serializarPreferencia({ modo: 'manual', zoom: 1.4 }), '{"modo":"manual","zoom":1.4}\n')
})

test('resolverZoom usa o fator manual ou a área da janela', () => {
  const area = { width: 2560, height: 1440 }
  assert.equal(resolverZoom({ modo: 'automatico', zoom: null }, area), 1.6)
  assert.equal(resolverZoom({ modo: 'manual', zoom: 1.25 }, area), 1.25)
})

test('atalhoDeEscala reconhece Ctrl mais, menos e zero', () => {
  assert.equal(atalhoDeEscala({ type: 'keyDown', control: true, key: '=' }), 'aumentar')
  assert.equal(atalhoDeEscala({ type: 'keyDown', meta: true, key: '+' }), 'aumentar')
  assert.equal(atalhoDeEscala({ type: 'keyDown', control: true, key: '-' }), 'diminuir')
  assert.equal(atalhoDeEscala({ type: 'keyDown', control: true, key: '0' }), 'resetar')
  assert.equal(atalhoDeEscala({ type: 'keyDown', control: true, isAutoRepeat: true, key: '=' }), null)
  assert.equal(atalhoDeEscala({ type: 'keyDown', key: '=' }), null)
})
