const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const {
  PERFIL_ANALISE_PADRAO,
  criarServicoAnaliseSumario,
} = require('../electron/lib-analise-sumario.cjs')
const { criarServicoSumario } = require('../electron/lib-sumario-diario.cjs')
const { coletarClaude } = require('../electron/sumario/fontes/claude.cjs')
const { coletarCodex } = require('../electron/sumario/fontes/codex.cjs')
const { coletarCursor } = require('../electron/sumario/fontes/cursor.cjs')
const { coletarGrokBot } = require('../electron/sumario/fontes/grok-bot.cjs')
const { coletarGrokCli } = require('../electron/sumario/fontes/grok-cli.cjs')
const { coletarPi } = require('../electron/sumario/fontes/pi.cjs')
const {
  cobertura,
  criarMensagem,
  janelaDoDia,
  mesclarConversas,
  redigirSegredos,
} = require('../electron/sumario/shared.cjs')

function temporario(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-sumario-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  return raiz
}

function fonteCompleta(ctx) {
  const duplicada = criarMensagem({
    source: 'fixture',
    conversationId: 'conversa-1',
    recordId: 'mensagem-1',
    timestamp: ctx.janela.inicioMs + 1_000,
    role: 'user',
    text: 'Planejar o módulo do dia com api_key=abcdefghijklmnopqrstuv',
    content: {
      apiKey: 'nao-pode-vazar',
      accessToken: 'outro-segredo-estruturado',
      detalhe: 'preservado',
    },
    provenance: { path: 'fixture.jsonl', line: 1 },
  })
  const resposta = criarMensagem({
    source: 'fixture',
    conversationId: 'conversa-1',
    recordId: 'mensagem-2',
    timestamp: ctx.janela.inicioMs + 2_000,
    role: 'assistant',
    text: 'Plano concluído',
    provenance: { path: 'fixture.jsonl', line: 2 },
  })
  const conversations = [{
    id: 'fixture:conversa-1',
    source: 'fixture',
    app: 'Fixture AI',
    title: 'Conversa de teste',
    cwd: 'C:\\Projeto',
    messages: [duplicada, duplicada, resposta],
  }]
  return {
    conversations,
    coverage: cobertura({
      id: 'fixture',
      label: 'Fixture AI',
      discovered: true,
      conversations,
      files: 1,
      records: 3,
    }),
  }
}

function duasQuestoes(primeira = {}) {
  const base = {
    prompt: 'No DailyWork, qual prática melhora a qualidade do trabalho?',
    options: [
      { id: 'a', text: 'Confiar em uma intenção' },
      { id: 'b', text: 'Verificar a entrega' },
      { id: 'c', text: 'Ignorar os riscos' },
    ],
    correctOptionId: 'b',
    explanation: 'Uma entrega verificável sustenta a conclusão.',
  }
  return Array.from({ length: 2 }, (_, indice) => ({
    id: `q${indice + 1}`,
    ...base,
    prompt: `${base.prompt} (${indice + 1})`,
    ...(indice === 0 ? primeira : {}),
  }))
}

function resumoValido(abertura = 'Trabalho consolidado.') {
  return `${abertura}\n\n## Avanços\n- **DailyWork · entrega:** A entrega principal foi verificada.\n\n## O que pede atenção\n- **DailyWork · pendência:** Uma pendência continua aberta.\n\n## Próximo passo\n- **DailyWork · publicação:** Verifique a pendência antes de publicar.`
}

function revisoesValidas(ideia = 'Revise a diferença entre plano e evidência.') {
  return [
    {
      context: 'DailyWork',
      subject: 'Verificação de entregas',
      markdown: `## Ideia principal\n\n${ideia}\n\n## O que lembrar\n- Uma prova clara sustenta a conclusão.\n\n## Como aplicar\n\nConfira o resultado antes de encerrar.`,
    },
    {
      context: 'SFR',
      subject: 'Protocolo clínico',
      markdown: '## Ideia principal\n\nUma imagem de conceito não substitui o mapa clínico.\n\n## O que lembrar\n- O protocolo precisa de nome e versão.\n\n## Como aplicar\n\nConfirme a fonte antes de usar a fórmula.',
    },
  ]
}

test('coleta gera corpus integral e índice leve, com deduplicação e segredo podado', async (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir,
    homeDir: raiz,
    appDataDir: raiz,
    localAppDataDir: raiz,
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })

  const resumo = await servico.coletar('2026-08-13')
  const arquivo = path.join(outputDir, '2026-08-13', 'conversas.json')
  const indice = path.join(outputDir, '2026-08-13', 'resumo.json')
  const arquivoInputs = path.join(outputDir, '2026-08-13', 'inputs.json')
  const corpus = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  const inputs = servico.obterInputs('2026-08-13')

  assert.equal(resumo.completeness, 'complete')
  assert.equal(resumo.stats.conversations, 1)
  assert.equal(resumo.stats.messages, 2)
  assert.equal(resumo.stats.userMessages, 1)
  assert.equal('prompts' in resumo.stats, false)
  assert.equal(resumo.stats.agentMessages, 1)
  assert.equal(corpus.conversations[0].messages[0].content.apiKey, '[REMOVIDO POR SEGURANÇA]')
  assert.equal(corpus.conversations[0].messages[0].content.accessToken, '[REMOVIDO POR SEGURANÇA]')
  assert.equal(corpus.conversations[0].messages[0].content.detalhe, 'preservado')
  assert.equal(
    corpus.conversations[0].messages[0].text,
    'Planejar o módulo do dia com api_key=[REMOVIDO POR SEGURANÇA]'
  )
  assert.equal(corpus.stats.bytes, fs.statSync(arquivo).size)
  assert.ok(fs.statSync(indice).size < fs.statSync(arquivo).size)
  assert.equal(inputs.stats.inputs, resumo.stats.userMessages)
  assert.equal(inputs.inputs.length, 1)
  assert.equal(inputs.schemaVersion, 3)
  assert.deepEqual(inputs.sources[0], {
    id: 'fixture',
    label: 'Fixture AI',
    status: 'complete',
    conversations: 1,
    messages: 2,
    errorCount: 0,
    inputCount: 1,
  })
  assert.equal(inputs.inputs[0].app, 'Fixture AI')
  assert.equal(inputs.inputs[0].conversationTitle, 'Conversa de teste')
  assert.equal(inputs.inputs[0].sequence, 1)
  assert.equal(inputs.inputs[0].text, 'Planejar o módulo do dia com api_key=[REMOVIDO POR SEGURANÇA]')
  assert.deepEqual(inputs.inputs[0].content, {
    apiKey: '[REMOVIDO POR SEGURANÇA]',
    accessToken: '[REMOVIDO POR SEGURANÇA]',
    detalhe: 'preservado',
  })
  assert.ok(fs.statSync(arquivoInputs).size < fs.statSync(arquivo).size)

  fs.writeFileSync(arquivo, '{corpus deliberadamente indisponível')
  assert.deepEqual(servico.obter('2026-08-13'), resumo)
  assert.deepEqual(servico.obterInputs('2026-08-13'), inputs)
})

test('inputs preserva toda entrada humana em ordem e exclui atividade automática', async (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const textoIntegral = `Decisão detalhada\n${'contexto '.repeat(4_000)}`
  const fonte = (ctx) => {
    const messages = [
      criarMensagem({
        source: 'fixture', conversationId: 'conversa-1', recordId: 'resposta',
        timestamp: ctx.janela.inicioMs + 500, role: 'assistant', text: 'Resposta da IA',
      }),
      criarMensagem({
        source: 'fixture', conversationId: 'conversa-1', recordId: 'entrada-longa',
        timestamp: ctx.janela.inicioMs + 1_000, role: 'user', text: textoIntegral,
      }),
      criarMensagem({
        source: 'fixture', conversationId: 'conversa-1', recordId: 'contexto',
        timestamp: ctx.janela.inicioMs + 1_500, role: 'system', kind: 'context', text: 'Injetado automaticamente',
      }),
      criarMensagem({
        source: 'fixture', conversationId: 'conversa-1', recordId: 'anexo',
        timestamp: ctx.janela.inicioMs + 1_000, role: 'user', text: '', content: { type: 'image' },
      }),
      criarMensagem({
        source: 'fixture', conversationId: 'conversa-1', recordId: 'participante',
        timestamp: ctx.janela.inicioMs + 3_000, role: 'participant', text: 'Outra pessoa',
      }),
    ]
    const conversations = [{
      id: 'fixture:conversa-1',
      source: 'fixture',
      app: 'Fixture AI',
      title: 'Autoria humana',
      cwd: 'C:\\Projeto',
      messages,
    }]
    return {
      conversations,
      coverage: cobertura({ id: 'fixture', label: 'Fixture AI', discovered: true, conversations }),
    }
  }
  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir,
    fontes: [fonte],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })

  await servico.coletar('2026-08-13')
  const resultado = servico.obterInputs('2026-08-13')

  assert.equal(resultado.stats.inputs, 2)
  assert.equal(resultado.stats.characters, textoIntegral.length)
  assert.equal(resultado.sources[0].inputCount, 2)
  assert.deepEqual(resultado.inputs.map((item) => item.id), ['fixture:anexo', 'fixture:entrada-longa'])
  assert.deepEqual(resultado.inputs.map((item) => item.sequence), [1, 2])
  assert.deepEqual(resultado.inputs[0].content, { type: 'image' })
  assert.equal(resultado.inputs[1].text, textoIntegral)
})

