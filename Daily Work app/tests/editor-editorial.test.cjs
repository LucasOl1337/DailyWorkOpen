const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarEditorEditorial, validarPauta, validarRevisao, hashConteudo } = require('../electron/lib-editor-editorial.cjs')
const { criarRedatorPublicacoes } = require('../electron/lib-redator-publicacoes.cjs')
const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
const { pautaFixture, completarComEditor, coberturaCompleta } = require('./helpers/editorial.cjs')

const CONTEXTO = 'A fila preserva as fontes e revoga a aprovação quando o texto muda.'
const pauta = () => validarPauta(pautaFixture(CONTEXTO), CONTEXTO)
function revisao(texto, patch = {}) {
  return { aprovado: true, notas: { evidencia: 5, especificidade: 4, utilidade: 4, voz: 4, adequacao: 4 }, cobertura: coberturaCompleta(texto), afirmacoes: [{ trecho: texto, sustentada: true, evidencias: ['e1'], motivo: 'O registro descreve o comportamento.' }], problemas: [], parecer: 'Texto específico.', ...patch }
}
const registro = { obterConexao: id => ({ id, nome: id, esquemaPublicacao: [{ campo: 'texto', tipo: 'textarea', max: 2000 }] }), prepararPublicacao: async () => { throw Error('Não deve publicar') }, confirmarPublicacao: async () => { throw Error('Não deve publicar') } }

test('pauta exige trechos que realmente existem na fonte e preserva limites', () => {
  assert.equal(pauta().evidencias[0].trecho, CONTEXTO)
  assert.throws(() => validarPauta({ ...pautaFixture(), evidencias: [{ trecho: 'Este produto foi usado por dez mil pessoas.', sustenta: 'Adoção.' }] }, CONTEXTO), e => e.codigo === 'EVIDENCIA_NAO_ENCONTRADA')
  assert.throws(() => validarPauta({ ...pautaFixture(), natureza: 'plano' }, CONTEXTO), e => e.codigo === 'SEM_PAUTA_PUBLICAVEL')
})

test('editor pode recusar uma pauta sem pedir ao redator que preencha lacunas', async () => {
  const editor = criarEditorEditorial({ completar: async ({ mensagens }) => {
    assert.match(mensagens[0].content, /DADO NÃO CONFIÁVEL/)
    assert.match(mensagens[0].content, /status "feito" isolado/)
    return JSON.stringify({ decisao: 'sem_pauta', motivo: 'Só há um pedido para construir a função, sem observação ou resultado.' })
  } })
  await assert.rejects(editor.preparar({ titulo: 'Ideia', contexto: 'Quero um sistema para publicar posts automaticamente.' }), e => e.codigo === 'SEM_PAUTA_PUBLICAVEL')
})

test('número sem evidência reprova mesmo se o modelo disser aprovado', () => {
  const texto = 'A fila reduziu o retrabalho em 97% e chegou a 10 mil clientes.'
  const resultado = validarRevisao(revisao(texto), { campos: { texto }, pauta: pauta() })
  assert.equal(resultado.aprovado, false)
  assert.match(resultado.problemas.join(' '), /97/)
  assert.match(resultado.problemas.join(' '), /10/)
})

test('números são comparados como tokens e IDs de URLs não viram métricas', () => {
  const fonte = 'O teste controlado levou 30 segundos, com 4,2 MB na amostra.'
  const p = validarPauta(pautaFixture(fonte), fonte)
  const falso = 'O teste levou 3 segundos.'
  assert.equal(validarRevisao(revisao(falso), { campos: { texto: falso }, pauta: p }).aprovado, false)
  const fiel = 'The sample used 4.2 MB. https://example.test/2026/12345'
  assert.equal(validarRevisao(revisao(fiel), { campos: { texto: fiel }, pauta: p }).aprovado, true)
})

test('revisor não pode inventar trechos da peça, IDs de prova ou omitir notas', () => {
  const campos = { texto: CONTEXTO }
  assert.throws(() => validarRevisao(revisao('Texto inexistente na publicação.'), { campos, pauta: pauta() }), e => e.codigo === 'REVISAO_EDITORIAL_INVALIDA')
  const comIdFalso = revisao(CONTEXTO, { afirmacoes: [{ trecho: CONTEXTO, sustentada: true, evidencias: ['inventado'] }] })
  assert.equal(validarRevisao(comIdFalso, { campos, pauta: pauta() }).aprovado, false)
  assert.throws(() => validarRevisao(revisao(CONTEXTO, { notas: { evidencia: 5 } }), { campos, pauta: pauta() }), e => e.codigo === 'REVISAO_EDITORIAL_INVALIDA')
})

