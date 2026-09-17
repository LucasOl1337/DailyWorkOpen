// Escopo global do agente + config persistida de provedor/perfil.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-agente-global-test-'))
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'LucasKnowledge')

fs.mkdirSync(process.env.LUCAS_KNOWLEDGE_DIR, { recursive: true })

const lib = require('../electron/lib-md.cjs')
const { criarServicoAgente, ErroAgente } = require('../electron/lib-agente-9router.cjs')

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

const DIA = '2026-09-07'
const HOJE = new Date()
const DIA_HOJE = [
  HOJE.getFullYear(),
  String(HOJE.getMonth() + 1).padStart(2, '0'),
  String(HOJE.getDate()).padStart(2, '0'),
].join('-')

function respostaJson(corpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return corpo
    },
  }
}

function respostaTexto(texto) {
  return respostaJson({ choices: [{ message: { role: 'assistant', content: texto } }] })
}

function respostaFerramentas(...chamadas) {
  return respostaJson({
    choices: [{ message: { role: 'assistant', content: '', tool_calls: chamadas } }],
  })
}

function chamadaFerramenta(id, nome, argumentos = {}) {
  return { id, type: 'function', function: { name: nome, arguments: JSON.stringify(argumentos) } }
}

function fetchEmFila(respostas) {
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url: String(url), init })
    assert.ok(respostas.length > 0, `fetch inesperado para ${url}`)
    const proxima = respostas.shift()
    return typeof proxima === 'function' ? proxima(chamadas.at(-1)) : proxima
  }
  return { fetchImpl, chamadas }
}

// O transporte Grok CLI devolve o objeto já parseado (sem envelope HTTP).
function respostaGrokTexto(texto) {
  return { choices: [{ message: { role: 'assistant', content: texto } }] }
}

function grokCliFila(respostas) {
  const chamadas = []
  return {
    chamadas,
    grokCli: {
      async completarChat(entrada) {
        chamadas.push(entrada)
        assert.ok(respostas.length > 0, 'chamada inesperada ao Grok CLI')
        const proxima = respostas.shift()
        return typeof proxima === 'function' ? proxima(entrada) : proxima
      },
      async sondar() {
        return { ok: true, modelos: ['grok-4.6', 'grok-4.5'] }
      },
    },
  }
}

function filaFalsa(itens) {
  return { listar: async () => itens.map((item) => ({ ...item })) }
}

function integracoesFalsas() {
  return {
    async listar() {
      return [
        {
          id: 'github',
          nome: 'GitHub',
          status: { configured: true, online: true, conta: { login: 'lucas' } },
          esquemaPublicacao: [],
          orientacaoRedacao: 'Seja direto.',
          capacidades: { sinais: false },
        },
      ]
    },
  }
}

function itemFila(parcial = {}) {
  return {
    id: 'ed-teste-1',
    titulo: 'DailyWork ganha fila editorial',
    conta: 'linkedin',
    idioma: 'pt-BR',
    formato: 'texto',
    estado: 'pendente',
    revisao: 2,
    atualizadoEm: '2026-09-08T12:00:00.000Z',
    ...parcial,
  }
}

function semearDia(dia, titulo) {
  lib.criarBloco({ tipo: 'tarefa', titulo, corpo: 'Objetivo: teste', status: 'fazendo' }, dia)
}

// ---------- Config persistida ----------

test('salvarConfiguracao persiste provedor e perfil e devolve a configuração nova', async () => {
  const configPath = path.join(TMP, `config-${Date.now()}-a.json`)
  const rede = fetchEmFila([
    respostaJson({ ok: true }), // /api/health
    respostaJson({ data: [{ id: 'cx/gpt-5.6-sol(medium)' }] }), // /models
  ])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl, configPath })
  const config = await servico.salvarConfiguracao({ provider: '9router', perfilId: 'gpt-5-6-sol-medium' })
  assert.equal(config.provider, '9router')
  assert.equal(config.perfilPadrao, 'gpt-5-6-sol-medium')
  assert.deepEqual(config.configuracaoPersistida, { provider: '9router', perfilId: 'gpt-5-6-sol-medium' })
  assert.equal(config.provedores.find((p) => p.id === '9router').selecionado, true)
  assert.ok(config.catalogos['grok-cli'].length > 0)
  const gravada = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.deepEqual(gravada, { provider: '9router', perfilId: 'gpt-5-6-sol-medium' })
})

