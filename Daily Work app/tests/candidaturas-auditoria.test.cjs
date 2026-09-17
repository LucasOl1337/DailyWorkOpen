const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolverEstimativa, criarPreset, valorPresetParaCampo, criarFerramentas, executarMissao } = require('../electron/candidaturas/nativo.cjs')
const { ENVIO_REVISADO, validarAcaoFormulario } = require('../electron/candidaturas/envio.cjs')
function isolado(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-proposta-candidaturas-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
test('mesma experiência específica no preset e na consulta, inclusive zero', () => {
  const dados = '- Software: 5 anos\n- Python: 2 anos\n- JavaScript: 4 anos\n- AWS: 0 anos\n'
  const preset = criarPreset(dados)
  for (const [stack, esperado] of [['Python', '2'], ['JavaScript', '4'], ['AWS', '0'], ['TypeScript', '5']]) {
    const pergunta = `How many years of ${stack} experience?`
    assert.equal(resolverEstimativa(dados, pergunta).valor, esperado)
    assert.equal(valorPresetParaCampo({ label: pergunta, tipo: 'number' }, preset), esperado)
  }
})
test('salário usa unidade correta e preserva pendência quando falta autorização', () => {
  const resolver = (pergunta, criterios) => resolverEstimativa('', pergunta, criterios)?.valor || null
  assert.equal(resolver('Salary expectation', {moeda:'USD', periodo:'hora', salarioMin:50}), null)
  assert.equal(resolver('Pretensão salarial', {moeda:'BRL', periodo:'mes', salarioMin:18000}), null)
  assert.equal(resolver('Salary expectation', {moeda:'EUR', periodo:'mes'}), null)
  assert.equal(resolver('Pretensão salarial anual BRL', {moeda:'BRL', periodo:'ano', salarioMin:144000}), '144000 BRL/ano')
  assert.equal(resolver('Pretensão salarial por mês BRL', {moeda:'BRL', periodo:'ano', salarioMin:144000}), '12000 BRL/mes')
  const preset = criarPreset('', {moeda:'USD', periodo:'mes', salarioMin:3500})
  assert.equal(valorPresetParaCampo({label:'Annual salary USD', tipo:'number'},preset),'42000')
  assert.equal(valorPresetParaCampo({label:'Hourly salary USD', tipo:'number'},preset),null)
})
test('todos os seletores e lote rejeitam envio final antes de chamar navegador', async t => {
  const chamadas = []
  const executar = criarFerramentas({s:{privateDir:isolado(t)},missaoId:'m',repoRoot:'unused',progresso:{acoes:0},salvar(){},autorizar(){},navegador:{async executar(a){chamadas.push(a)}}})
  for (const seletor of ['nome','label','campo','textoAlvo']) {
    await assert.rejects(executar('navegador',{acao:'clicar',aba:'1',[seletor]:'Submit application'}),/Use enviar/)
    await assert.rejects(executar('navegador',{acao:'lote',aba:'1',passos:[{acao:'preencher',campo:'nome',texto:'fixture'},{acao:'clicar',[seletor]:'Submit application'}]}),/Use enviar/)
  }
  assert.equal(chamadas.length,0)
  assert.doesNotThrow(()=>validarAcaoFormulario({acao:'clicar',nome:'Submit application',[ENVIO_REVISADO]:true}))
})
test('três ciclos só de erros e checkpoints param sem perder o checkpoint', async t => {
  const root = isolado(t)
  let estado = 'executando', ciclos = 0
  const missao = {id:'m',criterios:{meta:1},confirmadas:0,candidaturas:[],limite:'2099-01-01T00:00:00Z'}
  const s = {privateDir:root,missao:()=>({...missao,estado}),autorizar(){},executorEstado(a){estado=a.estado}}
  const r = await executarMissao({s,missaoId:'m',repoRoot:root,maxCiclos:5,navegador:{async conectar(){},async fechar(){}},agente:{async configuracao(){return {perfilPadrao:'fixture',provider:'fixture'}},async executarComFerramentas(o){ciclos++;try{await o.executarFerramenta('consultar',{fonte:'inexistente'})}catch{}await o.executarFerramenta('checkpoint',{resumo:'Retomar formulário fixture'});return {mensagem:'Continuar'}}}})
  assert.equal(ciclos,3)
  assert.equal(r.estado,'bloqueada')
  assert.match(r.erro,/sem progresso/)
  assert.equal(r.checkpoint,'Retomar formulário fixture')
})
test('leituras idênticas contam uma vez e página nova conta avanço', async t => {
  const progresso = {acoes:0}
  let url = 'https://example.test/a'
  const executar = criarFerramentas({s:{privateDir:isolado(t)},missaoId:'m',repoRoot:'unused',progresso,salvar(){},autorizar(){},navegador:{async executar(){return {url,frames:[{conteudo:'Formulário fixture',campos:[]}]}}}})
  await executar('navegador',{acao:'ler',aba:'1'})
  await executar('navegador',{acao:'ler',aba:'1'})
  assert.equal(progresso.avancos,1)
  url='https://example.test/b'
  await executar('navegador',{acao:'ler',aba:'1'})
  assert.equal(progresso.avancos,2)
})
