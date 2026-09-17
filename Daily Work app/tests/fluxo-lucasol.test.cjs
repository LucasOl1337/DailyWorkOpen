const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const temporarios = []

afterEach(() => {
  while (temporarios.length) {
    fs.rmSync(temporarios.pop(), { recursive: true, force: true })
  }
})

function ambiente() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-fluxo-lucasol-'))
  temporarios.push(raiz)
  const lucasOlDir = path.join(raiz, 'LucasOL')
  const escrever = (relativo, conteudo) => {
    const arquivo = path.join(lucasOlDir, relativo)
    fs.mkdirSync(path.dirname(arquivo), { recursive: true })
    fs.writeFileSync(arquivo, conteudo, 'utf8')
  }
  return { raiz, lucasOlDir, escrever }
}

test('preparar o dia reúne contexto relevante e ignora a fonte ZCode aposentada', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever(
    'Workspace/projects/registry.json',
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: 'sfr',
          name: 'SFR',
          aliases: ['sft-resgate-digital'],
          status: 'active',
          packet: 'Workspace/projects/sfr/README.md',
          repositories: ['C:/NexUnio/sft-resgate-digital'],
          updatedAt: '2026-08-10',
        },
      ],
    })
  )
  escrever(
    'Workspace/projects/sfr/README.md',
    '# SFR\n\n## Objetivo\nEstabilizar a geração de PDF.\n\n## Próxima ação\n- Validar o PDF com um caso real.\n'
  )
  escrever(
    'Knowledge/Desenvolvimento de Software/Validar comportamento.md',
    '# Validar comportamento\n\nAntes de expandir, valide PDF e comportamento observável com evidência real.\n'
  )
  escrever(
    'Knowledge/Núcleo de Identidade/Preferências pessoais.md',
    '# Preferências pessoais\n\nConteúdo sem relação com a frente de PDF.\n'
  )
  escrever(
    'skills/diagnosing-bugs/SKILL.md',
    '---\nname: diagnosing-bugs\ndescription: Diagnosticar bugs e regressões antes de corrigir.\n---\n'
  )
  escrever(
    'Private/work-signals/data/daily-context.json',
    JSON.stringify({
      generatedAt: '2026-08-11T12:00:00.000Z',
      signals: [
        {
          id: 'codex-1',
          source: 'codex',
          projectId: 'sfr',
          kind: 'production_friction',
          title: 'Falha ao gerar PDF',
          occurredAt: '2026-08-11T11:30:00.000Z',
          evidence: 'O teste real ainda falha.',
        },
        {
          id: 'zcode-1',
          source: 'zcode',
          projectId: 'sfr',
          kind: 'work_front',
          title: 'Sinal antigo do ZCode',
          occurredAt: '2026-08-11T11:45:00.000Z',
          evidence: 'Não deve entrar no contexto.',
        },
        {
          id: 'codex-global',
          source: 'codex',
          projectId: 'global',
          kind: 'production_friction',
          title: 'Falha transversal de validação',
          occurredAt: '2026-08-11T11:40:00.000Z',
          evidence: 'Pode afetar qualquer projeto.',
        },
      ],
    })
  )

  const dias = {
    '2026-08-10': [
      {
        id: 'b-pdf',
        tipo: 'tarefa',
        titulo: 'Estabilizar PDF do SFR',
        status: 'fazendo',
        corpo: 'Objetivo: corrigir a geração de PDF.',
        projeto: 'sfr',
      },
      {
        id: 'b-lucasol',
        tipo: 'tarefa',
        titulo: 'Revisar perfil do LucasOL',
        status: 'pendente',
        corpo: 'Objetivo: revisar outro produto.',
        projeto: 'lucasol',
      },
    ],
    '2026-08-11': [],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const fluxo = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T12:30:00.000Z'),
  })

  const resultado = fluxo.prepararDia({ dia: '2026-08-11', projetoId: 'sfr' })

  assert.equal(resultado.projeto.id, 'sfr')
  assert.deepEqual(resultado.carryovers.map((bloco) => bloco.id), ['b-pdf'])
  assert.deepEqual(resultado.sinais.map((sinal) => sinal.id).sort(), ['codex-1', 'codex-global'])
  assert.match(resultado.conhecimento[0].titulo, /Validar comportamento/)
  assert.equal(resultado.skills[0].id, 'diagnosing-bugs')
  assert.ok(resultado.fontes.every((fonte) => fonte.source !== 'zcode'))
  assert.ok(resultado.propostas.some((proposta) => proposta.kind === 'carryover'))
})

