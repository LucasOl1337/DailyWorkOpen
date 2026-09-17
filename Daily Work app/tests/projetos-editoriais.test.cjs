const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { candidatosProjetos, listarProjetosEditoriais } = require('../electron/lib-projetos-editoriais.cjs')

test('período seleciona uma pauta por projeto, confere atividade e vincula bytes da captura', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-projetos-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dataDir, 'editorial/fontes-projetos'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'editorial/midias/refs'), { recursive: true })
  const imagem = path.join(dataDir, 'editorial/midias/refs/projeto.png')
  fs.writeFileSync(imagem, 'bytes conhecidos')
  fs.writeFileSync(path.join(dataDir, 'editorial/fontes-projetos/projeto.json'), JSON.stringify({
    id: 'projeto', nome: 'Projeto', registro: 'Uma capacidade pública verificável.', fontes: [{ rotulo: 'Documentação', url: 'https://github.com/example/projeto' }],
    atividade: [{ hash: 'abcdef0123456789', data: '2026-09-01T10:00:00-03:00' }],
    capturas: [{ arquivo: 'midias/refs/projeto.png', ambiente: 'produto-real', dados: 'reais', descricao: 'Tela inspecionada.', sha256: createHash('sha256').update('bytes conhecidos').digest('hex') }],
  }))
  const entrada = { dataDir, projetos: ['projeto', 'projeto'], desde: '2026-08-11', ate: '2026-09-11', dia: '2026-09-11' }
  const [pauta, duplicata] = candidatosProjetos(entrada)
  assert.equal(duplicata, undefined)
  assert.equal(pauta.origem.projeto, 'projeto')
  assert.match(pauta.briefing, /Tela inspecionada/)
  assert.match(pauta.briefing, /github\.com\/example\/projeto/)
  assert.equal(pauta.linkPublico, 'https://github.com/example/projeto')
  assert.deepEqual(pauta.atividade.commits, ['abcdef0123456789'])
  assert.throws(() => candidatosProjetos({ ...entrada, ate: '2026-08-31' }), /Não há atividade/)
  assert.throws(() => candidatosProjetos({ ...entrada, projetos: ['../segredo'] }), /IDs dos projetos/)
  fs.writeFileSync(imagem, 'captura substituída')
  assert.throws(() => candidatosProjetos(entrada), /mudou desde a inspeção/)
  const arquivoFonte = path.join(dataDir, 'editorial/fontes-projetos/projeto.json')
  const fonte = JSON.parse(fs.readFileSync(arquivoFonte))
  fonte.captura = { executor: 'fixture', ambiente: 'produto-real', capacidade: 'Mostrar o painel.', cenas: [{ id: 'all', descricao: 'Visão geral.' }] }
  fonte.repositorios = ['/fixture/projeto']
  fs.writeFileSync(arquivoFonte, JSON.stringify(fonte))
  const [comReceita] = candidatosProjetos(entrada)
  assert.deepEqual(comReceita.referenciasVisuais, [], 'referência velha não bloqueia captura nova')
  assert.deepEqual(comReceita.repositorios, ['/fixture/projeto'])
  assert.equal(comReceita.captura.executor, 'fixture')
  assert.match(comReceita.briefing, /Capacidade a mostrar/)
  fonte.capturas = []
  fs.writeFileSync(arquivoFonte, JSON.stringify(fonte))
  assert.equal(listarProjetosEditoriais(dataDir)[0].temImagem, true, 'receita sem imagem pronta deve aparecer na seleção da Fila')
})

test('captura de demo não aparece como mídia publicável', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-projetos-demo-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dataDir, 'editorial/fontes-projetos'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'editorial/midias/refs'), { recursive: true })
  const imagem = path.join(dataDir, 'editorial/midias/refs/demo.png')
  fs.writeFileSync(imagem, 'bytes')
  fs.writeFileSync(path.join(dataDir, 'editorial/fontes-projetos/demo.json'), JSON.stringify({
    id: 'demo', nome: 'Demo', registro: 'Interface de teste.', fontes: [{ rotulo: 'Código' }],
    atividade: [{ hash: 'abcdef0123456789', data: '2026-09-01T10:00:00Z' }],
    capturas: [{ arquivo: 'midias/refs/demo.png', ambiente: 'demonstracao', dados: 'sinteticos', descricao: 'Servidor demo.', sha256: createHash('sha256').update('bytes').digest('hex') }],
  }))
  assert.equal(listarProjetosEditoriais(dataDir)[0].temImagem, false)
  assert.throws(() => candidatosProjetos({ dataDir, projetos: ['demo'], desde: '2026-09-01', ate: '2026-09-01', dia: '2026-09-01' }), /produto real, com dados reais/)
})