test('um post genérico com fatos corretos também não atinge o padrão', () => {
  const valor = revisao(CONTEXTO, { notas: { evidencia: 5, especificidade: 2, utilidade: 2, voz: 4, adequacao: 4 } })
  assert.equal(validarRevisao(valor, { campos: { texto: CONTEXTO }, pauta: pauta() }).aprovado, false)
})

test('inventário de funções sem história completa não pode ser aprovado', () => {
  const texto = 'O Sussurro transforma fala em texto direto no cursor.\n\nDá para ditar mensagens, documentos ou código com processamento local.'
  const valor = revisao(texto, {
    cobertura: {
      tema: { atendido: true, trecho: 'O Sussurro transforma fala em texto direto no cursor.' },
      problema: { atendido: false, trecho: '' },
      resolucao: { atendido: true, trecho: 'Dá para ditar mensagens, documentos ou código' },
      conclusao: { atendido: false, trecho: '' },
    },
  })
  const resultado = validarRevisao(valor, { campos: { texto }, pauta: pauta(), conta: 'x', idioma: 'pt-BR' })
  assert.equal(resultado.aprovado, false)
  assert.match(resultado.problemas.join(' '), /atrito|fechar a ideia/i)
})

test('marcadores Markdown reprovam a peça mesmo com voz aprovada pelo modelo', () => {
  for (const texto of ['A fila __preserva__ as fontes.', 'A fila **preserva** as fontes.', 'A fila usa `fontes`.']) {
    const resultado = validarRevisao(revisao(texto), { campos: { texto }, pauta: pauta() })
    assert.equal(resultado.aprovado, false)
    assert.match(resultado.problemas.join(' '), /Markdown/)
  }
})

test('seleção recebe o briefing e só aceita uma captura realmente fornecida', async () => {
  let selecionada = 'midias/refs/fila.png'
  const editor = criarEditorEditorial({ completar: async ({ mensagens }) => {
    assert.match(mensagens[0].content, /todo conteúdo proeminente/)
    assert.match(mensagens[0].content, /direção contraditória/)
    assert.match(mensagens[0].content, /será anexada sem edição/)
    const dados = JSON.parse(mensagens[1].content)
    assert.equal(dados.briefing, 'Mostrar a revisão com linguagem simples.')
    assert.equal(dados.referenciasVisuais[0].descricao, 'Tela da revisão aberta.')
    return JSON.stringify({ ...pautaFixture(CONTEXTO), midia: { tipo: 'captura', objetivo: 'Mostrar a revisão.', referencia: selecionada } })
  } })
  const entrada = { contexto: CONTEXTO, briefing: 'Mostrar a revisão com linguagem simples.', exigirMidia: true, referenciasVisuais: [{ arquivo: selecionada, descricao: 'Tela da revisão aberta.', sha256: 'hash-captura' }] }
  assert.equal((await editor.preparar(entrada)).midia.referenciaSha256, 'hash-captura')
  selecionada = 'midias/refs/inventada.png'
  await assert.rejects(editor.preparar(entrada), e => e.codigo === 'PAUTA_INVALIDA')
})

test('história sem tela adequada pede captura em vez de virar post sobre README', async () => {
  const editor = criarEditorEditorial({ completar: async () => JSON.stringify({ decisao: 'captura_necessaria', motivo: 'Abrir o painel All e o detalhe Codex.' }) })
  await assert.rejects(editor.preparar({ contexto: CONTEXTO, referenciasVisuais: [{ arquivo: 'readme.png', descricao: 'Documentação.' }] }), e => e.codigo === 'CAPTURA_NECESSARIA' && e.message.includes('Codex'))
})

