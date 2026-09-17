const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-agente-9router-test-'))
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'LucasKnowledge')

fs.mkdirSync(process.env.LUCAS_KNOWLEDGE_DIR, { recursive: true })

const lib = require('../electron/lib-md.cjs')
const {
  PERFIS_9ROUTER,
  ROTAS_9ROUTER,
  ErroAgente,
  criarServicoAgente,
} = require('../electron/lib-agente-9router.cjs')

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

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
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: chamadas,
        },
      },
    ],
  })
}

function chamadaFerramenta(id, nome, argumentos = {}) {
  return {
    id,
    type: 'function',
    function: { name: nome, arguments: JSON.stringify(argumentos) },
  }
}

function fetchEmFila(respostas, aoChamar) {
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    const chamada = { url: String(url), init }
    chamadas.push(chamada)
    if (aoChamar) await aoChamar(chamada, chamadas.length - 1)
    assert.ok(respostas.length > 0, `fetch inesperado para ${url}`)
    const proxima = respostas.shift()
    return typeof proxima === 'function' ? proxima(chamada) : proxima
  }
  return { fetchImpl, chamadas }
}

function entrada(dia, perfilId = 'grok-4-6', mensagem = 'Ajude com o meu dia.') {
  return {
    dia,
    perfilId,
    mensagens: [{ role: 'user', content: mensagem }],
  }
}

function entradaPrincipal(perfilId = 'grok-4-6', mensagem = 'Revise o Principal.') {
  return {
    escopo: 'principal',
    perfilId,
    mensagens: [{ role: 'user', content: mensagem }],
  }
}

function corpoEnviado(chamada) {
  return JSON.parse(chamada.init.body)
}

function chavesRecursivas(valor, resultado = []) {
  if (Array.isArray(valor)) {
    for (const item of valor) chavesRecursivas(item, resultado)
    return resultado
  }
  if (!valor || typeof valor !== 'object') return resultado
  for (const [chave, item] of Object.entries(valor)) {
    resultado.push(chave)
    chavesRecursivas(item, resultado)
  }
  return resultado
}

test('catálogo inclui as rotas base de escrita e revisão sem perder as rotas com esforço', () => {
  assert.equal(PERFIS_9ROUTER.length, 14)
  assert.equal(ROTAS_9ROUTER.length, 14)
  assert.equal(new Set(ROTAS_9ROUTER).size, 14)
  assert.deepEqual(new Set(PERFIS_9ROUTER.map((perfil) => perfil.rota)), new Set(ROTAS_9ROUTER))

  const porId = new Map(PERFIS_9ROUTER.map((perfil) => [perfil.id, perfil]))
  assert.equal(porId.get('grok-4-6').fallbackId, 'gpt-5-6-sol-high')
  assert.equal(porId.get('gpt-5-6-sol-high').rota, 'cx/gpt-5.6-sol(high)')
  assert.equal(porId.get('gpt-5-6-sol').rota, 'cx/gpt-5.6-sol')
  assert.equal(porId.get('gpt-5-6-luna').rota, 'cx/gpt-5.6-luna')
})

test('catálogo oferece Grok 4.6 pelo 9Router', () => {
  const perfil = PERFIS_9ROUTER.find((item) => item.id === 'grok-4-6')

  assert.equal(perfil.id, 'grok-4-6')
  assert.equal(perfil.rota, 'gcli/grok-4.6')
  assert.equal(perfil.fallbackId, 'gpt-5-6-sol-high')
})

test('catálogo oferece Cursor Grok 4.6 High pelo 9Router', () => {
  const perfil = PERFIS_9ROUTER.find((item) => item.id === 'cursor-grok-4-6-high')

  assert.equal(perfil.id, 'cursor-grok-4-6-high')
  assert.equal(perfil.rota, 'cu/cursor-grok-4.6-high')
  assert.equal(perfil.fallbackId, 'grok-4-6-high')
})

test('Grok 4.6 cai diretamente para GPT 5.6 Sol High quando falha', async () => {
  const rede = fetchEmFila([
    respostaJson({ error: { message: 'provider indisponível' } }, 502),
    respostaTexto('Continuei pelo fallback.'),
  ])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

  const resultado = await servico.completar({
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Faça o trabalho.' }],
  })

  assert.equal(rede.chamadas.length, 2)
  assert.equal(corpoEnviado(rede.chamadas[0]).model, 'gcli/grok-4.6')
  assert.equal(corpoEnviado(rede.chamadas[1]).model, 'cx/gpt-5.6-sol(high)')
  assert.equal(resultado.perfil.id, 'gpt-5-6-sol-high')
  assert.equal(resultado.fallback.de.id, 'grok-4-6')
  assert.equal(resultado.fallback.para.id, 'gpt-5-6-sol-high')
})