test('inputs não duplica como fala humana uma missão entregue entre agentes pelo Maestri', async (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const missao = 'Revise o gate de efeitos, rode os testes e reporte a evidência ao terminar.'
  const missaoEmArquivo = `Mapeie os campos de identificação sem criar um sistema paralelo.\n${'Detalhe verificável. '.repeat(320)}`
  const missaoEmLote = 'Preencha o corpus delegado; registre como DÚVIDA: quando necessário.'
  const missaoEmVariavel = 'Reaudite o commit integrado e devolva o veredito ao maestro.'
  const missaoEmEspera = 'Monitore a validação até terminar, preserve todos os artefatos e envie o resultado diretamente ao maestro responsável.'

  const fonteClaude = (ctx) => {
    const conversations = mesclarConversas([{
      id: 'claude:emissor',
      source: 'claude',
      app: 'Claude Code',
      title: 'Coordenação',
      cwd: 'C:\\Projeto',
      messages: [
        criarMensagem({
          source: 'claude', conversationId: 'emissor', recordId: 'pedido-original',
          timestamp: ctx.janela.inicioMs + 1_000, role: 'user', text: missao,
        }),
        criarMensagem({
          source: 'claude', conversationId: 'emissor', recordId: 'envio-maestri',
          timestamp: ctx.janela.inicioMs + 2_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'tool_use',
            name: 'Bash',
            input: { command: `"$MAESTRI_CLI" ask "Grok" "${missao}"` },
          },
        }),
        criarMensagem({
          source: 'claude', conversationId: 'emissor', recordId: 'arquivo-da-missao',
          timestamp: ctx.janela.inicioMs + 3_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'tool_use',
            name: 'Write',
            input: { file_path: 'C:\\Temp\\missao.txt', content: missaoEmArquivo },
          },
        }),
        criarMensagem({
          source: 'claude', conversationId: 'emissor', recordId: 'envio-arquivo-maestri',
          timestamp: ctx.janela.inicioMs + 4_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'S="/c/Temp" && maestri ask "Grok" "$(cat $S/missao.txt)"' },
          },
        }),
        criarMensagem({
          source: 'claude', conversationId: 'emissor', recordId: 'arquivo-do-lote',
          timestamp: ctx.janela.inicioMs + 5_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'tool_use',
            name: 'Write',
            input: {
              file_path: 'C:\\Temp\\ordens.json',
              content: JSON.stringify({ Grok: missaoEmLote }),
            },
          },
        }),
        criarMensagem({
          source: 'claude', conversationId: 'emissor', recordId: 'envio-lote-maestri',
          timestamp: ctx.janela.inicioMs + 6_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'S=/c/Temp; maestri ask --batch "$(cat $S/ordens.json)"' },
          },
        }),
        criarMensagem({
          source: 'codex', conversationId: 'emissor', recordId: 'envio-variavel-maestri',
          timestamp: ctx.janela.inicioMs + 7_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'CommandExecution',
            command: [
              'pwsh.exe',
              '-Command',
              `$payload = '${JSON.stringify({ 'Claude Code #3': missaoEmVariavel })}'; & $env:MAESTRI_CLI ask --batch $payload`,
            ],
          },
        }),
        criarMensagem({
          source: 'codex', conversationId: 'emissor', recordId: 'envio-espera-maestri',
          timestamp: ctx.janela.inicioMs + 8_000, role: 'tool', kind: 'tool_call',
          content: {
            type: 'CommandExecution',
            command: [
              'pwsh.exe',
              '-Command',
              `$prompt = @'\n${missaoEmEspera}\n'@\n& $env:MAESTRI_CLI ask "Claude Code #2" $prompt`,
            ],
          },
        }),
      ],
    }])
    return {
      conversations,
      coverage: cobertura({ id: 'claude', label: 'Claude Code', discovered: true, conversations }),
    }
  }

  const fonteGrok = (ctx) => {
    const conversations = mesclarConversas([{
      id: 'grok-cli:receptor',
      source: 'grok-cli',
      app: 'Grok CLI',
      title: 'Gate de efeitos',
      cwd: 'C:\\Projeto',
      messages: [
        criarMensagem({
          source: 'grok-cli', conversationId: 'receptor', recordId: 'missao-recebida',
          timestamp: ctx.janela.inicioMs + 6_000, role: 'user', text: `${missao}[Image #1] `,
        }),
        criarMensagem({
          source: 'grok-cli', conversationId: 'receptor', recordId: 'alvo-citado',
          timestamp: ctx.janela.inicioMs + 7_000, role: 'user', text: 'Grok',
        }),
        criarMensagem({
          source: 'grok-cli', conversationId: 'receptor', recordId: 'missao-do-arquivo',
          timestamp: ctx.janela.inicioMs + 8_000, role: 'user', text: `${missaoEmArquivo}[Image #2]`,
        }),
        criarMensagem({
          source: 'grok-cli', conversationId: 'receptor', recordId: 'missao-do-lote',
          timestamp: ctx.janela.inicioMs + 9_000, role: 'user',
          text: 'Preencha o corpus delegado; registre como DÚVIDA:[Image #1] quando necessário.[Image #2]',
        }),
        criarMensagem({
          source: 'claude', conversationId: 'receptor', recordId: 'missao-da-variavel',
          timestamp: ctx.janela.inicioMs + 10_000, role: 'user', text: missaoEmVariavel,
        }),
        criarMensagem({
          source: 'claude', conversationId: 'receptor', recordId: 'missao-em-espera',
          timestamp: ctx.janela.inicioMs + 5 * 60_000, role: 'user', text: missaoEmEspera.slice(0, 90),
        }),
      ],
    }])
    return {
      conversations,
      coverage: cobertura({ id: 'grok-cli', label: 'Grok CLI', discovered: true, conversations }),
    }
  }

  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir,
    fontes: [fonteClaude, fonteGrok],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })

  await servico.coletar('2026-08-13')
  const inputs = servico.obterInputs('2026-08-13')
  const corpus = servico.lerArtefato('2026-08-13')
  const recebida = corpus.conversations
    .flatMap((conversa) => conversa.messages)
    .find((mensagem) => mensagem.id === 'grok-cli:missao-recebida')

  assert.deepEqual(
    inputs.inputs.map((input) => input.id),
    ['claude:pedido-original', 'grok-cli:alvo-citado']
  )
  assert.equal(recebida.role, 'system')
  assert.equal(recebida.kind, 'delegated_task')
  assert.equal(recebida.provenance.delegation.target, 'Grok')
  const recebidaDoArquivo = corpus.conversations
    .flatMap((conversa) => conversa.messages)
    .find((mensagem) => mensagem.id === 'grok-cli:missao-do-arquivo')
  assert.equal(recebidaDoArquivo.role, 'system')
  assert.equal(recebidaDoArquivo.kind, 'delegated_task')
  const recebidaDoLote = corpus.conversations
    .flatMap((conversa) => conversa.messages)
    .find((mensagem) => mensagem.id === 'grok-cli:missao-do-lote')
  assert.equal(recebidaDoLote.role, 'system')
  assert.equal(recebidaDoLote.kind, 'delegated_task')
  const recebidaDaVariavel = corpus.conversations
    .flatMap((conversa) => conversa.messages)
    .find((mensagem) => mensagem.id === 'claude:missao-da-variavel')
  assert.equal(recebidaDaVariavel.role, 'system')
  assert.equal(recebidaDaVariavel.kind, 'delegated_task')
  const recebidaEmEspera = corpus.conversations
    .flatMap((conversa) => conversa.messages)
    .find((mensagem) => mensagem.id === 'claude:missao-em-espera')
  assert.equal(recebidaEmEspera.role, 'system')
  assert.equal(recebidaEmEspera.kind, 'delegated_task')
})

test('matriz padrão não inclui Copilot nem Gemini', async (t) => {
  const raiz = temporario(t)
  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    homeDir: raiz,
    appDataDir: raiz,
    localAppDataDir: raiz,
    programDataDir: raiz,
    readBuzzIdentity: () => null,
  })

  const resumo = await servico.coletar('2026-08-13')

  assert.deepEqual(resumo.coverage.map((fonte) => fonte.id), [
    'codex',
    'claude',
    'cursor',
    'grok-cli',
    'grok-bot',
    'opencode',
    'pi',
    'buzz',
    'whatsapp',
    'sussurro',
    'league-of-legends',
  ])
})

