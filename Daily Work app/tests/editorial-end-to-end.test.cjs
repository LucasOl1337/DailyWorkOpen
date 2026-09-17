const { completarComEditor } = require('./helpers/editorial.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')
const { criarJobsMidiasEditoriais } = require('../electron/lib-jobs-midias-editoriais.cjs')
const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')
const { criarConexaoX } = require('../electron/integracoes/x.cjs')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-editorial-e2e-'))
const SKILLS = path.resolve(__dirname, '../skills')
const DIA = '2026-09-08'
const pngFixture = path.join(TMP, 'fixture-editorial.png')
require('node:child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=800x600', '-frames:v', '1', pngFixture])
const PNG = fs.readFileSync(pngFixture)

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function cofreMemoria() {
  const dados = new Map()
  return {
    async guardar(id, valor) { dados.set(id, JSON.parse(JSON.stringify(valor))) },
    async ler(id) { return dados.get(id) ? JSON.parse(JSON.stringify(dados.get(id))) : null },
    async remover(id) { dados.delete(id) },
    async listar() { return [...dados.keys()] },
  }
}

function esperar(fn, limite = 5_000) {
  const inicio = Date.now()
  return new Promise((resolve, reject) => {
    const verificar = () => {
      try {
        const valor = fn()
        if (valor) return resolve(valor)
        if (Date.now() - inicio > limite) return reject(new Error('tempo esgotado'))
        setTimeout(verificar, 10)
      } catch (erro) { reject(erro) }
    }
    verificar()
  })
}

test('produtor real usa redator, fila e registro X reais e publica a revisão exata', async () => {
  const dataDir = path.join(TMP, 'producer')
  const userDataDir = path.join(TMP, 'producer-user')
  const cofre = cofreMemoria()
  await cofre.guardar('x', { accessToken: 'fake-token', usuario: { id: '42', username: 'lucasol', nome: 'Lucas' } })
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url: String(url), init })
    if (String(url).endsWith('/tweets')) return new Response(JSON.stringify({ data: { id: 'post-e2e' } }), { status: 201 })
    throw new Error(`rota X inesperada: ${url}`)
  }
  const conexao = criarConexaoX({ cofre, fetchImpl, dataDir })
  const registro = criarRegistroIntegracoes({ userDataDir, dataDir: path.join(dataDir, 'logs'), conexoes: [conexao] })
  const fila = criarFilaEditorial({ dataDir, registro })
  const prompts = []
  const produtor = criarProducaoEditorial({
    fila,
    registro,
    dataDir,
    skillsDir: SKILLS,
    lib: { listarBlocos: (dia) => dia === DIA ? [{ tipo: 'projeto', titulo: 'Entrega comprovada', corpo: 'Resultado observado no fixture.', status: 'feito', evidencias: ['teste de integração passou'], fontes: [{ rotulo: 'Fixture', url: 'https://example.test/e2e' }] }] : [] },
    completar: completarComEditor(async ({ mensagens }) => { prompts.push(mensagens); return { mensagem: JSON.stringify({ texto: 'Texto exato da versão E2E.' }) } }),
  })
  const inicio = produtor.iniciar({ dia: DIA, quantidade: 1, contas: ['x'], idiomas: ['pt-BR'] })
  assert.equal(inicio.producao.status, 'executando')
  const fim = await esperar(() => { const estado = produtor.estado(); return estado.producao.status === 'executando' ? null : estado })
  assert.equal(fim.producao.status, 'concluida')
  assert.match(prompts[0].map((mensagem) => mensagem.content).join('\n'), /teste de integração passou/)
  const [item] = await fila.listar()
  assert.equal(item.revisao, 1)
  const publicado = await fila.publicar(item.id, { revisao: item.revisao })
  assert.equal(publicado.estado, 'publicado')
  assert.equal(publicado.revisao, 3)
  assert.equal(publicado.recibo.id, 'post-e2e')
  assert.equal(chamadas.filter((chamada) => chamada.url.endsWith('/tweets')).length, 1)
  assert.equal(JSON.parse(chamadas[0].init.body).text, 'Texto exato da versão E2E.')
})