test('confirmar propostas grava somente o pacote revisado e repetir é idempotente', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({ version: 1, projects: [] }))
  const dias = {
    '2026-08-10': [
      {
        id: 'b-aberta',
        tipo: 'tarefa',
        titulo: 'Concluir integração',
        status: 'pendente',
        corpo: 'Objetivo: terminar a integração.\n\nPRONTO = testes verdes.',
        projeto: 'dailywork',
      },
    ],
    '2026-08-11': [],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
    criarBloco: (bloco, dia) => {
      const criado = { x: 0, y: 0, w: 260, h: 140, conexoes: [], ...bloco }
      dias[dia].push(criado)
      return criado
    },
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const fluxo = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T12:30:00.000Z'),
  })
  const pacote = fluxo.prepararDia({ dia: '2026-08-11' })
  const proposta = pacote.propostas.find((item) => item.kind === 'carryover')

  const primeira = fluxo.confirmarPropostas({
    dia: '2026-08-11',
    packId: pacote.packId,
    propostaIds: [proposta.id],
  })
  const repetida = fluxo.confirmarPropostas({
    dia: '2026-08-11',
    packId: pacote.packId,
    propostaIds: [proposta.id],
  })

  assert.equal(dias['2026-08-11'].length, 1)
  assert.deepEqual(repetida, primeira)
  assert.equal(primeira[0].bloco.carryoverDe, 'b-aberta')
  assert.equal(primeira[0].bloco.origem, 'context-pack')
  assert.ok(primeira[0].bloco.fontes.includes(`context-pack:${pacote.packId}/${proposta.id}`))
})

test('projeto inferido pelo dia não mistura carryovers de outras frentes', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({
    version: 1,
    projects: [
      { id: 'dailywork', name: 'DailyWork', aliases: [], status: 'active' },
      { id: 'medcor', name: 'Medcor', aliases: [], status: 'active' },
    ],
  }))
  const dias = {
    '2026-08-10': [
      { id: 'b-daily', tipo: 'tarefa', titulo: 'Validar DailyWork', status: 'pendente', projeto: 'dailywork' },
      { id: 'b-medcor', tipo: 'tarefa', titulo: 'Agendar Medcor', status: 'pendente', projeto: 'medcor' },
    ],
    '2026-08-11': [
      { id: 'b-hoje', tipo: 'tarefa', titulo: 'Integrar LucasOL', status: 'fazendo', projeto: 'dailywork' },
    ],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const pacote = criarFluxoLucasOL({ daily, lucasOlDir }).prepararDia({ dia: '2026-08-11' })

  assert.equal(pacote.projeto.id, 'dailywork')
  assert.deepEqual(pacote.carryovers.map((bloco) => bloco.id), ['b-daily'])
})

test('próxima ação canônica já presente no dia não é proposta novamente', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({
    version: 1,
    projects: [{
      id: 'dailywork',
      name: 'DailyWork',
      status: 'active',
      packet: 'Workspace/projects/dailywork/README.md',
    }],
  }))
  escrever(
    'Workspace/projects/dailywork/README.md',
    '# DailyWork\n\n## Próxima ação\n- Validar o fluxo no app real.\n'
  )
  const dias = {
    '2026-08-11': [{
      id: 'b-existente',
      tipo: 'tarefa',
      titulo: 'Validar o fluxo no app real.',
      status: 'fazendo',
      projeto: 'dailywork',
    }],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const pacote = criarFluxoLucasOL({ daily, lucasOlDir }).prepararDia({ dia: '2026-08-11' })

  assert.equal(pacote.propostas.some((item) => item.kind === 'project_next_action'), false)
})