test('Grok CLI conta os pedaços de uma entrada humana como uma só mensagem', async (t) => {
  const raiz = temporario(t)
  const textoLongo = [
    'Relatório completo do trabalho:',
    '- primeira linha que foi colada de novo pelo cliente',
    '- segunda linha que foi colada de novo pelo cliente',
  ].join('\n')
  const sessao = path.join(
    raiz,
    '.grok',
    'sessions',
    'fixture',
    '12345678-1234-1234-1234-123456789abc'
  )
  fs.mkdirSync(sessao, { recursive: true })
  fs.writeFileSync(path.join(sessao, 'summary.json'), JSON.stringify({
    created_at: '2026-08-13T12:00:00.000Z',
    last_active_at: '2026-08-13T12:05:00.000Z',
  }))
  fs.writeFileSync(path.join(sessao, 'events.jsonl'), [
    JSON.stringify({ type: 'turn_started', turn_number: 1, ts: '2026-08-13T12:00:00.000Z' }),
  ].join('\n'))
  fs.writeFileSync(path.join(sessao, 'updates.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: '<user_query><system-reminder>contexto automático</system-reminder></user_query>' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.500Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: '[Context]\nScope: channel\nChannel: Projetos' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.600Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: '[Base]\nYou are operating inside the Buzz platform.' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.700Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: '[Buzz event: @mention]\nEvent ID: fixture' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.800Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: '[Thread Context (2 of 3 messages)]\n[1] mensagem anterior' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:01.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 1 },
      content: { type: 'text', text: 'Revise o módulo do dia' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:01.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 1 },
      content: { type: 'image', data: 'imagem-fixture', mimeType: 'image/png' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:01.500Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 2 },
      content: { type: 'text', text: 'Depois confira o resultado' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:02.000Z', params: { update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Revisão ' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:03.000Z', params: { update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'concluída' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:04.000Z', params: { update: {
      sessionUpdate: 'turn_completed',
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:10.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 3 },
      content: { type: 'text', text: textoLongo },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:10.100Z', params: { update: {
      sessionUpdate: 'turn_completed',
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:10.200Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 4 },
      content: { type: 'text', text: '- primeira linha que foi colada de novo pelo cliente' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:10.300Z', params: { update: {
      sessionUpdate: 'turn_completed',
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:10.400Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 5 },
      content: { type: 'text', text: '- segunda linha que foi colada de novo pelo cliente' },
    } } }),
    ...Array.from({ length: 5 }, (_item, indice) => JSON.stringify({
      timestamp: `2026-08-13T12:00:10.${500 + (indice * 100)}Z`,
      params: { update: {
        sessionUpdate: 'user_message_chunk',
        _meta: { promptIndex: 6 + indice },
        content: { type: 'text', text: `linha recodificada ${indice + 1}` },
      } },
    })),
    JSON.stringify({ timestamp: '2026-08-13T12:00:14.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      _meta: { promptIndex: 11 },
      content: { type: 'text', text: 'Agora execute o plano' },
    } } }),
  ].join('\n'))
  fs.writeFileSync(path.join(sessao, 'chat_history.jsonl'), [
    JSON.stringify({ type: 'user', prompt_index: 1, content: [{ type: 'text', text: 'Revise o módulo do dia\n[imagem anexada]' }] }),
    JSON.stringify({ type: 'assistant', content: 'Revisão concluída' }),
  ].join('\n'))
  const subagente = path.join(
    raiz,
    '.grok',
    'sessions',
    'fixture',
    '87654321-4321-4321-4321-cba987654321'
  )
  fs.mkdirSync(subagente, { recursive: true })
  fs.writeFileSync(path.join(subagente, 'summary.json'), JSON.stringify({
    created_at: '2026-08-13T13:00:00.000Z',
    last_active_at: '2026-08-13T13:05:00.000Z',
    session_kind: 'subagent',
  }))
  fs.writeFileSync(path.join(subagente, 'events.jsonl'), [
    JSON.stringify({ type: 'turn_started', turn_number: 1, ts: '2026-08-13T13:00:00.000Z' }),
  ].join('\n'))
  fs.writeFileSync(path.join(subagente, 'updates.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-13T13:00:00.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'Tarefa enviada por outro agente' },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T13:00:01.000Z', params: { update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Tarefa concluída' },
    } } }),
  ].join('\n'))
  fs.writeFileSync(path.join(subagente, 'chat_history.jsonl'), [
    JSON.stringify({ type: 'user', prompt_index: 1, content: 'Tarefa enviada por outro agente' }),
  ].join('\n'))
  const agenteBuzz = path.join(
    raiz,
    '.grok',
    'sessions',
    'fixture',
    '11111111-2222-3333-4444-555555555555'
  )
  fs.mkdirSync(agenteBuzz, { recursive: true })
  fs.writeFileSync(path.join(agenteBuzz, 'summary.json'), JSON.stringify({
    created_at: '2026-08-13T14:00:00.000Z',
    last_active_at: '2026-08-13T14:05:00.000Z',
    git_root_dir: path.join(raiz, '.buzz'),
  }))
  fs.writeFileSync(path.join(agenteBuzz, 'events.jsonl'), [
    JSON.stringify({ type: 'turn_started', turn_number: 1, ts: '2026-08-13T14:00:00.000Z' }),
  ].join('\n'))
  fs.writeFileSync(path.join(agenteBuzz, 'updates.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-13T14:00:00.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'Mensagem entregue pelo harness do Buzz' },
    } } }),
  ].join('\n'))
  fs.writeFileSync(path.join(agenteBuzz, 'chat_history.jsonl'), [
    JSON.stringify({ type: 'user', prompt_index: 1, content: 'Mensagem entregue pelo harness do Buzz' }),
  ].join('\n'))

  const resultado = await coletarGrokCli({
    homeDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })
  const todas = resultado.conversations.flatMap((conversa) => conversa.messages)
  const mensagensHumanas = todas.filter((mensagem) => (
    mensagem.role === 'user' && mensagem.kind === 'message'
  ))

  assert.deepEqual(
    mensagensHumanas.map((mensagem) => mensagem.text),
    ['Revise o módulo do dia', 'Depois confira o resultado', textoLongo, 'Agora execute o plano']
  )
  assert.equal(todas.filter((mensagem) => mensagem.kind === 'delegated_task').length, 2)
  assert.equal(todas.filter((mensagem) => mensagem.role === 'system').length, 7)
})

test('Grok CLI não trata o prompt do analista do Sumário como mensagem da pessoa', async (t) => {
  const raiz = temporario(t)
  const sessao = path.join(
    raiz,
    '.grok',
    'sessions',
    'fixture',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  )
  fs.mkdirSync(sessao, { recursive: true })
  fs.writeFileSync(path.join(sessao, 'summary.json'), JSON.stringify({
    created_at: '2026-08-13T12:00:00.000Z',
    last_active_at: '2026-08-13T12:05:00.000Z',
  }))
  const dump = [
    '=== SYSTEM ===',
    'Você é o analista do Sumário Diário do DailyWork.',
    '=== CONVERSATION ===',
    'user: Dia 2026-08-12. Fragmento 17 de 143.',
    '<corpus-jsonl>',
    '{"conversationId":"codex:ontem","source":"codex","text":"segredo do dia anterior"}',
    '</corpus-jsonl>',
  ].join('\n')
  fs.writeFileSync(path.join(sessao, 'updates.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: dump },
    } } }),
    JSON.stringify({ timestamp: '2026-08-13T12:00:01.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'instala o microsoft teams nesse pc' },
    } } }),
  ].join('\n'))
  fs.writeFileSync(path.join(sessao, 'chat_history.jsonl'), '')

  const resultado = await coletarGrokCli({
    homeDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })
  const todas = resultado.conversations.flatMap((conversa) => conversa.messages)
  const humanas = todas.filter((mensagem) => mensagem.role === 'user' && mensagem.kind === 'message')

  assert.deepEqual(humanas.map((mensagem) => mensagem.text), ['instala o microsoft teams nesse pc'])
  assert.equal(todas.filter((mensagem) => mensagem.kind === 'context' && mensagem.text.includes('corpus-jsonl')).length, 1)
})

test('Grok CLI guarda só o pedido humano de um prompt do agente do DailyWork', async (t) => {
  const raiz = temporario(t)
  const sessao = path.join(
    raiz,
    '.grok',
    'sessions',
    'fixture',
    'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
  )
  fs.mkdirSync(sessao, { recursive: true })
  fs.writeFileSync(path.join(sessao, 'summary.json'), JSON.stringify({
    created_at: '2026-08-13T12:00:00.000Z',
    last_active_at: '2026-08-13T12:05:00.000Z',
  }))
  const envelope = [
    '=== SYSTEM ===',
    'Você é o agente global do DailyWork. Responda em português brasileiro.',
    '',
    '=== CONVERSATION ===',
    'user: oi',
    '',
    '=== INSTRUCTION ===',
    'Responda somente no JSON do schema.',
  ].join('\n')
  fs.writeFileSync(path.join(sessao, 'updates.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-13T12:00:00.000Z', params: { update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: envelope },
    } } }),
  ].join('\n'))
  fs.writeFileSync(path.join(sessao, 'chat_history.jsonl'), '')

  const resultado = await coletarGrokCli({
    homeDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })
  const humanas = resultado.conversations.flatMap((conversa) => conversa.messages)
    .filter((mensagem) => mensagem.role === 'user' && mensagem.kind === 'message')

  assert.deepEqual(humanas.map((mensagem) => mensagem.text), ['oi'])
})

