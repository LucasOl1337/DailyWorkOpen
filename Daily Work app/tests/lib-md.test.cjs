// Testes da camada de serviço (electron/lib-md.cjs) — node:test, sem deps.
// Roda com: npm test
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Isola os dados em pasta temporária ANTES de carregar o módulo.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-test-'))
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'LucasKnowledge')

fs.mkdirSync(path.join(process.env.LUCAS_KNOWLEDGE_DIR, 'Inteligência Artificial'), {
  recursive: true,
})
fs.mkdirSync(
  path.join(
    process.env.LUCAS_KNOWLEDGE_DIR,
    '.obsidian',
    'plugins',
    'lucas-hierarchy-graph'
  ),
  { recursive: true }
)
fs.writeFileSync(
  path.join(process.env.LUCAS_KNOWLEDGE_DIR, 'LUCAS.md'),
  '# LUCAS\n\n- [[Inteligência Artificial]]\n',
  'utf8'
)
fs.writeFileSync(
  path.join(
    process.env.LUCAS_KNOWLEDGE_DIR,
    'Inteligência Artificial',
    'Inteligência Artificial.md'
  ),
  '---\ntipo: domínio\n---\n\n# Inteligência Artificial\n\nConectado a [[LUCAS]].\n',
  'utf8'
)
fs.writeFileSync(
  path.join(
    process.env.LUCAS_KNOWLEDGE_DIR,
    '.obsidian',
    'plugins',
    'lucas-hierarchy-graph',
    'data.json'
  ),
  JSON.stringify({
    positions: {
      'LUCAS.md': { x: 0, y: -420 },
      'Inteligência Artificial/Inteligência Artificial.md': { x: -380, y: -100 },
    },
  }),
  'utf8'
)

const lib = require('../electron/lib-md.cjs')

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

test('frontmatter: round-trip blocoParaMd -> mdParaBloco', () => {
  const bloco = {
    id: 'b-teste',
    tipo: 'tarefa',
    titulo: 'Teste de round trip',
    status: 'fazendo',
    x: 10,
    y: -20,
    w: 300,
    h: 150,
    conexoes: ['b-outro'],
    corpo: 'corpo em **markdown**',
  }
  const texto = lib.blocoParaMd(bloco)
  const deVolta = lib.mdParaBloco('b-teste.md', texto)
  assert.deepEqual(deVolta, bloco)
})

test('frontmatter: valores inválidos caem nos defaults', () => {
  const bloco = lib.mdParaBloco('x.md', '---\ntipo: invalido\nstatus: estranho\n---\n')
  assert.equal(bloco.tipo, 'nota')
  assert.equal(bloco.status, 'pendente')
})

test('frontmatter: imagem preserva o caminho de mídia', () => {
  const bloco = {
    id: 'b-imagem',
    tipo: 'imagem',
    titulo: 'Tela publicada',
    status: 'feito',
    x: 1,
    y: 2,
    w: 640,
    h: 360,
    midia: 'assets/portfolio/tela-abc.png',
    conexoes: [],
    corpo: 'Evidência visual.',
  }
  assert.deepEqual(lib.mdParaBloco('b-imagem.md', lib.blocoParaMd(bloco)), bloco)
})

test('CRUD de bloco: criar, obter, atualizar, excluir', () => {
  const criado = lib.criarBloco({ titulo: 'Bloco CRUD', tipo: 'projeto' })
  assert.ok(criado.id.startsWith('b-'))
  assert.equal(criado.titulo, 'Bloco CRUD')

  const obtido = lib.obterBloco(criado.id)
  assert.equal(obtido.titulo, 'Bloco CRUD')

  const atualizado = lib.atualizarBloco(criado.id, { status: 'feito', corpo: 'concluído' })
  assert.equal(atualizado.status, 'feito')
  assert.equal(atualizado.corpo, 'concluído')
  assert.equal(atualizado.titulo, 'Bloco CRUD') // patch não apaga outros campos

  assert.equal(lib.excluirBloco(criado.id), true)
  assert.equal(lib.obterBloco(criado.id), null)

  // soft-delete: foi para _arquivo, não sumiu
  const arquivados = fs.readdirSync(path.join(TMP, 'data', '_arquivo'))
  assert.ok(arquivados.some((n) => n.endsWith(`${criado.id}.md`)))
})

test('obter/atualizar/excluir com id inexistente não explode', () => {
  assert.equal(lib.obterBloco('b-inexistente'), null)
  assert.equal(lib.atualizarBloco('b-inexistente', { titulo: 'x' }), null)
  assert.equal(lib.excluirBloco('b-inexistente'), false)
})

