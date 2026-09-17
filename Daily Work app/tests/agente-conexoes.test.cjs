const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-agente-conexoes-'))
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'LucasKnowledge')
fs.mkdirSync(process.env.LUCAS_KNOWLEDGE_DIR, { recursive: true })

const lib = require('../electron/lib-md.cjs')
const { criarServicoAgente, FERRAMENTAS_CONEXOES } = require('../electron/lib-agente-9router.cjs')
const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')
const { json, redeFalsa } = require('./integracoes-suporte.cjs')

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const DIA = '2026-09-05'

function respostaModelo(conteudo, toolCalls) {
  return json({ choices: [{ message: { role: 'assistant', content: conteudo, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }] })
}

function chamada(id, nome, argumentos) {
  return { id, type: 'function', function: { name: nome, arguments: JSON.stringify(argumentos) } }
}

function ambiente(respostasModelo) {
  const rede = redeFalsa([
    { trecho: 'api.github.com/user', resposta: json({ login: 'lucas', name: 'Lucas', html_url: 'u', avatar_url: 'a' }) },
    { trecho: '/users/lucas/events', resposta: json([]) },
    { metodo: 'POST', trecho: '/repos/lucas/dw/issues', resposta: json({ number: 3, html_url: 'https://github.com/lucas/dw/issues/3' }, 201) },
    { metodo: 'POST', trecho: '/chat/completions', resposta: () => respostasModelo.shift() },
  ])
  const integracoes = criarRegistroIntegracoes({ userDataDir: path.join(TMP, `user-${Math.random()}`), fetchImpl: rede.fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }) })
  const agente = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl, integracoes })
  return { rede, agente, integracoes }
}

test('ferramentas das conexões só aparecem no escopo do dia', async () => {
  const { rede, agente } = ambiente([respostaModelo('ok'), respostaModelo('ok')])
  await agente.conversar({ dia: DIA, perfilId: 'grok-4-6', mensagens: [{ role: 'user', content: 'oi' }] })
  const payloadDia = JSON.parse(rede.chamadas.find((c) => c.url.includes('/chat/completions')).body)
  const nomesDia = payloadDia.tools.map((tool) => tool.function.name)
  assert.ok(nomesDia.includes('consultar_conexoes'))
  assert.ok(nomesDia.includes('propor_publicacao'))
  assert.ok(nomesDia.includes('consultar_sessao_visual'))
  assert.ok(!nomesDia.includes('confirmar_publicacao'))
  assert.equal(FERRAMENTAS_CONEXOES.length, 3)

  await agente.conversar({ escopo: 'principal', perfilId: 'grok-4-6', mensagens: [{ role: 'user', content: 'oi' }] })
  const payloadPrincipal = JSON.parse(rede.chamadas.filter((c) => c.url.includes('/chat/completions')).at(-1).body)
  assert.ok(!payloadPrincipal.tools.some((tool) => tool.function.name.startsWith('propor_publicacao')))
})

test('agente lê as contas, propõe uma publicação e só publica após confirmação', async () => {
  const { rede, agente, integracoes } = ambiente([
    respostaModelo('', [chamada('c1', 'consultar_conexoes', {})]),
    respostaModelo('', [chamada('c2', 'propor_publicacao', { conta: 'github', campos: { tipo: 'issue', repo: 'lucas/dw', titulo: 'Abrir frente', corpo: 'Detalhes' } })]),
    respostaModelo('Proposta preparada.'),
  ])
  const resposta = await agente.conversar({ dia: DIA, perfilId: 'grok-4-6', mensagens: [{ role: 'user', content: 'Abra uma issue sobre isso.' }] })
  assert.equal(resposta.confirmacoes.length, 1)
  const confirmacao = resposta.confirmacoes[0]
  assert.equal(confirmacao.tipo, 'publicar')
  assert.equal(confirmacao.preview.depois.tipo, 'publicação')
  assert.equal(confirmacao.preview.depois.corpo, 'Detalhes')
  assert.equal(rede.chamadas.filter((c) => c.metodo === 'POST' && c.url.includes('/issues')).length, 0, 'nada publicado ainda')

  const mensagemFerramenta = JSON.parse(rede.chamadas.filter((c) => c.url.includes('/chat/completions'))[1].body).messages.find((m) => m.role === 'tool')
  const leitura = JSON.parse(mensagemFerramenta.content)
  assert.equal(leitura.contas.find((conta) => conta.conta === 'github').conectada, true)
  assert.ok(!JSON.stringify(leitura).includes('gho'), 'tokens nunca vão ao modelo')

  const recibo = await agente.confirmarAcao({ dia: DIA, acaoId: confirmacao.id })
  assert.match(recibo.mensagem, /issues\/3/)
  assert.equal(rede.chamadas.filter((c) => c.metodo === 'POST' && c.url.includes('/issues')).length, 1)
  assert.equal(integracoes.propostasPendentes().length, 0)
  await assert.rejects(agente.confirmarAcao({ dia: DIA, acaoId: 'inexistente' }), /expirou/)
})

test('proposta inválida volta como erro de ferramenta sem derrubar a conversa', async () => {
  const { agente } = ambiente([
    respostaModelo('', [chamada('c1', 'propor_publicacao', { conta: 'github', campos: { tipo: 'issue', corpo: 'sem repo' } })]),
    respostaModelo('Faltou o repositório.'),
  ])
  const resposta = await agente.conversar({ dia: DIA, perfilId: 'grok-4-6', mensagens: [{ role: 'user', content: 'publique' }] })
  assert.equal(resposta.confirmacoes.length, 0)
  assert.equal(resposta.mensagem, 'Faltou o repositório.')
})
