const fs = require('node:fs')
const path = require('node:path')
const { criarArquivos, lerJson, gravarJson, erro, hash, comTrava, validarCampanhaId } = require('./arquivos.cjs')

function texto(valor, max, campo, obrigatorio = false) {
  if (typeof valor !== 'string' || valor.length > max || obrigatorio && !valor.trim()) throw erro('ENTRADA_INVALIDA', `Confira o campo ${campo}.`)
  return valor.trim()
}
function urlPublica(valor) {
  if (!valor) return ''
  let u; try { u = new URL(valor) } catch {}
  if (!u || u.protocol !== 'https:' || u.username || u.password || valor.length > 2000) throw erro('URL_INVALIDA', 'Informe uma URL HTTPS sem credenciais.')
  return u.href
}
function normalizarSite(valor) {
  const t = typeof valor === 'string' ? valor.trim() : ''
  if (!t) return ''
  if (/^https:\/\//i.test(t)) return t
  if (/^http:\/\//i.test(t)) return `https://${t.slice(t.indexOf('://') + 3)}`
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/:?#].*)?$/i.test(t)) return `https://${t}`
  return t
}
function siteOpcional(valor) {
  const t = texto(valor || '', 2000, 'site')
  return t ? urlPublica(normalizarSite(t)) : ''
}

function dominiosDasCampanhas(lucasOlDir, base = ['x.com', 'twitter.com', 'linkedin.com', 'google.com', 'cognition.com', 'cognition.ai', 'ashbyhq.com']) {
  const extra = []
  const raiz = path.join(lucasOlDir, 'Portfolio/empresas')
  if (fs.existsSync(raiz)) {
    for (const d of fs.readdirSync(raiz, { withFileTypes: true })) {
      if (!d.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(d.name)) continue
      const salvo = lerJson(path.join(raiz, d.name, 'campanha.json.local'))
      if (!salvo?.site) continue
      try {
        const host = new URL(salvo.site).hostname.replace(/^www\./, '')
        if (host) extra.push(host)
      } catch {}
    }
  }
  return [...new Set([...base, ...extra])]
}

function criarCatalogoCampanhas(opcoes) {
  const { fundirIdentidade, coletarIdentidade, aplicarMarcaLocal, baixarMarca } = require('./identidade.cjs')
  const raiz = path.join(opcoes.lucasOlDir, 'Portfolio/empresas')
  const arquivo = id => path.join(criarArquivos({ ...opcoes, campanhaId: validarCampanhaId(id) }).base, 'campanha.json.local')
  const pasta = id => path.dirname(arquivo(id))
  const cadastroPadrao = { id: 'cognition', nome: 'Cognition', site: 'https://cognition.com', objetivo: 'Buscar oportunidades compatíveis e construir contatos com a equipe.', executor: 'codex', criadoEm: null }
  function lerCadastro(id = 'cognition') {
    const salvo = lerJson(arquivo(id))
    if (!salvo && id !== 'cognition') throw erro('NAO_ENCONTRADO', 'Campanha não encontrada.', 404)
    if (salvo && (salvo.id !== id || typeof salvo.nome !== 'string')) throw erro('ESTADO_INVALIDO', 'Cadastro de campanha inválido.', 409)
    return { salvo, cadastro: salvo || cadastroPadrao }
  }
  function obter(id = 'cognition') {
    const { salvo, cadastro } = lerCadastro(id)
    return { ...cadastro, identidade: aplicarMarcaLocal(pasta(id), fundirIdentidade(cadastro)), revisao: hash(JSON.stringify(salvo)) }
  }
  async function materializar(id = 'cognition') {
    const { cadastro } = lerCadastro(id)
    await baixarMarca(pasta(id), fundirIdentidade(cadastro), opcoes.fetchIdentidade)
    return obter(id)
  }
  function listar() {
    const ids = fs.existsSync(raiz) ? fs.readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory() && /^[a-z0-9][a-z0-9-]{0,59}$/.test(d.name) && fs.existsSync(path.join(raiz, d.name, 'campanha.json.local'))).map(d => d.name) : []
    return [...new Set(['cognition', ...ids])].map(obter).sort((a, b) => a.nome.localeCompare(b.nome))
  }
  async function criar(entrada = {}) {
    const nome = texto(entrada.nome, 100, 'empresa', true)
    const id = validarCampanhaId(entrada.id || nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
    const site = siteOpcional(entrada.site)
    const objetivo = texto(entrada.objetivo || '', 2000, 'objetivo') || 'Buscar oportunidades compatíveis e construir contatos com a equipe.'
    const visual = fundirIdentidade({ id, nome, site, objetivo, identidade: await coletarIdentidade(site, opcoes.fetchIdentidade) })
    return comTrava(path.join(raiz, '.campanhas.lock'), async () => {
      const a = criarArquivos({ ...opcoes, campanhaId: id })
      if (id === 'cognition' || fs.existsSync(a.base)) throw erro('CAMPANHA_EXISTENTE', 'Já existe uma pasta ou campanha com esse nome.', 409)
      fs.mkdirSync(a.base, { recursive: true, mode: 0o700 })
      const cadastro = { id, nome, site, objetivo, executor: 'codex', criadoEm: new Date().toISOString(), identidade: visual }
      const textos = require('./modelo-campanha.cjs').textosCampanha(cadastro)
      gravarJson(path.join(a.base, 'estado.json.local'), { campanha: id, objetivo, toques: {}, candidaturas: {}, fila_argumentos: ['A01'] })
      gravarJson(path.join(a.base, 'pesquisa.json.local'), { notas: objetivo, pessoas: [], fontes: [], atualizadoEm: null })
      for (const [nomeArquivo, conteudo] of [['findings.md', textos.findings], ['playbook.md', textos.playbook], ['argumentos.md', textos.argumentos], ['alvos.md', textos.alvos], ['ciclo.prompt.md', textos.ciclo], ['diario.md', textos.diario]]) {
        fs.writeFileSync(path.join(a.base, nomeArquivo), conteudo, { mode: 0o600 })
      }
      gravarJson(arquivo(id), cadastro)
      a.auditar('campanha-criar')
      await baixarMarca(a.base, visual, opcoes.fetchIdentidade)
      return obter(id)
    })
  }
  async function configurar(id, entrada = {}) {
    const a = criarArquivos({ ...opcoes, campanhaId: id })
    return comTrava(path.join(a.runs, 'cadastro.lock'), () => {
      const { cadastro } = lerCadastro(id)
      const atual = obter(id)
      if (entrada.revisao !== atual.revisao) throw erro('CONFLITO', 'A campanha mudou. Atualize antes de salvar.', 409)
      const dados = { ...cadastro }
      for (const campo of ['nome', 'objetivo']) if (entrada[campo] !== undefined) dados[campo] = texto(entrada[campo], campo === 'nome' ? 100 : 2000, campo, campo === 'nome')
      if (entrada.site !== undefined) dados.site = siteOpcional(entrada.site)
      if (entrada.executor !== undefined) {
        if (!require('./executores.cjs').EXECUTORES.some(e => e.id === entrada.executor)) throw erro('EXECUTOR_INVALIDO', 'Escolha um executor disponível no catálogo.')
        dados.executor = entrada.executor
      }
      dados.atualizadoEm = new Date().toISOString()
      gravarJson(arquivo(id), dados, { backup: true })
      a.auditar('campanha-configurar', { executor: dados.executor })
      return obter(id)
    })
  }
  return { listar, obter, materializar, criar, configurar }
}

function criarPesquisa(arquivos) {
  const destino = path.join(arquivos.base, 'pesquisa.json.local')
  function obter() {
    const salvo = lerJson(destino)
    return { ...(salvo || { notas: '', pessoas: [], fontes: [], atualizadoEm: null }), revisao: hash(JSON.stringify(salvo)) }
  }
  async function salvar(entrada = {}) {
    const notas = texto(entrada.notas || '', 40000, 'anotações')
    if (!Array.isArray(entrada.pessoas) || entrada.pessoas.length > 100 || !Array.isArray(entrada.fontes) || entrada.fontes.length > 100) throw erro('ENTRADA_INVALIDA', 'Informe até 100 pessoas e 100 fontes por pesquisa.')
    if (entrada.fontes.some(f => !f || typeof f !== 'object') || entrada.pessoas.some(p => !p || typeof p !== 'object')) throw erro('ENTRADA_INVALIDA', 'Confira as pessoas e fontes da pesquisa.')
    const fontes = entrada.fontes.map(f => ({ titulo: texto(f.titulo, 300, 'título da fonte', true), url: urlPublica(texto(f.url, 2000, 'fonte', true)), trecho: texto(f.trecho || '', 3000, 'evidência'), verificadoEm: texto(f.verificadoEm || '', 40, 'data') }))
    if (fontes.some(f => f.verificadoEm && (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(f.verificadoEm) || !Number.isFinite(Date.parse(f.verificadoEm))))) throw erro('ENTRADA_INVALIDA', 'Use uma data válida para a verificação da fonte.')
    const pessoas = entrada.pessoas.map(p => ({ nome: texto(p.nome, 160, 'nome', true), cargo: texto(p.cargo || '', 300, 'cargo'), url: urlPublica(p.url || ''), motivo: texto(p.motivo || '', 2000, 'relevância'), prioridade: ['alta', 'media', 'baixa'].includes(p.prioridade) ? p.prioridade : 'media', status: ['a_verificar', 'verificado', 'contatado'].includes(p.status) ? p.status : 'a_verificar', fonteUrl: urlPublica(p.fonteUrl || '') }))
    if (pessoas.some(p => p.status === 'verificado' && !fontes.some(f => f.url === p.fonteUrl && f.trecho && f.verificadoEm))) throw erro('EVIDENCIA_OBRIGATORIA', 'Pessoa verificada precisa de fonte, trecho e data na pesquisa.')
    return comTrava(path.join(arquivos.runs, 'pesquisa.lock'), () => {
      if (obter().revisao !== entrada.revisao) throw erro('CONFLITO', 'A pesquisa mudou. Atualize para preservar as novas anotações.', 409)
      gravarJson(destino, { notas, pessoas, fontes, atualizadoEm: new Date().toISOString(), execucaoId: process.env.AUTOMACOES_EXECUCAO_ID || null, contextoId: process.env.AUTOMACOES_CONTEXTO_ID || null }, { backup: true })
      arquivos.auditar('pesquisa-salvar', { pessoas: pessoas.length, fontes: fontes.length })
      return obter()
    })
  }
  return { obter, salvar }
}
module.exports = { criarCatalogoCampanhas, criarPesquisa, urlPublica, normalizarSite, siteOpcional, dominiosDasCampanhas }