test('salvarSnapshot: reconcilia (cria novos, arquiva ausentes)', () => {
  const a = lib.criarBloco({ titulo: 'A' })
  const b = lib.criarBloco({ titulo: 'B' })
  const resultado = lib.salvarSnapshot([{ ...a, titulo: 'A editado' }])
  assert.deepEqual(resultado.diff.atualizar, [a.id])
  assert.deepEqual(resultado.diff.arquivar, [b.id])
  assert.equal(lib.obterBloco(a.id).titulo, 'A editado')
  assert.equal(lib.obterBloco(b.id), null)
})

test('salvarSnapshot vazio é ignorado (proteção contra perda de dados)', () => {
  const c = lib.criarBloco({ titulo: 'Sobrevivente' })
  const resultado = lib.salvarSnapshot([])
  assert.equal(resultado.ignorado, true)
  assert.notEqual(lib.obterBloco(c.id), null) // continua no disco
  lib.excluirBloco(c.id)
})

test('salvarSnapshot com dry=true devolve diff sem gravar', () => {
  const d = lib.criarBloco({ titulo: 'D' })
  const antes = lib.obterBloco(d.id)
  const resultado = lib.salvarSnapshot([{ ...d, titulo: 'D mudado' }, { id: 'b-novo', titulo: 'Novo' }], {
    dry: true,
  })
  assert.equal(resultado.dry, true)
  assert.deepEqual(resultado.diff.atualizar, [d.id])
  assert.deepEqual(resultado.diff.criar, ['b-novo'])
  assert.deepEqual(lib.obterBloco(d.id), antes) // nada mudou no disco
  assert.equal(lib.obterBloco('b-novo'), null)
  lib.excluirBloco(d.id)
})

test('salvarSnapshot idêntico não regrava arquivos nem polui auditoria', () => {
  const bloco = lib.criarBloco({ id: 'b-snapshot-inalterado', titulo: 'Sem mudança' })
  const arquivo = path.join(process.env.DAILYWORK_DATA_DIR, `${bloco.id}.md`)
  const log = path.join(process.env.DAILYWORK_DATA_DIR, '_log.ndjson')
  const mtimeAntes = fs.statSync(arquivo).mtimeMs
  const bytesLogAntes = fs.statSync(log).size

  const resultado = lib.salvarSnapshot(lib.listarBlocos())

  assert.equal(resultado.inalterado, true)
  assert.equal(fs.statSync(arquivo).mtimeMs, mtimeAntes)
  assert.equal(fs.statSync(log).size, bytesLogAntes)
  lib.excluirBloco(bloco.id)
})

test('sessões: criar, salvar, carregar, excluir', () => {
  lib.criarSessao('teste-sessao')
  assert.deepEqual(lib.listarSessoes(), ['teste-sessao'])
  assert.equal(lib.carregarSessao('teste-sessao'), null) // recém-criada é vazia

  const snapshot = { schema: {}, records: [{ id: 'shape:x' }] }
  lib.salvarSessao('teste-sessao', snapshot)
  assert.deepEqual(lib.carregarSessao('teste-sessao'), snapshot)

  lib.excluirSessao('teste-sessao')
  assert.deepEqual(lib.listarSessoes(), [])
})

test('dias: blocos ficam isolados do Principal e de outros dias', () => {
  lib.criarBloco({ id: 'b-mesmo-id', titulo: 'Geral' })
  lib.criarBloco({ id: 'b-mesmo-id', titulo: 'Dia 24' }, '2026-07-24')
  lib.criarBloco({ id: 'b-outro-dia', titulo: 'Dia 25' }, '2026-07-25')

  assert.equal(lib.obterBloco('b-mesmo-id').titulo, 'Geral')
  assert.equal(lib.obterBloco('b-mesmo-id', '2026-07-24').titulo, 'Dia 24')
  assert.deepEqual(lib.listarDias(), ['2026-07-24', '2026-07-25'])

  lib.excluirBloco('b-mesmo-id', '2026-07-24')
  assert.equal(lib.obterBloco('b-mesmo-id', '2026-07-24'), null)
  assert.equal(lib.obterBloco('b-mesmo-id').titulo, 'Geral')
  lib.excluirBloco('b-mesmo-id')
  lib.excluirBloco('b-outro-dia', '2026-07-25')
})

