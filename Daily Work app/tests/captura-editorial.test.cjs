const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { criarCapturaEditorial } = require('../electron/lib-captura-editorial.cjs')

function setup(t, { reprovar = false, omitir = false, alterar = false, artificial = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-captura-test-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const fixture = path.join(dataDir, 'fixture.png')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=800x600', '-frames:v', '1', fixture])
  const eventos = []
  let dir
  const servico = criarCapturaEditorial({ dataDir, completar: async () => { throw Error('Visão obrigatória') },
    executores: { 'capturador-teste': async ({ pedido, outputDir }) => {
      eventos.push('capturar'); dir = outputDir
      for (const c of pedido.cenas.filter(c => !omitir || c.id === 'all')) fs.copyFileSync(fixture, path.join(outputDir, `${c.id}.png`))
      return artificial
        ? { versao: 'fixture-v1', ambiente: 'demo', dados: { tipo: 'sintéticos', origem: 'fixture' }, cenas: pedido.cenas.map(c => ({ id: c.id, observado: true })) }
        : { versao: 'produto-v1', ambiente: 'produto-real', dados: { tipo: 'reais', origem: 'estado local do produto', atualizadoEm: '2026-09-13T12:00:00.000Z' }, cenas: pedido.cenas.map(c => ({ id: c.id, observado: true })) }
    } },
    completarComImagens: async ({ mensagens, imagens }) => {
      eventos.push('inspecionar')
      assert.equal(imagens.length, 2)
      assert.match(mensagens[1].content, /estado local do produto/)
      if (alterar) fs.appendFileSync(path.join(dir, 'all.png'), 'mudou')
      const saidas = JSON.parse(mensagens[1].content).saidas
      return JSON.stringify({ vereditos: saidas.map(provedor => ({ provedor, accepted: !reprovar, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: reprovar ? 'fail' : 'pass', notes: reprovar ? 'O painel está ilegível.' : 'A capacidade aparece.' })), vencedor: reprovar ? null : 'all' })
    },
  })
  const pauta = { pautaId: 'pauta-teste', titulo: 'Painel', briefing: 'Painel real de consulta.', origem: { projeto: 'omarchy-agents' }, captura: { executor: 'capturador-teste', ambiente: 'produto-real', capacidade: 'Consultar uso conjunto e por agente', cenas: [{ id: 'all', descricao: 'Uso de todos os agentes.' }, { id: 'codex', descricao: 'Limite e modelos do Codex.' }] }, referenciasVisuais: [{ arquivo: 'readme.png' }] }
  const manifest = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'editorial/capturas', fs.readdirSync(path.join(dataDir, 'editorial/capturas'))[0], 'manifest.json')))
  return { servico, pauta, eventos, dataDir, manifest }
}

test('captura as duas cenas antes de oferecer referências e mantém ordem, origem e hashes', async t => {
  const { servico, pauta, eventos, dataDir, manifest } = setup(t)
  const resultado = await servico.preparar(pauta)
  assert.deepEqual(eventos, ['capturar', 'inspecionar'])
  assert.deepEqual(resultado.references.map(r => r.cena), ['all', 'codex'])
  assert.equal(resultado.references.some(r => r.arquivo.includes('readme')), false)
  for (const ref of resultado.references) {
    assert.equal(ref.sha256.length, 64)
    assert.ok(fs.existsSync(path.join(dataDir, 'editorial', ref.arquivo)))
  }
  assert.equal(manifest().status, 'ready')
})

for (const [nome, opcoes, codigo] of [
  ['cena ausente', { omitir: true }, 'ARTEFATO_AUSENTE'],
  ['visão reprova legibilidade', { reprovar: true }, 'CAPTURA_REPROVADA'],
  ['arquivo muda durante inspeção', { alterar: true }, 'ARTEFATO_DIVERGENTE'],
]) test(`${nome} não vira ready nem recorre ao README`, async t => {
  const { servico, pauta, manifest } = setup(t, opcoes)
  await assert.rejects(servico.preparar(pauta), e => e.codigo === codigo)
  assert.equal(manifest().status, 'failed')
  assert.equal(manifest().references, undefined)
})

test('executor desconhecido registra falha acionável sem executar comando arbitrário', async t => {
  const { servico, pauta, eventos, manifest } = setup(t)
  pauta.captura.executor = 'nao-configurado'
  await assert.rejects(servico.preparar(pauta), e => e.codigo === 'CAPTURA_INDISPONIVEL')
  assert.deepEqual(eventos, [])
  assert.equal(manifest().status, 'failed')
})

test('proveniência artificial é bloqueada antes da inspeção e nunca vira referência', async t => {
  const { servico, pauta, eventos, manifest } = setup(t, { artificial: true })
  await assert.rejects(servico.preparar(pauta), e => e.codigo === 'CAPTURA_ARTIFICIAL')
  assert.deepEqual(eventos, ['capturar'])
  assert.equal(manifest().status, 'failed')
  assert.equal(manifest().references, undefined)
})

test('receita que pede demo ou mock é recusada antes de chamar executor', async t => {
  const { servico, pauta, eventos } = setup(t)
  pauta.captura.modo = 'demo'
  await assert.rejects(servico.preparar(pauta), e => e.codigo === 'CAPTURA_ARTIFICIAL')
  assert.deepEqual(eventos, [])
})

test('cancelamento entre captura e inspeção impede entrega das referências', async t => {
  const { servico, pauta, eventos, manifest } = setup(t)
  await assert.rejects(servico.preparar(pauta, { verificarCancelamento: () => {
    if (eventos.includes('capturar')) throw Object.assign(Error('Cancelado'), { codigo: 'JOB_CANCELADO' })
  } }), e => e.codigo === 'JOB_CANCELADO')
  assert.deepEqual(eventos, ['capturar'])
  assert.equal(manifest().status, 'failed')
})