test('canal interno de análise usa a whitelist sem expor ferramentas', async () => {
  const rede = fetchEmFila([respostaTexto('Síntese pronta.')])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

  const resultado = await servico.completar({
    perfilId: 'gpt-5-6-sol-medium',
    mensagens: [
      { role: 'system', content: 'Resuma com precisão.' },
      { role: 'user', content: 'Corpus de teste.' },
    ],
    maxTokens: 900,
  })

  const payload = corpoEnviado(rede.chamadas[0])
  assert.equal(resultado.mensagem, 'Síntese pronta.')
  assert.equal(resultado.perfil.id, 'gpt-5-6-sol-medium')
  assert.equal(payload.model, 'cx/gpt-5.6-sol(medium)')
  assert.equal(payload.max_tokens, 900)
  assert.equal('tools' in payload, false)
})

test('análise longa reserva trinta segundos dos cinco minutos para fallback', async () => {
  const rede = fetchEmFila([respostaTexto('Síntese pronta.')])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })
  const setTimeoutOriginal = global.setTimeout
  let prazoObservado = null
  global.setTimeout = (fn, prazo, ...args) => {
    prazoObservado = prazo
    return setTimeoutOriginal(fn, 10_000, ...args)
  }
  try {
    await servico.completar({
      perfilId: 'grok-4-6',
      mensagens: [{ role: 'user', content: 'Analise este dia.' }],
      timeoutMs: 300_000,
    })
  } finally {
    global.setTimeout = setTimeoutOriginal
  }

  assert.equal(prazoObservado, 270_000)
})

test('perfil arbitrário é rejeitado antes de qualquer chamada de rede', async () => {
  let chamadas = 0
  const servico = criarServicoAgente({
    lib,
    fetchImpl: async () => {
      chamadas += 1
      throw new Error('não deveria chamar fetch')
    },
  })

  await assert.rejects(
    servico.conversar(entrada('2026-08-01', 'modelo/fora-da-whitelist')),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'PERFIL_NAO_PERMITIDO'
  )
  assert.equal(chamadas, 0)
})

test('cada perfil envia somente sua rota e nenhum campo de esforço ou tool_choice', async () => {
  for (const perfil of PERFIS_9ROUTER) {
    const rede = fetchEmFila([respostaTexto('OK')])
    const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

    await servico.conversar(entrada('2026-08-02', perfil.id))

    assert.equal(rede.chamadas.length, 1)
    const payload = corpoEnviado(rede.chamadas[0])
    assert.equal(payload.model, perfil.rota)
    const proibidas = chavesRecursivas(payload).filter((chave) =>
      /^(tool_choice|reasoning.*|thinking.*|effort.*)$/i.test(chave)
    )
    assert.deepEqual(proibidas, [], `${perfil.nome} enviou campos proibidos`)
  }
})

test('contexto e consultar_dia nunca misturam blocos de outro dia', async () => {
  const dia = '2026-08-03'
  const outroDia = '2026-08-04'
  lib.criarBloco({ id: 'b-contexto-hoje', titulo: 'Somente hoje', corpo: 'Ação atual' }, dia)
  lib.criarBloco({ id: 'b-contexto-outro', titulo: 'Segredo de outro dia', corpo: 'Não vazar' }, outroDia)

  const rede = fetchEmFila(
    [
      respostaFerramentas(chamadaFerramenta('call-consultar', 'consultar_dia')),
      respostaTexto('Contexto relido.'),
    ],
    (_chamada, indice) => {
      if (indice !== 0) return
      lib.criarBloco({ id: 'b-contexto-novo', titulo: 'Criado durante a conversa' }, dia)
      lib.criarBloco({ id: 'b-contexto-outro-novo', titulo: 'Outro dia novo' }, outroDia)
    }
  )
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

  const resultado = await servico.conversar(entrada(dia, 'grok-4-6', 'Consulte novamente o dia.'))

  assert.equal(resultado.contexto.dia, dia)
  const primeira = JSON.stringify(corpoEnviado(rede.chamadas[0]))
  assert.match(primeira, /b-contexto-hoje/)
  assert.doesNotMatch(primeira, /b-contexto-outro/)

  const segunda = corpoEnviado(rede.chamadas[1])
  const retornoFerramenta = segunda.messages.find(
    (mensagem) => mensagem.role === 'tool' && mensagem.tool_call_id === 'call-consultar'
  )
  assert.ok(retornoFerramenta)
  const consulta = JSON.parse(retornoFerramenta.content)
  assert.equal(consulta.dia, dia)
  assert.ok(consulta.blocos.some((bloco) => bloco.id === 'b-contexto-novo'))
  assert.ok(consulta.blocos.every((bloco) => !bloco.id.startsWith('b-contexto-outro')))
})