test('salvarConfiguracao rejeita provedor e perfil fora do catálogo', async () => {
  const configPath = path.join(TMP, `config-${Date.now()}-b.json`)
  const servico = criarServicoAgente({ lib, fetchImpl: fetchEmFila([]).fetchImpl, configPath })
  await assert.rejects(
    () => servico.salvarConfiguracao({ provider: 'openai', perfilId: 'gpt-5' }),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'PROVEDOR_INVALIDO'
  )
  await assert.rejects(
    () => servico.salvarConfiguracao({ provider: 'grok-cli', perfilId: 'gpt-5-6-sol-max' }),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'PERFIL_NAO_PERMITIDO'
  )
  assert.equal(fs.existsSync(configPath), false)
})

test('config persistida vence a heurística do fetchImpl e vale sem reiniciar o processo', async () => {
  const configPath = path.join(TMP, `config-${Date.now()}-c.json`)
  fs.writeFileSync(configPath, JSON.stringify({ provider: 'grok-cli', perfilId: 'grok-4-5' }))
  // Mesmo com fetchImpl customizado (que indicaria 9router), o disco manda.
  const { chamadas, grokCli } = grokCliFila([respostaGrokTexto('Pelo CLI.')])
  const servico = criarServicoAgente({
    lib,
    grokCli,
    configPath,
    fetchImpl: async () => {
      throw new Error('não deveria chamar o 9Router')
    },
  })
  const resultado = await servico.conversar({
    dia: DIA,
    mensagens: [{ role: 'user', content: 'oi' }],
  })
  assert.equal(resultado.mensagem, 'Pelo CLI.')
  assert.equal(resultado.perfil.id, 'grok-4-5')
  assert.equal(chamadas.length, 1)
})

test('sem config persistida o comportamento padrão se mantém', async () => {
  const configPath = path.join(TMP, `config-${Date.now()}-inexistente.json`)
  const rede = fetchEmFila([respostaTexto('Pelo router.')])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl, configPath })
  const resultado = await servico.conversar({
    dia: DIA,
    mensagens: [{ role: 'user', content: 'oi' }],
  })
  assert.equal(resultado.perfil.rota, 'gcli/grok-4.6')
  const config = await servico.configuracao()
  assert.equal(config.configuracaoPersistida, null)
  assert.equal(config.perfilPadrao, 'grok-4-6')
})

// ---------- Escopo global ----------

test('escopo global monta a visão consolidada e expõe as ferramentas globais', async () => {
  semearDia(DIA, 'Fechar a Fila editorial')
  const rede = fetchEmFila([respostaTexto('Visão pronta.')])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    integracoes: integracoesFalsas(),
    fontes: { fila: filaFalsa([itemFila()]) },
    configPath: path.join(TMP, `config-${Date.now()}-d.json`),
  })
  const resultado = await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'O que você enxerga?' }],
  })
  assert.equal(resultado.contexto.escopo, 'global')
  assert.equal(resultado.contexto.hoje, DIA_HOJE)
  const payload = JSON.parse(rede.chamadas.find((c) => c.url.includes('/chat/completions')).init.body)
  const sistema = payload.messages[0].content
  assert.ok(sistema.includes('agente global do DailyWork'))
  assert.ok(sistema.includes('visao-global'))
  assert.ok(sistema.includes('Fechar a Fila editorial'))
  assert.ok(sistema.includes('DailyWork ganha fila editorial'))
  assert.ok(sistema.includes('GitHub'))
  const ferramentas = payload.tools.map((tool) => tool.function.name)
  for (const esperada of [
    'consultar_dia',
    'consultar_principal',
    'consultar_fila_editorial',
    'criar_bloco',
    'atualizar_bloco',
    'mudar_status',
    'propor_arquivamento',
    'consultar_conexoes',
    'propor_publicacao',
  ]) {
    assert.ok(ferramentas.includes(esperada), `ferramenta ausente: ${esperada}`)
  }
  const consultarDia = payload.tools.find((tool) => tool.function.name === 'consultar_dia')
  assert.ok(consultarDia.function.parameters.properties.dia, 'consultar_dia global aceita dia alvo')
})

