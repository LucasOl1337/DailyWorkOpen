// Produz e inspeciona uma sequência do produto antes de oferecer imagens ao
// editor. Receitas escolhem executores conhecidos; dados nunca viram shell.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { validarManifest } = require('../scripts/editorial-media-runner.cjs')
const { criarCuradoriaMidia } = require('./lib-curadoria-midia.cjs')

const falha = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo })
const MARCADORES_ARTIFICIAIS = /\b(?:demo|demonstracao|demonstração|fixture|mock|sintetico|sintético|sintetica|sintética)\b/i

function validarPedido(captura) {
  if (!captura || !/^[a-z0-9-]+$/.test(captura.executor || '') || typeof captura.capacidade !== 'string' || !captura.capacidade.trim()) throw falha('CAPTURA_PEDIDO_INVALIDO', 'Informe executor e capacidade a mostrar.')
  if (captura.ambiente !== 'produto-real') throw falha('CAPTURA_PEDIDO_INVALIDO', 'A captura editorial precisa declarar ambiente produto-real.')
  if (MARCADORES_ARTIFICIAIS.test(JSON.stringify(captura))) throw falha('CAPTURA_ARTIFICIAL', 'Receitas de demonstração, fixture, mock ou dados sintéticos não são mídia editorial publicável.')
  if (!Array.isArray(captura.cenas) || captura.cenas.length < 1 || captura.cenas.length > 4 || new Set(captura.cenas.map(c => c?.id)).size !== captura.cenas.length) throw falha('CAPTURA_PEDIDO_INVALIDO', 'Declare de uma a quatro cenas distintas, em ordem.')
  for (const cena of captura.cenas) if (!/^[a-z0-9-]+$/.test(cena?.id || '') || !cena.descricao?.trim()) throw falha('CAPTURA_PEDIDO_INVALIDO', 'Cada cena precisa de id e descrição do que deve aparecer.')
  return captura
}

function validarReciboReal(recibo, pedido) {
  if (!recibo?.versao || recibo?.ambiente !== 'produto-real' || recibo?.dados?.tipo !== 'reais' || !recibo?.dados?.origem) {
    throw falha('CAPTURA_ARTIFICIAL', 'O executor precisa comprovar produto real e dados reais observados na origem.')
  }
  if (MARCADORES_ARTIFICIAIS.test(JSON.stringify(recibo))) throw falha('CAPTURA_ARTIFICIAL', 'A captura contém proveniência de demonstração, fixture, mock ou dados sintéticos.')
  if (!pedido.cenas.every(c => recibo.cenas?.some(r => r.id === c.id && r.observado === true))) {
    throw falha('CAPTURA_INCOMPLETA', 'O executor não confirmou todas as cenas observadas.')
  }
  return recibo
}

function descreverDados(dados) {
  return `reais, observados em ${dados.origem}${dados.atualizadoEm ? `; estado atualizado em ${dados.atualizadoEm}` : ''}`
}

