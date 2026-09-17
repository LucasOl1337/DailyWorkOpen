const { completarComEditor, pautaFixture } = require('./helpers/editorial.cjs')
const { validarPauta } = require('../electron/lib-editor-editorial.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-espelhar-'))
const SKILL = path.join(TMP, 'skills', 'aprendizado-em-post')
fs.mkdirSync(SKILL, { recursive: true })
fs.writeFileSync(path.join(SKILL, 'SKILL.md'), '# Aprendizado em post\nSepare fato observado, tentativa e plano.\n')
after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function criarFilaFake() {
  const itens = []
  return {
    itens,
    listar: async () => itens.slice(),
    obter: async (id) => itens.find((item) => item.id === id) || null,
    criar: async (item) => {
      const criado = { ...item, id: `item-${itens.length + 1}`, revisao: 1, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() }
      itens.push(criado)
      return criado
    },
  }
}

function criarRegistroFake({ imagem = true } = {}) {
  return {
    obterConexao: (id) => ({
      id,
      nome: id,
      esquemaPublicacao: [{ campo: 'texto', tipo: 'textarea', max: 2_000 }],
      capacidades: { publicar: true, midia: { imagem, video: false } },
    }),
  }
}

function criarJobsFake({ autorizarGasto = true } = {}) {
  return {
    iniciados: [],
    configuracao: () => ({ autorizarGasto }),
    aguardar: async id => ({ id, status: 'ready', midias: [{ tipo: 'imagem', arquivo: 'imagem-do-teste.png' }] }),
    iniciar: async (entrada) => {
      const job = { id: `job-${entrada.itemId}`, ...entrada, status: 'planned' }
      criarJobsFake.ultimo = job
      return { job }
    },
  }
}

function completarFake({ contextoUsado = true } = {}) {
  const prompts = []
  const completar = completarComEditor(async ({ mensagens }) => {
    prompts.push(mensagens)
    return { mensagem: JSON.stringify({ texto: 'Versão adaptada e verificável.' }) }
  })
  completar.prompts = prompts
  return completar
}

function criarProducao({ fila, registro, jobsMidias = null, completar } = {}) {
  return criarProducaoEditorial({
    fila: fila || criarFilaFake(),
    registro: registro || criarRegistroFake(),
    lib: { listarBlocos: () => [] },
    completar: completar || completarFake(),
    jobsMidias,
    dataDir: fs.mkdtempSync(path.join(TMP, 'data-')),
    skillsDir: path.join(TMP, 'skills'),
  })
}

function itemBase(extra = {}) {
  return {
    editorial: { pauta: validarPauta(pautaFixture(), 'A fila preserva as fontes e revoga a aprovação quando o texto muda.') },
    pautaId: 'pauta-espelho',
    conta: 'linkedin',
    idioma: 'pt-BR',
    formato: 'texto',
    titulo: 'O DailyWork lê o dia inteiro antes de propor',
    texto: 'Texto original verificável da peça.',
    campos: {},
    midias: [],
    fontes: [{ rotulo: 'Evidência', url: 'https://example.test/e' }],
    origem: { tipo: 'dia', dia: '2026-09-08' },
    estado: 'pendente',
    ...extra,
  }
}

test('espelhar cria versão adaptada no outro idioma, preservando pauta e fontes', async () => {
  const fila = criarFilaFake()
  const original = await fila.criar(itemBase())
  const producao = criarProducao({ fila })
  const espelho = await producao.espelhar(original.id, {})
  assert.equal(espelho.pautaId, original.pautaId)
  assert.equal(espelho.conta, 'linkedin')
  assert.equal(espelho.idioma, 'en')
  assert.equal(espelho.estado, 'pendente')
  assert.equal(espelho.texto, 'Versão adaptada e verificável.')
  assert.deepEqual(espelho.fontes, original.fontes)
  assert.deepEqual(espelho.origem, original.origem)
  assert.equal(fila.itens.length, 2)
})

test('espelhar aceita outra conta e mantém o idioma quando pedido', async () => {
  const fila = criarFilaFake()
  const original = await fila.criar(itemBase())
  const producao = criarProducao({ fila })
  const espelho = await producao.espelhar(original.id, { conta: 'x', idioma: 'pt-BR' })
  assert.equal(espelho.conta, 'x')
  assert.equal(espelho.idioma, 'pt-BR')
})

test('espelhar respeita perfis distintos de redação e revisão', async () => {
  const fila = criarFilaFake()
  const original = await fila.criar(itemBase())
  const perfis = []
  const base = completarComEditor(async () => ({ mensagem: JSON.stringify({ texto: 'Versão adaptada e verificável.' }) }))
  const completar = async entrada => { perfis.push({ perfil: entrada.perfilId, etapa: entrada.mensagens[0].content }); return base(entrada) }
  const producao = criarProducao({ fila, completar })
  await producao.espelhar(original.id, { conta: 'x', idioma: 'pt-BR', perfilId: 'redator-fixture', perfilEditor: 'editor-fixture' })
  assert.ok(perfis.some(chamada => chamada.perfil === 'redator-fixture' && !chamada.etapa.startsWith('ETAPA_EDITORIAL:')))
  assert.ok(perfis.some(chamada => chamada.perfil === 'editor-fixture' && chamada.etapa.startsWith('ETAPA_EDITORIAL: revisao')))
})

