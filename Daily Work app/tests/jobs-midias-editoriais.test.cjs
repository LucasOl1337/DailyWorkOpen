const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
const { criarJobsMidiasEditoriais } = require('../electron/lib-jobs-midias-editoriais.cjs')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-media-jobs-'))
const registro = { prepararPublicacao: async () => { throw new Error('não publica no teste') }, confirmarPublicacao: async () => { throw new Error('não publica no teste') } }
after(() => fs.rmSync(TMP, { recursive: true, force: true }))

async function esperar(fn, limite = 5_000) {
  const inicio = Date.now()
  while (Date.now() - inicio < limite) { const valor = fn(); if (valor) return valor; await new Promise((resolve) => setTimeout(resolve, 10)) }
  throw new Error('tempo esgotado')
}
async function filaComItem(nome) {
  const dataDir = path.join(TMP, nome)
  const fila = criarFilaEditorial({ dataDir, registro })
  const item = await fila.criar({ pautaId: 'pauta-media', conta: 'linkedin', idioma: 'pt-BR', formato: 'texto', titulo: 'Pauta de mídia', texto: 'Texto que permanece na revisão.', campos: {}, fontes: [{ rotulo: 'fixture', url: 'https://example.test' }], origem: { tipo: 'dia', dia: '2026-09-08' } })
  return { dataDir, fila, item }
}

test('job de mini vitrine executa compose fixture, valida e anexa na fila real', async () => {
  const { dataDir, fila, item } = await filaComItem('video')
  const source = path.join(TMP, 'source.mp4'); const poster = path.join(TMP, 'source.jpg')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, '-frames:v', '1', poster])
  const copiar = path.join(TMP, 'compose-fixture.cjs')
  fs.writeFileSync(copiar, `const fs=require('fs'),path=require('path');const out=path.dirname(process.argv[2]);fs.copyFileSync(${JSON.stringify(source)},path.join(out,'video.mp4'));fs.copyFileSync(${JSON.stringify(poster)},path.join(out,'poster.jpg'))`)
  const roteiro = path.join(TMP, 'roteiro.json'); fs.writeFileSync(roteiro, JSON.stringify({ out: 'video.mp4' }))
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, vitrinePython: process.execPath, vitrineCompose: copiar, pollMs: 10 })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'video', roteiroFile: roteiro, source, poster })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return job.status === 'ready' || job.status === 'failed' ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  const atualizado = await fila.obter(item.id)
  assert.equal(atualizado.formato, 'video')
  assert.equal(atualizado.midias.length, 1)
  assert.equal(atualizado.midias[0].tipo, 'video')
  assert.equal(atualizado.midias[0].arquivo.startsWith('midias/'), true)
  assert.equal(new Set(atualizado.midias.map((midia) => midia.tipo)).size, 1)
})

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
// Arquivo decodificável no tamanho editorial; os testes de conteúdo usam um
// revisor injetado. O pixel isolado só serve para o caso negativo de resolução.
const pngFixture = path.join(TMP, 'fixture-editorial.png')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=800x600', '-frames:v', '1', pngFixture])
const PNG_EDITORIAL = fs.readFileSync(pngFixture)

test('sequência revisa as duas cenas juntas e anexa todas em ordem à fila real', async () => {
  const { dataDir, fila, item } = await filaComItem('sequencia-real')
  const references = ['all', 'codex'].map(nome => {
    const arquivo = `midias/refs/${nome}.png`
    fs.mkdirSync(path.dirname(path.join(dataDir, 'editorial', arquivo)), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'editorial', arquivo), PNG_EDITORIAL)
    return arquivo
  })
  let inspecionadas = 0
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar: async () => { throw Error('Sem geração') }, completarComImagens: async ({ mensagens, imagens }) => {
    inspecionadas = imagens.length
    const saidas = JSON.parse(mensagens[1].content).saidas
    return JSON.stringify({ vencedor: saidas[0], vereditos: saidas.map(provedor => ({ provedor, accepted: true, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: 'pass' })) })
  } })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', estrategia: 'referencia-real', sequencia: true, references })
  const final = await jobs.aguardar(iniciado.job.id)
  assert.equal(final.status, 'ready', final.erro?.mensagem)
  assert.equal(inspecionadas, 2)
  const atualizado = await fila.obter(item.id)
  assert.equal(atualizado.midias.length, 2)
  assert.match(atualizado.midias[0].arquivo, /cena-1/)
  assert.match(atualizado.midias[1].arquivo, /cena-2/)
  assert.equal(atualizado.revisao, 2)
})

