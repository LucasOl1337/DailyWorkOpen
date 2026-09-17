const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function derivador() {
  const arquivo = path.resolve(__dirname, '../src/lib/estado-global.tsx')
  const modulo = { exports: {} }
  const codigo = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(codigo, {
    module: modulo, exports: modulo.exports,
    require: nome => nome.startsWith('./') ? {} : require(nome),
    Date, Map, Set,
  }, { filename: arquivo })
  return modulo.exports.derivar
}
const derivar = derivador()
function agenda(ocorrencias) { return { rotinas: [], ocorrencias } }
function ocorrencia(extra) {
  return { id: 'planejamento-1', rotina: 'planejamento', modulo: 'sumario', tipo: 'planejamento', nome: 'Planejamento do dia', dia: '2026-09-16', estado: 'bloqueada', codigo: 'FALHA_9ROUTER', mensagem: 'O provedor não respondeu.', prevista: 1, atualizadaEm: 2, ...extra }
}

test('resolver Planejamento do dia identifica a atividade bloqueada, não apenas uma tela genérica de agente', () => {
  const p = derivar(agenda([ocorrencia()]), null, []).pendencias[0]
  assert.equal(p.alvo?.tipo, 'agenda')
  assert.equal(p.alvo?.ocorrenciaId, 'planejamento-1')
  assert.equal(p.alvo?.modulo, 'sumario')
  assert.equal(p.alvo?.dia, '2026-09-16')
})

test('resolver campanha RedBull preserva empresa, pesquisa e ocorrência exata', () => {
  const p = derivar(agenda([ocorrencia({ id: 'pesquisa-redbull-1', rotina: 'pesquisa:redbull', modulo: 'campanha:redbull', tipo: 'pesquisa', nome: 'Pesquisa RedBull' })]), null, []).pendencias[0]
  assert.equal(p.alvo?.modulo, 'campanha:redbull')
  assert.equal(p.alvo?.ocorrenciaId, 'pesquisa-redbull-1')
})

test('rascunho sem mídia não é anunciado como pronto para publicar', () => {
  const fila = [{ id: 'sem-imagem', estado: 'pendente', prontidao: { pronta: false, bloqueios: [{ codigo: 'SEM_MIDIA', mensagem: 'Falta imagem' }] } }]
  const ps = derivar(null, null, fila).pendencias
  assert.equal(ps.some(p => /pronta.*publicar/.test(p.titulo)), false)
  assert.equal(ps[0]?.alvo?.tipo, 'secao')
  assert.equal(ps[0]?.alvo?.secao, 'fila-revisao')
})

test('rodada posterior em execução elimina o aviso de bloqueio já superado', () => {
  const atual = ocorrencia({ id: 'planejamento-2', estado: 'executando', atualizadaEm: 3 })
  assert.equal(derivar(agenda([ocorrencia(), atual]), null, []).pendencias.length, 0)
})

test('agenda parada com a bancada no humano não pede conferir Chromium', () => {
  const p = derivar(agenda([ocorrencia({ codigo: 'CONTROLE_HUMANO', mensagem: 'A bancada está com você ou indisponível.' })]), null, []).pendencias[0]
  assert.equal(p.titulo, 'Planejamento do dia: parou')
  assert.doesNotMatch(p.acao, /conexão/)
})