test('job Image Factory prepara com curadoria, anexa PNG verificável e respeita a revisão', async () => {
  const dataDir = path.join(TMP, 'media')
  const registro = { async prepararPublicacao() { throw new Error('não publicar no job') }, async confirmarPublicacao() { throw new Error('não publicar no job') } }
  const fila = criarFilaEditorial({ dataDir, registro })
  const referencia = path.join(dataDir, 'editorial', 'midias', 'referencias', 'entrada.png')
  fs.mkdirSync(path.dirname(referencia), { recursive: true }); fs.writeFileSync(referencia, PNG)
  const item = await fila.criar({ pautaId: 'pauta-media-e2e', conta: 'x', idioma: 'pt-BR', formato: 'texto', titulo: 'Pauta visual', texto: 'Fato para ilustrar.', midias: [{ id: 'referencia', tipo: 'imagem', arquivo: 'midias/referencias/entrada.png', mime: 'image/png' }], fontes: [], origem: { tipo: 'dia', dia: DIA } })
  const factoryRoot = path.join(TMP, 'factory-root')
  const saida = path.join(factoryRoot, 'factory-output.png')
  fs.mkdirSync(factoryRoot, { recursive: true }); fs.writeFileSync(saida, PNG)
  const chamadas = []
  const intencao = { output_purpose: 'information-explainer', output_topology: 'document-page', text_policy: 'required', aspect_ratio: '1:1', consulta: 'editorial explainer page', must_not_infer: ['revenue'], publico: 'pt-BR technical readers' }
  const plano = { id: 'editorial-proof', title: 'Explicador do fato', scene: 'document page', action: 'compose one page', composition: 'single column', camera: 'orthographic', lighting: 'soft', styling: 'technical', palette: '#123456', mood: 'clear', style_direction: 'infographic', aspect_ratio: '1:1', avoid: ['invented metrics'], text_content: 'Fato para ilustrar.' }
  const completar = async ({ mensagens }) => {
    const sistema = String(mensagens[0]?.content || '')
    if (sistema.includes('Decida a intenção visual')) return { mensagem: JSON.stringify(intencao) }
    if (sistema.includes('escolhendo mecanismos visuais')) return { mensagem: JSON.stringify({ case_ids: [494], template_id: '02-charts-infographics/02-json-advanced' }) }
    if (sistema.includes('plano criativo')) return { mensagem: JSON.stringify(plano) }
    throw new Error(`completar inesperado: ${sistema.slice(0, 80)}`)
  }
  const completarComImagens = async ({ mensagens }) => {
    const sistema = String(mensagens[0]?.content || '')
    if (sistema.includes('revisor visual editorial')) return { mensagem: JSON.stringify({ vereditos: [{ provedor: 'grok', accepted: true, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: 'pass', notes: 'fiel à referência' }], vencedor: 'grok' }) }
    if (sistema.includes('plano criativo')) return { mensagem: JSON.stringify(plano) }
    throw new Error(`visão inesperada: ${sistema.slice(0, 80)}`)
  }
  const execFileImpl = async (_executable, args) => {
    chamadas.push(args.slice())
    const operacao = args[1]
    if (operacao === 'casos' && args[2] === 'buscar') return { stdout: JSON.stringify({ ok: true, biblioteca: { results: [{ id: 494, title_pt: 'Infográfico JSON', semantics: { primary_purpose: 'information-explainer', output_topology: 'document-page', text_policy: 'required', target_kinds: ['project'] } }] } }) }
    if (operacao === 'casos') return { stdout: JSON.stringify({ ok: true, casos: [{ id: 494 }] }) }
    if (operacao === 'modelos' && args[2] === 'listar') return { stdout: JSON.stringify({ ok: true, modelos: [{ id: '02-charts-infographics/02-json-advanced', topologia: 'document-page', politica_texto: 'required', propositos_compativeis: ['information-explainer'], tipos_de_alvo: ['project'] }] }) }
    if (operacao === 'modelos') return { stdout: JSON.stringify({ ok: true }) }
    if (operacao === 'disparar') return { stdout: JSON.stringify({ entrega: { grok: { trabalho: 'factory-e2e' } } }) }
    if (operacao === 'acompanhar') return { stdout: JSON.stringify({ trabalho: 'factory-e2e', estado: 'concluido' }) }
    if (operacao === 'receber') return { stdout: JSON.stringify({ trabalho: 'factory-e2e', entrega: { grok: { imagens: [saida] } } }) }
    return { stdout: JSON.stringify({ ok: true }) }
  }
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar, completarComImagens, execFileImpl, imageFactoryRoot: factoryRoot, imageFactoryPython: '/fake/python', imageFactoryScript: '/fake/image-factory.py', pollMs: 1, skillsDir: SKILLS })
  jobs.configurar({ autorizarGasto: true })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', alvo: 'isolated-target', foco: 'e2e-proof', provedores: 'grok', motor: 'factory' })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(pronto.factoryWork, 'factory-e2e')
  assert.equal(chamadas.filter((args) => args[1] === 'disparar').length, 1)
  assert.equal(chamadas.some((args) => args.includes('--autorizar-gasto')), true)
  assert.equal(pronto.revisaoVisual?.vencedor, 'grok')
  const atualizado = await fila.obter(item.id)
  assert.equal(atualizado.formato, 'imagem')
  assert.equal(atualizado.revisao, 2)
  assert.equal(atualizado.midias.length, 1)
  assert.equal(atualizado.midias[0].sha256, crypto.createHash('sha256').update(PNG).digest('hex'))
  const preview = await fila.lerMidia(item.id, atualizado.midias[0].id)
  assert.deepEqual(preview.dados, PNG)
  await assert.rejects(() => jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', alvo: 'isolated-target', foco: 'stale' }), (erro) => erro.codigo === 'REVISAO_OBSOLETA')
})

test('falha de job não chama registro nem anexa artefato', async () => {
  const dataDir = path.join(TMP, 'media-fail')
  let confirmacoes = 0
  const registro = { async prepararPublicacao() { return { proposalId: 'never' } }, async confirmarPublicacao() { confirmacoes += 1; return { id: 'never' } } }
  const fila = criarFilaEditorial({ dataDir, registro })
  const item = await fila.criar({ pautaId: 'pauta-fail', conta: 'x', idioma: 'pt-BR', formato: 'texto', titulo: 'Falha', texto: 'Fixture', fontes: [], origem: { tipo: 'dia', dia: DIA } })
  const pastaRefs = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(pastaRefs, { recursive: true }); fs.writeFileSync(path.join(pastaRefs, 'entrada.png'), PNG)
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar: async () => ({ mensagem: '{}' }), execFileImpl: async () => ({ stdout: JSON.stringify({ ok: true }) }), imageFactoryRoot: path.join(TMP, 'factory-fail'), imageFactoryPython: '/fake/python', imageFactoryScript: '/fake/factory.py', pollMs: 1, skillsDir: SKILLS })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', alvo: 'target', foco: 'fail', motor: 'factory', references: ['midias/refs/entrada.png'] })
  const falhou = await esperar(() => { const job = jobs.obter(iniciado.job.id); return job.status === 'failed' ? job : null })
  assert.equal(falhou.erro.codigo, 'INTENCAO_INVALIDA')
  assert.equal(confirmacoes, 0)
  assert.equal((await fila.obter(item.id)).midias.length, 0)
})
