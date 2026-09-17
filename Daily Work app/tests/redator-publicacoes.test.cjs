const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-redator-'))
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'LucasKnowledge')
fs.mkdirSync(process.env.LUCAS_KNOWLEDGE_DIR, { recursive: true })

const lib = require('../electron/lib-md.cjs')
const { criarRedatorPublicacoes, extrairJson, diagnosticarTextoRobotico, incluirLinkObrigatorio } = require('../electron/lib-redator-publicacoes.cjs')
const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const DIA = '2026-09-05'

test('extrai JSON com ou sem cerca de código', () => {
  assert.deepEqual(extrairJson('```json\n{"texto":"a"}\n```'), { texto: 'a' })
  assert.deepEqual(extrairJson('Aqui está: {"texto":"b"} fim'), { texto: 'b' })
  assert.equal(extrairJson('nada'), null)
})

test('rascunho usa cards do dia como contexto e respeita o esquema da conta', async () => {
  lib.criarBloco({ id: 'b-frente', tipo: 'tarefa', titulo: 'Conectar GitHub ao DailyWork', corpo: 'Objetivo: publicar issues', status: 'feito' }, DIA)
  const registro = criarRegistroIntegracoes({ userDataDir: path.join(TMP, 'user'), fetchImpl: async () => new Response('{}', { status: 404 }), execFileImpl: async () => { throw new Error('sem gh') } })
  let promptRecebido = null
  const redator = criarRedatorPublicacoes({
    completar: async ({ mensagens }) => {
      promptRecebido = mensagens
      return { mensagem: '{"texto":"Hoje conectei o GitHub ao DailyWork.","respostaA":"", "ignorado":"x"}' }
    },
    registro,
    lib,
  })
  const resultado = await redator.rascunhar({ conta: 'x', dia: DIA, briefing: 'tom leve' })
  assert.equal(resultado.contextoUsado, true)
  assert.deepEqual(resultado.rascunho, { texto: 'Hoje conectei o GitHub ao DailyWork.', respostaA: '' })
  assert.match(promptRecebido[1].content, /Conectar GitHub ao DailyWork/)
  assert.match(promptRecebido[1].content, /tom leve/)
  assert.match(promptRecebido[0].content, /280/)
})

test('resposta sem JSON cai no campo de texto principal', async () => {
  const registro = criarRegistroIntegracoes({ userDataDir: path.join(TMP, 'user2'), fetchImpl: async () => new Response('{}', { status: 404 }), execFileImpl: async () => { throw new Error('sem gh') } })
  const redator = criarRedatorPublicacoes({ completar: async () => ({ mensagem: 'Texto solto do modelo.' }), registro, lib })
  const resultado = await redator.rascunhar({ conta: 'linkedin', dia: DIA })
  assert.deepEqual(resultado.rascunho, { texto: 'Texto solto do modelo.' })
})

test('modo publicável rejeita resposta que não é JSON', async () => {
  const registro = criarRegistroIntegracoes({ userDataDir: path.join(TMP, 'user3'), fetchImpl: async () => new Response('{}', { status: 404 }), execFileImpl: async () => { throw new Error('sem gh') } })
  const redator = criarRedatorPublicacoes({ completar: async () => ({ mensagem: 'Texto solto sem JSON.' }), registro, lib })
  await assert.rejects(() => redator.rascunhar({ conta: 'x', dia: DIA, strictJson: true }), (erro) => erro.codigo === 'RESPOSTA_JSON_INVALIDA')
})

test('modo publicável com pauta selecionada não consulta o corpus diário privado', async () => {
  const registro = criarRegistroIntegracoes({ userDataDir: path.join(TMP, 'user4'), fetchImpl: async () => new Response('{}', { status: 404 }), execFileImpl: async () => { throw new Error('sem gh') } })
  const redator = criarRedatorPublicacoes({
    completar: async ({ mensagens }) => {
      assert.match(mensagens[1].content, /Pauta pública selecionada/)
      assert.doesNotMatch(mensagens[1].content, /SEGREDO-PRIVADO/)
      return { mensagem: '{"texto":"Versão baseada somente na pauta selecionada."}' }
    },
    registro,
    lib: { listarBlocos: () => { throw new Error('não deveria ler Principal') } },
    sumario: { obterInputs: () => { throw new Error('não deveria ler entradas') } },
    analiseSumario: { obter: () => { throw new Error('não deveria ler análise') } },
  })
  const resultado = await redator.rascunhar({ conta: 'x', dia: DIA, publicavel: true, strictJson: true, contextoExtra: 'Pauta pública selecionada', briefing: 'tom objetivo' })
  assert.equal(resultado.contextoUsado, true)
})