test('uma cena reprovada impede anexar uma sequência incompleta', async () => {
  const { dataDir, fila, item } = await filaComItem('sequencia-reprovada')
  const refs = ['all', 'codex'].map(nome => {
    const arquivo = `midias/refs/${nome}.png`
    fs.mkdirSync(path.dirname(path.join(dataDir, 'editorial', arquivo)), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'editorial', arquivo), PNG_EDITORIAL)
    return arquivo
  })
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar: async () => '', completarComImagens: async () => JSON.stringify({ vencedor: 'cena-1', vereditos: ['cena-1', 'cena-2'].map((provedor, i) => ({ provedor, accepted: i === 0, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: i ? 'fail' : 'pass', notes: i ? 'Detalhe ilegível.' : 'Visão geral legível.' })) }) })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', estrategia: 'referencia-real', sequencia: true, references: refs })
  assert.equal((await jobs.aguardar(iniciado.job.id)).status, 'failed')
  assert.equal((await fila.obter(item.id)).midias.length, 0)
})

function fakesCuradoria({ revisoes }) {
  let chamadasRevisao = 0
  const intencao = { output_purpose: 'concept-development', output_topology: 'single-frame', text_policy: 'optional', aspect_ratio: '4:5', consulta: 'editorial evidence object', must_not_infer: ['revenue'], publico: 'pt-BR technical readers', justificativa: 'teste' }
  const selecao = { case_ids: [261], template_id: '02-charts-infographics/01-standard', raciocinio: 'mecanismo compatível' }
  const plano = { id: 'editorial-proof', title: 'Prova editorial', scene: 'A single evidence object on a desk.', action: 'The object rests.', composition: 'Centered.', camera: '50mm, straight on.', lighting: 'Soft studio.', styling: 'Editorial.', palette: 'ink on paper', mood: 'calm', style_direction: 'precise', aspect_ratio: '4:5', avoid: ['invented claims'], text_content: '' }
  const completar = async ({ mensagens }) => {
    const sistema = String(mensagens[0]?.content || '')
    if (sistema.includes('Decida a intenção visual')) return { mensagem: JSON.stringify(intencao) }
    if (sistema.includes('escolhendo mecanismos visuais')) return { mensagem: JSON.stringify(selecao) }
    if (sistema.includes('plano criativo')) return { mensagem: JSON.stringify(plano) }
    throw new Error(`completar inesperado: ${sistema.slice(0, 90)}`)
  }
  const completarComImagens = async ({ mensagens }) => {
    const sistema = String(mensagens[0]?.content || '')
    // A revisão menciona "plano criativo" no prompt; despacha ela primeiro.
    if (sistema.includes('revisor visual editorial')) {
      const revisao = revisoes[Math.min(chamadasRevisao, revisoes.length - 1)]
      chamadasRevisao += 1
      return { mensagem: JSON.stringify(revisao) }
    }
    if (sistema.includes('plano criativo')) return { mensagem: JSON.stringify(plano) }
    throw new Error(`visão inesperada: ${sistema.slice(0, 90)}`)
  }
  return { completar, completarComImagens }
}

const REVISAO_CODEX_VENCE = { vereditos: [
  { provedor: 'grok', accepted: false, identity_fidelity: 'not-applicable', topology: 'pass', text: 'not-applicable', intent_alignment: 'fail', notes: 'composição aquém do plano' },
  { provedor: 'codex', accepted: true, identity_fidelity: 'not-applicable', topology: 'pass', text: 'not-applicable', intent_alignment: 'pass', notes: 'nítida e fiel à pauta' },
], vencedor: 'codex' }
const REVISAO_REPROVA = { vereditos: [
  { provedor: 'grok', accepted: false, identity_fidelity: 'not-applicable', topology: 'fail', text: 'fail', intent_alignment: 'fail', notes: 'texto riscado e ilegível' },
  { provedor: 'codex', accepted: false, identity_fidelity: 'not-applicable', topology: 'fail', text: 'fail', intent_alignment: 'pass', notes: 'caracteres quebrados no rótulo' },
], vencedor: null }