test('agente do Principal lê e altera somente blocos do Principal', async () => {
  const dia = '2026-08-13'
  lib.criarBloco({ id: 'b-principal-contexto', titulo: 'Case durável', corpo: 'Evidência do portfólio' })
  lib.criarBloco({ id: 'b-dia-isolado', titulo: 'Tarefa privada do dia', corpo: 'Não vazar' }, dia)

  const rede = fetchEmFila([
    respostaFerramentas(chamadaFerramenta('call-principal', 'consultar_principal')),
    respostaFerramentas(
      chamadaFerramenta('call-criar-principal', 'criar_bloco', {
        tipo: 'projeto',
        titulo: 'Novo case durável',
        corpo: 'Resultado: case preservado no portfólio.',
      })
    ),
    respostaTexto('Proposta preparada.'),
  ])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })
  const resultado = await servico.conversar(
    entradaPrincipal('grok-4-6', 'Releia o Principal e crie um novo case durável.')
  )

  const primeira = corpoEnviado(rede.chamadas[0])
  assert.equal(primeira.tools[0].function.name, 'consultar_principal')
  assert.match(JSON.stringify(primeira), /b-principal-contexto/)
  assert.doesNotMatch(JSON.stringify(primeira), /b-dia-isolado/)
  assert.equal(resultado.contexto.escopo, 'principal')
  assert.equal(resultado.contexto.dia, null)
  assert.equal(resultado.contexto.contextoDuravelIncluido, true)
  assert.equal(lib.listarBlocos().some((bloco) => bloco.titulo === 'Novo case durável'), false)

  const acaoId = resultado.confirmacoes[0].id
  await assert.rejects(
    servico.confirmarAcao({ escopo: 'dia', dia, acaoId }),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'CONFIRMACAO_EXPIRADA'
  )

  const redeConfirmacao = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('call-criar-principal-2', 'criar_bloco', {
        tipo: 'projeto',
        titulo: 'Case confirmado no Principal',
        corpo: 'Resultado: evidência durável.',
      })
    ),
    respostaTexto('Proposta preparada.'),
  ])
  const servicoConfirmacao = criarServicoAgente({ lib, fetchImpl: redeConfirmacao.fetchImpl })
  const proposta = await servicoConfirmacao.conversar(entradaPrincipal())
  const confirmado = await servicoConfirmacao.confirmarAcao({
    escopo: 'principal',
    acaoId: proposta.confirmacoes[0].id,
  })
  assert.equal(confirmado.acao.tipo, 'criou')
  assert.ok(lib.listarBlocos().some((bloco) => bloco.titulo === 'Case confirmado no Principal'))
  assert.equal(lib.listarBlocos(dia).some((bloco) => bloco.titulo === 'Case confirmado no Principal'), false)
})

