const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-executor-test-'))
const WORKSPACES = path.join(TMP, 'workspaces')
const REPO = path.join(WORKSPACES, 'produto')
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'knowledge')
fs.mkdirSync(REPO, { recursive: true })
fs.writeFileSync(path.join(REPO, 'app.txt'), 'estado=antigo\n', 'utf8')

const lib = require('../electron/lib-md.cjs')
const { criarServicoExecutorNativo } = require('../electron/lib-executor-nativo.cjs')

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('executor nativo edita, valida e conclui a frente sem harness externo', async () => {
  const dia = '2026-08-20'
  lib.criarBloco({
    id: 'b-execucao-nativa',
    tipo: 'tarefa',
    titulo: 'Atualizar produto',
    corpo: 'Objetivo: trocar o estado.\n- Edite app.txt\nPRONTO = arquivo validado',
    repositorio: REPO,
  }, dia)
  const toolsUsadas = []
  const servico = criarServicoExecutorNativo({
    lib,
    workspaceRoots: [WORKSPACES],
    executarComFerramentas: async ({ executarFerramenta, ferramentas, mensagens }) => {
      assert.match(mensagens[0].content, /resumo final em português simples/)
      assert.match(mensagens[0].content, /no máximo três frases curtas/)
      const finalizar = ferramentas.find((item) => item.function.name === 'finalizar_trabalho')
      assert.equal(finalizar.function.parameters.properties.resumo.maxLength, 600)
      toolsUsadas.push('ler_arquivo')
      const leitura = await executarFerramenta('ler_arquivo', { caminho: 'app.txt' })
      assert.match(leitura.conteudo, /estado=antigo/)
      toolsUsadas.push('substituir_texto')
      await executarFerramenta('substituir_texto', {
        caminho: 'app.txt',
        antigo: 'estado=antigo',
        novo: 'estado=novo',
      })
      toolsUsadas.push('executar_comando')
      const validacao = await executarFerramenta('executar_comando', {
        comando: 'node --version',
      })
      assert.equal(validacao.ok, true)
      await assert.rejects(
        executarFerramenta('executar_comando', { comando: 'codex exec "continue"' }),
        /harness de agente/
      )
      await assert.rejects(
        executarFerramenta('finalizar_trabalho', {
          concluido: true,
          resumo: 'x'.repeat(601),
          evidencias: [],
        }),
        /até 600 caracteres/
      )
      toolsUsadas.push('finalizar_trabalho')
      await executarFerramenta('finalizar_trabalho', {
        concluido: true,
        resumo: 'Estado atualizado e validado.',
        evidencias: ['node --version: passou'],
      })
      return {
        mensagem: 'Concluído.',
        perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
        fallback: null,
      }
    },
  })

  const iniciada = servico.iniciar({ dia, blocoId: 'b-execucao-nativa' })
  const final = await servico.aguardar(iniciada.id)

  assert.equal(final.status, 'concluida')
  assert.equal(fs.readFileSync(path.join(REPO, 'app.txt'), 'utf8'), 'estado=novo\n')
  assert.deepEqual(toolsUsadas, ['ler_arquivo', 'substituir_texto', 'executar_comando', 'finalizar_trabalho'])
  const bloco = lib.obterBloco('b-execucao-nativa', dia)
  assert.equal(bloco.status, 'feito')
  assert.match(bloco.evidencias.join('\n'), /Arquivo alterado: app.txt/)
  assert.match(bloco.evidencias.join('\n'), /passou/)
})

test('executor recusa escrita fora do repositório autorizado', async () => {
  const dia = '2026-08-21'
  lib.criarBloco({
    id: 'b-fuga',
    tipo: 'tarefa',
    titulo: 'Tentar sair da raiz',
    corpo: 'Teste de fronteira.',
    repositorio: REPO,
  }, dia)
  const servico = criarServicoExecutorNativo({
    lib,
    workspaceRoots: [WORKSPACES],
    executarComFerramentas: async ({ executarFerramenta }) => {
      await executarFerramenta('criar_arquivo', { caminho: '../fora.txt', conteudo: 'não' })
      throw new Error('não deveria continuar')
    },
  })

  const iniciada = servico.iniciar({ dia, blocoId: 'b-fuga' })
  const final = await servico.aguardar(iniciada.id)

  assert.equal(final.status, 'falhou')
  assert.equal(final.erro.codigo, 'FORA_DO_REPOSITORIO')
  assert.equal(fs.existsSync(path.join(WORKSPACES, 'fora.txt')), false)
  assert.equal(lib.obterBloco('b-fuga', dia).status, 'fazendo')
})

test('executor limita o resumo mesmo sem a ferramenta de fechamento', async () => {
  const dia = '2026-08-22'
  lib.criarBloco({
    id: 'b-resumo-longo',
    tipo: 'tarefa',
    titulo: 'Produzir fechamento curto',
    corpo: 'Apenas valide o limite do fechamento.',
    repositorio: REPO,
  }, dia)
  const servico = criarServicoExecutorNativo({
    lib,
    workspaceRoots: [WORKSPACES],
    executarComFerramentas: async () => ({
      mensagem: `Resultado principal. ${'detalhe '.repeat(200)}`,
      perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
      fallback: null,
    }),
  })

  const iniciada = servico.iniciar({ dia, blocoId: 'b-resumo-longo' })
  const final = await servico.aguardar(iniciada.id)
  const resumo = final.resultados[0].resumo

  assert.ok(resumo.length <= 600)
  assert.match(resumo, /…$/)
})

test('executor traduz C:/Projetos do Windows para a pasta Linux de projetos', async () => {
  const { candidatosDeRepositorio } = require('../electron/lib-executor-nativo.cjs')
  const traduzido = candidatosDeRepositorio('C:/Projetos/produto', WORKSPACES)
  assert.ok(traduzido.includes('C:/Projetos/produto'))
  if (process.platform !== 'win32') {
    assert.equal(traduzido.includes(REPO), true)
  }

  const dia = '2026-09-05'
  lib.criarBloco({
    id: 'b-caminho-windows',
    tipo: 'tarefa',
    titulo: 'Abrir repositório legado',
    corpo: 'Objetivo: aceitar o caminho do Windows.\n- Confirme o arquivo\nPRONTO = caminho resolvido',
    repositorio: 'C:\\Projetos\\produto',
  }, dia)
  const servico = criarServicoExecutorNativo({
    lib,
    appRoot: path.join(WORKSPACES, 'DailyWork', 'Daily Work app'),
    workspaceRoots: [WORKSPACES],
    executarComFerramentas: async ({ executarFerramenta }) => {
      const leitura = await executarFerramenta('ler_arquivo', { caminho: 'app.txt' })
      assert.match(leitura.conteudo, /estado=/)
      await executarFerramenta('finalizar_trabalho', {
        concluido: true,
        resumo: 'Caminho do Windows resolvido no Linux.',
        evidencias: ['app.txt lido'],
      })
      return {
        mensagem: 'Concluído.',
        perfil: { id: 'grok-4-6', nome: 'Grok 4.6', rota: 'gcli/grok-4.6' },
        fallback: null,
      }
    },
  })

  if (process.platform === 'win32') return
  const iniciada = servico.iniciar({ dia, blocoId: 'b-caminho-windows' })
  const final = await servico.aguardar(iniciada.id)
  assert.equal(final.status, 'concluida')
  assert.equal(lib.obterBloco('b-caminho-windows', dia).status, 'feito')
})
