const { completarComEditor } = require('./helpers/editorial.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-producao-editorial-'))
const SKILLS = path.join(TMP, 'skills')
const SKILL = path.join(SKILLS, 'aprendizado-em-post')
fs.mkdirSync(path.join(SKILL, 'references'), { recursive: true })
fs.writeFileSync(path.join(SKILL, 'SKILL.md'), '# Aprendizado em post\nSepare fato observado, tentativa e plano. Entregue uma tese útil e concreta.\n')
fs.writeFileSync(path.join(SKILL, 'references', 'qualidade.md'), '# Qualidade\nCada afirmação deve apontar para evidência do contexto.\n')

const DIA = '2026-09-08'

test('perfil editorial obsoleto usa o perfil atual sem esconder outras falhas', async () => {
  const { completarComPerfilAtual } = require('../electron/lib-producao-editorial.cjs')
  const chamadas = []
  const completar = completarComPerfilAtual(async entrada => {
    chamadas.push(entrada.perfilId)
    if (entrada.perfilId) throw Object.assign(new Error('perfil antigo'), { codigo: 'PERFIL_NAO_PERMITIDO' })
    return { mensagem: 'ok' }
  })
  assert.equal((await completar({ perfilId: 'perfil-de-outro-provider' })).mensagem, 'ok')
  assert.deepEqual(chamadas, ['perfil-de-outro-provider', undefined])
  await assert.rejects(completarComPerfilAtual(async () => { throw Object.assign(new Error('rede'), { codigo: 'TIMEOUT_9ROUTER' }) })({ perfilId: 'x' }), /rede/)
})

function esperar(fn, limite = 1_000) {
  const inicio = Date.now()
  return new Promise((resolve, reject) => {
    const verificar = () => {
      try {
        const valor = fn()
        if (valor) return resolve(valor)
        if (Date.now() - inicio > limite) return reject(new Error('tempo esgotado'))
        setTimeout(verificar, 5)
      } catch (erro) { reject(erro) }
    }
    verificar()
  })
}

function contextoFake() {
  const blocos = [
    { id: 'b1', titulo: 'Corrigi o recorte de evidências', corpo: 'Resultado: o redator agora preserva fontes e estudos.', status: 'feito', evidencias: ['teste sintético passou'], fontes: [{ rotulo: 'Teste', url: 'https://example.test/evidence' }], projeto: 'dailywork' },
    { id: 'b2', titulo: 'Plano de validar a fila', corpo: 'Tentativa: desenhei o próximo passo de integração.', status: 'pendente', evidencias: [], fontes: [] },
  ]
  const inputs = Array.from({ length: 121 }, (_, indice) => ({ source: 'agente', timestamp: `2026-09-08T00:${String(indice).padStart(2, '0')}:00Z`, text: `entrada ${indice + 1}`, content: indice === 120 ? { url: 'https://example.test/ultimo' } : undefined }))
  return {
    lib: { listarBlocos: (dia) => dia === DIA ? blocos : [] },
    sumario: { obterInputs: () => ({ inputs }) },
    analiseSumario: { obter: () => ({ analysis: { summaryMarkdown: 'Resumo analisado', studies: [{ context: 'Estudo', subject: 'Fontes preservadas', markdown: 'O estudo confirma a origem.' }] } }) },
  }
}

function criarFila() {
  const itens = []
  return {
    itens,
    listar: async () => itens.slice(),
    criar: async (item) => { const criado = { ...item, id: `item-${itens.length + 1}`, revisao: 1, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() }; itens.push(criado); return criado },
  }
}

function criarRegistro() {
  return {
    obterConexao: (id) => ({ id, nome: id, esquemaPublicacao: [{ campo: 'texto', tipo: 'textarea', max: 1_000 }] }),
  }
}

function criarRegistroReal(nome) {
  const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')
  return criarRegistroIntegracoes({
    userDataDir: path.join(TMP, `user-${nome}`),
    dataDir: path.join(TMP, `logs-${nome}`),
    fetchImpl: async () => new Response('{}', { status: 404 }),
    execFileImpl: async () => { throw new Error('gh ausente no teste') },
  })
}

function criarCompletar({ atraso = 0, prompts = [] } = {}) {
  return completarComEditor(async ({ mensagens }) => {
    prompts.push(mensagens)
    if (atraso) await new Promise((resolve) => setTimeout(resolve, atraso))
    return { mensagem: JSON.stringify({ texto: 'Aprendizado verificável da pauta.' }) }
  })
}

