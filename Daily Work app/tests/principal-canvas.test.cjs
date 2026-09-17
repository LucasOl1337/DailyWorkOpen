const test = require('node:test')
const assert = require('node:assert/strict')
const { registerHooks } = require('node:module')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'tldraw') {
      return { url: 'mock:tldraw', shortCircuit: true }
    }
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        // Deixa o resolvedor padrão produzir o erro original.
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mock:tldraw') {
      return {
        format: 'module',
        source: `
          export const createShapeId = (id) => 'shape:' + id
          export const toRichText = (text) => ({ text })
        `,
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})

async function carregarPrincipal() {
  return import('../src/lib/conhecimento.ts')
}

test('Principal remove decorações fixas antigas sem recriar cabeçalhos bloqueados', async () => {
  const { carregarConhecimentoNoCanvas } = await carregarPrincipal()
  let shapes = [
    {
      id: 'shape:principal-portfolio-header',
      type: 'geo',
      meta: { dailyworkKind: 'principal-system', papel: 'portfolio-header' },
    },
  ]
  const excluidas = []
  const criadas = []
  const editor = {
    getCurrentPageShapes: () => shapes,
    deleteShapes(ids) {
      excluidas.push(...ids)
      shapes = shapes.filter((shape) => !ids.includes(shape.id))
    },
    createShapes(novas) {
      criadas.push(...novas)
    },
  }

  carregarConhecimentoNoCanvas(editor, {
    disponivel: false,
    raiz: '',
    notas: [],
  })

  assert.deepEqual(excluidas, ['shape:principal-portfolio-header'])
  assert.deepEqual(criadas, [])
})

test('conhecimento: projeta shapes desbloqueados para permitir arrastar e reorganizar', async () => {
  const { carregarConhecimentoNoCanvas } = await carregarPrincipal()
  const criadas = []
  const bindings = []
  let shapes = []
  const editor = {
    getCurrentPageShapes: () => shapes,
    getShape: (id) => shapes.find((s) => s.id === id),
    deleteShapes(ids) {
      shapes = shapes.filter((s) => !ids.includes(s.id))
    },
    createShape(shape) {
      criadas.push(shape)
      shapes.push(shape)
    },
    createBindings(novos) {
      bindings.push(...novos)
    },
    sendToBack() {},
  }

  carregarConhecimentoNoCanvas(editor, {
    disponivel: true,
    raiz: '/vault',
    notas: [
      {
        caminho: 'Painel Essencial/Acertos.md',
        titulo: 'Acertos',
        resumo: 'Práticas aprovadas',
        grupo: 'Painel essencial',
        links: ['Painel Essencial/ItemA.md'],
        modificadaEm: new Date().toISOString(),
        noMapa: true,
        posicao: { x: -1800, y: -1050 },
      },
      {
        caminho: 'Painel Essencial/ItemA.md',
        titulo: 'Item A',
        resumo: 'Detalhe',
        grupo: 'Painel essencial',
        links: [],
        modificadaEm: new Date().toISOString(),
        noMapa: true,
        posicao: { x: -1800, y: -1368 },
      },
    ],
  })

  const cards = criadas.filter((s) => s.type === 'dailywork-knowledge-card')
  assert.equal(cards.length, 2)
  assert.equal(cards[0].isLocked, false)
  assert.equal(cards[1].isLocked, false)
  assert.equal(cards[1].props.w, 280)
  assert.equal(cards[1].props.h, 96)
  assert.ok(bindings.length >= 2)
})