test('confirmar propostas recusa pacote que ficou obsoleto', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({ version: 1, projects: [] }))
  const dias = {
    '2026-08-10': [{ id: 'b-aberta', tipo: 'tarefa', titulo: 'Frente aberta', status: 'pendente' }],
    '2026-08-11': [],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
    criarBloco: () => assert.fail('não deve gravar um pacote obsoleto'),
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const fluxo = criarFluxoLucasOL({ daily, lucasOlDir })
  const pacote = fluxo.prepararDia({ dia: '2026-08-11' })
  dias['2026-08-10'][0].titulo = 'Frente alterada externamente'

  assert.throws(
    () => fluxo.confirmarPropostas({
      dia: '2026-08-11',
      packId: pacote.packId,
      propostaIds: [pacote.propostas[0].id],
    }),
    /CONFLITO/
  )
})

test('fechamento separa execução, memória, conhecimento e portfólio antes de gravar', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever(
    'Workspace/projects/registry.json',
    JSON.stringify({
      version: 1,
      projects: [{ id: 'sfr', name: 'SFR', status: 'active', packet: 'Workspace/projects/sfr/README.md' }],
    })
  )
  escrever('Workspace/projects/sfr/README.md', '# SFR\n\n## Próxima ação\n- Validar PDF.\n')
  const blocos = [
    {
      id: 'b-pronta',
      tipo: 'tarefa',
      titulo: 'Corrigir PDF',
      status: 'feito',
      projeto: 'sfr',
      corpo: 'Objetivo: corrigir o PDF.\n\nResultado: anexo legível no e-mail.\nAprendizado: abrir o anexo real evita falso positivo.\n\nPRONTO = anexo revisado.',
      evidencias: ['test:pdf-real', 'artifact:anexo.pdf'],
    },
    {
      id: 'b-aberta',
      tipo: 'tarefa',
      titulo: 'Validar offline',
      status: 'fazendo',
      projeto: 'sfr',
      corpo: 'Objetivo: validar offline.\n\n- Desligar a rede e preencher a ficha.\n\nPRONTO = sem perda ou duplicação.',
      evidencias: [],
    },
  ]
  const criados = []
  const daily = {
    listarDias: () => ['2026-08-11'],
    listarBlocos: () => [...blocos, ...criados],
    criarBloco: (bloco) => {
      const criado = { x: 0, y: 0, w: 260, h: 140, conexoes: [], ...bloco }
      criados.push(criado)
      return criado
    },
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const fluxo = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T21:00:00.000Z'),
  })

  const revisao = fluxo.revisarFechamento({ dia: '2026-08-11' })

  assert.equal(criados.length, 0)
  assert.deepEqual(revisao.resumo, { total: 2, concluidas: 1, abertas: 1, semEvidencia: 0 })
  assert.equal(revisao.handoffs[0].proximaAcao, 'Desligar a rede e preencher a ficha.')
  assert.equal(revisao.destinos.workspace[0].projectId, 'sfr')
  assert.match(revisao.destinos.knowledgeCandidates[0].content, /anexo real/)
  assert.match(revisao.destinos.portfolioCandidates[0].content, /anexo legível/)

  const recibos = fluxo.confirmarFechamento({
    dia: '2026-08-11',
    reviewId: revisao.reviewId,
    destinos: ['daily', 'workspace', 'knowledgeCandidates', 'portfolioCandidates'],
  })
  const repetidos = fluxo.confirmarFechamento({
    dia: '2026-08-11',
    reviewId: revisao.reviewId,
    destinos: ['daily', 'workspace', 'knowledgeCandidates', 'portfolioCandidates'],
  })

  assert.equal(criados.filter((bloco) => bloco.papel === 'closure').length, 1)
  assert.ok(fs.existsSync(path.join(lucasOlDir, 'Workspace/projects/sfr/LOG.md')))
  assert.equal(fs.readdirSync(path.join(lucasOlDir, 'Research/knowledge-candidates')).length, 1)
  assert.equal(fs.readdirSync(path.join(lucasOlDir, 'Research/portfolio-candidates')).length, 1)
  assert.deepEqual(repetidos, recibos)
})