test('inputs persistidos do analista do Sumário não aparecem como mensagens da pessoa', (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const pasta = path.join(outputDir, '2026-08-13')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'inputs.json'), JSON.stringify({
    schemaVersion: 3,
    day: '2026-08-13',
    completeness: 'complete',
    stats: { inputs: 2, characters: 9999, conversations: 2, sources: 1 },
    sources: [{
      id: 'grok-cli',
      label: 'Grok CLI',
      status: 'complete',
      conversations: 2,
      messages: 2,
      errorCount: 0,
      inputCount: 2,
    }],
    inputs: [
      {
        id: 'dump',
        source: 'grok-cli',
        app: 'Grok CLI',
        conversationId: 'grok-cli:1',
        conversationTitle: 'Análise',
        text: '=== SYSTEM ===\nVocê é o analista do Sumário Diário do DailyWork.\n<corpus-jsonl>\n{"conversationId":"ontem"}\n</corpus-jsonl>',
      },
      {
        id: 'humano',
        source: 'grok-cli',
        app: 'Grok CLI',
        conversationId: 'grok-cli:2',
        conversationTitle: 'Teams',
        text: 'instala o microsoft teams nesse pc',
      },
    ],
  }))
  const servico = criarServicoSumario({ appRoot: raiz, outputDir, fontes: [] })

  const inputs = servico.obterInputs('2026-08-13')

  assert.deepEqual(inputs.inputs.map((input) => input.text), ['instala o microsoft teams nesse pc'])
  assert.equal(inputs.stats.inputs, 1)
  assert.equal(inputs.sources[0].inputCount, 1)
})

test('inputs persistidos do agente do DailyWork mostram só o que a pessoa digitou', (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const pasta = path.join(outputDir, '2026-08-13')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'inputs.json'), JSON.stringify({
    schemaVersion: 3,
    day: '2026-08-13',
    completeness: 'complete',
    stats: { inputs: 1, characters: 20_000, conversations: 1, sources: 1 },
    sources: [{
      id: 'grok-cli',
      label: 'Grok CLI',
      status: 'complete',
      conversations: 1,
      messages: 1,
      errorCount: 0,
      inputCount: 1,
    }],
    inputs: [{
      id: 'envelope',
      source: 'grok-cli',
      app: 'Grok CLI',
      conversationId: 'grok-cli:1',
      conversationTitle: '=== SYSTEM ===',
      text: [
        '=== SYSTEM ===',
        'Você é o agente global do DailyWork. Responda em português brasileiro.',
        '',
        '=== CONVERSATION ===',
        'user: oi',
        '',
        '=== INSTRUCTION ===',
        'Responda somente no JSON do schema.',
      ].join('\n'),
    }],
  }))
  const servico = criarServicoSumario({ appRoot: raiz, outputDir, fontes: [] })

  const inputs = servico.obterInputs('2026-08-13')

  assert.deepEqual(inputs.inputs.map((input) => input.text), ['oi'])
  assert.equal(inputs.stats.characters, 2)
})

test('análise do Sumário não reingere o próprio prompt como evidência do dia', async (t) => {
  const raiz = temporario(t)
  const dump = [
    '=== SYSTEM ===',
    'Você é o analista do Sumário Diário do DailyWork.',
    '=== CONVERSATION ===',
    'user: Dia 2026-08-12. Fragmento 1 de 2.',
    '<corpus-jsonl>',
    '{"conversationId":"ontem","text":"segredo-do-dia-anterior"}',
    '</corpus-jsonl>',
  ].join('\n')
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [function coletarFixture(ctx) {
      const conversations = [{
        id: 'fixture:analista',
        source: 'fixture',
        app: 'Fixture AI',
        title: 'Sessão contaminada',
        messages: [
          criarMensagem({
            source: 'fixture',
            conversationId: 'analista',
            recordId: 'dump',
            timestamp: ctx.janela.inicioMs + 1_000,
            role: 'user',
            text: dump,
          }),
          criarMensagem({
            source: 'fixture',
            conversationId: 'analista',
            recordId: 'humano',
            timestamp: ctx.janela.inicioMs + 2_000,
            role: 'user',
            text: 'Planejar o módulo do dia',
          }),
        ],
      }]
      return {
        conversations,
        coverage: cobertura({
          id: 'fixture',
          label: 'Fixture AI',
          discovered: true,
          conversations,
          files: 1,
          records: 2,
        }),
      }
    }],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  await sumario.coletar('2026-08-13')
  const chamadas = []
  const analises = criarServicoAnaliseSumario({
    sumario,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
    completar: async (entrada) => {
      chamadas.push(entrada)
      return {
        mensagem: entrada.mensagens[0].content.includes('analista final')
          ? JSON.stringify({
            summaryMarkdown: resumoValido(),
            studies: revisoesValidas(),
            questions: duasQuestoes(),
          })
          : 'Nota parcial baseada no fragmento.',
        perfil: { id: 'fixture-model', nome: 'Fixture Model', rota: 'fixture/model' },
      }
    },
  })

  await analises.analisar('2026-08-13', { perfilId: 'fixture-model' })
  const inputs = sumario.obterInputs('2026-08-13')
  const pedidoFragmento = chamadas.find((entrada) => entrada.mensagens[0].content.includes('analista do Sumário'))

  assert.deepEqual(inputs.inputs.map((input) => input.text), ['Planejar o módulo do dia'])
  assert.match(pedidoFragmento.mensagens[1].content, /Planejar o módulo do dia/)
  assert.doesNotMatch(pedidoFragmento.mensagens[1].content, /segredo-do-dia-anterior/)
})

test('Codex separa contexto automático da mensagem escrita pela pessoa', async (t) => {
  const raiz = temporario(t)
  const pasta = path.join(raiz, '.codex', 'sessions', '2026', '08', '13')
  const arquivo = path.join(pasta, 'rollout-12345678-1234-1234-1234-123456789abc.jsonl')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(arquivo, [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-08-13T11:59:00.000Z',
      payload: { source: 'vscode', originator: 'Codex Desktop' },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-13T12:00:00.000Z',
      payload: {
        id: 'entrada-1',
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '<recommended_plugins>automático</recommended_plugins>' },
          { type: 'input_text', text: '# AGENTS.md instructions\nautomático' },
          { type: 'input_text', text: '<environment_context>automático</environment_context>' },
        ],
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-13T12:01:00.000Z',
      payload: {
        id: 'anexo-automatico',
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# Files mentioned by the user:\n\n## captura.png: C:/temp/captura.png' }],
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-13T12:01:20.000Z',
      payload: {
        id: 'anexo-com-pedido',
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '# Files mentioned by the user:\n\n## captura.png: C:/temp/captura.png\n\n## My request:\nOlhe esta captura' },
          { type: 'input_text', text: '<image name=[Image #1] path="C:/temp/captura.png">' },
          { type: 'input_image', image_url: 'data:image/png;base64,fixture' },
          { type: 'input_text', text: '</image>' },
        ],
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-13T12:01:21.000Z',
      payload: {
        type: 'user_message',
        message: '# Files mentioned by the user:\n\n## captura.png: C:/temp/captura.png\n\n## My request:\nOlhe esta captura',
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-13T12:01:30.000Z',
      payload: {
        id: 'entrada-2',
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Melhore o resumo do dia' }],
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-13T12:06:30.000Z',
      payload: {
        type: 'item_completed',
        started_at_ms: Date.parse('2026-08-13T12:01:40.000Z'),
        completed_at_ms: Date.parse('2026-08-13T12:06:30.000Z'),
        item: {
          type: 'CommandExecution',
          id: 'exec-maestri',
          command: ['pwsh.exe', '-Command', '& $env:MAESTRI_CLI ask "Grok" "Revise o módulo"'],
        },
      },
    }),
  ].join('\n'))
  fs.writeFileSync(path.join(pasta, 'rollout-87654321-4321-4321-4321-cba987654321.jsonl'), [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-08-13T12:02:00.000Z',
      payload: {
        source: { subagent: { thread_spawn: { parent_thread_id: 'pai', depth: 1 } } },
        originator: 'Codex Desktop',
      },
    }),
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-08-13T12:02:30.000Z',
      payload: { source: 'vscode', originator: 'Codex Desktop' },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-13T12:03:00.000Z',
      payload: {
        id: 'tarefa-delegada',
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Audite este módulo' }],
      },
    }),
  ].join('\n'))

  const resultado = await coletarCodex({
    homeDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })
  const mensagens = resultado.conversations.flatMap((conversa) => conversa.messages)

  assert.deepEqual(
    mensagens.filter((mensagem) => mensagem.role === 'user').map((mensagem) => mensagem.text),
    ['Olhe esta captura', 'Melhore o resumo do dia']
  )
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'delegated_task').length, 1)
  assert.equal(mensagens.filter((mensagem) => mensagem.role === 'system').length, 4)
  const comando = mensagens.find((mensagem) => mensagem.id === 'codex:command:exec-maestri')
  assert.equal(comando.kind, 'tool_call')
  assert.equal(comando.timestamp, '2026-08-13T12:01:40.000Z')
})