test('contexto durável só é lido com opt-in explícito', async () => {
  let leiturasDuraveis = 0
  const libControlada = {
    ...lib,
    contextoPrincipal() {
      leiturasDuraveis += 1
      return { portfolio: [], conhecimento: { disponivel: false, painelEssencial: [] } }
    },
  }

  const redePadrao = fetchEmFila([respostaTexto('Somente o dia.')])
  await criarServicoAgente({ lib: libControlada, fetchImpl: redePadrao.fetchImpl }).conversar(
    entrada('2026-08-10')
  )
  assert.equal(leiturasDuraveis, 0)

  const redeOptIn = fetchEmFila([respostaTexto('Contexto autorizado.')])
  const resultadoOptIn = await criarServicoAgente({ lib: libControlada, fetchImpl: redeOptIn.fetchImpl }).conversar({
    ...entrada('2026-08-10'),
    usarContextoDuravel: true,
  })
  assert.equal(leiturasDuraveis, 1)
  assert.equal(resultadoOptIn.contexto.contextoDuravelIncluido, true)

  for (let indice = 0; indice < 5; indice += 1) {
    lib.criarBloco(
      { id: `b-contexto-grande-${indice}`, titulo: `Contexto grande ${indice}`, corpo: 'x'.repeat(30_000) },
      '2026-08-11'
    )
  }
  const redeComRecorte = fetchEmFila([respostaTexto('Contexto diário preservado.')])
  const resultadoComRecorte = await criarServicoAgente({
    lib: libControlada,
    fetchImpl: redeComRecorte.fetchImpl,
  }).conversar({
    ...entrada('2026-08-11'),
    usarContextoDuravel: true,
  })
  assert.equal(resultadoComRecorte.contexto.contextoDuravelIncluido, false)
})

test('contexto durável do dia usa o pacote seletivo do LucasOL', async () => {
  const fluxo = {
    prepararDia({ dia }) {
      return {
        schemaVersion: 1,
        packId: 'pack-seletivo',
        dia,
        projeto: { id: 'sfr', name: 'SFR', packetSummary: 'Confiabilidade offline.' },
        carryovers: [],
        conhecimento: [{ titulo: 'Valide comportamento', caminho: 'Validar.md', resumo: 'Teste o anexo real.' }],
        skills: [{ id: 'diagnosing-bugs', descricao: 'Diagnosticar antes de corrigir.' }],
        sinais: [{ id: 'codex-1', source: 'codex', title: 'Falha no PDF', evidence: 'Anexo ilegível.' }],
        riscos: [],
        propostas: [],
        fontes: [],
      }
    },
  }
  const rede = fetchEmFila([respostaTexto('Contexto seletivo recebido.')])
  const servico = criarServicoAgente({ lib, fluxo, fetchImpl: rede.fetchImpl })

  await servico.conversar({
    ...entrada('2026-08-11'),
    usarContextoDuravel: true,
  })

  const prompt = corpoEnviado(rede.chamadas[0]).messages[0].content
  assert.match(prompt, /pack-seletivo/)
  assert.match(prompt, /diagnosing-bugs/)
  assert.match(prompt, /Falha no PDF/)
  assert.match(prompt, /Valide comportamento/)
  assert.match(prompt, /Use frases curtas e palavras comuns/)
  assert.match(prompt, /Não copie nem traduza jargão de agentes ao pé da letra/)
  assert.match(prompt, /no máximo cinco bullets/)
  assert.doesNotMatch(prompt, /painelEssencial/)
})

test('última rodada de ferramenta recebe uma síntese final sem tools', async () => {
  const rede = fetchEmFila([
    respostaFerramentas(chamadaFerramenta('call-erro-1', 'ferramenta_inexistente')),
    respostaFerramentas(chamadaFerramenta('call-erro-2', 'ferramenta_inexistente')),
    respostaFerramentas(chamadaFerramenta('call-erro-3', 'ferramenta_inexistente')),
    respostaFerramentas(chamadaFerramenta('call-consulta-final', 'consultar_dia')),
    respostaTexto('Síntese final depois da leitura.'),
  ])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

  const resultado = await servico.conversar(
    entrada('2026-08-12', 'grok-4-6', 'Insista em reler antes de responder.')
  )

  assert.equal(resultado.mensagem, 'Síntese final depois da leitura.')
  assert.equal(rede.chamadas.length, 5)
  assert.equal('tools' in corpoEnviado(rede.chamadas[4]), false)
})