test('fechamento nunca trata concluído sem evidência como resultado comprovado', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({ version: 1, projects: [] }))
  const daily = {
    listarDias: () => ['2026-08-11'],
    listarBlocos: () => [{
      id: 'b-sem-prova',
      tipo: 'tarefa',
      titulo: 'Publicar release',
      status: 'feito',
      corpo: 'Resultado: release publicada.',
      evidencias: [],
    }],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const revisao = criarFluxoLucasOL({ daily, lucasOlDir }).revisarFechamento({ dia: '2026-08-11' })

  assert.equal(revisao.resumo.semEvidencia, 1)
  assert.equal(revisao.destinos.portfolioCandidates.length, 0)
  assert.match(revisao.alertas[0], /sem evidência/i)
})

test('preparação avisa conflito de agentes na mesma branch e memória de projeto velha', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever(
    'Workspace/projects/registry.json',
    JSON.stringify({
      version: 1,
      projects: [{
        id: 'sfr',
        name: 'SFR',
        status: 'active',
        packet: 'Workspace/projects/sfr/README.md',
        updatedAt: '2026-06-01',
      }],
    })
  )
  escrever('Workspace/projects/sfr/README.md', '# SFR\n')
  const daily = {
    listarDias: () => ['2026-08-11'],
    listarBlocos: () => [
      { id: 'b-a', tipo: 'tarefa', titulo: 'A', status: 'fazendo', projeto: 'sfr', repositorio: 'C:/repo', branch: 'LucasOl-SFT', responsavel: 'codex-a' },
      { id: 'b-b', tipo: 'tarefa', titulo: 'B', status: 'fazendo', projeto: 'sfr', repositorio: 'C:/repo', branch: 'LucasOl-SFT', responsavel: 'codex-b' },
    ],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const pacote = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T12:00:00.000Z'),
  }).prepararDia({ dia: '2026-08-11', projetoId: 'sfr' })

  assert.ok(pacote.riscos.some((risco) => risco.code === 'CONCURRENT_BRANCH'))
  assert.ok(pacote.riscos.some((risco) => risco.code === 'STALE_PROJECT'))
})

test('revisão semanal mostra frentes reincidentes e qualidade da evidência', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({ version: 1, projects: [] }))
  const dias = {
    '2026-08-09': [{ id: 'b-1', tipo: 'tarefa', titulo: 'Validar PDF', status: 'pendente', projeto: 'sfr' }],
    '2026-08-10': [{ id: 'b-2', tipo: 'tarefa', titulo: 'Validar PDF', status: 'fazendo', projeto: 'sfr' }],
    '2026-08-11': [
      { id: 'b-3', tipo: 'tarefa', titulo: 'Validar PDF', status: 'feito', projeto: 'sfr', evidencias: ['artifact:pdf'] },
      { id: 'b-4', tipo: 'tarefa', titulo: 'Publicar release', status: 'feito', projeto: 'sfr', evidencias: [] },
    ],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const semana = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T21:00:00.000Z'),
  }).revisarSemana({ ate: '2026-08-11' })

  assert.deepEqual(semana.periodo, { de: '2026-08-05', ate: '2026-08-11' })
  assert.equal(semana.resumo.concluidasComEvidencia, 1)
  assert.equal(semana.resumo.concluidasSemEvidencia, 1)
  assert.equal(semana.frentesRecorrentes[0].titulo, 'Validar PDF')
  assert.equal(semana.frentesRecorrentes[0].dias, 3)
  assert.equal(semana.conhecimento.linksLocaisQuebrados, 0)
})