test('seleção de sequência preserva ordem e hashes e recusa arquivo inventado', async () => {
  let arquivos = ['codex.png', 'all.png']
  const refs = ['all', 'codex'].map(nome => ({ arquivo: `${nome}.png`, descricao: nome, sha256: `hash-${nome}` }))
  const editor = criarEditorEditorial({ completar: async () => JSON.stringify({ ...pautaFixture(CONTEXTO), midia: { tipo: 'captura', objetivo: 'Mostrar conjunto e detalhe.', referencias: arquivos } }) })
  const entrada = { contexto: CONTEXTO, exigirMidia: true, referenciasVisuais: refs }
  const pauta = await editor.preparar(entrada)
  assert.deepEqual(pauta.midia.referencias.map(r => r.sha256), ['hash-codex', 'hash-all'])
  arquivos = ['inventada.png']
  await assert.rejects(editor.preparar(entrada), e => e.codigo === 'PAUTA_INVALIDA')
})

test('reescrita passa por nova revisão e guarda os modelos e prompts usados', async () => {
  let escritas = 0
  const chamadas = []
  const completar = completarComEditor(async entrada => {
    escritas++
    return { mensagem: JSON.stringify({ texto: escritas === 1 ? 'A fila atende 10 mil clientes.' : CONTEXTO }), perfil: { id: 'redator-real-fixture' }, fallback: null }
  })
  const redator = criarRedatorPublicacoes({ registro, completar: async entrada => { chamadas.push(entrada); return completar(entrada) } })
  const resultado = await redator.rascunhar({ conta: 'linkedin', idioma: 'pt-BR', contextoExtra: CONTEXTO, pautaEditorial: pauta(), publicavel: true, strictJson: true, perfilId: 'redator-fixture', perfilEditor: 'editor-fixture' })
  assert.equal(chamadas.find(c=>c.mensagens.at(-1).content.includes('O editor reprovou a peça')).perfilId, 'editor-fixture')
  assert.equal(escritas, 2)
  assert.equal(resultado.rascunho.texto, CONTEXTO)
  assert.equal(resultado.editorial.qualidade.aprovado, true)
  assert.equal(resultado.editorial.execucoes.filter(e => e.etapa === 'revisao').length, 2)
  assert.equal(resultado.editorial.execucoes[0].perfilUsado, 'redator-real-fixture')
  assert.equal(resultado.editorial.execucoes[0].promptHash.length, 64)
})

test('resposta inicial fora do JSON recebe uma reparação estrutural antes de descartar a pauta', async () => {
  let redacoes = 0
  const redator = criarRedatorPublicacoes({ registro, completar: completarComEditor(async () => {
    redacoes++
    return redacoes === 1 ? 'Aqui está o texto pedido, mas sem o objeto.' : JSON.stringify({ texto: CONTEXTO })
  }) })
  const resultado = await redator.rascunhar({ conta: 'linkedin', idioma: 'pt-BR', contextoExtra: CONTEXTO, pautaEditorial: pauta(), publicavel: true, strictJson: true })
  assert.equal(redacoes, 2)
  assert.equal(resultado.rascunho.texto, CONTEXTO)
  assert.equal(resultado.editorial.qualidade.aprovado, true)
})

test('modo publicável aceita um objeto JSON extraível e ainda o submete ao esquema e ao editor', async () => {
  let redacoes = 0
  const redator = criarRedatorPublicacoes({ registro, completar: completarComEditor(async () => {
    redacoes++
    return `Resposta:\n${JSON.stringify({ texto: CONTEXTO })}\nFim.`
  }) })
  const resultado = await redator.rascunhar({ conta: 'linkedin', idioma: 'pt-BR', contextoExtra: CONTEXTO, pautaEditorial: pauta(), publicavel: true, strictJson: true })
  assert.equal(redacoes, 1)
  assert.equal(resultado.rascunho.texto, CONTEXTO)
  assert.equal(resultado.editorial.qualidade.aprovado, true)
})