function execFactoryFake({ factoryRoot, chamadas }) {
  for (const nome of ['grok.png', 'codex.png']) fs.writeFileSync(path.join(factoryRoot, nome), PNG_EDITORIAL)
  return async (executable, args) => {
    chamadas.push(args.slice())
    const op = args[1]
    const sub = args[2]
    if (op === 'casos' && sub === 'buscar') return { stdout: JSON.stringify({ ok: true, biblioteca: { results: [{ id: 261, title_pt: 'Objeto de evidência', category: 'UI', semantics: { primary_purpose: 'concept-development', output_topology: 'single-frame', text_policy: 'optional', target_kinds: ['project'], risk_flags: [] } }, { id: 262, title_pt: 'Outro mecanismo', semantics: {} }] } }) }
    if (op === 'casos' && sub === 'ver') return { stdout: JSON.stringify({ ok: true, casos: [{ id: 261, dna: 'mecanismo' }] }) }
    if (op === 'modelos' && sub === 'listar') return { stdout: JSON.stringify({ ok: true, modelos: [{ id: '02-charts-infographics/01-standard', titulo_pt: 'Infográfico educativo', topologia: 'single-frame', politica_texto: 'optional', propositos_compativeis: ['concept-development'], tipos_de_alvo: ['project'] }] }) }
    if (op === 'modelos' && sub === 'ver') return { stdout: JSON.stringify({ ok: true, modelo: { id: '02-charts-infographics/01-standard' } }) }
    if (op === 'disparar') return { stdout: JSON.stringify({ trabalho: `factory-${chamadas.filter((args2) => args2[1] === 'disparar').length}`, estado: 'disparando' }) }
    if (op === 'acompanhar') return { stdout: JSON.stringify({ estado: 'concluido' }) }
    if (op === 'receber') return { stdout: JSON.stringify({ entrega: { grok: { imagens: [path.join(factoryRoot, 'grok.png')] }, codex: { imagens: [path.join(factoryRoot, 'codex.png')] } } }) }
    return { stdout: JSON.stringify({ ok: true }) }
  }
}

function jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes }) {
  const { completar, completarComImagens } = fakesCuradoria({ revisoes })
  const jobs = criarJobsMidiasEditoriais({
    fila,
    dataDir,
    completar,
    completarComImagens,
    execFileImpl: execFactoryFake({ factoryRoot, chamadas }),
    imageFactoryPython: '/venv/python',
    imageFactoryScript: '/factory/cli.py',
    imageFactoryRoot: factoryRoot,
    pollMs: 1,
    capturarUrl: null,
    portfolioDir: path.join(dataDir, 'sem-portfolio'),
    acervoDir: path.join(dataDir, 'sem-acervo'),
  })
  jobs.configurar({ autorizarGasto: true })
  return jobs
}

function aceitarImagem(provedor) {
  return { mensagem: JSON.stringify({ vereditos: [{ provedor, accepted: true, identity_fidelity: 'pass', topology: 'pass', text: 'not-applicable', intent_alignment: 'pass', notes: 'fixture de contrato' }], vencedor: provedor }) }
}

test('imagem do Codex importada passa pela visão com a referência original, sem gerar nem gastar', async () => {
  const { dataDir, fila, item } = await filaComItem('importada')
  let entradaVisao
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, capturarUrl: null,
    completar: async () => { throw Error('não deve redigir nem gerar ao importar') },
    completarComImagens: async entrada => { entradaVisao = entrada; return aceitarImagem('imagem-importada') },
  })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', imagemBase64: PNG_EDITORIAL.toString('base64'), references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const j = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(j.status) && j })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(pronto.autorizarGasto, false)
  assert.equal(pronto.params.imagemBase64, undefined)
  assert.equal(entradaVisao.imagens.length, 2)
  assert.equal(entradaVisao.imagens[0].nome, 'entrada.png')
  assert.equal(entradaVisao.imagens[1].nome, 'saida-imagem-importada')
  assert.equal((await fila.obter(item.id)).midias.length, 1)
})