test('criar_bloco e mudar_status só escrevem após confirmação e preservam frentes independentes', async () => {
  const dia = '2026-08-05'
  lib.criarBloco(
    { id: 'b-foco-antigo', tipo: 'tarefa', titulo: 'Foco antigo', status: 'fazendo' },
    dia
  )
  lib.criarBloco(
    { id: 'b-foco-terceiro', tipo: 'projeto', titulo: 'Terceiro foco', status: 'pendente' },
    dia
  )

  const redeCriacao = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('call-criar', 'criar_bloco', {
        tipo: 'tarefa',
        titulo: 'Novo foco',
        corpo: 'Objetivo: avançar\n- Executar a próxima ação\nPRONTO = resultado salvo',
        status: 'fazendo',
      })
    ),
    respostaTexto('Novo foco criado.'),
  ])
  const servicoCriacao = criarServicoAgente({ lib, fetchImpl: redeCriacao.fetchImpl })
  const criado = await servicoCriacao.conversar(entrada(dia, 'grok-4-6', 'Crie e inicie o novo foco.'))
  const retornoCriacao = corpoEnviado(redeCriacao.chamadas[1]).messages.find(
    (mensagem) => mensagem.tool_call_id === 'call-criar'
  )
  assert.deepEqual(JSON.parse(retornoCriacao.content).erro, undefined)
  assert.equal(lib.listarBlocos(dia).some((bloco) => bloco.titulo === 'Novo foco'), false)
  assert.equal(criado.acoes.length, 0)
  assert.equal(criado.confirmacoes[0].tipo, 'criar')
  assert.equal(criado.confirmacoes[0].preview.antes, null)
  assert.equal(criado.confirmacoes[0].preview.depois.titulo, 'Novo foco')
  assert.match(criado.confirmacoes[0].preview.depois.corpo, /Objetivo:/)
  assert.match(criado.mensagem, /Nenhuma mudança foi aplicada/)
  assert.equal(JSON.parse(retornoCriacao.content).acao.tipo, 'criar')
  assert.equal('id' in JSON.parse(retornoCriacao.content).acao, false)
  assert.equal(retornoCriacao.content.includes(criado.confirmacoes[0].id), false)

  const criacaoConfirmada = await servicoCriacao.confirmarAcao({
    dia,
    acaoId: criado.confirmacoes[0].id,
  })
  assert.equal(criacaoConfirmada.acao.tipo, 'criou')

  const novoFoco = lib.listarBlocos(dia).find((bloco) => bloco.titulo === 'Novo foco')
  assert.ok(novoFoco)
  assert.equal(novoFoco.status, 'fazendo')
  assert.equal(lib.obterBloco('b-foco-antigo', dia).status, 'fazendo')

  const redeMudanca = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('call-status', 'mudar_status', {
        id: 'b-foco-terceiro',
        status: 'fazendo',
      })
    ),
    respostaTexto('Foco alterado.'),
  ])
  const servicoMudanca = criarServicoAgente({ lib, fetchImpl: redeMudanca.fetchImpl })
  const propostaMudanca = await servicoMudanca.conversar(
    entrada(dia, 'grok-4-6', 'Comece o terceiro foco.')
  )
  assert.equal(lib.obterBloco('b-foco-terceiro', dia).status, 'pendente')
  await servicoMudanca.confirmarAcao({ dia, acaoId: propostaMudanca.confirmacoes[0].id })

  const focos = lib
    .listarBlocos(dia)
    .filter((bloco) => bloco.status === 'fazendo' && ['tarefa', 'projeto'].includes(bloco.tipo))
  assert.deepEqual(
    new Set(focos.map((bloco) => bloco.id)),
    new Set(['b-foco-antigo', 'b-foco-terceiro', novoFoco.id])
  )
  assert.equal(lib.obterBloco(novoFoco.id, dia).status, 'fazendo')
})

test('alteração concorrente gera CONFLITO e preserva a escrita externa', async () => {
  const dia = '2026-08-06'
  lib.criarBloco({ id: 'b-concorrente', titulo: 'Título inicial', corpo: 'Original' }, dia)

  const rede = fetchEmFila(
    [
      respostaFerramentas(
        chamadaFerramenta('call-atualizar', 'atualizar_bloco', {
          id: 'b-concorrente',
          titulo: 'Título do agente',
        })
      ),
      respostaTexto('A alteração concorrente foi preservada.'),
    ],
    (_chamada, indice) => {
      if (indice === 0) {
        lib.atualizarBloco('b-concorrente', { titulo: 'Título externo' }, dia)
      }
    }
  )
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

  const resultado = await servico.conversar(entrada(dia, 'grok-4-6', 'Atualize o título.'))

  assert.equal(lib.obterBloco('b-concorrente', dia).titulo, 'Título externo')
  assert.deepEqual(resultado.acoes, [])
  const segunda = corpoEnviado(rede.chamadas[1])
  const retorno = segunda.messages.find((mensagem) => mensagem.tool_call_id === 'call-atualizar')
  assert.equal(JSON.parse(retorno.content).erro.codigo, 'CONFLITO')
})