test('reescrita aprovada no conteúdo é ajustada ao limite da rede antes da segunda revisão', async () => {
  let redacoes = 0
  let revisoes = 0
  const registroCurto = { obterConexao: id => ({ id, nome:id, esquemaPublicacao:[{campo:'texto',tipo:'textarea',max:90}] }) }
  const completar = async entrada => {
    const sistema = entrada.mensagens[0].content
    if (sistema.startsWith('ETAPA_EDITORIAL: revisao')) {
      revisoes++
      const dados=JSON.parse(entrada.mensagens[1].content)
      const trecho=dados.campos.texto
      if(revisoes===1) return {mensagem:JSON.stringify(revisao(trecho,{aprovado:false,problemas:['Corte a métrica sem suporte.'],afirmacoes:[{trecho,sustentada:false,evidencias:[],motivo:'Sem prova.'}]}))}
      return {mensagem:JSON.stringify(revisao(trecho))}
    }
    redacoes++
    if(redacoes===1)return {mensagem:JSON.stringify({texto:'A fila atende 10 mil clientes.'})}
    if(redacoes===2)return {mensagem:JSON.stringify({texto:'A fila preserva as fontes e revoga a aprovação quando o texto muda. '.repeat(3)})}
    assert.match(entrada.mensagens.at(-1).content,/limite de 90 caracteres/)
    return {mensagem:JSON.stringify({texto:CONTEXTO})}
  }
  const redator=criarRedatorPublicacoes({registro:registroCurto,completar})
  const resultado=await redator.rascunhar({conta:'x',idioma:'pt-BR',contextoExtra:CONTEXTO,pautaEditorial:pauta(),publicavel:true,strictJson:true})
  assert.equal(resultado.rascunho.texto,CONTEXTO)
  assert.equal(redacoes,3)
  assert.equal(revisoes,2)
})

test('segunda reprovação interrompe geração, sem aceitar a melhor tentativa por falta de opção', async () => {
  const redator = criarRedatorPublicacoes({ registro, completar: completarComEditor(async () => JSON.stringify({ texto: 'A fila atende 10 mil clientes.' })) })
  await assert.rejects(redator.rascunhar({ conta: 'linkedin', contextoExtra: CONTEXTO, pautaEditorial: pauta(), publicavel: true, strictJson: true }), e => e.codigo === 'QUALIDADE_EDITORIAL_BAIXA')
})

test('revisão vale para o texto exato; feedback sobrevive ao arquivamento', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-quality-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const fila = criarFilaEditorial({ dataDir, registro })
  const entrada = { pautaId: 'pauta-1', conta: 'linkedin', idioma: 'pt-BR', titulo: 'Revisão', texto: CONTEXTO, campos: { texto: CONTEXTO }, editorial: { pauta: pauta(), qualidade: { estado: 'aprovada', aprovado: true } } }
  entrada.editorial.qualidade.conteudoHash = hashConteudo(entrada)
  const item = await fila.criar(entrada)
  assert.equal(item.editorial.qualidade.estado, 'aprovada')
  const semMudanca = await fila.atualizar(item.id, { revisao: item.revisao, midias: [] })
  assert.equal(semMudanca.editorial.qualidade.estado, 'aprovada')
  const editado = await fila.atualizar(item.id, { revisao: semMudanca.revisao, texto: 'A revisão acompanha a versão exata.' })
  assert.equal(editado.editorial.qualidade.estado, 'alterada')
  const recusado = await fila.recusar(item.id, { revisao: editado.revisao, motivo: 'Mostre uma situação real de uso.' })
  await fila.excluirMuitos({ itens: [{ id: recusado.id, revisao: recusado.revisao }] })
  const memoria = fs.readFileSync(path.join(dataDir, 'editorial/feedback.ndjson'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepEqual(memoria.map(e => e.tipo), ['edicao', 'recusa'])
  assert.equal(memoria[1].motivo, 'Mostre uma situação real de uso.')
  assert.equal((await fila.listar()).length, 0)
})

test('produção sem história termina como sem_pauta e mostra o motivo', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-no-story-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const pasta = path.join(dataDir, 'skills/aprendizado-em-post')
  fs.mkdirSync(pasta, { recursive: true }); fs.writeFileSync(path.join(pasta, 'SKILL.md'), 'Use somente evidências.')
  let criados = 0
  const produtor = criarProducaoEditorial({ dataDir, skillsDir: path.join(dataDir, 'skills'), fila: { listar: async () => [], criar: async () => { criados++ } }, registro, lib: { listarBlocos: dia => dia ? [{ titulo: 'Plano', corpo: 'Quero criar uma função para publicar posts.', status: 'pendente' }] : [] }, completar: async () => JSON.stringify({ decisao: 'sem_pauta', motivo: 'Ainda falta observar o resultado.' }) })
  produtor.iniciar({ dia: '2026-09-10', quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  for (let i = 0; i < 100 && produtor.estado().producao.status === 'executando'; i++) await new Promise(r => setTimeout(r, 5))
  assert.equal(criados, 0)
  assert.equal(produtor.estado().producao.status, 'sem_pauta')
  assert.equal(produtor.estado().producao.descartadas[0].motivo, 'Ainda falta observar o resultado.')
})