function criarRegistroFila() {
  return {
    obterConexao: (id) => ({ id, nome: id, esquemaPublicacao: [{ campo: 'texto', tipo: 'textarea', max: 1_000 }] }),
    async prepararPublicacao() { return { proposalId: 'qa-proposal' } },
    async confirmarPublicacao() { return { id: 'qa-remote' } },
  }
}

function criarFilaPersistente(dataDir, registro = criarRegistroFila()) {
  const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
  return criarFilaEditorial({ dataDir, registro })
}

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('produção automática encontra as fontes verificadas e captura antes de redigir, sem seleção manual de projeto', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'automatico-fontes-verificadas')
  fs.mkdirSync(path.join(dataDir, 'editorial/fontes-projetos'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'editorial/fontes-projetos/painel.json'), JSON.stringify({
    id: 'painel', nome: 'Painel', registro: 'A pessoa construiu um painel para consultar o uso por agente.',
    fontes: [{ rotulo: 'Registro público' }], atividade: [{ hash: 'abcdef0123456789', data: `${DIA}T00:00:00Z` }],
    captura: { executor: 'fixture', ambiente: 'produto-real', capacidade: 'Consultar o uso por agente.', cenas: [{ id: 'painel', descricao: 'Uso por agente.' }] },
  }))
  const eventos = []
  const fila = criarFila()
  const produtor = criarProducaoEditorial({ fila, dataDir, skillsDir: SKILLS,
    lib: { listarBlocos: () => [] },
    registro: { obterConexao: () => ({ capacidades: { midia: { imagem: true } } }) },
    jobsMidias: {
      capturarPauta: async () => { eventos.push('captura'); return { references: [{ arquivo: 'midias/refs/painel.png', descricao: 'Painel inspecionado.', sha256: 'hash-fixture' }] } },
      iniciar: async () => ({ job: { id: 'imagem-fixture' } }), aguardar: async () => ({ status: 'ready', midias: [{ arquivo: 'midias/refs/painel.png' }] }),
    },
    redator: {
      prepararPauta: async entrada => { eventos.push('pauta'); assert.equal(entrada.perfilId, 'grok-4-6'); assert.equal(entrada.referenciasVisuais.length, 1); return { titulo: 'Painel', tese: 'Uso por agente.', evidencias: [], midia: { tipo: 'captura' } } },
      rascunhar: async ({ pautaEditorial }) => { eventos.push('redação'); return { contextoUsado: true, rascunho: { texto: 'O painel reúne o uso por agente.' }, editorial: { pauta: pautaEditorial, qualidade: {} } } },
    },
  })
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(produtor.estado().producao.status, 'concluida', produtor.estado().producao.mensagem)
  assert.equal(fila.itens.length, 1)
  assert.deepEqual(eventos, ['captura', 'pauta', 'redação'])
  // Uma peça mensal já existente representa a mesma fonte na descoberta automática.
  fila.itens[0].pautaId = 'pauta-mes-identidade-anterior'
  fs.unlinkSync(path.join(dataDir, 'editorial/producao-historico.ndjson'))
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(fila.itens.length, 1)
  assert.deepEqual(eventos, ['captura', 'pauta', 'redação'])
})