test('falha depois de uma tool call não deixa mutação parcial no dia', async () => {
  const dia = '2026-08-09'
  const rede = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('call-criar-sem-commit', 'criar_bloco', {
        tipo: 'tarefa',
        titulo: 'Não pode aparecer',
        corpo: 'Objetivo: provar atomicidade',
      })
    ),
    () => {
      throw new Error('falha simulada depois da proposta')
    },
  ])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl })

  await assert.rejects(
    servico.conversar(entrada(dia, 'grok-4-6', 'Crie a tarefa.')),
    (erro) => erro.codigo === '9ROUTER_INDISPONIVEL'
  )
  assert.equal(
    lib.listarBlocos(dia).some((bloco) => bloco.titulo === 'Não pode aparecer'),
    false
  )
})

test('arquivamento exige proposta e repetir a confirmação devolve o mesmo recibo', async () => {
  const dia = '2026-08-07'
  lib.criarBloco({ id: 'b-arquivar', tipo: 'tarefa', titulo: 'Card arquivável' }, dia)
  const rede = fetchEmFila([
    respostaFerramentas(
      chamadaFerramenta('call-arquivar', 'propor_arquivamento', {
        id: 'b-arquivar',
        motivo: 'A pessoa solicitou remover este card.',
      })
    ),
    respostaTexto('Confirme o arquivamento.'),
  ])
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    agora: () => new Date('2026-08-07T12:00:00-03:00').getTime(),
  })

  const proposta = await servico.conversar(entrada(dia, 'grok-4-6', 'Arquive o card b-arquivar.'))
  assert.equal(proposta.confirmacoes.length, 1)
  assert.equal(proposta.confirmacoes[0].tipo, 'arquivar')
  assert.ok(lib.obterBloco('b-arquivar', dia), 'a proposta não pode arquivar imediatamente')

  const acaoId = proposta.confirmacoes[0].id
  const confirmado = await servico.confirmarAcao({ dia, acaoId })
  assert.equal(confirmado.acao.tipo, 'arquivou')
  assert.equal(lib.obterBloco('b-arquivar', dia), null)
  const arquivados = fs.readdirSync(path.join(process.env.DAILYWORK_DATA_DIR, 'dias', dia, '_arquivo'))
  assert.ok(arquivados.some((nome) => nome.endsWith('-b-arquivar.md')))

  const repetido = await servico.confirmarAcao({ dia, acaoId })
  assert.deepEqual(repetido, confirmado)
  assert.equal(lib.obterBloco('b-arquivar', dia), null)
})

test('chave aparece somente em Authorization e falhas públicas não vazam o segredo', async () => {
  const dia = '2026-08-08'
  const segredo = 'segredo-super-sensivel-do-teste'
  const rede = fetchEmFila([respostaTexto('Resposta segura.')])
  const servico = criarServicoAgente({ lib, fetchImpl: rede.fetchImpl, apiKey: segredo })

  const resultado = await servico.conversar(entrada(dia))
  assert.equal(rede.chamadas[0].init.headers.Authorization, `Bearer ${segredo}`)
  assert.doesNotMatch(rede.chamadas[0].url, new RegExp(segredo))
  assert.doesNotMatch(String(rede.chamadas[0].init.body), new RegExp(segredo))
  assert.doesNotMatch(JSON.stringify(resultado), new RegExp(segredo))

  let headerObservado = ''
  const servicoComFalha = criarServicoAgente({
    lib,
    apiKey: segredo,
    fetchImpl: async (_url, init) => {
      headerObservado = init.headers.Authorization
      throw new Error(`falha interna contendo ${segredo}`)
    },
  })
  await assert.rejects(servicoComFalha.conversar(entrada(dia)), (erro) => {
    assert.equal(erro.codigo, '9ROUTER_INDISPONIVEL')
    assert.doesNotMatch(erro.message, new RegExp(segredo))
    return true
  })
  assert.equal(headerObservado, `Bearer ${segredo}`)
})