test('consultar_dia no escopo global lê um dia por vez e barra releitura repetida', async () => {
  semearDia(DIA, 'Frente do dia sete')
  const rede = fetchEmFila([
    respostaFerramentas(chamadaFerramenta('c1', 'consultar_dia', { dia: DIA })),
    respostaFerramentas(chamadaFerramenta('c2', 'consultar_dia', { dia: DIA })),
    respostaTexto('Li o dia sete.'),
  ])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-e.json`),
  })
  const resultado = await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Leia o dia sete duas vezes.' }],
  })
  assert.equal(resultado.mensagem, 'Li o dia sete.')
  const corpos = rede.chamadas.map((c) => JSON.parse(c.init.body))
  const ferramentasRespondidas = corpos
    .flatMap((corpo) => corpo.messages)
    .filter((mensagem) => mensagem.role === 'tool')
    .map((mensagem) => JSON.parse(mensagem.content))
  assert.ok(ferramentasRespondidas.some((r) => r.ok === true && r.dia === DIA))
  assert.ok(ferramentasRespondidas.some((r) => r.ok === false && r.erro.codigo === 'CONSULTA_REPETIDA'))
})

test('consultar_fila_editorial devolve as peças da Fila para o modelo', async () => {
  const rede = fetchEmFila([
    respostaFerramentas(chamadaFerramenta('c1', 'consultar_fila_editorial', {})),
    respostaTexto('A Fila tem uma peça pendente.'),
  ])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    fontes: { fila: filaFalsa([itemFila(), itemFila({ id: 'ed-teste-2', estado: 'agendado', agendadoPara: '2026-09-09T12:00:00.000Z' })]) },
    configPath: path.join(TMP, `config-${Date.now()}-f.json`),
  })
  const resultado = await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Como está a Fila?' }],
  })
  assert.equal(resultado.mensagem, 'A Fila tem uma peça pendente.')
  const ultimaChamada = JSON.parse(rede.chamadas.at(-1).init.body)
  const respostaFerramenta = ultimaChamada.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))[0]
  assert.equal(respostaFerramenta.ok, true)
  assert.equal(respostaFerramenta.total, 2)
  assert.equal(respostaFerramenta.porEstado.pendente, 1)
  assert.equal(respostaFerramenta.porEstado.agendado, 1)
})

test('escopo global sem Fila injetada não expõe consultar_fila_editorial', async () => {
  const rede = fetchEmFila([respostaTexto('Sem fila aqui.')])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-g.json`),
  })
  await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'oi' }],
  })
  const payload = JSON.parse(rede.chamadas.find((c) => c.url.includes('/chat/completions')).init.body)
  const ferramentas = payload.tools.map((tool) => tool.function.name)
  assert.ok(!ferramentas.includes('consultar_fila_editorial'))
})

test('escrita no escopo global mira o dia da proposta e confirma com escopo global', async () => {
  const rede = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('c1', 'criar_bloco', {
        tipo: 'tarefa',
        titulo: 'Revisar lote editorial',
        corpo: 'Objetivo: revisar as 12 peças',
        dia: DIA,
      })
    ),
    respostaTexto('Proposta pronta.'),
  ])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-h.json`),
  })
  const conversa = await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: `Crie uma tarefa no dia ${DIA}.` }],
  })
  assert.equal(conversa.confirmacoes.length, 1)
  assert.equal(conversa.confirmacoes[0].dia, DIA)

  // Escopo errado não confirma proposta global.
  await assert.rejects(
    () => servico.confirmarAcao({ escopo: 'dia', dia: DIA, acaoId: conversa.confirmacoes[0].id }),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'CONFIRMACAO_EXPIRADA'
  )
})

test('confirmarAcao no escopo global escreve no dia alvo da proposta', async () => {
  const rede = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('c1', 'criar_bloco', {
        tipo: 'nota',
        titulo: 'Nota vinda do global',
        corpo: 'Conteúdo de teste',
        dia: DIA,
      })
    ),
    respostaTexto('Proposta pronta.'),
  ])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-i.json`),
  })
  const conversa = await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: `Anote algo no dia ${DIA}.` }],
  })
  const recibo = await servico.confirmarAcao({ escopo: 'global', acaoId: conversa.confirmacoes[0].id })
  assert.equal(recibo.acao.tipo, 'criou')
  const bloco = lib.obterBloco(recibo.acao.blocoId, DIA)
  assert.equal(bloco.titulo, 'Nota vinda do global')
  // E não parou no Principal nem em hoje por acidente.
  assert.equal(lib.obterBloco(recibo.acao.blocoId), null)
})