test('direção editorial gera e revisa sem biblioteca ou Python da Factory', async () => {
  const { dataDir, fila, item } = await filaComItem('direcao-editorial')
  const { completar, completarComImagens } = fakesCuradoria({ revisoes: [REVISAO_CODEX_VENCE] })
  let geracoes = 0
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar, completarComImagens,
    capturarUrl: null, portfolioDir: path.join(dataDir, 'ausente'), acervoDir: path.join(dataDir, 'ausente'),
    execFileImpl: async () => { throw Error('não deve usar Factory') },
    gerarImagemCli: { gerar: async ({ provedor, dest }) => { geracoes++; assert.equal(provedor, 'codex'); fs.writeFileSync(dest, PNG_EDITORIAL); return { path: dest, modelo: 'fixture' } } },
  })
  jobs.configurar({ autorizarGasto: true })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', estrategia: 'editorial' })
  const pronto = await esperar(() => { const j = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(j.status) && j })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(pronto.revisaoVisual.motor, 'editorial')
  assert.equal(geracoes, 1)
  assert.equal((await fila.obter(item.id)).midias.length, 1)
})

test('edição ou cancelamento durante a revisão visual impede anexo à versão errada', async () => {
  for (const acao of ['editar', 'cancelar']) {
    const { dataDir, fila, item } = await filaComItem(`importada-${acao}`)
    let liberar, entrou = false
    const jobs = criarJobsMidiasEditoriais({ fila, dataDir, capturarUrl: null,
      completar: async () => { throw Error('só visão') },
      completarComImagens: async () => { entrou = true; await new Promise(r => { liberar = r }); return aceitarImagem('imagem-importada') },
    })
    const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', imagemBase64: PNG_EDITORIAL.toString('base64'), references: comReferencia(dataDir) })
    await esperar(() => entrou)
    if (acao === 'editar') await fila.atualizar(item.id, { revisao: item.revisao, texto: 'Texto corrigido enquanto a imagem estava em revisão.' })
    else jobs.cancelar(iniciado.job.id)
    liberar()
    await esperar(() => ['failed', 'cancelled'].includes(jobs.obter(iniciado.job.id).status))
    assert.equal((await fila.obter(item.id)).midias.length, 0)
  }
})

test('captura real só é anexada depois de demonstrar a pauta ao revisor', async () => {
  const { dataDir, fila, item } = await filaComItem('captura-valida')
  let chamadas = 0
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, capturarUrl: null,
    completar: async () => { throw Error('não deve gerar') },
    completarComImagens: async () => { chamadas++; return aceitarImagem('captura') },
  })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', estrategia: 'referencia-real', references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const j = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(j.status) && j })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(chamadas, 1)
  assert.equal((await fila.obter(item.id)).midias.length, 1)
})

// A Factory não dispara sem referência real: os itens de teste ganham uma.
function comReferencia(dataDir, bytes = PNG_EDITORIAL) {
  const pasta = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'entrada.png'), bytes)
  return ['midias/refs/entrada.png']
}

function marcarReferenciaReal(arquivo, bytes) {
  const sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
  fs.writeFileSync(`${arquivo}.json`, JSON.stringify({ ambiente: 'produto-real', dados: 'reais', descricao: 'Captura real inspecionada.', sha256 }))
}

test('job Image Factory prepara com curadoria, dispara both e anexa a vencedora da revisão visual', async () => {
  const { dataDir, fila, item } = await filaComItem('image')
  const factoryRoot = path.join(TMP, 'factory-root'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_CODEX_VENCE] })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory', references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  const disparos = chamadas.filter((args) => args[1] === 'disparar')
  assert.equal(disparos.length, 1)
  assert.equal(disparos[0].includes('--autorizar-gasto'), true)
  assert.equal(disparos[0][disparos[0].indexOf('--provedores') + 1], 'both')
  assert.equal(pronto.revisaoVisual?.vencedor, 'codex')
  assert.equal(pronto.revisaoVisual?.tentativas, 1)
  assert.equal(pronto.artefatosComplementares?.some((arquivo) => arquivo.startsWith('grok-t1-')), true)
  const atualizado = await fila.obter(item.id)
  assert.equal(atualizado.midias.length, 1)
  assert.equal(atualizado.midias[0].tipo, 'imagem')
  // O brief gravado reflete a intenção da curadoria, não o molde fixo antigo.
  const brief = JSON.parse(fs.readFileSync(path.join(factoryRoot, 'ALVOS', `DAILYWORK_${pronto.id}`, 'PRODUCOES', `editorial-${pronto.id}`, 'production-brief.json'), 'utf8'))
  assert.equal(brief.output_topology, 'single-frame')
  assert.equal(brief.text_policy, 'optional')
  assert.deepEqual(brief.providers, ['grok', 'codex'])
  assert.equal(brief.creative_plan[0].template_id, '02-charts-infographics/01-standard')
  assert.deepEqual(brief.creative_plan[0].case_ids, [261])
  assert.equal(brief.creative_plan[0].text_content, undefined)
  // Recriar o serviço não redispára trabalho já concluído.
  const { completar, completarComImagens } = fakesCuradoria({ revisoes: [REVISAO_CODEX_VENCE] })
  const reiniciado = criarJobsMidiasEditoriais({ fila, dataDir, completar, completarComImagens, execFileImpl: execFactoryFake({ factoryRoot, chamadas }), imageFactoryPython: '/venv/python', imageFactoryScript: '/factory/cli.py', imageFactoryRoot: factoryRoot, pollMs: 1 })
  assert.equal(reiniciado.obter(pronto.id).id, pronto.id)
  assert.equal(chamadas.filter((args) => args[1] === 'disparar').length, 1)
})