test('Pi separa texto do agente e tool calls usados para delegar tarefas', async (t) => {
  const raiz = temporario(t)
  const pasta = path.join(raiz, '.pi', 'agent', 'sessions', 'fixture')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, '2026-08-13T12-00-00-12345678-1234-1234-1234-123456789abc.jsonl'), [
    JSON.stringify({
      type: 'session',
      id: '12345678-1234-1234-1234-123456789abc',
      cwd: 'C:\\Projeto',
    }),
    JSON.stringify({
      type: 'message',
      id: 'mensagem-pi',
      timestamp: '2026-08-13T12:00:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'raciocínio interno' },
          { type: 'text', text: 'Vou delegar a revisão.' },
          {
            type: 'toolCall',
            id: 'tool-pi',
            name: 'bash',
            arguments: { command: 'maestri ask "Grok" "Revise o módulo"' },
          },
        ],
      },
    }),
  ].join('\n'))

  const resultado = await coletarPi({ homeDir: raiz, janela: janelaDoDia('2026-08-13') })
  const mensagens = resultado.conversations.flatMap((conversa) => conversa.messages)

  assert.deepEqual(mensagens.map((mensagem) => ({ role: mensagem.role, kind: mensagem.kind, text: mensagem.text })), [
    { role: 'assistant', kind: 'message', text: 'Vou delegar a revisão.' },
    { role: 'tool', kind: 'tool_call', text: 'maestri ask "Grok" "Revise o módulo"' },
  ])
})

test('Codex preserva o pedido depois de contexto ambiente no mesmo bloco', async (t) => {
  const home = temporario(t)
  const dia = '2026-08-13'
  const arquivo = path.join(
    home,
    '.codex',
    'sessions',
    '2026',
    '08',
    '13',
    'rollout-2026-08-13T12-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'
  )
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  fs.writeFileSync(arquivo, [
    {
      timestamp: '2026-08-13T15:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: 'C:\\Projetos\\DailyWork' },
    },
    {
      timestamp: '2026-08-13T15:01:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: '<in-app-browser-context>estado automático</in-app-browser-context>\n\n## My request:\nAbra o Sumário diário',
        }],
      },
    },
  ].map((registro) => JSON.stringify(registro)).join('\n'))

  const servico = criarServicoSumario({
    appRoot: path.join(home, 'app'),
    homeDir: home,
    appDataDir: path.join(home, 'appdata'),
    localAppDataDir: path.join(home, 'localappdata'),
    outputDir: path.join(home, 'saida'),
    now: () => new Date('2026-08-13T16:00:00.000Z'),
  })

  const resultado = await servico.coletar(dia)
  assert.equal(resultado.stats.userMessages, 1)
  const artefato = servico.lerArtefato(dia)
  const falas = artefato.conversations.flatMap((conversa) => conversa.messages)
  assert.equal(falas.some((mensagem) => mensagem.role === 'user' && mensagem.text === 'Abra o Sumário diário'), true)
  assert.equal(falas.some((mensagem) => mensagem.role === 'user' && mensagem.text.includes('in-app-browser-context')), false)
})

test('Cursor não atribui tarefas simuladas, subagentes e histórico sincronizado à pessoa', async (t) => {
  const raiz = temporario(t)
  const pasta = path.join(raiz, 'Cursor', 'User', 'globalStorage')
  const arquivo = path.join(pasta, 'state.vscdb')
  fs.mkdirSync(pasta, { recursive: true })
  const db = new DatabaseSync(arquivo)
  db.exec(`
    CREATE TABLE composerHeaders (composerId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, value TEXT);
    CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
  `)
  db.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, ?)').run(
    'composer-1',
    Date.parse('2026-08-13T12:00:00.000Z'),
    Date.parse('2026-08-13T12:05:00.000Z'),
    JSON.stringify({ name: 'Conversa fixture' })
  )
  const inserir = db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)')
  inserir.run('bubbleId:composer-1:humana', JSON.stringify({
    type: 1,
    text: 'Melhore a tela do sumário',
    createdAt: '2026-08-13T12:00:00.000Z',
  }))
  inserir.run('bubbleId:composer-1:simulada', JSON.stringify({
    type: 1,
    text: 'Continue a execução do plano',
    isSimulatedMsg: true,
    createdAt: '2026-08-13T12:01:00.000Z',
  }))
  inserir.run('bubbleId:composer-1:subagente', JSON.stringify({
    type: 1,
    text: 'Audite a interface',
    subagentSpawnTaskToolCallId: 'tool-1',
    createdAt: '2026-08-13T12:02:00.000Z',
  }))
  inserir.run('bubbleId:composer-1:historico', JSON.stringify({
    type: 1,
    text: 'Mensagem antiga sincronizada em outro Composer',
    serverBubbleId: 'server-bubble-1',
    conversationTurnIndex: 3,
    createdAt: '2026-08-13T12:03:00.000Z',
  }))
  db.close()

  const resultado = await coletarCursor({
    appDataDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })
  const mensagens = resultado.conversations.flatMap((conversa) => conversa.messages)

  assert.deepEqual(
    mensagens.filter((mensagem) => mensagem.role === 'user').map((mensagem) => mensagem.text),
    ['Melhore a tela do sumário']
  )
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'delegated_task').length, 2)
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'context').length, 1)
})

test('Claude não conta notificações, compactações e sessões automáticas como fala humana', async (t) => {
  const raiz = temporario(t)
  const pasta = path.join(raiz, '.claude', 'projects', 'fixture')
  const arquivo = path.join(pasta, '12345678-1234-1234-1234-123456789abc.jsonl')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(arquivo, [
    JSON.stringify({
      type: 'user',
      uuid: 'humana',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:00:00.000Z',
      message: { role: 'user', content: 'Explique o resultado do dia' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'notificacao',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:01:00.000Z',
      message: { role: 'user', content: '<task-notification>agente terminou</task-notification>' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'compactacao',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:02:00.000Z',
      isCompactSummary: true,
      message: { role: 'user', content: 'This session is being continued from a previous conversation.' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'buzz-contexto',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:03:00.000Z',
      message: { role: 'user', content: '[Context]\nScope: channel\nChannel: Projetos' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'buzz-evento',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:04:00.000Z',
      message: { role: 'user', content: '[New message — arrived while you were working]\n\n[Buzz event: @mention]' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'notificacao-estruturada',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:04:30.000Z',
      promptSource: 'system',
      origin: { kind: 'task-notification' },
      message: { role: 'user', content: 'Um agente em segundo plano foi interrompido.' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'sessao-background',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:04:40.000Z',
      sessionKind: 'bg',
      promptSource: 'typed',
      origin: { kind: 'human' },
      message: { role: 'user', content: 'Execute esta tarefa no agente de fundo.' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'entrada-sdk-cli',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:04:45.000Z',
      entrypoint: 'sdk-cli',
      promptSource: 'sdk',
      message: { role: 'user', content: 'Execute esta tarefa recebida pelo SDK.' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'entrada-cowork',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:04:50.000Z',
      entrypoint: 'claude-desktop',
      promptSource: 'sdk',
      origin: { kind: 'human' },
      message: { role: 'user', content: 'Pedido humano feito no Cowork' },
    }),
    JSON.stringify({
      type: 'custom-title',
      customTitle: 'Um agente em segundo plano foi interrompido.',
    }),
  ].join('\n'))
  const pastaSubagentes = path.join(pasta, '12345678-1234-1234-1234-123456789abc', 'subagents')
  fs.mkdirSync(pastaSubagentes, { recursive: true })
  fs.writeFileSync(path.join(pastaSubagentes, 'agent-fixture.jsonl'), [
    JSON.stringify({
      type: 'user',
      uuid: 'tarefa-subagente',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:05:00.000Z',
      isSidechain: true,
      message: { role: 'user', content: 'Você é um agente de levantamento. Audite o módulo.' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'resultado-ferramenta-subagente',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      timestamp: '2026-08-13T12:06:00.000Z',
      isSidechain: true,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'resultado técnico' }],
      },
    }),
  ].join('\n'))

  const resultado = await coletarClaude({
    homeDir: raiz,
    appDataDir: path.join(raiz, 'appdata'),
    janela: janelaDoDia('2026-08-13'),
  })
  const mensagens = resultado.conversations.flatMap((conversa) => conversa.messages)

  assert.deepEqual(
    mensagens
      .filter((mensagem) => mensagem.role === 'user' && mensagem.kind === 'message')
      .map((mensagem) => mensagem.text),
    ['Explique o resultado do dia', 'Pedido humano feito no Cowork']
  )
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'context').length, 5)
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'delegated_task').length, 3)
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'tool_result').length, 1)
  assert.equal(resultado.conversations[0].title, 'Explique o resultado do dia')
})