test('BLOCKED_AUTH no 9Router cai no Grok CLI local em vez de esvaziar o lote', async () => {
  const rede = fetchEmFila([
    respostaJson({ error: { message: 'Missing API key' } }, 401),
    respostaJson({ error: { message: 'Missing API key' } }, 401),
  ])
  let grokChamado = 0
  const servico = criarServicoAgente({
    lib,
    fetchImpl: rede.fetchImpl,
    grokCli: {
      completarChat: async () => {
        grokChamado += 1
        return { choices: [{ message: { content: 'ok pelo grok local' } }] }
      },
      sondar: async () => ({ ok: true, modelos: ['grok-4.6'] }),
    },
  })
  const resultado = await servico.completar({
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Faça o trabalho.' }],
  })
  assert.equal(grokChamado, 1)
  assert.equal(resultado.mensagem, 'ok pelo grok local')
  assert.equal(resultado.fallback.motivo, 'BLOCKED_AUTH')
  assert.equal(resultado.perfil.id, 'grok-4-6')
})

test('rascunhar o dia devolve JSON válido e recusa resposta ilegível', async () => {
  const fluxo = {
    prepararDia({ dia }) {
      return {
        schemaVersion: 1,
        packId: 'pack-rascunho',
        dia,
        projeto: { id: 'nexsales', name: 'NexSales', packetSummary: 'Atendimento.' },
        carryovers: [],
        conhecimento: [],
        skills: [],
        sinais: [],
        riscos: [],
        propostas: [{
          id: 'sumario-1',
          kind: 'sumario_proximo_passo',
          reason: 'Próximo passo no Sumário de 2026-08-10.',
          bloco: { titulo: 'Clinick · conversas reais', corpo: 'Acompanhar atendimentos.', projeto: 'nexsales' },
        }],
        analiseRecente: { dia: '2026-08-10', summaryMarkdown: '## Próximo passo\n- **Clinick · conversas reais:** Acompanhar.' },
        fontes: [],
      }
    },
  }
  const rascunho = {
    direcao: 'Fechar o loop da Clinick no painel.',
    frentes: [{
      titulo: 'Clinick · conversas reais',
      objetivo: 'Acompanhar os primeiros atendimentos.',
      acoes: ['Abrir o painel', 'Ver se a equipe usa'],
      pronto: 'Pelo menos um atendimento observado.',
      projeto: 'nexsales',
      baseadoEm: 'sumario-1',
    }],
  }
  const redeOk = fetchEmFila([respostaTexto(`\`\`\`json\n${JSON.stringify(rascunho)}\n\`\`\``)])
  const servico = criarServicoAgente({ lib, fluxo, fetchImpl: redeOk.fetchImpl })
  const resultado = await servico.rascunharDia({ dia: '2026-08-11', perfilId: 'grok-4-6' })
  assert.equal(resultado.packId, 'pack-rascunho')
  assert.equal(resultado.direcao, rascunho.direcao)
  assert.equal(resultado.frentes[0].titulo, 'Clinick · conversas reais')
  assert.equal(resultado.frentes[0].projeto, 'nexsales')
  assert.match(corpoEnviado(redeOk.chamadas[0]).messages[1].content, /pack-rascunho/)

  const redeRuim = fetchEmFila([respostaTexto('Não consegui pensar em JSON hoje.')])
  await assert.rejects(
    () => criarServicoAgente({ lib, fluxo, fetchImpl: redeRuim.fetchImpl }).rascunharDia({ dia: '2026-08-11' }),
    (erro) => {
      assert.equal(erro.codigo, 'RASCUNHO_INVALIDO')
      return true
    }
  )
})


test('resolverChaveNoveRouter prefere env e cai na Default Key local sem vazar o valor', () => {
  const { resolverChaveNoveRouter } = require('../electron/lib-chave-9router.cjs')
  const { DatabaseSync } = require('node:sqlite')
  const dbPath = path.join(TMP, 'ninerouter.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec('create table apiKeys (id integer, key text, name text, isActive integer)')
  db.prepare('insert into apiKeys values (1, ?, ?, 1)').run('sk-local-teste-nao-usar', 'Default Key')
  db.close()
  assert.equal(resolverChaveNoveRouter({ env: { NINE_ROUTER_API_KEY: 'sk-env' }, dbPath }), 'sk-env')
  assert.equal(resolverChaveNoveRouter({ env: {}, dbPath }), 'sk-local-teste-nao-usar')
  assert.equal(resolverChaveNoveRouter({ env: {}, dbPath: path.join(TMP, 'ausente.sqlite') }), '')
})