test('revisão visual reprovada gera nova tentativa com plano corrigido', async () => {
  const { dataDir, fila, item } = await filaComItem('image-retry')
  const factoryRoot = path.join(TMP, 'factory-retry'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_REPROVA, REVISAO_CODEX_VENCE] })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory', references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  const disparos = chamadas.filter((args) => args[1] === 'disparar')
  assert.equal(disparos.length, 2)
  assert.equal(disparos[1][disparos[1].indexOf('--foco') + 1], `editorial-${pronto.id}-t2`)
  assert.equal(pronto.revisaoVisual?.tentativas, 2)
  assert.equal(pronto.tentativas.length, 2)
  assert.equal(pronto.tentativas[0].vencedor, null)
  // A segunda tentativa grava contratos próprios no foco -t2.
  const briefT2 = JSON.parse(fs.readFileSync(path.join(factoryRoot, 'ALVOS', `DAILYWORK_${pronto.id}`, 'PRODUCOES', `editorial-${pronto.id}-t2`, 'production-brief.json'), 'utf8'))
  assert.equal(briefT2.focus, `editorial-${pronto.id}-t2`)
})

test('reprovação em todas as tentativas falha o job sem anexar nada', async () => {
  const { dataDir, fila, item } = await filaComItem('image-fail')
  const factoryRoot = path.join(TMP, 'factory-fail'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_REPROVA] })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory', references: comReferencia(dataDir) })
  const falho = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(falho.status, 'failed')
  assert.equal(falho.erro?.codigo, 'FACTORY_REVISAO_REPROVOU')
  assert.match(falho.erro?.mensagem || '', /revisão visual/)
  assert.equal(chamadas.filter((args) => args[1] === 'disparar').length, 2)
  assert.equal((await fila.obter(item.id)).midias.length, 0)
})

test('sem provedor de visão a mídia falha sem aceitação mecânica', async () => {
  const { dataDir, fila, item } = await filaComItem('image-degradada')
  const factoryRoot = path.join(TMP, 'factory-degradada'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const { completar } = fakesCuradoria({ revisoes: [] })
  const completarComImagens = async () => { const e = new Error('A análise visual precisa do provedor 9router ativo'); e.codigo = 'VISAO_INDISPONIVEL'; throw e }
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar, completarComImagens, execFileImpl: execFactoryFake({ factoryRoot, chamadas }), imageFactoryPython: '/venv/python', imageFactoryScript: '/factory/cli.py', imageFactoryRoot: factoryRoot, pollMs: 1 })
  jobs.configurar({ autorizarGasto: true })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory', references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'failed')
  assert.equal(pronto.erro.codigo, 'VISAO_INDISPONIVEL')
  assert.equal((await fila.obter(item.id)).midias.length, 0)

})