test('lote aguarda imagem e não registra sucesso se a revisão visual falha', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-imagem-obrigatoria')
  const fila = criarFila()
  let concluir
  const revisaoVisual = new Promise(resolve => { concluir = resolve })
  const produtor = criarProducaoEditorial({ ...contextoFake(), fila,
    registro: { obterConexao: () => ({ capacidades: { midia: { imagem: true } } }) },
    redator: {
      prepararPauta: async entrada => ({ titulo: 'Uma função visível', tese: 'Função', midia: { tipo: 'captura' } }),
      rascunhar: async ({ pautaEditorial }) => ({ contextoUsado: true, rascunho: { texto: 'Post com captura solicitada.' }, editorial: { pauta: pautaEditorial, qualidade: {} } }),
    },
    jobsMidias: { iniciar: async () => ({ job: { id: 'j1' } }), aguardar: async () => revisaoVisual },
    dataDir, skillsDir: SKILLS,
  })
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  await esperar(() => fila.itens.length === 1)
  assert.equal(produtor.estado().producao.status, 'executando', 'o texto sozinho não conclui o lote')
  concluir({ status: 'failed', erro: { codigo: 'REFERENCIA_INADEQUADA', mensagem: 'A função não aparece.' } })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(produtor.estado().producao.status, 'erro')
  assert.match(produtor.estado().producao.mensagem, /função não aparece/)
  const historico = fs.readFileSync(path.join(dataDir, 'editorial/producao-historico.ndjson'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(historico.some(e => e.tipo === 'sucesso'), false)
})

test('produtor captura antes da pauta e preserva ambas as cenas até a escrita', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'captura-antes-da-escrita')
  fs.mkdirSync(path.join(dataDir, 'editorial/fontes-projetos'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'editorial/fontes-projetos/painel.json'), JSON.stringify({ id: 'painel', nome: 'Painel', registro: 'O painel consulta o uso dos agentes por modelo.', fontes: [{ rotulo: 'Documentação' }], atividade: [{ hash: 'abcdef0123456789', data: `${DIA}T00:00:00Z` }], captura: { executor: 'fixture', ambiente: 'produto-real', capacidade: 'Consultar uso por agente.', cenas: [{ id: 'all', descricao: 'Conjunto.' }, { id: 'codex', descricao: 'Detalhe.' }] } }))
  const eventos = []
  const references = ['all', 'codex'].map(id => ({ arquivo: `midias/refs/${id}.png`, descricao: `Painel ${id} inspecionado.`, sha256: `hash-${id}` }))
  const fila = criarFila()
  const produtor = criarProducaoEditorial({ fila, dataDir, skillsDir: SKILLS,
    registro: { obterConexao: () => ({ capacidades: { midia: { imagem: true } } }) },
    jobsMidias: {
      capturarPauta: async pauta => { eventos.push('captura'); assert.equal(pauta.captura.executor, 'fixture'); return { references } },
      iniciar: async () => { eventos.push('anexo'); return { job: { id: 'j1' } } },
      aguardar: async () => ({ status: 'ready', midias: references }),
    },
    redator: {
      prepararPauta: async entrada => { eventos.push('pauta'); assert.deepEqual(entrada.referenciasVisuais, references); return { titulo: 'Painel', tese: 'Uso por agente.', evidencias: [], midia: { tipo: 'captura' } } },
      rascunhar: async ({ pautaEditorial }) => { eventos.push('escrita'); assert.deepEqual(pautaEditorial.midia.referencias, references); return { contextoUsado: true, rascunho: { texto: 'Um painel para consultar os agentes.' }, editorial: { pauta: pautaEditorial, qualidade: {} } } },
    },
  })
  produtor.iniciar({ dia: DIA, desde: DIA, ate: DIA, projetos: ['painel'], contas: ['linkedin'], idiomas: ['pt-BR'], exigirMidia: true, quantidade: 1 })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(produtor.estado().producao.status, 'concluida')
  assert.deepEqual(eventos, ['captura', 'pauta', 'escrita', 'anexo'])
})

test('regeneração explícita de pauta arquivada preserva histórico e não duplica item ativo', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-regenerar')
  const fila = criarFila()
  const produtor = criarProducaoEditorial({ ...contextoFake(), fila, registro: criarRegistro(), completar: criarCompletar(), dataDir, skillsDir: SKILLS })
  const entrada = { dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] }
  const rodar = async extras => { produtor.iniciar({ ...entrada, ...extras }); await esperar(() => produtor.estado().producao.status !== 'executando') }
  await rodar({})
  const pautaId = fila.itens[0].pautaId
  await rodar({ pautaIds: [pautaId], regenerarArquivadas: true })
  assert.equal(fila.itens.length, 1, 'item ativo impede duplicata mesmo com regeneração')
  fila.itens.splice(0)
  await rodar({ pautaIds: [pautaId] })
  assert.equal(fila.itens.length, 0, 'histórico impede repetição na produção normal')
  await rodar({ pautaIds: [pautaId], regenerarArquivadas: true })
  assert.equal(fila.itens.length, 1)
  const historico = fs.readFileSync(path.join(dataDir, 'editorial/producao-historico.ndjson'), 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.tipo === 'sucesso')
  assert.equal(historico.length, 2)
  assert.equal(historico[1].regeneracaoSolicitada, true)
})