test('dias: sessão diária legada é convertida uma vez para Markdown', () => {
  lib.criarSessao('dia-2026-07-23')
  lib.salvarSessao('dia-2026-07-23', {
    document: {
      store: {
        'page:page': { id: 'page:page', typeName: 'page' },
        'shape:b-legado': {
          id: 'shape:b-legado',
          typeName: 'shape',
          type: 'geo',
          x: 10,
          y: 20,
          props: { w: 300, h: 180 },
          meta: {
            blockId: 'b-legado',
            tipo: 'tarefa',
            titulo: 'Trabalho do dia 23',
            status: 'feito',
            corpo: 'Preservado do snapshot.',
          },
        },
      },
    },
  })

  const blocos = lib.listarBlocos('2026-07-23')
  assert.equal(blocos.length, 1)
  assert.equal(blocos[0].titulo, 'Trabalho do dia 23')
  assert.ok(fs.existsSync(path.join(TMP, 'data', 'dias', '2026-07-23', 'b-legado.md')))
  assert.ok(fs.existsSync(path.join(TMP, 'sessoes', 'dia-2026-07-23.tldr')))
})

test('auditoria: mutações registram em data/_log.ndjson', () => {
  const logPath = path.join(TMP, 'data', '_log.ndjson')
  assert.ok(fs.existsSync(logPath))
  const linhas = fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  const acoes = linhas.map((l) => l.acao)
  assert.ok(acoes.includes('bloco:criar'))
  assert.ok(acoes.includes('bloco:excluir'))
  assert.ok(acoes.includes('snapshot:salvo'))
  assert.ok(acoes.includes('snapshot:dry-run'))
  assert.ok(linhas.every((l) => typeof l.ts === 'string'))
})

test('portfólio: mídia é persistida por hash e pode ser relida', () => {
  const entrada = {
    nome: 'Tela real.png',
    mimeType: 'image/png',
    base64: Buffer.from('png-de-teste').toString('base64'),
  }
  const primeira = lib.salvarMidiaPortfolio(entrada)
  const segunda = lib.salvarMidiaPortfolio(entrada)
  assert.equal(primeira.caminho, segunda.caminho)
  assert.equal(primeira.bytes, Buffer.from(entrada.base64, 'base64').length)
  assert.ok(primeira.caminho.startsWith('assets/portfolio/tela-real-'))
  assert.equal(lib.lerMidiaPortfolio(primeira.caminho), primeira.dataUrl)
  assert.equal(lib.lerMidiaPortfolio('../fora.png'), null)
})

test('snapshot preserva tipo e caminho de uma imagem já persistida', () => {
  lib.criarBloco({
    id: 'imagem-segura',
    tipo: 'imagem',
    titulo: 'Prova visual',
    status: 'feito',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    midia: 'assets/portfolio/prova-hash.png',
    conexoes: [],
    corpo: '',
  })
  lib.salvarSnapshot([
    {
      id: 'imagem-segura',
      tipo: 'nota',
      titulo: 'Prova visual',
      status: 'feito',
      x: 10,
      y: 20,
      w: 400,
      h: 300,
      conexoes: [],
      corpo: '',
    },
  ])
  const depois = lib.obterBloco('imagem-segura')
  assert.equal(depois.tipo, 'imagem')
  assert.equal(depois.midia, 'assets/portfolio/prova-hash.png')
})

test('conhecimento: lista hierarquia, resolve wikilinks e lê a fonte', () => {
  const catalogo = lib.listarConhecimento()
  assert.equal(catalogo.disponivel, true)
  assert.equal(catalogo.notas.length, 2)
  const lucas = catalogo.notas.find((nota) => nota.caminho === 'LUCAS.md')
  assert.deepEqual(lucas.links, ['Inteligência Artificial/Inteligência Artificial.md'])
  assert.deepEqual(lucas.posicao, { x: 0, y: -420 })

  const nota = lib.obterNotaConhecimento('Inteligência Artificial/Inteligência Artificial.md')
  assert.equal(nota.titulo, 'Inteligência Artificial')
  assert.match(nota.corpo, /Conectado a/)
  assert.equal(typeof nota.etag, 'string')
})

test('conhecimento: escrita exige etag e cria backup recuperável', () => {
  const caminho = 'Inteligência Artificial/Inteligência Artificial.md'
  const antes = lib.obterNotaConhecimento(caminho)
  const conteudo = `${antes.conteudo.trim()}\n\nAtualizado pelo teste.\n`
  const depois = lib.salvarNotaConhecimento(caminho, conteudo, antes.etag)
  assert.match(depois.conteudo, /Atualizado pelo teste/)
  assert.notEqual(depois.etag, antes.etag)
  assert.throws(
    () => lib.salvarNotaConhecimento(caminho, 'conteúdo concorrente', antes.etag),
    /CONFLITO/
  )
  const backups = fs.readdirSync(path.join(TMP, 'data', '_arquivo', 'conhecimento'))
  assert.ok(backups.some((nome) => nome.endsWith('Inteligência Artificial.md')))
})

