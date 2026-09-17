const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarLogicaEditorial, validar, padrao, BEATS_IDS, compilarRedacao, resumoProducao } = require('../electron/lib-logica-editorial.cjs')
const { criarEditorEditorial, validarPauta } = require('../electron/lib-editor-editorial.cjs')
const { pautaFixture } = require('./helpers/editorial.cjs')

test('o padrão tem os quatro passos de uma redação', () => {
  const logica = padrao()
  assert.deepEqual(logica.roteiro.map((passo) => passo.id), [...BEATS_IDS])
  assert.match(compilarRedacao(logica), /1\. Tema/)
  assert.match(compilarRedacao(logica), /2\. Problema/)
  assert.match(compilarRedacao(logica), /3\. Resolução/)
  assert.match(compilarRedacao(logica), /4\. Conclusão/)
  assert.match(resumoProducao(logica), /tema, problema, resolução, conclusão/)
})

test('grava, lê e restaura a lógica sem perder os ids do roteiro', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-logica-'))
  const servico = criarLogicaEditorial({ dataDir: tmp })
  const base = servico.obter()
  assert.equal(base.origem, 'padrao')
  const editada = validar({
    ...base,
    roteiro: base.roteiro.map((passo) => passo.id === 'tema' ? { ...passo, instrucao: `${passo.instrucao} Comece pelo nome do projeto.` } : passo),
    notas: 'Em inglês, abrir pelo detalhe mais específico.',
  })
  const salva = servico.salvar(editada)
  assert.equal(salva.origem, 'arquivo')
  assert.match(salva.roteiro[0].instrucao, /Comece pelo nome do projeto/)
  assert.equal(servico.obter().notas, 'Em inglês, abrir pelo detalhe mais específico.')
  const restaurada = servico.restaurar()
  assert.equal(restaurada.origem, 'padrao')
  assert.equal(restaurada.notas, '')
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('recusa roteiro incompleto ou com passos fora da ordem', () => {
  const base = padrao()
  assert.throws(() => validar({ ...base, roteiro: base.roteiro.slice(0, 3) }), (erro) => erro.codigo === 'LOGICA_INVALIDA')
  assert.throws(() => validar({ ...base, roteiro: [base.roteiro[1], base.roteiro[0], base.roteiro[2], base.roteiro[3]] }), (erro) => erro.codigo === 'LOGICA_INVALIDA')
  assert.throws(() => validar({ ...base, voz: { ...base.voz, tom: 'curto' } }), (erro) => erro.codigo === 'LOGICA_INVALIDA')
})

test('o editor de pauta pede os quatro passos da lógica vigente', async () => {
  const editor = criarEditorEditorial({
    completar: async ({ mensagens }) => {
      assert.match(mensagens[0].content, /"tema":/)
      assert.match(mensagens[0].content, /"problema":/)
      assert.match(mensagens[0].content, /"resolucao":/)
      assert.match(mensagens[0].content, /"conclusao":/)
      assert.doesNotMatch(mensagens[0].content, /"protagonista":/)
      return JSON.stringify(pautaFixture())
    },
  })
  const pauta = await editor.preparar({ contexto: 'A fila preserva as fontes e revoga a aprovação quando o texto muda.' })
  assert.equal(pauta.tema, pautaFixture().tema)
  assert.equal(validarPauta(pautaFixture(), pautaFixture().evidencias[0].trecho).problema, pautaFixture().problema)
})