test('perfil canônico chega à pauta, escrita e revisão, persiste na peça e atualiza no próximo lote', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const knowledgeDir = path.join(TMP, 'knowledge-perfil')
  fs.mkdirSync(path.join(knowledgeDir, 'Editorial'), { recursive: true })
  const arquivo = path.join(knowledgeDir, 'Editorial', 'perfil-editorial.md')
  const gravarPerfil = versao => fs.writeFileSync(arquivo, `Versão ${versao}\n<!-- preferencias:inicio -->\nFrases claras e imagem simples, edição ${versao}.\n<!-- preferencias:fim -->\nNotas operacionais fora do prompt.`)
  gravarPerfil(7)
  fs.writeFileSync(path.join(knowledgeDir, 'Editorial/referencias.json'), JSON.stringify({ exemplos: [{ id: 'positivo', avaliacao: 'aprovado', texto: 'Uma abertura concreta.\n\nOutra frase, com espaço entre os blocos.' }] }))
  const fila = criarFila()
  const chamadas = []
  const responder = criarCompletar()
  const produtor = criarProducaoEditorial({ ...contextoFake(), fila, registro: criarRegistro(), completar: async entrada => { chamadas.push(entrada); return responder(entrada) }, dataDir: path.join(TMP, 'data-perfil'), skillsDir: SKILLS, knowledgeDir })
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(fila.itens.length, 1)
  const perfil = fila.itens[0].editorial.perfilEditorial
  assert.equal(perfil.versao, 7)
  assert.match(perfil.hash, /^[a-f0-9]{64}$/)
  for (const etapa of ['pauta', 'revisao']) {
    const entrada = chamadas.find(c => c.mensagens[0].content.startsWith(`ETAPA_EDITORIAL: ${etapa}`))
    assert.deepEqual(JSON.parse(entrada.mensagens[1].content).preferencias[0], perfil)
    assert.equal(JSON.parse(entrada.mensagens[1].content).preferencias[0].exemplos[0].texto, 'Uma abertura concreta.\n\nOutra frase, com espaço entre os blocos.')
  }
  const escrita = chamadas.find(c => !c.mensagens[0].content.startsWith('ETAPA_EDITORIAL:'))
  assert.match(escrita.mensagens[1].content, /Frases claras e imagem simples, edição 7/)
  assert.ok(escrita.mensagens[1].content.includes(JSON.stringify(perfil.exemplos[0].texto)))
  assert.doesNotMatch(JSON.stringify(chamadas), /Notas operacionais fora do prompt/)
  gravarPerfil(8)
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(fila.itens.length, 2)
  assert.equal(fila.itens[1].editorial.perfilEditorial.versao, 8)
  assert.notEqual(fila.itens[1].editorial.perfilEditorial.hash, perfil.hash)
  assert.equal(fila.itens[0].editorial.perfilEditorial.versao, 7)
})

test('produção cria versões por pauta, conta e idioma usando análise, evidência e skill', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dados = contextoFake()
  const fila = criarFila()
  const prompts = []
  const produtor = criarProducaoEditorial({ ...dados, fila, registro: criarRegistroReal('real'), completar: criarCompletar({ prompts }), dataDir: path.join(TMP, 'data-1'), skillsDir: SKILLS })
  const inicio = produtor.iniciar({ dia: DIA, quantidade: 2, contas: ['linkedin', 'x'], idiomas: ['pt-BR', 'en'] })
  assert.equal(inicio.producao.status, 'executando')
  const fim = await esperar(() => { const estado = produtor.estado(); return estado.producao.status === 'executando' ? null : estado })
  assert.equal(fim.producao.status, 'concluida')
  assert.equal(fila.itens.length, 8)
  assert.deepEqual(new Set(fila.itens.map((item) => item.idioma)), new Set(['pt-BR', 'en']))
  assert.equal(new Set(fila.itens.map((item) => item.pautaId)).size, 2)
  const contexto = prompts[0].map((mensagem) => mensagem.content).join('\n')
  assert.doesNotMatch(contexto, /Resumo analisado/)
  assert.match(contexto, /preserva fontes e estudos/)
  assert.match(contexto, /use exclusivamente a pauta e as evidências selecionadas acima/)
  assert.doesNotMatch(contexto, /entrada 121/)
  assert.match(contexto, /aprendizado-em-post|Separe fato observado/)
  assert.match(contexto, /https:\/\/example\.test\/evidence/)
  const amostra = fila.itens.find((item) => item.origem?.projeto === 'dailywork')
  assert.ok(amostra)
  assert.equal(amostra.origem.tipo, 'dia')
  assert.equal(amostra.origem.dia, DIA)
  assert.equal(amostra.origem.loteDia, DIA)
  assert.equal(amostra.origem.partes.some((parte) => parte.tipo === 'sumario'), false)
  assert.equal(amostra.origem.partes.some((parte) => parte.tipo === 'analise'), false)
})