test('Grok Bot separa mensagens digitadas de mensagens enviadas por outro agente', async (t) => {
  const raiz = temporario(t)
  const pasta = path.join(raiz, 'Grok Bot', 'sand-client-persistence')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'fixture.blob'), JSON.stringify({
    value: {
      entries: [
        {
          kind: 'message',
          id: 'humana',
          role: 'user',
          content: 'Quais são meus compromissos de hoje?',
          timestampMs: Date.parse('2026-08-13T12:00:00.000Z'),
          clientNonce: 'nonce-humana',
        },
        {
          kind: 'message',
          id: 'outro-agente',
          role: 'user',
          content: 'Rotina criada e pronta para executar.',
          timestampMs: Date.parse('2026-08-13T12:01:00.000Z'),
          fromAgent: { id: 'agente-1', name: 'Daily Work' },
        },
      ],
    },
  }))

  const resultado = await coletarGrokBot({
    appDataDir: raiz,
    janela: janelaDoDia('2026-08-13'),
  })
  const mensagens = resultado.conversations.flatMap((conversa) => conversa.messages)

  assert.deepEqual(
    mensagens
      .filter((mensagem) => mensagem.role === 'user' && mensagem.kind === 'message')
      .map((mensagem) => mensagem.text),
    ['Quais são meus compromissos de hoje?']
  )
  assert.equal(mensagens.filter((mensagem) => mensagem.kind === 'delegated_task').length, 1)
})

test('redação remove tokens mesmo embutidos e credenciais de URL', () => {
  const token = `prefixosk-${'a'.repeat(48)}sufixo`
  const jwt = `prefixoeyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(16)}sufixo`
  const url = 'https://usuario:segredo-supersecreto@example.com/repositorio'

  const redigido = redigirSegredos(`${token} ${jwt} ${url}`)

  assert.equal(redigido.includes('sk-'), false)
  assert.equal(redigido.includes('eyJ'), false)
  assert.equal(redigido.includes('segredo-supersecreto'), false)
  assert.match(redigido, /https:\/\/usuario:\[REMOVIDO POR SEGURANÇA\]@example\.com/)
})

test('payloads técnicos omitem binários e respeitam limites persistentes', () => {
  const base64 = 'a'.repeat(80_000)
  const mensagem = criarMensagem({
    source: 'fixture',
    conversationId: 'conversa-grande',
    timestamp: '2026-08-13T12:00:00.000Z',
    role: 'tool',
    kind: 'tool_result',
    text: `resultado data:application/octet-stream;base64,${base64} fim ${'x '.repeat(15_000)}`,
    content: {
      imagem: `data:image/png;base64,${base64}`,
      itens: Array.from({ length: 1_000 }, (_item, indice) => ({ indice, texto: 'y'.repeat(1_000) })),
    },
  })
  const persistida = JSON.stringify(mensagem)
  const mensagemSemTexto = criarMensagem({
    source: 'fixture',
    conversationId: 'conversa-grande',
    timestamp: '2026-08-13T12:00:01.000Z',
    role: 'tool',
    kind: 'event',
    content: { imagem: `data:image/png;base64,${base64}` },
  })

  assert.match(mensagem.text, /DADO application\/octet-stream OMITIDO/)
  assert.match(mensagem.text, /caracteres omitidos/)
  assert.equal('content' in mensagem, false)
  assert.match(JSON.stringify(mensagemSemTexto), /DADO image\/png OMITIDO/)
  assert.ok(mensagem.text.length < 5_000)
  assert.ok(persistida.length < 6_000)
  assert.equal(persistida.includes(base64), false)
})

test('corpus preserva conversas e amostra somente eventos técnicos', () => {
  const mensagens = [
    ...Array.from({ length: 100 }, (_item, indice) => criarMensagem({
      source: 'fixture',
      conversationId: 'conversa-ampla',
      recordId: `humana-${indice}`,
      timestamp: 1_700_000_000_000 + indice * 2,
      role: indice % 2 ? 'assistant' : 'user',
      text: `fala ${indice}`,
    })),
    ...Array.from({ length: 1_000 }, (_item, indice) => criarMensagem({
      source: 'fixture',
      conversationId: 'conversa-ampla',
      recordId: `tool-${indice}`,
      timestamp: 1_700_000_000_001 + indice * 2,
      role: 'tool',
      kind: 'tool_result',
      text: `resultado ${indice}`,
    })),
  ]
  const [conversa] = mesclarConversas([{
    id: 'fixture:conversa-ampla',
    source: 'fixture',
    messages: mensagens,
  }])

  assert.equal(conversa.messages.filter((item) => item.kind === 'message').length, 100)
  assert.equal(conversa.messages.filter((item) => item.kind === 'tool_result').length, 80)
  assert.deepEqual(conversa.technicalEvents, { total: 1_000, kept: 80, omitted: 920 })
  assert.equal(conversa.messages.some((item) => item.id.endsWith('tool-0')), true)
  assert.equal(conversa.messages.some((item) => item.id.endsWith('tool-999')), true)
  const [mescladaNovamente] = mesclarConversas([conversa])
  assert.deepEqual(mescladaNovamente.technicalEvents, { total: 1_000, kept: 80, omitted: 920 })
})

test('duas instâncias não coletam o mesmo dia ao mesmo tempo', async (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  let execucoes = 0
  const fonteLenta = async (ctx) => {
    execucoes += 1
    await new Promise((resolve) => setTimeout(resolve, 100))
    return fonteCompleta(ctx)
  }
  const opcoes = {
    appRoot: raiz,
    outputDir,
    homeDir: raiz,
    appDataDir: raiz,
    localAppDataDir: raiz,
    fontes: [fonteLenta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  }
  const primeiro = criarServicoSumario(opcoes)
  const segundo = criarServicoSumario(opcoes)

  const [resumoA, resumoB] = await Promise.all([
    primeiro.coletar('2026-08-13'),
    segundo.coletar('2026-08-13'),
  ])

  assert.equal(execucoes, 1)
  assert.equal(resumoA.generatedAt, resumoB.generatedAt)
  assert.equal(resumoA.completeness, 'complete')
  assert.equal(resumoB.completeness, 'complete')
})

test('coleta remove imediatamente a trava deixada por um processo encerrado', async (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const pastaDia = path.join(outputDir, '2026-08-13')
  fs.mkdirSync(pastaDia, { recursive: true })
  fs.writeFileSync(
    path.join(pastaDia, '.coleta.lock'),
    JSON.stringify({ pid: 2_147_483_647, startedAt: '2026-08-13T12:00:00.000Z' })
  )
  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir,
    homeDir: raiz,
    appDataDir: raiz,
    localAppDataDir: raiz,
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })

  const resumo = await servico.coletar('2026-08-13')

  assert.equal(resumo.completeness, 'complete')
  assert.equal(fs.existsSync(path.join(pastaDia, '.coleta.lock')), false)
})

test('fonte com falha nunca é anunciada como cobertura completa', async (t) => {
  const raiz = temporario(t)
  const servico = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [async function coletarQueFalha() { throw new Error('fixture indisponível') }],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })

  const resumo = await servico.coletar('2026-08-13')

  assert.equal(resumo.completeness, 'partial')
  assert.equal(resumo.coverage[0].status, 'partial')
  assert.deepEqual(resumo.coverage[0].errors, ['fixture indisponível'])
  assert.deepEqual(servico.obterInputs('2026-08-13').sources[0], {
    id: 'quefalha',
    label: 'quefalha',
    status: 'partial',
    conversations: 0,
    messages: 0,
    errorCount: 1,
    inputCount: 0,
  })
})

test('índice de inputs antigo exige uma nova coleta', (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const pasta = path.join(outputDir, '2026-08-13')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'inputs.json'), JSON.stringify({
    schemaVersion: 2,
    day: '2026-08-13',
    completeness: 'complete',
    sources: [{ id: 'legada' }],
    inputs: [{ id: 'legado' }],
  }))
  const servico = criarServicoSumario({ appRoot: raiz, outputDir, fontes: [] })

  const inputs = servico.obterInputs('2026-08-13')

  assert.equal(inputs.schemaVersion, 3)
  assert.equal(inputs.completeness, 'not_collected')
  assert.deepEqual(inputs.sources, [])
  assert.deepEqual(inputs.inputs, [])
})

test('datas inválidas e tentativas de sair da raiz são recusadas', async (t) => {
  const raiz = temporario(t)
  const servico = criarServicoSumario({ appRoot: raiz, outputDir: path.join(raiz, 'sumarios'), fontes: [] })

  assert.equal(servico.obterInputs('2026-08-13').completeness, 'not_collected')
  await assert.rejects(servico.coletar('../segredo'), /data inválida/)
  assert.throws(() => servico.obter('2026-02-30'), /data inválida/)
  assert.throws(() => servico.obterInputs('../segredo'), /data inválida/)
})

