const test = require('node:test')
const assert = require('node:assert/strict')
const {
  nomeProjeto,
  formatarDia,
  formatarProducao,
  montarOrigem,
  descreverProveniencia,
  textoBusca,
} = require('../electron/lib-proveniencia-editorial.cjs')

test('nomeia projetos conhecidos e formata o dia do sumário', () => {
  assert.equal(nomeProjeto('videogen'), 'VIDEOGEN')
  assert.equal(nomeProjeto('the-last-arrow'), 'The Last Arrow')
  assert.equal(nomeProjeto('ramdog'), 'RamDog')
  assert.equal(nomeProjeto('sfr'), 'SFR Resgate')
  assert.equal(nomeProjeto('nexsales'), 'NexSales')
  assert.equal(formatarDia('2026-09-09'), '09/09/2026')
})

test('itens já produzidos mostram horário local e a base do acervo', () => {
  const prova = descreverProveniencia({
    titulo: 'VIDEOGEN',
    criadoEm: '2026-09-09T13:38:46.141Z',
    origem: { tipo: 'acervo', projeto: 'videogen' },
    fontes: [{ rotulo: 'Ficha pública videogen.md', url: 'https://github.com/example/videogen' }],
  })
  assert.equal(prova.quando, '09/09/2026, 10:38')
  assert.match(prova.quandoCompleto, /9 de set/)
  assert.match(prova.quandoCompleto, /10:38/)
  assert.equal(prova.projeto, 'VIDEOGEN')
  assert.equal(prova.base, 'Acervo · VIDEOGEN')
  assert.equal(prova.capa, 'Acervo · ficha pública')
  assert.ok(prova.partes.some((parte) => parte.tipo === 'ficha-publica'))
  assert.ok(prova.partes.some((parte) => parte.rotulo === 'Ficha pública videogen.md'))
})

test('peça do dia aponta o sumário mesmo sem partes gravadas', () => {
  const prova = descreverProveniencia({
    titulo: 'Corrigi o recorte de evidências',
    criadoEm: '2026-09-08T15:50:10.299Z',
    origem: { tipo: 'dia', dia: '2026-09-08', projeto: 'dailywork' },
    fontes: [],
  })
  assert.equal(prova.quando, '08/09/2026, 12:50')
  assert.equal(prova.sumarioDia, '2026-09-08')
  assert.equal(prova.sumario, 'Sumário 08/09/2026')
  assert.equal(prova.base, 'Sumário 08/09/2026 · DailyWork')
  assert.ok(prova.partes.some((parte) => parte.tipo === 'bloco'))
})

test('produção registra lote e análise consumida sem atribuir sumário por data', () => {
  const origem = montarOrigem({
    tipo: 'acervo',
    projeto: 'nexarq',
    loteDia: '2026-09-09',
    titulo: 'NexARQ',
    analiseUsada: true,
    partePrincipal: 'ficha-publica',
  })
  assert.equal(origem.tipo, 'acervo')
  assert.equal(origem.projeto, 'nexarq')
  assert.equal(origem.loteDia, '2026-09-09')
  assert.ok(origem.partes.some((parte) => parte.tipo === 'ficha-publica'))
  assert.equal(origem.partes.some((parte) => parte.tipo === 'sumario'), false)
  assert.ok(origem.partes.some((parte) => parte.tipo === 'analise'))
  const prova = descreverProveniencia({ titulo: 'NexARQ', criadoEm: '2026-09-09T13:00:00.000Z', origem, fontes: [] })
  assert.equal(prova.sumarioDia, '2026-09-09')
  assert.match(textoBusca({ titulo: 'NexARQ', texto: 'fato', pautaId: 'p', conta: 'x', origem, fontes: [] }), /NexARQ/)
  assert.match(textoBusca({ titulo: 'NexARQ', texto: 'fato', pautaId: 'p', conta: 'x', origem, fontes: [] }), /2026-09-09/)
})

test('formatarProducao usa o fuso de São Paulo', () => {
  assert.equal(formatarProducao('2026-09-09T13:38:46.141Z'), '09/09/2026, 10:38')
})

test('pedido direto e escrito por Lucas têm base própria', () => {
  const pedido = montarOrigem({ tipo: 'pedido', projeto: 'sussurro', dia: '2026-09-16', titulo: 'Novo loop' })
  assert.equal(pedido.tipo, 'pedido')
  const provaPedido = descreverProveniencia({ titulo: 'Novo loop', criadoEm: '2026-09-16T12:00:00.000Z', origem: pedido, fontes: [] })
  assert.equal(provaPedido.base, 'Pedido direto · Sussurro')
  const provaManual = descreverProveniencia({ titulo: 'Post meu', criadoEm: '2026-09-16T12:00:00.000Z', origem: { tipo: 'manual' }, fontes: [] })
  assert.equal(provaManual.base, 'Escrito à mão')
})