test('espelhar recusa mesma conta e idioma, duplicata e item inexistente', async () => {
  const fila = criarFilaFake()
  const original = await fila.criar(itemBase())
  const producao = criarProducao({ fila })
  await assert.rejects(
    () => producao.espelhar(original.id, { conta: 'linkedin', idioma: 'pt-BR' }),
    (erro) => erro.codigo === 'ESPELHO_IDENTICO'
  )
  await producao.espelhar(original.id, {})
  await assert.rejects(
    () => producao.espelhar(original.id, { conta: 'linkedin', idioma: 'en' }),
    (erro) => erro.codigo === 'ESPELHO_DUPLICADO'
  )
  await assert.rejects(
    () => producao.espelhar('item-fantasma', {}),
    (erro) => erro.codigo === 'NAO_ENCONTRADO'
  )
})

test('espelhar valida conta e idioma contra a whitelist', async () => {
  const fila = criarFilaFake()
  const original = await fila.criar(itemBase())
  const producao = criarProducao({ fila })
  await assert.rejects(() => producao.espelhar(original.id, { conta: 'tiktok' }), /conta contém valor inválido/)
  await assert.rejects(() => producao.espelhar(original.id, { idioma: 'es' }), /idioma contém valor inválido/)
})

test('produção em lote dispara mídia automática quando gasto autorizado', async () => {
  const fila = criarFilaFake()
  const jobs = criarJobsFake({ autorizarGasto: true })
  const chamadas = []
  jobs.iniciar = async (entrada) => { chamadas.push(entrada); return { job: { id: `job-${chamadas.length}`, status: 'planned' } } }
  const lib = {
    listarBlocos: (dia) => dia === '2026-09-08'
      ? [{ id: 'b1', titulo: 'Entreguei a fila editorial', corpo: 'Resultado com prova.', status: 'feito', evidencias: ['teste passou'], fontes: [] }]
      : [],
  }
  const producao = criarProducaoEditorial({
    fila,
    registro: criarRegistroFake(),
    lib,
    completar: completarFake(),
    jobsMidias: jobs,
    dataDir: fs.mkdtempSync(path.join(TMP, 'data-')),
    skillsDir: path.join(TMP, 'skills'),
  })
  producao.iniciar({ dia: '2026-09-08', quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  const estado = await new Promise((resolve, reject) => {
    const inicio = Date.now()
    const verificar = () => {
      const atual = producao.estado().producao
      if (['concluida', 'erro'].includes(atual.status)) return resolve(atual)
      if (Date.now() - inicio > 5_000) return reject(new Error('tempo esgotado'))
      setTimeout(verificar, 10)
    }
    verificar()
  })
  assert.equal(estado.status, 'concluida', estado.mensagem)
  assert.equal(fila.itens.length, 1)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].tipo, 'imagem')
  assert.equal(chamadas[0].itemId, fila.itens[0].id)
  assert.equal(chamadas[0].estrategia, 'referencia-real')
})

test('mídia automática com referência real não exige gasto, mas respeita config e suporte', async () => {
  async function rodar({ jobs, registro, configExtra }) {
    const fila = criarFilaFake()
    const lib = {
      listarBlocos: (dia) => dia === '2026-09-08'
        ? [{ id: 'b1', titulo: 'Entreguei a fila editorial', corpo: 'Resultado com prova.', status: 'feito', evidencias: ['teste passou'], fontes: [] }]
        : [],
    }
    const producao = criarProducaoEditorial({
      fila,
      registro: registro || criarRegistroFake(),
      lib,
      completar: completarFake(),
      jobsMidias: jobs,
      dataDir: fs.mkdtempSync(path.join(TMP, 'data-')),
      skillsDir: path.join(TMP, 'skills'),
    })
    if (configExtra) producao.configurar(configExtra)
    producao.iniciar({ dia: '2026-09-08', quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
    await new Promise((resolve, reject) => {
      const inicio = Date.now()
      const verificar = () => {
        const atual = producao.estado().producao
        if (['concluida', 'erro'].includes(atual.status)) return resolve(atual)
        if (Date.now() - inicio > 5_000) return reject(new Error('tempo esgotado'))
        setTimeout(verificar, 10)
      }
      verificar()
    })
    return fila
  }

  const chamadasSemGasto = []
  const jobsSemGasto = criarJobsFake({ autorizarGasto: false })
  jobsSemGasto.iniciar = async (entrada) => { chamadasSemGasto.push(entrada); return { job: { id: 'j', status: 'planned' } } }
  await rodar({ jobs: jobsSemGasto })
  assert.equal(chamadasSemGasto.length, 1)
  assert.equal(chamadasSemGasto[0].estrategia, 'referencia-real')

  const chamadasDesligada = []
  const jobsDesligada = criarJobsFake({ autorizarGasto: true })
  jobsDesligada.iniciar = async (entrada) => { chamadasDesligada.push(entrada); return { job: { id: 'j', status: 'planned' } } }
  await rodar({ jobs: jobsDesligada, configExtra: { midiaAutomatica: false } })
  assert.equal(chamadasDesligada.length, 0)

  const chamadasSemSuporte = []
  const jobsSemSuporte = criarJobsFake({ autorizarGasto: true })
  jobsSemSuporte.iniciar = async (entrada) => { chamadasSemSuporte.push(entrada); return { job: { id: 'j', status: 'planned' } } }
  await rodar({ jobs: jobsSemSuporte, registro: criarRegistroFake({ imagem: false }) })
  assert.equal(chamadasSemSuporte.length, 0)
})

test('espelhar também dispara mídia automática na versão nova', async () => {
  const fila = criarFilaFake()
  const original = await fila.criar(itemBase())
  const chamadas = []
  const jobs = criarJobsFake({ autorizarGasto: true })
  jobs.iniciar = async (entrada) => { chamadas.push(entrada); return { job: { id: 'j-1', status: 'planned' } } }
  const producao = criarProducao({ fila, jobsMidias: jobs })
  const espelho = await producao.espelhar(original.id, {})
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].itemId, espelho.id)
})