test('análise anexa o corpus ao chat, reduz por IA e reaproveita fragmentos já processados', async (t) => {
  const raiz = temporario(t)
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    homeDir: raiz,
    appDataDir: raiz,
    localAppDataDir: raiz,
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  await sumario.coletar('2026-08-13')
  const chamadas = []
  const analises = criarServicoAnaliseSumario({
    sumario,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
    completar: async (entrada) => {
      chamadas.push(entrada)
      const final = entrada.mensagens[0].content.includes('analista final')
      return {
        mensagem: final ? JSON.stringify({
          summaryMarkdown: resumoValido(),
          studies: revisoesValidas(),
          questions: duasQuestoes({
            prompt: 'O que comprova uma entrega?',
            options: [
              { id: 'a', text: 'Uma intenção' },
              { id: 'b', text: 'Uma evidência verificável' },
              { id: 'c', text: 'Um palpite' },
            ],
            correctOptionId: 'b',
            explanation: 'A evidência permite verificar o resultado.',
          }),
        }) : 'Nota parcial baseada no fragmento.',
        perfil: { id: 'fixture-model', nome: 'Fixture Model', rota: 'fixture/model' },
      }
    },
  })

  const primeira = await analises.analisar('2026-08-13', { perfilId: 'fixture-model' })
  const chamadasPrimeira = chamadas.length
  const segunda = await analises.analisar('2026-08-13', { perfilId: 'fixture-model' })
  const finalizada = await analises.analisar('2026-08-13', {
    perfilId: 'fixture-model',
    finalizar: true,
  })

  assert.equal(primeira.status, 'complete')
  assert.equal(primeira.analysis.chat[0].kind, 'corpus_attachment')
  assert.equal(primeira.analysis.chat[0].attachment.userMessages, 1)
  assert.match(primeira.analysis.chat[1].content, /Trabalho consolidado/)
  assert.equal(primeira.analysis.studies.length, 2)
  assert.deepEqual(
    primeira.analysis.studies.map((estudo) => [estudo.context, estudo.subject]),
    [['DailyWork', 'Verificação de entregas'], ['SFR', 'Protocolo clínico']]
  )
  assert.match(primeira.analysis.studies[0].markdown, /Ideia principal/)
  assert.equal(primeira.analysis.questions.length, 2)
  assert.equal(primeira.analysis.questions[0].correctOptionId, 'b')
  const pedidoFinal = chamadas.find((entrada) => entrada.mensagens[0].content.includes('analista final'))
  const pedidoFragmento = chamadas.find((entrada) => entrada.mensagens[0].content.includes('analista do Sumário'))
  assert.match(pedidoFragmento.mensagens[0].content, /role=user como evidência em primeira pessoa/)
  assert.match(pedidoFinal.mensagens[0].content, /Fale diretamente com o titular/)
  assert.match(pedidoFinal.mensagens[0].content, /preferências e dúvidas expressos pelo titular/)
  assert.match(pedidoFinal.mensagens[0].content, /português brasileiro cotidiano/)
  assert.match(pedidoFinal.mensagens[0].content, /160 a 240 palavras/)
  assert.match(pedidoFinal.mensagens[0].content, /Projeto ou contexto · assunto/)
  assert.match(pedidoFinal.mensagens[0].content, /uma a três revisões/)
  assert.match(pedidoFinal.mensagens[0].content, /Não misture trabalhos sem relação/)
  assert.match(pedidoFinal.mensagens[0].content, /enunciado deve nomear o projeto, produto ou contexto/i)
  assert.match(pedidoFinal.mensagens[0].content, /exatamente duas questões/)
  assert.match(pedidoFinal.mensagens[0].content, /três alternativas/)
  assert.match(pedidoFinal.mensagens[0].content, /frases naturais/)
  assert.match(pedidoFinal.mensagens[0].content, /Não crie uma lista extra de exercícios/)
  assert.match(pedidoFinal.mensagens[0].content, /inglês solto como probe, weekday, pre-scan/)
  assert.match(pedidoFinal.mensagens[0].content, /Escreva sempre “banco de dados”/)
  assert.ok(pedidoFinal.timeoutMs >= 300_000, 'a síntese não pode expirar antes do Grok concluir')
  assert.ok(
    chamadas.filter((entrada) => entrada !== pedidoFinal).every((entrada) => entrada.timeoutMs >= 300_000),
    'os fragmentos também precisam acomodar a latência real do Grok'
  )
  assert.equal(segunda.analysis.pipeline.reusedFragments, segunda.analysis.pipeline.fragments)
  assert.equal(finalizada.analysis.finalizedAt, '2026-08-13T19:00:00.000Z')
  assert.equal(chamadas.length, chamadasPrimeira + 2, 'rodadas seguintes só refazem a síntese final')
  assert.equal(analises.obter('2026-08-13').status, 'complete')
})

test('análise repara texto longo, jargão e alternativas em excesso', async (t) => {
  const raiz = temporario(t)
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  await sumario.coletar('2026-08-13')
  const chamadasFinais = []
  const analises = criarServicoAnaliseSumario({
    sumario,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
    completar: async (entrada) => {
      const sistema = entrada.mensagens[0].content
      if (!sistema.includes('analista final')) {
        return {
          mensagem: 'Nota parcial baseada no fragmento.',
          perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
        }
      }
      chamadasFinais.push(entrada)
      const reparo = sistema.includes('não seguiu o contrato')
      return {
        mensagem: JSON.stringify(reparo ? {
          summaryMarkdown: resumoValido('No DailyWork, você corrigiu o ponto principal.'),
          studies: revisoesValidas('Escolha primeiro o dado que realmente define a ordem.'),
          questions: duasQuestoes(),
        } : {
          summaryMarkdown: `${Array.from({ length: 270 }, () => 'palavra').join(' ')} probe suíte\n\n### Avanços\n- Algo avançou.\n\n### O que pede atenção\n- Algo pede atenção.\n\n### Próximo passo\n- Faça o próximo passo.`,
          studies: [{
            context: 'Geral',
            subject: 'Regra de ordenação',
            markdown: '## Ideia principal\n\nTexto curto.\n\n## O que lembrar\n1. Primeiro item.\n2. Segundo item.\n3. Terceiro item.\n4. Quarto item.\n\n## Como aplicar\n\nFaça uma ação.',
          }],
          questions: duasQuestoes({
            options: [
              { id: 'a', text: 'Primeira opção' },
              { id: 'b', text: 'Segunda opção' },
              { id: 'c', text: 'Terceira opção' },
              { id: 'd', text: 'Quarta opção' },
            ],
          }),
        }),
        perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
      }
    },
  })

  const resultado = await analises.analisar('2026-08-13')

  assert.equal(chamadasFinais.length, 2)
  assert.match(chamadasFinais[1].mensagens[0].content, /máximo é 260/)
  assert.match(chamadasFinais[1].mensagens[0].content, /exatamente 3 alternativas/)
  assert.match(chamadasFinais[1].mensagens[0].content, /troque o jargão/)
  assert.match(chamadasFinais[1].mensagens[0].content, /deve usar somente estes títulos/)
  assert.match(chamadasFinais[1].mensagens[0].content, /no máximo 3 itens/)
  assert.match(chamadasFinais[1].mensagens[0].content, /cada bullet do resumo deve começar/)
  assert.match(chamadasFinais[1].mensagens[0].content, /contexto vago/)
  assert.equal(resultado.analysis.questions.length, 2)
  assert.equal(resultado.analysis.questions[0].options.length, 3)
  assert.doesNotMatch(JSON.stringify(resultado.analysis), /\b(probe|su[ií]te)\b/i)
})

test('análise finaliza corpus parcial sem esconder os avisos de cobertura', async (t) => {
  const raiz = temporario(t)
  const fonteParcial = (ctx) => {
    const resultado = fonteCompleta(ctx)
    return {
      ...resultado,
      coverage: {
        ...resultado.coverage,
        status: 'partial',
        errors: ['7 linhas inválidas no transcript'],
      },
    }
  }
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [fonteParcial],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  const corpus = await sumario.coletar('2026-08-13')
  const analises = criarServicoAnaliseSumario({
    sumario,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
    completar: async (entrada) => ({
      mensagem: entrada.mensagens[0].content.includes('analista final')
        ? JSON.stringify({
          summaryMarkdown: resumoValido('Trabalho recuperado com cobertura parcial.'),
          studies: revisoesValidas('Revise as evidências disponíveis.'),
          questions: duasQuestoes(),
        })
        : 'Nota parcial baseada no fragmento.',
      perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
    }),
  })

  const resultado = await analises.analisar('2026-08-13', { finalizar: true })

  assert.equal(corpus.completeness, 'partial')
  assert.equal(corpus.coverage[0].status, 'partial')
  assert.equal(resultado.status, 'complete')
  assert.equal(resultado.analysis.corpusCompleteness, 'partial')
  assert.equal(resultado.analysis.finalizedAt, '2026-08-13T19:00:00.000Z')
})