test('motor cli gera pelas sessões nativas, sem disparar a Factory, e anexa a vencedora', async () => {
  const { dataDir, fila, item } = await filaComItem('image-cli')
  const factoryRoot = path.join(TMP, 'factory-cli'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const geradas = []
  const { completar, completarComImagens } = fakesCuradoria({ revisoes: [REVISAO_CODEX_VENCE] })
  const gerarImagemCli = {
    gerar: async ({ provedor, dest }) => {
      geradas.push(provedor)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, PNG_EDITORIAL)
      return { ok: true, path: dest, modelo: provedor === 'grok' ? 'grok-imagine-image-2.0' : 'cx/gpt-5.5-image', via: provedor === 'grok' ? 'grok-cli' : '9router' }
    },
  }
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, completar, completarComImagens, gerarImagemCli, execFileImpl: execFactoryFake({ factoryRoot, chamadas }), imageFactoryPython: '/venv/python', imageFactoryScript: '/factory/cli.py', imageFactoryRoot: factoryRoot, pollMs: 1 })
  jobs.configurar({ autorizarGasto: true })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(pronto.params.motor, 'cli')
  assert.equal(pronto.revisaoVisual?.vencedor, 'codex')
  assert.equal(pronto.revisaoVisual?.motor, 'cli')
  assert.deepEqual(geradas, ['grok', 'codex'])
  assert.equal(chamadas.filter((args) => args[1] === 'disparar').length, 0)
  assert.equal(pronto.tentativas[0].modelos.grok, 'grok-imagine-image-2.0')
  assert.equal((await fila.obter(item.id)).midias.length, 1)
})

test('captura de um pixel é recusada antes da revisão ou geração', async () => {
  const { dataDir, fila, item } = await filaComItem('image-evidence')
  const references = comReferencia(dataDir, Buffer.from(PNG_1PX, 'base64'))
  let chamadasModelo = 0
  const jobs = criarJobsMidiasEditoriais({
    fila,
    dataDir,
    completar: async () => { chamadasModelo += 1; throw new Error('não deveria chamar modelo') },
    gerarImagemCli: { gerar: async () => { chamadasModelo += 1; throw new Error('não deveria gerar') } },
    capturarUrl: null,
    portfolioDir: path.join(dataDir, 'sem-portfolio'),
    acervoDir: path.join(dataDir, 'sem-acervo'),
  })
  jobs.configurar({ autorizarGasto: false })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, estrategia: 'referencia-real', references })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'failed')
  assert.equal(pronto.erro.codigo, 'REFERENCIA_INADEQUADA')
  assert.equal(chamadasModelo, 0)
  assert.equal((await fila.obter(item.id)).midias.length, 0)

})

test('job de imagem busca referência pelo projeto sem references explícitas', async () => {
  const { dataDir, fila } = await filaComItem('image-hunt')
  const item = await fila.criar({ pautaId: 'pauta-nexarq', conta: 'linkedin', idioma: 'pt-BR', formato: 'texto', titulo: 'NexARQ admin', texto: 'Painel real do projeto.', campos: {}, fontes: [{ rotulo: 'ficha', url: 'https://example.test/nexarq' }], origem: { tipo: 'acervo', projeto: 'nexarq' } })
  const pasta = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(pasta, { recursive: true })
  const referencia = path.join(pasta, 'nexarq-admin-metricas.png')
  fs.writeFileSync(referencia, Buffer.from(PNG_1PX, 'base64'))
  marcarReferenciaReal(referencia, Buffer.from(PNG_1PX, 'base64'))
  const factoryRoot = path.join(TMP, 'factory-hunt'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_CODEX_VENCE] })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory' })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(pronto.params.references[0], 'midias/refs/nexarq-admin-metricas.png')
  assert.equal(pronto.params.referenciasOrigem[0].origem, 'refs-editoriais')
  assert.equal((await fila.obter(item.id)).midias.length, 1)
})