test('conhecimento: a nota raiz LUCAS.md permanece imutável', () => {
  const raiz = lib.obterNotaConhecimento('LUCAS.md')
  assert.throws(
    () => lib.salvarNotaConhecimento('LUCAS.md', `${raiz.conteudo}\n`, raiz.etag),
    /imutável/
  )
})

test('contexto do Principal reúne portfólio e conhecimento para planejar dias', () => {
  lib.criarBloco({ id: 'b-portfolio', tipo: 'projeto', titulo: 'DailyWork' })
  const contexto = lib.contextoPrincipal()
  assert.ok(contexto.portfolio.some((bloco) => bloco.id === 'b-portfolio'))
  assert.equal(contexto.conhecimento.total, 2)
  assert.equal(contexto.conhecimento.disponivel, true)
  lib.excluirBloco('b-portfolio')
})

test('metadados semânticos sobrevivem ao ciclo Markdown sem perder listas', () => {
  const original = {
    id: 'b-semantico',
    tipo: 'tarefa',
    titulo: 'Validar release',
    status: 'fazendo',
    x: 10,
    y: 20,
    w: 300,
    h: 180,
    conexoes: ['b-decisao'],
    corpo: 'Objetivo: validar a release.\n\nPRONTO = evidência registrada.',
    papel: 'front',
    projeto: 'sfr',
    fase: 'validate',
    origem: 'context-pack',
    responsavel: 'codex',
    repositorio: 'C:/NexUnio/sft-resgate-digital',
    branch: 'LucasOl-SFT',
    worktree: 'C:/NexUnio/sft-resgate-digital',
    carryoverDe: 'b-ontem',
    concluidoEm: '2026-08-11T18:00:00-03:00',
    fontes: ['workspace:sfr', 'dailywork:2026-08-10/b-ontem'],
    evidencias: ['test:npm-test', 'artifact:pdf-real'],
    bloqueadoPor: ['b-decisao'],
  }

  const restaurado = lib.mdParaBloco('b-semantico.md', lib.blocoParaMd(original))

  assert.deepEqual(restaurado, original)
})

test('conhecimento: salva e remove posições personalizadas no mapa', () => {
  const caminho = 'Inteligência Artificial/Inteligência Artificial.md'
  const resSalvar = lib.salvarPosicoesConhecimento({ [caminho]: { x: 550, y: -220 } })
  assert.equal(resSalvar.ok, true)
  assert.deepEqual(resSalvar.positions[caminho], { x: 550, y: -220 })

  const listado = lib.listarConhecimento()
  const nota = listado.notas.find((n) => n.caminho === caminho)
  assert.equal(nota.noMapa, true)
  assert.deepEqual(nota.posicao, { x: 550, y: -220 })

  const resRemover = lib.removerPosicaoConhecimento(caminho)
  assert.equal(resRemover.ok, true)
  const listadoAposRemover = lib.listarConhecimento()
  const notaAposRemover = listadoAposRemover.notas.find((n) => n.caminho === caminho)
  assert.equal(notaAposRemover.noMapa, false)
})

test('conhecimento: arquiva nota com segurança movendo para _arquivo', () => {
  const caminho = 'Inteligência Artificial/Inteligência Artificial.md'
  assert.throws(() => lib.excluirNotaConhecimento('LUCAS.md'), /LUCAS\.md/)

  const res = lib.excluirNotaConhecimento(caminho)
  assert.equal(res, true)
  assert.equal(lib.obterNotaConhecimento(caminho), null)

  const backupDir = path.join(TMP, 'data', '_arquivo', 'conhecimento')
  const arquivos = fs.readdirSync(backupDir)
  assert.ok(arquivos.some((n) => n.includes('Inteligência Artificial.md')))
})


test('watcher de data/ só recarrega canvases para .md de bloco', () => {
  for (const nome of ['abc.md', 'dias/2026-10-23/abc.md', 'dias\\2026-10-23\\abc.md', null, '']) {
    assert.equal(lib.ehArquivoDeBloco(nome), true, String(nome))
  }
  for (const nome of ['_log.ndjson', 'principal-canvas.json', 'editorial/itens/x.json', 'editorial/media-jobs/j/notas.md', 'sumarios/2026-10-23/x.md', 'dias/2026-10-23/_arquivo/abc.md', '_arquivo/abc.md']) {
    assert.equal(lib.ehArquivoDeBloco(nome), false, nome)
  }
})