test('configuração persiste e histórico evita repetir a mesma combinação', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dados = contextoFake()
  const fila = criarFila()
  const dataDir = path.join(TMP, 'data-2')
  const produtor = criarProducaoEditorial({ ...dados, fila, registro: criarRegistro(), completar: criarCompletar(), dataDir, skillsDir: SKILLS })
  assert.deepEqual(produtor.configurar({ quantidade: 1, contas: ['linkedin'], idiomas: ['en'], estoqueAlvo: 4 }), { ativa: true, quantidade: 1, contas: ['linkedin'], idiomas: ['en'], intervaloMinutos: 30, estoqueAlvo: 4, midiaAutomatica: true, formatoMidia: 'imagem', perfilId: 'grok-4-6' })
  produtor.iniciar({ dia: DIA })
  await esperar(() => produtor.estado().producao.status === 'executando' ? null : produtor.estado())
  assert.equal(fila.itens.length, 1)
  const segundo = criarProducaoEditorial({ ...dados, fila, registro: criarRegistro(), completar: criarCompletar(), dataDir, skillsDir: SKILLS })
  assert.equal(segundo.estado().config.estoqueAlvo, 4)
  segundo.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['en'] })
  await esperar(() => segundo.estado().producao.status === 'executando' ? null : segundo.estado())
  assert.equal(fila.itens.length, 2)
  assert.notEqual(fila.itens[0].pautaId, fila.itens[1].pautaId)
})

test('cancelamento antes do retorno do modelo não enfileira saída posterior', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dados = contextoFake()
  const fila = criarFila()
  const produtor = criarProducaoEditorial({ ...dados, fila, registro: criarRegistro(), completar: criarCompletar({ atraso: 40 }), dataDir: path.join(TMP, 'data-3'), skillsDir: SKILLS })
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  const cancelado = produtor.cancelar()
  assert.equal(cancelado.producao.status, 'cancelada')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(fila.itens.length, 0)
  assert.equal(produtor.estado().producao.status, 'cancelada')
})

test('recupera estado executando órfão quando o lock pertence a processo morto', () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dados = contextoFake()
  const fila = criarFila()
  const dataDir = path.join(TMP, 'data-orphan')
  const editorial = path.join(dataDir, 'editorial')
  fs.mkdirSync(editorial, { recursive: true })
  fs.writeFileSync(path.join(editorial, 'producao-estado.json'), JSON.stringify({ status: 'executando', id: 'lote-antigo', criados: [], erros: [] }))
  const encerrado = require('node:child_process').spawnSync(process.execPath, ['-e', ''])
  assert.equal(encerrado.status, 0)
  fs.writeFileSync(path.join(editorial, 'producao.lock'), JSON.stringify({ pid: encerrado.pid, id: 'lote-antigo' }))
  const produtor = criarProducaoEditorial({ ...dados, fila, registro: criarRegistro(), completar: criarCompletar(), dataDir, skillsDir: SKILLS })
  assert.equal(produtor.estado().producao.status, 'erro')
  assert.equal(produtor.estado().producao.erro.codigo, 'PRODUCAO_ORFA')
})