test('job falho sem referência retenta quando o caçador acha evidência', async () => {
  const { dataDir, fila, item } = await filaComItem('image-retry-ref')
  const factoryRoot = path.join(TMP, 'factory-retry-ref'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_CODEX_VENCE] })
  const falho = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory' })
  const primeiro = await esperar(() => { const job = jobs.obter(falho.job.id); return job.status === 'failed' ? job : null })
  assert.equal(primeiro.erro?.codigo, 'FACTORY_SEM_REFERENCIA')
  const pasta = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(pasta, { recursive: true })
  const referencia = path.join(pasta, 'entrada.png')
  fs.writeFileSync(referencia, Buffer.from(PNG_1PX, 'base64'))
  marcarReferenciaReal(referencia, Buffer.from(PNG_1PX, 'base64'))
  const atualizado = await fila.atualizar(item.id, { revisao: item.revisao, origem: { tipo: 'acervo', projeto: 'entrada' }, titulo: 'Entrada com evidência' })
  assert.notEqual(atualizado.revisao, item.revisao)
  // A revisão mudou: iniciar novo job; o retentar do job antigo não casa.
  const segundo = await jobs.iniciar({ itemId: atualizado.id, revisao: atualizado.revisao, tipo: 'imagem', pautaId: atualizado.pautaId, motor: 'factory' })
  const pronto = await esperar(() => { const job = jobs.obter(segundo.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.ok(pronto.params.references.some((arquivo) => arquivo.includes('entrada')))
})

test('retentarSemReferencia reabre job falho quando o disco ganha evidência do projeto', async () => {
  const { dataDir, fila } = await filaComItem('image-retentar')
  const item = await fila.criar({ pautaId: 'pauta-retentar', conta: 'linkedin', idioma: 'pt-BR', formato: 'texto', titulo: 'NexARQ', texto: 'Painel.', campos: {}, fontes: [], origem: { tipo: 'acervo', projeto: 'nexarq' } })
  const factoryRoot = path.join(TMP, 'factory-retentar'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_CODEX_VENCE] })
  const falho = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory' })
  await esperar(() => { const job = jobs.obter(falho.job.id); return job.status === 'failed' ? job : null })
  const pasta = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(pasta, { recursive: true })
  const referencia = path.join(pasta, 'nexarq-admin-metricas.png')
  fs.writeFileSync(referencia, Buffer.from(PNG_1PX, 'base64'))
  marcarReferenciaReal(referencia, Buffer.from(PNG_1PX, 'base64'))
  const { retomados } = await jobs.retentarSemReferencia()
  assert.deepEqual(retomados, [falho.job.id])
  const pronto = await esperar(() => { const job = jobs.obter(falho.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
})

test('revisão visual aceita JPEG do Grok com extensão png e anexa', async () => {
  const { dataDir, fila, item } = await filaComItem('image-jpeg-png')
  const jpeg = path.join(TMP, 'saida-grok.jpg')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=800x600', '-frames:v', '1', jpeg])
  const bytes = fs.readFileSync(jpeg)
  const factoryRoot = path.join(TMP, 'factory-jpeg'); fs.mkdirSync(factoryRoot, { recursive: true })
  const { completar, completarComImagens } = fakesCuradoria({ revisoes: [REVISAO_CODEX_VENCE] })
  const gerarImagemCli = {
    gerar: async ({ dest }) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, bytes)
      return { ok: true, path: dest, modelo: 'teste', via: 'disco' }
    },
  }
  const jobs = criarJobsMidiasEditoriais({
    fila, dataDir, completar, completarComImagens, gerarImagemCli,
    execFileImpl: execFactoryFake({ factoryRoot, chamadas: [] }),
    imageFactoryPython: '/venv/python', imageFactoryScript: '/factory/cli.py', imageFactoryRoot: factoryRoot, pollMs: 1,
    capturarUrl: null, portfolioDir: path.join(dataDir, 'sem-portfolio'), acervoDir: path.join(dataDir, 'sem-acervo'),
  })
  jobs.configurar({ autorizarGasto: true })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, references: comReferencia(dataDir) })
  const pronto = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal((await fila.obter(item.id)).midias.length, 1)
})

test('imagem sem referência real falha cedo com orientação clara', async () => {
  const { dataDir, fila, item } = await filaComItem('image-sem-ref')
  const factoryRoot = path.join(TMP, 'factory-sem-ref'); fs.mkdirSync(factoryRoot, { recursive: true })
  const chamadas = []
  const jobs = jobsImagem({ fila, dataDir, factoryRoot, chamadas, revisoes: [REVISAO_CODEX_VENCE] })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, motor: 'factory' })
  const falho = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['ready', 'failed'].includes(job.status) ? job : null })
  assert.equal(falho.status, 'failed')
  assert.equal(falho.erro?.codigo, 'FACTORY_SEM_REFERENCIA')
  assert.match(falho.erro?.mensagem || '', /referência real/)
  // Falha antes de qualquer chamada à CLI da Factory.
  assert.equal(chamadas.length, 0)
})

