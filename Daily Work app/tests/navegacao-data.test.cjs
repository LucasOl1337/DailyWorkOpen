const test = require('node:test')
const assert = require('node:assert/strict')

test('sumario futuro volta para hoje sem bloquear o Diario futuro', async () => {
  const {
    limitarViewSumarioAoHoje,
    podeAvancarData,
  } = await import('../src/lib/data-local.ts')

  assert.equal(
    limitarViewSumarioAoHoje('sumario:2026-08-21', '2026-08-20'),
    'sumario:2026-08-20',
  )
  assert.equal(
    limitarViewSumarioAoHoje('dia:2026-08-21', '2026-08-20'),
    'dia:2026-08-21',
  )
  assert.equal(podeAvancarData('sumario', '2026-08-20', '2026-08-20'), false)
  assert.equal(podeAvancarData('dia', '2026-08-20', '2026-08-20'), true)
})