test('duas instâncias reais preservam o dono do lote e configuração externa', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-concorrencia')
  const registro = criarRegistroFila()
  const fila = criarFilaPersistente(dataDir, registro)
  let liberar
  const esperaModelo = new Promise((resolve) => { liberar = resolve })
  const completar = completarComEditor(async () => { await esperaModelo; return { mensagem: JSON.stringify({ texto: 'versão de teste' }) } })
  const dados = contextoFake()
  const opcoes = { ...dados, fila, registro, completar, dataDir, skillsDir: SKILLS }
  const primeiro = criarProducaoEditorial(opcoes)
  const segundo = criarProducaoEditorial(opcoes)
  const terceiro = criarProducaoEditorial(opcoes)
  const vencedor = primeiro.iniciar({ dia: DIA, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  const perdedor = segundo.iniciar({ dia: DIA, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  const terceiroPacote = terceiro.iniciar({ dia: DIA, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  assert.equal(perdedor.producao.status, 'executando')
  assert.equal(perdedor.producao.id, vencedor.producao.id)
  assert.equal(terceiroPacote.producao.id, vencedor.producao.id)
  segundo.configurar({ ativa: false, perfilId: 'perfil-configurado-em-outra-instancia' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'editorial', 'producao-estado.json'), 'utf8')).id, vencedor.producao.id)
  liberar()
  const fim = await esperar(() => { const estado = primeiro.estado(); return estado.producao.status === 'executando' ? null : estado })
  assert.equal(fim.producao.status, 'concluida')
  assert.equal(primeiro.estado().config.perfilId, 'perfil-configurado-em-outra-instancia')
  assert.equal(primeiro.estado().config.ativa, false)
  assert.equal((await fila.listar()).length, 1)
})

test('lote em que todas as versões falham termina em erro, não em concluído', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const completar = async () => {
    const erro = new Error('O 9Router recusou a autenticação configurada.')
    erro.codigo = 'BLOCKED_AUTH'
    throw erro
  }
  const fila = criarFila()
  const produtor = criarProducaoEditorial({ ...contextoFake(), fila, registro: criarRegistro(), completar, dataDir: path.join(TMP, 'data-lote-vazio'), skillsDir: SKILLS })
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  const fim = await esperar(() => { const estado = produtor.estado(); return estado.producao.status === 'executando' ? null : estado })
  assert.equal(fim.producao.status, 'erro')
  assert.equal(fila.itens.length, 0)
  assert.equal(fim.producao.erros.length > 0, true)
  assert.match(String(fim.producao.erro?.mensagem || fim.producao.erro || ''), /9Router recusou|falharam/)
})

test('cancelamento de outra instância é observado antes de enfileirar', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-cancelamento-remoto')
  const registro = criarRegistroFila()
  const fila = criarFilaPersistente(dataDir, registro)
  let liberar
  const esperaModelo = new Promise((resolve) => { liberar = resolve })
  const completar = async () => { await esperaModelo; return { mensagem: JSON.stringify({ texto: 'não deve entrar na fila' }) } }
  const opcoes = { ...contextoFake(), fila, registro, completar, dataDir, skillsDir: SKILLS }
  const primeiro = criarProducaoEditorial(opcoes)
  const segundo = criarProducaoEditorial(opcoes)
  primeiro.iniciar({ dia: DIA, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  await esperar(() => fs.existsSync(path.join(dataDir, 'editorial', 'producao.lock')))
  assert.equal(segundo.cancelar().producao.status, 'cancelada')
  liberar()
  const fim = await esperar(() => { const estado = primeiro.estado(); return estado.producao.status === 'executando' ? null : estado })
  assert.equal(fim.producao.status, 'cancelada')
  assert.equal((await fila.listar()).length, 0)
})

test('rotina iniciada com produção desativada religa quando a configuração muda', () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-rotina-religar')
  const timers = []
  const produtor = criarProducaoEditorial({
    ...contextoFake(),
    fila: criarFilaPersistente(dataDir),
    registro: criarRegistroFila(),
    completar: criarCompletar(),
    dataDir,
    skillsDir: SKILLS,
    setIntervalImpl: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer },
    clearIntervalImpl: (timer) => { const indice = timers.indexOf(timer); if (indice >= 0) timers.splice(indice, 1) },
  })
  produtor.configurar({ ativa: false, estoqueAlvo: 0 })
  produtor.iniciarRotina()
  assert.equal(timers.length, 0)
  produtor.configurar({ ativa: true })
  assert.equal(timers.length, 1)
  produtor.parar()
  assert.equal(timers.length, 0)
})

test('pauta de acervo mantém identidade entre dias e muda apenas com alteração material', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-acervo-estavel')
  const fila = criarFila()
  const acervo = {
    id: 'ficha-publica', titulo: 'NexARQ', corpo: 'Decisão registrada na ficha pública.',
    status: 'feito', evidencias: ['prova pública'], fontes: [{ rotulo: 'GitHub', url: 'https://github.com/example/nexarq' }],
    origem: { tipo: 'acervo', projeto: 'nexarq' }, tipo: 'projeto',
  }
  const dados = {
    lib: { listarBlocos: (dia) => dia ? [] : [acervo] },
    sumario: { obterInputs: () => ({ inputs: [] }) },
    analiseSumario: { obter: () => ({ analysis: null }) },
  }
  const executar = async (dia) => {
    const produtor = criarProducaoEditorial({ ...dados, fila, registro: criarRegistro(), completar: criarCompletar(), dataDir, skillsDir: SKILLS })
    produtor.iniciar({ dia, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
    return esperar(() => produtor.estado().producao.status === 'executando' ? null : produtor.estado())
  }
  await executar('2026-09-08')
  assert.equal(fila.itens.length, 1)
  assert.equal(fila.itens[0].origem.tipo, 'acervo')
  assert.equal(fila.itens[0].origem.projeto, 'nexarq')
  assert.equal(fila.itens[0].origem.loteDia, '2026-09-08')
  assert.ok(fila.itens[0].origem.partes.some((parte) => parte.tipo === 'ficha-publica'))
  const pautaOriginal = fila.itens[0].pautaId
  await executar('2026-09-09')
  assert.equal(fila.itens.length, 1)
  assert.equal(fila.itens[0].pautaId, pautaOriginal)
  acervo.corpo = 'Decisão materialmente alterada na ficha pública.'
  await executar('2026-09-10')
  assert.equal(fila.itens.length, 2)
  assert.notEqual(fila.itens[1].pautaId, pautaOriginal)
})

test('ranking usa evidência e referência real sem lista fixa de projetos', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-acervo-recente')
  const fila = criarFila()
  const semReferencia = {
    id: 'ficha-arrow', titulo: 'The Last Arrow', corpo: 'Jogo antigo com ficha completa.',
    status: 'feito', evidencias: ['prova antiga'], fontes: [{ rotulo: 'GitHub', url: 'https://github.com/example/the-last-arrow' }],
    origem: { tipo: 'acervo', projeto: 'the-last-arrow' }, tipo: 'projeto',
  }
  const comReferencia = {
    id: 'ficha-projeto-novo', titulo: 'Projeto novo', corpo: 'Produto com prova completa.',
    status: 'feito', evidencias: ['prova 1', 'prova 2'], fontes: [{ rotulo: 'GitHub', url: 'https://github.com/example/projeto-novo' }],
    origem: { tipo: 'acervo', projeto: 'projeto-novo' }, tipo: 'projeto',
  }
  const produtor = criarProducaoEditorial({
    lib: { listarBlocos: (dia) => dia ? [] : [semReferencia, comReferencia] },
    sumario: { obterInputs: () => ({ inputs: [] }) },
    analiseSumario: { obter: () => ({ analysis: null }) },
    fila,
    registro: criarRegistro(),
    completar: criarCompletar(),
    dataDir,
    skillsDir: SKILLS,
  })
  const refs = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(refs, { recursive: true })
  fs.writeFileSync(path.join(refs, 'projeto-novo-fonte.png'), 'fixture')
  produtor.configurar({ midiaAutomatica: false })
  produtor.iniciar({ dia: '2026-09-09', quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status === 'executando' ? null : produtor.estado())
  assert.equal(fila.itens.length, 1)
  assert.equal(fila.itens[0].origem.projeto, 'projeto-novo')
})

test('lote mensal usa fontes por projeto e preserva o registro completo entre seleção, escrita e mídia', async () => {
  const { createHash } = require('node:crypto')
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'mensal')
  fs.mkdirSync(path.join(dataDir, 'editorial/fontes-projetos'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'editorial/midias/refs'), { recursive: true })
  const registro = 'A tela permite organizar uma equipe. O formulário mostrado está vazio e não comprova uma missão executada.'
  const bytes = Buffer.from('captura inspecionada')
  fs.writeFileSync(path.join(dataDir, 'editorial/midias/refs/equipe.png'), bytes)
  fs.writeFileSync(path.join(dataDir, 'editorial/fontes-projetos/equipe.json'), JSON.stringify({ id: 'equipe', nome: 'Equipe', registro, fontes: [{ rotulo: 'Documentação' }], atividade: [{ hash: 'abcdef0123456789', data: '2026-09-01T12:00:00-03:00' }], capturas: [{ arquivo: 'midias/refs/equipe.png', ambiente: 'produto-real', dados: 'reais', descricao: 'Formulário vazio.', sha256: createHash('sha256').update(bytes).digest('hex') }] }))
  const fila = criarFila()
  const chamadas = []
  const produtor = criarProducaoEditorial({ fila, dataDir, skillsDir: SKILLS,
    registro: { obterConexao: () => ({ capacidades: { midia: { imagem: true } } }) },
    redator: {
      prepararPauta: async entrada => { chamadas.push({ ...entrada }); if (chamadas.length === 1) throw Object.assign(new Error('Captura escolhida não fornecida'), { codigo: 'PAUTA_INVALIDA' }); return { titulo: 'Equipe', tese: 'Organização da equipe', evidencias: [{ id: 'e1', trecho: 'A tela permite organizar uma equipe.' }], midia: { tipo: 'captura' } } },
      rascunhar: async entrada => {
        assert.equal(entrada.perfilEditor, 'gpt-5-6-luna')
        assert.ok(entrada.pautaEditorial.evidencias.some(e => e.trecho === registro), 'a revisão recebe também os limites que a seleção resumiu')
        return { contextoUsado: true, rascunho: { texto: 'A equipe é configurada no formulário.' }, editorial: { pauta: entrada.pautaEditorial, qualidade: {} } }
      },
    },
    jobsMidias: {
      iniciar: async entrada => { assert.equal(entrada.perfilVisao, 'gpt-5-6-luna'); return { job: { id: 'midia-equipe' } } },
      aguardar: async () => ({ status: 'ready', midias: [{ id: 'imagem-equipe' }] }),
    },
  })
  const entrada = { dia: DIA, desde: '2026-08-08', ate: DIA, projetos: ['equipe', 'equipe'], contas: ['x'], idiomas: ['pt-BR'], exigirMidia: true, perfilEditor: 'gpt-5-6-luna', perfilVisao: 'gpt-5-6-luna', briefing: 'Uma coisa concreta.' }
  produtor.configurar({ midiaAutomatica: false })
  produtor.iniciar(entrada)
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(fila.itens.length, 1, JSON.stringify(produtor.estado().producao))
  assert.equal(produtor.estado().producao.criados.length, 1)
  assert.equal(chamadas.length, 2, 'uma seleção inválida recebe uma correção de contrato')
  assert.equal(chamadas[0].briefing, entrada.briefing)
  assert.match(chamadas[1].briefing, /nomes exatos dos arquivos/)
  assert.equal(chamadas[0].referenciasVisuais[0].arquivo, 'midias/refs/equipe.png')
  assert.deepEqual(fila.itens[0].editorial.atividade.commits, ['abcdef0123456789'])
  assert.equal(produtor.estado().projetos[0].id, 'equipe')
  produtor.iniciar(entrada)
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(fila.itens.length, 1, 'repetir o mesmo período não duplica a peça')
  assert.equal(produtor.estado().producao.status, 'concluida')
  assert.match(produtor.estado().producao.mensagem, /Nenhuma duplicata/)
})

test('pedido gera pauta com origem pedido e cai para pedido_direto sem evidência', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const dataDir = path.join(TMP, 'data-pedido')
  const fila = criarFila()
  const produtor = criarProducaoEditorial({
    fila,
    dataDir,
    skillsDir: SKILLS,
    registro: criarRegistro(),
    redator: {
      prepararPauta: async () => { throw Object.assign(new Error('sem trecho verificável'), { codigo: 'PAUTA_SEM_EVIDENCIA' }) },
      rascunhar: async ({ contextoExtra, pautaEditorial }) => {
        assert.equal(pautaEditorial, null)
        assert.match(contextoExtra, /Assunto inventado/)
        return { contextoUsado: true, rascunho: { texto: 'Um post pedido por Lucas sobre o assunto.' } }
      },
    },
  })
  produtor.iniciar({ dia: DIA, pedido: { tema: 'Assunto inventado', contexto: 'Quero um post curto sobre isso.' }, contas: ['x'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(produtor.estado().producao.status, 'concluida')
  assert.equal(fila.itens.length, 1)
  assert.equal(fila.itens[0].origem.tipo, 'pedido')
  assert.equal(fila.itens[0].editorial.qualidade.estado, 'pedido_direto')
  assert.match(fila.itens[0].titulo, /Assunto inventado|post pedido/i)
})

test('falha na primeira história não consome a meta nem impede a próxima história', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  const fila = criarFila()
  let escritas = 0
  const produtor = criarProducaoEditorial({ ...contextoFake(), fila, registro: criarRegistro(), dataDir: path.join(TMP, 'meta-entregue'), skillsDir: SKILLS,
    redator: {
      prepararPauta: async ({ titulo }) => ({ titulo, tese: titulo, anguloHash: titulo, midia: { tipo: 'nenhuma' } }),
      rascunhar: async ({ pautaEditorial }) => {
        if (++escritas === 1) throw Object.assign(new Error('Falha transitória na redação.'), { codigo: 'TIMEOUT' })
        return { contextoUsado: true, rascunho: { texto: 'A segunda história foi produzida.' }, editorial: { pauta: pautaEditorial, qualidade: {} } }
      },
    },
  })
  produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(escritas, 2)
  assert.equal(fila.itens.length, 1)
  assert.equal(produtor.estado().producao.historias, 1)
})

test('impedimento sem mudança não repete chamadas e recomeço explícito reavalia', async () => {
  const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
  let avaliacoes = 0
  const produtor = criarProducaoEditorial({ ...contextoFake(), fila: criarFila(), registro: criarRegistro(), dataDir: path.join(TMP, 'impedimentos'), skillsDir: SKILLS,
    redator: { prepararPauta: async () => { avaliacoes++; throw Object.assign(new Error('Falta captura do produto.'), { codigo: 'CAPTURA_NECESSARIA' }) } },
  })
  const entrada = { dia: DIA, quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'] }
  produtor.iniciar(entrada)
  await esperar(() => produtor.estado().producao.status !== 'executando')
  const primeiras = avaliacoes
  assert.ok(primeiras > 0)
  produtor.iniciar(entrada)
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(avaliacoes, primeiras)
  assert.equal(produtor.estado().producao.status, 'sem_pauta')
  produtor.iniciar({ ...entrada, reavaliar: true })
  await esperar(() => produtor.estado().producao.status !== 'executando')
  assert.equal(avaliacoes, primeiras * 2)
})