test('dia sem conversas recebe um relatório final sem consumir o modelo', async (t) => {
  const raiz = temporario(t)
  const fonteVazia = () => ({
    conversations: [],
    coverage: cobertura({
      id: 'fixture-empty',
      label: 'Fixture vazia',
      discovered: true,
      conversations: [],
      files: 1,
    }),
  })
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [fonteVazia],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  await sumario.coletar('2026-08-13')
  let chamadas = 0
  const analises = criarServicoAnaliseSumario({
    sumario,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
    completar: async () => {
      chamadas += 1
      throw new Error('não deveria chamar o modelo')
    },
  })

  const resultado = await analises.analisar('2026-08-13', { finalizar: true })

  assert.equal(resultado.status, 'complete')
  assert.equal(resultado.analysis.finalizedAt, '2026-08-13T19:00:00.000Z')
  assert.match(resultado.analysis.summaryMarkdown, /não encontrei atividade/i)
  assert.deepEqual(resultado.analysis.studies, [])
  assert.deepEqual(resultado.analysis.questions, [])
  assert.equal(chamadas, 0)
})

test('análise com contrato de texto antigo fica desatualizada', async (t) => {
  const raiz = temporario(t)
  const outputDir = path.join(raiz, 'sumarios')
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir,
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  const corpus = await sumario.coletar('2026-08-13')
  fs.writeFileSync(path.join(outputDir, '2026-08-13', 'analise.json'), JSON.stringify({
    schemaVersion: 3,
    day: '2026-08-13',
    generatedAt: '2026-08-13T19:00:00.000Z',
    corpusGeneratedAt: corpus.generatedAt,
    pipeline: { promptVersion: 4, finalPromptVersion: 7 },
  }))
  const analises = criarServicoAnaliseSumario({
    sumario,
    completar: async () => { throw new Error('não deveria chamar o modelo') },
  })

  assert.equal(analises.obter('2026-08-13').status, 'outdated')
})

test('Grok 4.6 é o perfil padrão da análise do Sumário', () => {
  assert.equal(PERFIL_ANALISE_PADRAO, 'grok-4-6')
})

test('resposta do quiz é corrigida e permanece no histórico do dia', async (t) => {
  const raiz = temporario(t)
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  await sumario.coletar('2026-08-13')
  const completar = async (entrada) => ({
    mensagem: entrada.mensagens[0].content.includes('analista final')
      ? JSON.stringify({
        summaryMarkdown: resumoValido('Resumo.'),
        studies: revisoesValidas('Revise evidências.'),
        questions: duasQuestoes({
          prompt: 'Qual opção representa evidência?',
          options: [
            { id: 'a', text: 'Intenção' },
            { id: 'b', text: 'Teste executado' },
            { id: 'c', text: 'Suposição' },
          ],
          correctOptionId: 'b',
          explanation: 'Um teste executado é verificável.',
        }),
      })
      : 'Nota parcial.',
    perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
  })
  const analises = criarServicoAnaliseSumario({
    sumario,
    completar,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
  })
  const criada = await analises.analisar('2026-08-13')
  const questao = criada.analysis.questions[0]

  const respondida = await analises.interagir('2026-08-13', {
    type: 'answer',
    questionId: questao.id,
    optionId: 'a',
  })
  const reaberta = criarServicoAnaliseSumario({ sumario, completar }).obter('2026-08-13')

  assert.deepEqual(respondida.interactions.answers[questao.id], {
    questionId: questao.id,
    optionId: 'a',
    correct: false,
    answeredAt: '2026-08-13T19:00:00.000Z',
  })
  assert.deepEqual(reaberta.interactions.answers, respondida.interactions.answers)
})

test('chat conversa sobre o dia com o modelo escolhido e persiste as mensagens', async (t) => {
  const raiz = temporario(t)
  const sumario = criarServicoSumario({
    appRoot: raiz,
    outputDir: path.join(raiz, 'sumarios'),
    fontes: [fonteCompleta],
    now: () => new Date('2026-08-13T18:30:00.000Z'),
  })
  await sumario.coletar('2026-08-13')
  const chamadas = []
  const completar = async (entrada) => {
    chamadas.push(entrada)
    const sistema = entrada.mensagens[0].content
    if (sistema.includes('analista final')) {
      return {
        mensagem: JSON.stringify({
          summaryMarkdown: resumoValido('Você terminou o plano.'),
          studies: revisoesValidas('Revise evidências.'),
          questions: duasQuestoes({
            prompt: 'O que foi concluído?',
            options: [
              { id: 'a', text: 'O plano' },
              { id: 'b', text: 'Nada' },
              { id: 'c', text: 'Só a intenção' },
            ],
            correctOptionId: 'a',
            explanation: 'O corpus registra o plano concluído.',
          }),
        }),
        perfil: { id: entrada.perfilId, nome: entrada.perfilId, rota: 'fixture/final' },
      }
    }
    if (sistema.includes('Reescreva a resposta em português simples')) {
      return {
        mensagem: 'Você acertou ao transformar o plano em resultado verificável.',
        perfil: { id: entrada.perfilId, nome: 'GPT 5.6 Sol Normal', rota: 'cx/gpt-5.6-sol' },
      }
    }
    if (sistema.includes('tutor do histórico diário')) {
      return {
        mensagem: `${Array.from({ length: 145 }, () => 'palavra').join(' ')} probe`,
        perfil: { id: entrada.perfilId, nome: 'GPT 5.6 Sol Normal', rota: 'cx/gpt-5.6-sol' },
      }
    }
    return {
      mensagem: 'Nota parcial.',
      perfil: { id: entrada.perfilId, nome: entrada.perfilId, rota: 'fixture/map' },
    }
  }
  const analises = criarServicoAnaliseSumario({
    sumario,
    completar,
    now: () => new Date('2026-08-13T19:00:00.000Z'),
  })
  await analises.analisar('2026-08-13')
  chamadas.length = 0

  const conversa = await analises.interagir('2026-08-13', {
    type: 'chat',
    profileId: 'gpt-5-6-sol-medium',
    message: 'Onde eu poderia ter melhorado? api_key=abcdefghijklmnopqrstuv',
  })
  const reaberta = criarServicoAnaliseSumario({ sumario, completar }).obter('2026-08-13')

  assert.equal(chamadas.length, 2)
  assert.equal(chamadas[0].perfilId, 'gpt-5-6-sol-medium')
  assert.match(chamadas[0].mensagens[0].content, /Você terminou o plano/)
  assert.match(chamadas[0].mensagens[0].content, /no máximo 140 palavras/)
  assert.match(chamadas[0].mensagens[0].content, /português brasileiro cotidiano/)
  assert.match(chamadas[0].mensagens[0].content, /inglês solto como probe, weekday, pre-scan/)
  assert.match(chamadas[1].mensagens[0].content, /A resposta tem 146 palavras/)
  assert.match(chamadas[1].mensagens[0].content, /troque o jargão/)
  assert.equal(conversa.interactions.chat.length, 2)
  assert.equal(conversa.interactions.chat[0].role, 'user')
  assert.equal(conversa.interactions.chat[0].content.includes('abcdefghijklmnopqrstuv'), false)
  assert.equal(conversa.interactions.chat[1].profile.id, 'gpt-5-6-sol-medium')
  assert.doesNotMatch(conversa.interactions.chat[1].content, /probe/)
  assert.deepEqual(reaberta.interactions.chat, conversa.interactions.chat)
})

test('Claude Cowork comprova que a sessão do desktop aponta para um transcript local', async (t) => {
  const raiz = temporario(t)
  const sessionId = '12345678-1234-1234-1234-123456789abc'
  const projeto = path.join(raiz, '.claude', 'projects', 'fixture')
  const metadados = path.join(raiz, 'appdata', 'Claude', 'claude-code-sessions', 'conta', 'workspace')
  fs.mkdirSync(projeto, { recursive: true })
  fs.mkdirSync(metadados, { recursive: true })
  fs.writeFileSync(path.join(projeto, `${sessionId}.jsonl`), [
    JSON.stringify({
      type: 'user',
      uuid: 'mensagem-1',
      sessionId,
      timestamp: '2026-08-13T12:00:00.000Z',
      message: { role: 'user', content: 'Organize o dia' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'mensagem-2',
      sessionId,
      timestamp: '2026-08-13T12:01:00.000Z',
      message: { role: 'assistant', content: 'Dia organizado' },
    }),
  ].join('\n'))
  fs.writeFileSync(path.join(metadados, 'local_fixture.json'), JSON.stringify({
    sessionId: 'local_fixture',
    cliSessionId: sessionId,
    createdAt: Date.parse('2026-08-13T12:00:00.000Z'),
    lastActivityAt: Date.parse('2026-08-13T12:01:00.000Z'),
  }))

  const resultado = await coletarClaude({
    homeDir: raiz,
    appDataDir: path.join(raiz, 'appdata'),
    janela: janelaDoDia('2026-08-13'),
  })

  assert.equal(resultado.coverage.status, 'complete')
  assert.equal(resultado.conversations.length, 1)
  assert.equal(resultado.conversations[0].messages.length, 2)
  assert.match(resultado.coverage.notes[1], /^1 sessão/)
})
