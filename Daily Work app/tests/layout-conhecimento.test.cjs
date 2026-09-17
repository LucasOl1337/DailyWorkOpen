const test = require('node:test')
const assert = require('node:assert/strict')

async function carregarLayout() {
  return import('../src/lib/layout-conhecimento.ts')
}

test('separa cards que compartilham a mesma linha', async () => {
  const { organizarLayoutConhecimento } = await carregarLayout()
  const posicoes = organizarLayoutConhecimento([
    { chave: 'a', x: 0, y: 0, w: 260, h: 82 },
    { chave: 'b', x: 120, y: 0, w: 260, h: 82 },
    { chave: 'c', x: 240, y: 0, w: 260, h: 82 },
  ])

  const centros = ['a', 'b', 'c'].map((chave) => posicoes.get(chave).x)
  assert.ok(centros[1] - centros[0] >= 291.99)
  assert.ok(centros[2] - centros[1] >= 291.99)
})

test('mantem a ancora e resolve colisoes em duas dimensoes', async () => {
  const { organizarLayoutConhecimento } = await carregarLayout()
  const nos = [
    { chave: 'raiz', x: 0, y: 0, w: 380, h: 154, peso: 12, ancora: true },
    { chave: 'vertical-a', x: 0, y: 80, w: 260, h: 82 },
    { chave: 'vertical-b', x: 0, y: 160, w: 260, h: 82 },
    { chave: 'lateral', x: 120, y: 80, w: 260, h: 82 },
  ]
  const primeira = organizarLayoutConhecimento(nos)
  const segunda = organizarLayoutConhecimento(nos)

  assert.deepEqual(primeira.get('raiz'), { x: 0, y: 0 })
  assert.deepEqual([...primeira], [...segunda])

  for (let i = 0; i < nos.length; i += 1) {
    for (let j = i + 1; j < nos.length; j += 1) {
      const a = { ...nos[i], ...primeira.get(nos[i].chave) }
      const b = { ...nos[j], ...primeira.get(nos[j].chave) }
      const separadosEmX = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 31.99
      const separadosEmY = Math.abs(a.y - b.y) >= (a.h + b.h) / 2 + 31.99
      assert.ok(separadosEmX || separadosEmY, `${a.chave} ainda cruza ${b.chave}`)
    }
  }
})

test('separa acertos, erros e alertas do Painel Essencial em clusters', async () => {
  const { organizarPainelEssencial } = await carregarLayout()
  const acertoHub = 'Painel Essencial/Acertos e Práticas Consolidadas.md'
  const erroHub = 'Painel Essencial/Erros e Lições Aprendidas.md'
  const alerta = 'Painel Essencial/Alertas Atuais.md'
  const entrada = [
    { chave: acertoHub, x: -1200, y: -900 },
    { chave: `${acertoHub.replace(/\.md$/, '')}/A.md`, x: -3000, y: -1350 },
    { chave: `${acertoHub.replace(/\.md$/, '')}/B.md`, x: -2640, y: -1350 },
    { chave: erroHub, x: 0, y: -900 },
    { chave: `${erroHub.replace(/\.md$/, '')}/A.md`, x: -720, y: -1350 },
    { chave: `${erroHub.replace(/\.md$/, '')}/B.md`, x: -360, y: -1350 },
    { chave: alerta, x: 1200, y: -900 },
    { chave: 'LUCAS.md', x: 0, y: -420 },
  ]
  const posicoes = organizarPainelEssencial(entrada)

  assert.deepEqual(posicoes.get(acertoHub), { x: -1800, y: -1050 })
  assert.deepEqual(posicoes.get(erroHub), { x: 300, y: -1050 })
  assert.deepEqual(posicoes.get(alerta), { x: 1400, y: -1050 })
  assert.ok(posicoes.get(`${acertoHub.replace(/\.md$/, '')}/B.md`).x < -1000)
  assert.ok(posicoes.get(`${erroHub.replace(/\.md$/, '')}/A.md`).x > -500)
  assert.deepEqual(posicoes.get('LUCAS.md'), { x: 0, y: -420 })
})