test('escrita global sem dia alvo cai no dia de hoje', async () => {
  const rede = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('c1', 'criar_bloco', {
        tipo: 'nota',
        titulo: 'Nota sem dia explícito',
        corpo: 'Cai em hoje',
      })
    ),
    respostaTexto('Proposta pronta.'),
  ])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-j.json`),
  })
  const conversa = await servico.conversar({
    escopo: 'global',
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Anote algo.' }],
  })
  assert.equal(conversa.confirmacoes[0].dia, DIA_HOJE)
  const recibo = await servico.confirmarAcao({ escopo: 'global', acaoId: conversa.confirmacoes[0].id })
  assert.equal(lib.obterBloco(recibo.acao.blocoId, DIA_HOJE)?.titulo, 'Nota sem dia explícito')
})

// ---------- Inspeção de contexto ----------

test('inspecionarContexto global expõe seções, ferramentas e o prompt exato', async () => {
  semearDia(DIA, 'Frente inspecionada')
  const servico = criarServicoAgente({
    lib,
    fetchImpl: fetchEmFila([]).fetchImpl,
    integracoes: integracoesFalsas(),
    fontes: { fila: filaFalsa([itemFila()]) },
    configPath: path.join(TMP, `config-${Date.now()}-k.json`),
  })
  const inspecao = await servico.inspecionarContexto({ escopo: 'global' })
  assert.equal(inspecao.escopo, 'global')
  assert.equal(inspecao.hoje, DIA_HOJE)
  assert.ok(inspecao.prompt.includes('VISÃO GLOBAL'))
  assert.ok(inspecao.prompt.includes('Frente inspecionada'))
  assert.equal(inspecao.caracteresPrompt, inspecao.prompt.length)
  assert.ok(inspecao.ferramentas.includes('consultar_fila_editorial'))
  const ids = inspecao.secoes.map((secao) => secao.id)
  assert.deepEqual(ids, ['dias', 'principal', 'fila', 'conexoes'])
  assert.ok(inspecao.secoes.find((s) => s.id === 'fila').detalhe.includes('pendente: 1'))
  assert.ok(!inspecao.prompt.includes('NINE_ROUTER_API_KEY'))
})

test('inspecionarContexto do dia reflete os cards e o contexto durável', async () => {
  semearDia(DIA, 'Card inspecionado do dia')
  const servico = criarServicoAgente({
    lib,
    fetchImpl: fetchEmFila([]).fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-l.json`),
  })
  const inspecao = await servico.inspecionarContexto({ escopo: 'dia', dia: DIA, usarContextoDuravel: true })
  assert.equal(inspecao.escopo, 'dia')
  assert.equal(inspecao.dia, DIA)
  assert.ok(inspecao.prompt.includes('CONTEXTO CANÔNICO'))
  assert.ok(inspecao.prompt.includes('Card inspecionado do dia'))
  const ids = inspecao.secoes.map((secao) => secao.id)
  assert.deepEqual(ids, ['blocos', 'imagens', 'duravel'])
  assert.ok(inspecao.secoes.find((s) => s.id === 'blocos').quantidade >= 1)
  assert.ok(!inspecao.ferramentas.includes('consultar_fila_editorial'))
})

test('inspecionarContexto valida o dia no escopo dia', async () => {
  const servico = criarServicoAgente({
    lib,
    fetchImpl: fetchEmFila([]).fetchImpl,
    configPath: path.join(TMP, `config-${Date.now()}-m.json`),
  })
  await assert.rejects(
    () => servico.inspecionarContexto({ escopo: 'dia', dia: '08/09/2026' }),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'DIA_INVALIDO'
  )
})