test('sumário recente vira propostas e não duplica o que já está no dia', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({
    version: 1,
    projects: [{
      id: 'nexsales',
      name: 'NexSales',
      aliases: ['Clinick'],
      status: 'active',
    }],
  }))
  const dias = {
    '2026-08-10': [],
    '2026-08-11': [{
      id: 'b-existente',
      tipo: 'tarefa',
      titulo: 'Clinick · celular',
      status: 'pendente',
    }],
  }
  const daily = {
    listarDias: () => Object.keys(dias),
    listarBlocos: (dia) => dias[dia] || [],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const pacote = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T12:00:00.000Z'),
    obterAnaliseSumario: (dia) => {
      if (dia !== '2026-08-10') return { status: 'not_collected', analysis: null }
      return {
        status: 'complete',
        analysis: {
          summaryMarkdown: [
            '## Avanços',
            '- Outra coisa irrelevante.',
            '## O que pede atenção',
            '- **Clinick · celular:** Enquanto a equipe responder pelo aparelho, o contexto parte.',
            '## Próximo passo',
            '- **Clinick · conversas reais:** Acompanhar os primeiros atendimentos no painel.',
          ].join('\n'),
        },
      }
    },
  }).prepararDia({ dia: '2026-08-11' })

  const sumario = pacote.propostas.filter((item) => item.kind === 'sumario_proximo_passo')
  assert.equal(sumario.length, 1)
  assert.equal(sumario[0].bloco.titulo, 'Clinick · conversas reais')
  assert.equal(sumario[0].bloco.projeto, 'nexsales')
  assert.ok(sumario[0].bloco.fontes.includes('sumario:2026-08-10/analise'))
  assert.equal(pacote.analiseRecente.dia, '2026-08-10')
  assert.ok(pacote.fontes.some((fonte) => fonte.kind === 'daily_summary'))
})

test('próxima ação de todos os projetos ativos entra no pacote', () => {
  const { lucasOlDir, escrever } = ambiente()
  escrever('Workspace/projects/registry.json', JSON.stringify({
    version: 1,
    projects: [
      {
        id: 'dailywork',
        name: 'DailyWork',
        status: 'active',
        packet: 'Workspace/projects/dailywork/README.md',
        updatedAt: '2026-08-11',
      },
      {
        id: 'nexsales',
        name: 'NexSales',
        status: 'active',
        packet: 'Workspace/projects/nexsales/README.md',
        updatedAt: '2026-08-10',
      },
      {
        id: 'arquivo',
        name: 'Arquivado',
        status: 'archived',
        packet: 'Workspace/projects/arquivo/README.md',
        updatedAt: '2026-08-12',
      },
    ],
  }))
  escrever('Workspace/projects/dailywork/README.md', '# DailyWork\n\n## Próxima ação\n- Abrir o Diário com sugestões.\n')
  escrever('Workspace/projects/nexsales/README.md', '# NexSales\n\n## Próxima ação\n- Conferir o painel da Clinick.\n')
  escrever('Workspace/projects/arquivo/README.md', '# Arquivado\n\n## Próxima ação\n- Não deve aparecer.\n')
  const daily = {
    listarDias: () => ['2026-08-11'],
    listarBlocos: () => [],
  }
  const { criarFluxoLucasOL } = require('../electron/lib-fluxo-lucasol.cjs')
  const pacote = criarFluxoLucasOL({
    daily,
    lucasOlDir,
    agora: () => new Date('2026-08-11T12:00:00.000Z'),
  }).prepararDia({ dia: '2026-08-11' })

  const proximas = pacote.propostas.filter((item) => item.kind === 'project_next_action')
  assert.deepEqual(proximas.map((item) => item.bloco.projeto), ['dailywork', 'nexsales'])
  assert.equal(proximas[0].bloco.titulo, 'Abrir o Diário com sugestões.')
  assert.ok(pacote.propostas.length <= 10)
})
