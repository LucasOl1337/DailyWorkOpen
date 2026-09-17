const test = require('node:test')
const assert = require('node:assert/strict')

async function carregar() {
  return import('../src/lib/fila-filtros.ts')
}

function peca(extra = {}) {
  const criadoEm = extra.criadoEm || '2026-09-16T20:00:00.000Z'
  return {
    id: extra.id || 'a',
    pautaId: extra.pautaId || 'pauta-1',
    conta: extra.conta || 'x',
    idioma: extra.idioma || 'pt-BR',
    formato: extra.formato || 'imagem',
    titulo: extra.titulo || 'Título',
    texto: extra.texto || 'Texto da peça',
    campos: {},
    midias: [],
    fontes: [],
    origem: extra.origem || { tipo: 'dia', projeto: 'sussurro' },
    estado: extra.estado || 'pendente',
    revisao: 1,
    criadoEm,
    atualizadoEm: extra.atualizadoEm || criadoEm,
    prontidao: extra.prontidao === undefined ? { pronta: true, modo: 'supervisionado', bloqueios: [] } : extra.prontidao,
    ...extra,
  }
}

test('a fila mostra a peça mais recente em cima mesmo se uma antiga foi atualizada depois', async () => {
  const { filtrarFila } = await carregar()
  const antiga = peca({
    id: 'antiga',
    titulo: 'Do trabalho espalhado',
    criadoEm: '2026-09-16T19:01:00.000Z',
    atualizadoEm: '2026-09-16T23:40:00.000Z',
  })
  const nova = peca({
    id: 'nova',
    titulo: 'Sussurro: da fala direto para o cursor',
    criadoEm: '2026-09-16T23:55:00.000Z',
    atualizadoEm: '2026-09-16T23:55:00.000Z',
  })
  const lista = filtrarFila([antiga, nova])
  assert.deepEqual(lista.map((item) => item.id), ['nova', 'antiga'])
})

test('mais antigas ficam embaixo; a ordem invertida sobe as antigas', async () => {
  const { filtrarFila } = await carregar()
  const pecas = [
    peca({ id: 'c', criadoEm: '2026-09-16T10:00:00.000Z' }),
    peca({ id: 'a', criadoEm: '2026-09-16T20:00:00.000Z' }),
    peca({ id: 'b', criadoEm: '2026-09-16T15:00:00.000Z' }),
  ]
  assert.deepEqual(filtrarFila(pecas).map((item) => item.id), ['a', 'b', 'c'])
  assert.deepEqual(filtrarFila(pecas, { ordem: 'antiga' }).map((item) => item.id), ['c', 'b', 'a'])
})

test('publicados saem da fila e os chips de situação recortam o restante', async () => {
  const { filtrarFila, contarSituacoes } = await carregar()
  const pecas = [
    peca({ id: 'pronta', prontidao: { pronta: true, modo: 'supervisionado', bloqueios: [] } }),
    peca({ id: 'pendente', prontidao: { pronta: false, modo: 'supervisionado', bloqueios: [{ codigo: 'SEM_MIDIA', mensagem: 'falta imagem' }] } }),
    peca({ id: 'erro', estado: 'erro', prontidao: { pronta: false, modo: 'supervisionado', bloqueios: [] } }),
    peca({ id: 'publicada', estado: 'publicado' }),
  ]
  const contagem = contarSituacoes(pecas)
  assert.equal(contagem.todas, 3)
  assert.equal(contagem.prontas, 1)
  assert.equal(contagem.pendentes, 1)
  assert.equal(contagem.atencao, 1)
  assert.deepEqual(filtrarFila(pecas, { situacao: 'prontas' }).map((item) => item.id), ['pronta'])
  assert.deepEqual(filtrarFila(pecas, { situacao: 'atencao' }).map((item) => item.id), ['erro'])
  assert.equal(filtrarFila(pecas).some((item) => item.estado === 'publicado'), false)
})

test('rede, idioma, formato e projeto recortam a lista', async () => {
  const { filtrarFila, filtrosFilaAtivos } = await carregar()
  const pecas = [
    peca({ id: 'x-pt', conta: 'x', idioma: 'pt-BR', formato: 'imagem', origem: { tipo: 'dia', projeto: 'sussurro' } }),
    peca({ id: 'li-en', conta: 'linkedin', idioma: 'en', formato: 'texto', origem: { tipo: 'dia', projeto: 'dailywork' } }),
  ]
  assert.equal(filtrarFila(pecas, { conta: 'linkedin' })[0].id, 'li-en')
  assert.equal(filtrarFila(pecas, { idioma: 'en' })[0].id, 'li-en')
  assert.equal(filtrarFila(pecas, { formato: 'imagem' })[0].id, 'x-pt')
  assert.equal(filtrarFila(pecas, { projeto: 'sussurro' })[0].id, 'x-pt')
  assert.equal(filtrarFila(pecas, { busca: 'DailyWork' })[0].id, 'li-en')
  assert.equal(filtrosFilaAtivos({ ordem: 'recente' }), false)
  assert.equal(filtrosFilaAtivos({ situacao: 'prontas' }), true)
  assert.equal(filtrosFilaAtivos({ ordem: 'recente' }, 'sussurro'), true)
})