test('cancelamento de job de mídia impede anexo posterior', async () => {
  const { dataDir, fila, item } = await filaComItem('cancel')
  const roteiro = path.join(TMP, 'cancel-roteiro.json'); fs.writeFileSync(roteiro, JSON.stringify({ out: 'video.mp4' }))
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, vitrinePython: process.execPath, vitrineCompose: path.join(TMP, 'unused-compose.cjs'), execFileImpl: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return { stdout: '' } } })
  const iniciado = await jobs.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'video', roteiroFile: roteiro })
  jobs.cancelar(iniciado.job.id)
  const fim = await esperar(() => { const job = jobs.obter(iniciado.job.id); return ['cancelled', 'failed'].includes(job.status) ? job : null })
  assert.equal(fim.status, 'cancelled')
  assert.equal((await fila.obter(item.id)).midias.length, 0)
})

test('configuração de gasto é persistente e ids não atravessam a área de jobs', async () => {
  const { dataDir, fila } = await filaComItem('config')
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir })
  assert.deepEqual(jobs.configuracao(), { autorizarGasto: false })
  assert.throws(() => jobs.configurar({ autorizarGasto: 'sim' }), /boolean/)
  assert.deepEqual(jobs.configurar({ autorizarGasto: true }), { autorizarGasto: true })
  const outra = criarJobsMidiasEditoriais({ fila, dataDir })
  assert.deepEqual(outra.configuracao(), { autorizarGasto: true })
  assert.throws(() => outra.obter('../segredo'), /identificador de job inválido/)
})

test('vídeo automático dispensa roteiro manual e revisa o MP4 antes de anexar', async () => {
  const { dataDir, fila, item } = await filaComItem('video-automatico')
  const arquivo = 'midias/refs/cena.png'
  fs.mkdirSync(path.dirname(path.join(dataDir, 'editorial', arquivo)), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'editorial', arquivo), PNG_EDITORIAL)
  const comImagem = await fila.atualizar(item.id, { revisao: item.revisao, midias: [{ id: 'cena', tipo: 'imagem', arquivo }], formato: 'imagem' })
  // Compose de fixture: monta o MP4 do roteiro com ffmpeg, sem depender da skill vitrine local.
  const compor = path.join(TMP, 'compose-slides.cjs')
  fs.writeFileSync(compor, `const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process')
const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),[w,h]=r.size
const entradas=r.segments.flatMap(s=>['-loop','1','-t',String(s.dur),'-i',s.slide])
const filtro=r.segments.map((_,i)=>'['+i+':v]scale='+w+':'+h+':force_original_aspect_ratio=decrease,pad='+w+':'+h+':(ow-iw)/2:(oh-ih)/2,setsar=1,fps='+r.fps+'[v'+i+']').join(';')+';'+r.segments.map((_,i)=>'[v'+i+']').join('')+'concat=n='+r.segments.length+':v=1[v]'
execFileSync('ffmpeg',['-y','-loglevel','error',...entradas,'-filter_complex',filtro,'-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',path.join(path.dirname(process.argv[2]),r.out)])`)
  let revisoes = 0
  const jobs = criarJobsMidiasEditoriais({ fila, dataDir, vitrinePython: process.execPath, vitrineCompose: compor, completar: async () => { throw Error('Sem geração de texto neste teste') },
    completarComImagens: async ({ mensagens, imagens }) => {
      revisoes++; assert.ok(imagens.length >= 1)
      const saidas = JSON.parse(mensagens[1].content).saidas
      return JSON.stringify({ vencedor: saidas[0], vereditos: saidas.map(provedor => ({ provedor, accepted: true, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: 'pass' })) })
    },
  })
  const { job } = await jobs.iniciar({ itemId: item.id, revisao: comImagem.revisao, tipo: 'video', automatico: true })
  const pronto = await jobs.aguardar(job.id)
  assert.equal(pronto.status, 'ready', pronto.erro?.mensagem)
  assert.equal(revisoes, 1)
  const atualizado = await fila.obter(item.id)
  assert.equal(atualizado.formato, 'video')
  assert.equal(atualizado.midias[0].tipo, 'video')
  const meta = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(dataDir, 'editorial', atualizado.midias[0].arquivo)], { encoding: 'utf8' }))
  assert.ok(Number(meta.format.duration) >= 6)
})