test('link público obrigatório entra no texto e preserva o limite da rede', () => {
  const campos = { texto: 'Uma descrição curta do projeto.' }
  incluirLinkObrigatorio(campos, [{ campo: 'texto', tipo: 'textarea', max: 80 }], 'https://github.com/example/projeto')
  assert.equal(campos.texto, 'Uma descrição curta do projeto.\n\nhttps://github.com/example/projeto')
  assert.ok(campos.texto.length <= 80)

  const longo = { texto: 'Uma frase muito longa que ocupa o campo inteiro e ainda continua com detalhes que podem ser cortados.' }
  incluirLinkObrigatorio(longo, [{ campo: 'texto', tipo: 'textarea', max: 90 }], 'https://github.com/example/projeto')
  assert.ok(longo.texto.endsWith('https://github.com/example/projeto'))
  assert.ok(longo.texto.length <= 90)
})

test('redator acrescenta o repositório mesmo quando o modelo omite o link', async () => {
  const registro = criarRegistroIntegracoes({ userDataDir: path.join(TMP, 'user-link'), fetchImpl: async () => new Response('{}', { status: 404 }), execFileImpl: async () => { throw new Error('sem gh') } })
  let prompt
  const redator = criarRedatorPublicacoes({ completar: async ({ mensagens }) => { prompt = mensagens; return { mensagem: '{"texto":"Publiquei um painel para acompanhar agentes."}' } }, registro, lib })
  const resultado = await redator.rascunhar({ conta: 'x', publicavel: true, strictJson: true, contextoExtra: 'Pauta pública.', linkObrigatorio: 'https://github.com/example/omarchy-agents' })
  assert.match(prompt[0].content, /Inclua exatamente este link público/)
  assert.match(resultado.rascunho.texto, /https:\/\/github\.com\/example\/omarchy-agents$/)
})

test('gate de voz detecta molde repetitivo e pede uma revisão concreta', async () => {
  const registro = criarRegistroIntegracoes({ userDataDir: path.join(TMP, 'user5'), fetchImpl: async () => new Response('{}', { status: 404 }), execFileImpl: async () => { throw new Error('sem gh') } })
  const respostas = [
    { texto: 'Meu trabalho ficava espalhado.\n\nA decisão técnica foi criar uma fila.\n\nO efeito verificável está no produto.\n\nO aprendizado que levo é simples.\n\nComo você organiza isso?\n\n#IA #Produto' },
    { texto: 'Cada proposta agora guarda a própria revisão. Se uma peça muda, a aprovação anterior deixa de valer; a fila mostra exatamente qual versão ainda precisa ser lida.' },
  ]
  const chamadas = []
  const redator = criarRedatorPublicacoes({ completar: async ({ mensagens }) => { chamadas.push(mensagens); return { mensagem: JSON.stringify(respostas.shift()) } }, registro, lib })
  const resultado = await redator.rascunhar({ conta: 'linkedin', dia: DIA, publicavel: true, strictJson: true, contextoExtra: 'A fila invalida aprovação quando a revisão muda.' })
  assert.equal(chamadas.length, 2)
  assert.match(chamadas[1].at(-1).content, /forma previsível/)
  assert.equal(resultado.rascunho.texto, 'Cada proposta agora guarda a própria revisão. Se uma peça muda, a aprovação anterior deixa de valer; a fila mostra exatamente qual versão ainda precisa ser lida.')
  assert.equal(diagnosticarTextoRobotico(resultado.rascunho.texto).length, 0)
})
