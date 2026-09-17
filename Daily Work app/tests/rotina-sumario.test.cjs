const assert = require('node:assert/strict')
const test = require('node:test')
const { criarRotinaSumario } = require('../electron/lib-rotina-sumario.cjs')

test('rotina coleta hoje, finaliza ontem e não repete um relatório finalizado', async () => {
  const coletas = []
  const analises = []
  let finalizada = false
  const rotina = criarRotinaSumario({
    now: () => new Date(2026, 7, 17, 10, 0, 0),
    diasParaRecuperar: 1,
    coletar: async (dia) => {
      coletas.push(dia)
      return { completeness: 'complete', stats: { messages: 1 } }
    },
    obterAnalise: () => ({
      status: finalizada ? 'complete' : 'not_analyzed',
      analysis: finalizada ? { finalizedAt: '2026-08-17T13:00:00.000Z' } : null,
    }),
    analisar: async (dia, opcoes) => {
      analises.push({ dia, opcoes })
      finalizada = true
      return { status: 'complete' }
    },
  })

  await rotina.executarAgora()
  await rotina.executarAgora()

  assert.deepEqual(coletas, ['2026-08-17', '2026-08-16', '2026-08-17'])
  assert.equal(analises.length, 1)
  assert.equal(analises[0].dia, '2026-08-16')
  assert.equal(analises[0].opcoes.finalizar, true)
})

test('rotina agenda uma execução inicial e repetições sem duplicar timers', () => {
  const timeouts = []
  const intervals = []
  const limpos = []
  const rotina = criarRotinaSumario({
    coletar: async () => ({ completeness: 'complete', stats: { messages: 0 } }),
    obterAnalise: () => ({ status: 'complete', analysis: { finalizedAt: 'feito' } }),
    analisar: async () => ({ status: 'complete' }),
    setTimeoutFn: (fn, ms) => {
      timeouts.push({ fn, ms })
      return 'timeout-1'
    },
    setIntervalFn: (fn, ms) => {
      intervals.push({ fn, ms })
      return 'interval-1'
    },
    clearTimeoutFn: (id) => limpos.push(id),
    clearIntervalFn: (id) => limpos.push(id),
  })

  rotina.iniciar()
  rotina.iniciar()

  assert.deepEqual(timeouts.map((item) => item.ms), [15_000])
  assert.deepEqual(intervals.map((item) => item.ms), [15 * 60_000])
  rotina.parar()
  assert.deepEqual(limpos, ['timeout-1', 'interval-1'])
})

test('falha em um dia não impede a recuperação dos outros dias', async () => {
  const analisados = []
  const erros = []
  const rotina = criarRotinaSumario({
    now: () => new Date(2026, 7, 17, 10, 0, 0),
    diasParaRecuperar: 3,
    coletar: async (dia) => {
      if (dia === '2026-08-16') throw new Error('fonte indisponível')
      return { completeness: 'complete', stats: { messages: 1 } }
    },
    obterAnalise: () => ({ status: 'not_analyzed', analysis: null }),
    analisar: async (dia) => {
      analisados.push(dia)
      return { status: 'complete' }
    },
    onError: (erro) => erros.push(erro.message),
  })

  await rotina.executarAgora()

  assert.deepEqual(analisados, ['2026-08-15', '2026-08-14'])
  assert.deepEqual(erros, ['fonte indisponível'])
})

test('rotina também finaliza um dia válido sem mensagens', async () => {
  const analisados = []
  const rotina = criarRotinaSumario({
    now: () => new Date(2026, 7, 17, 10, 0, 0),
    diasParaRecuperar: 1,
    coletar: async () => ({ completeness: 'complete', stats: { messages: 0 } }),
    obterAnalise: () => ({ status: 'not_analyzed', analysis: null }),
    analisar: async (dia, opcoes) => analisados.push({ dia, opcoes }),
  })

  await rotina.executarAgora()

  assert.deepEqual(analisados, [{ dia: '2026-08-16', opcoes: { finalizar: true } }])
})

test('rotina finaliza corpus parcial e mantém o aviso de cobertura', async () => {
  const analisados = []
  const rotina = criarRotinaSumario({
    now: () => new Date(2026, 7, 17, 10, 0, 0),
    diasParaRecuperar: 1,
    coletar: async () => ({
      completeness: 'partial',
      stats: { messages: 20 },
      coverage: [{ id: 'codex', status: 'partial', errors: ['7 linhas inválidas'] }],
    }),
    obterAnalise: () => ({ status: 'not_analyzed', analysis: null }),
    analisar: async (dia, opcoes) => analisados.push({ dia, opcoes }),
  })

  await rotina.executarAgora()

  assert.deepEqual(analisados, [{ dia: '2026-08-16', opcoes: { finalizar: true } }])
})

test('rotina refaz a coleta e finaliza uma análise atual que ainda estava aberta', async () => {
  const coletas = []
  const analises = []
  const rotina = criarRotinaSumario({
    now: () => new Date(2026, 7, 17, 10, 0, 0),
    diasParaRecuperar: 1,
    coletar: async (dia) => {
      coletas.push(dia)
      return { completeness: 'complete', stats: { messages: 2 } }
    },
    obterAnalise: () => ({
      status: 'complete',
      analysis: { finalizedAt: null },
    }),
    analisar: async (dia, opcoes) => {
      analises.push({ dia, opcoes })
      return { status: 'complete' }
    },
  })

  await rotina.executarAgora()

  assert.deepEqual(coletas, ['2026-08-17', '2026-08-16'])
  assert.deepEqual(analises, [{ dia: '2026-08-16', opcoes: { finalizar: true } }])
})