function criarCapturaEditorial({ dataDir, completar, completarComImagens, executores = { 'omarchy-agents': (...args) => require('../scripts/capturas/omarchy-agents.cjs').capturar(...args) } }) {
  async function preparar(pauta, { perfilVisao, verificarCancelamento = () => {} } = {}) {
    const pedido = validarPedido(pauta.captura)
    const id = `captura-${crypto.randomUUID()}`
    const outputDir = path.resolve(dataDir, 'editorial', 'capturas', id)
    fs.mkdirSync(outputDir, { recursive: true })
    const arquivoManifest = path.join(outputDir, 'manifest.json')
    let manifest = { version: 1, jobId: id, pautaId: pauta.pautaId, tipo: 'captura-real', status: 'planned', outputDir, request: pedido, artifacts: pedido.cenas.map(c => ({ path: `${c.id}.png`, kind: 'image', mime: 'image/png', cena: c.id })) }
    const salvar = () => {
      const tmp = `${arquivoManifest}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 }); fs.renameSync(tmp, arquivoManifest)
    }
    salvar()
    try {
      verificarCancelamento()
      const executar = executores[pedido.executor]
      if (typeof executar !== 'function') throw falha('CAPTURA_INDISPONIVEL', `Falta um executor de captura para ${pedido.executor}.`)
      if (typeof completarComImagens !== 'function') throw falha('VISAO_INDISPONIVEL', 'A captura precisa de inspeção visual antes da escrita.')
      manifest.status = 'producing'; salvar()
      const recibo = validarReciboReal(await executar({ pedido, outputDir, verificarCancelamento }), pedido)
      verificarCancelamento()
      manifest = validarManifest({ ...manifest, recibo }, { exigirArquivos: true })
      for (const a of manifest.artifacts) {
        const { width, height } = a.propriedades
        if (Math.min(width, height) < 480 || Math.max(width, height) < 800 || width * height > 40_000_000) throw falha('CAPTURA_ILEGIVEL', `A cena ${a.cena} precisa de resolução editorial legível.`)
      }
      const curador = criarCuradoriaMidia({ completar, completarComImagens, perfilVisao })
      const revisao = await curador.revisarSaidas({
        pauta: { ...pauta, texto: pauta.briefing, editorial: { pauta: { tese: pedido.capacidade, midia: { tipo: 'captura', objetivo: pedido.capacidade, direcao: pedido.cenas.map(c => c.descricao).join('\n') }, evidencias: [{ trecho: `Origem dos dados: ${descreverDados(recibo.dados)}. Versão: ${recibo.versao}.` }] } } },
        intencao: { output_topology: 'ui-screen', text_policy: 'optional' },
        saidas: manifest.artifacts.map(a => ({ provedor: a.cena, mimeType: 'image/png', base64: fs.readFileSync(path.join(outputDir, a.path)).toString('base64') })),
      })
      verificarCancelamento()
      manifest.revisao = revisao
      if (!manifest.artifacts.every(a => revisao.vereditos.some(v => v.provedor === a.cena && v.accepted))) throw falha('CAPTURA_REPROVADA', revisao.vereditos.filter(v => !v.accepted).map(v => v.notes).join('; ') || 'A sequência não demonstra a capacidade.')
      // A inspeção vale para estes bytes; detecte alteração durante a visão.
      manifest = validarManifest(manifest, { exigirArquivos: true })
      const refsDir = path.resolve(dataDir, 'editorial', 'midias', 'refs')
      fs.mkdirSync(refsDir, { recursive: true })
      const references = manifest.artifacts.map((a, i) => {
        const nome = `${pauta.origem?.projeto?.replace(/[^a-z0-9-]/gi, '') || 'produto'}-${id}-${a.cena}.png`
        const ref = { arquivo: `midias/refs/${nome}`, sha256: a.sha256, natureza: 'interface', ambiente: 'produto-real', dados: 'reais', cena: a.cena, descricao: `${pedido.cenas[i].descricao} Dados ${descreverDados(recibo.dados)}. Versão observada: ${recibo.versao}.`, capturaId: id }
        fs.copyFileSync(path.join(outputDir, a.path), path.join(refsDir, nome), fs.constants.COPYFILE_EXCL)
        fs.writeFileSync(path.join(refsDir, `${nome}.json`), JSON.stringify(ref, null, 2), { flag: 'wx', mode: 0o600 })
        return ref
      })
      manifest = { ...manifest, status: 'ready', references, concluidoEm: new Date().toISOString() }; salvar()
      return { references, manifestFile: arquivoManifest }
    } catch (causa) {
      manifest = { ...manifest, status: 'failed', erro: { codigo: causa.codigo || 'CAPTURA_FALHOU', mensagem: causa.message } }; salvar()
      throw causa
    }
  }
  return { preparar }
}
module.exports = { criarCapturaEditorial, validarPedido, validarReciboReal }
