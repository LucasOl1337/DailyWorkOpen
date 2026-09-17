// Jobs de mídia editoriais: a única porta de execução para Image Factory e
// mini-vitrine. O chamador fornece intenção estruturada; nunca fornece shell.

const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { validarManifest, validarArtefato, importarMidias } = require('../scripts/editorial-media-runner.cjs')
const { criarCuradoriaMidia, PROPOSITOS_PADRAO } = require('./lib-curadoria-midia.cjs')
const { criarGeradorImagensCli, promptDoPlano, mimeDaImagem } = require('./lib-gerador-imagens-cli.cjs')
const { criarCapturaEditorial } = require('./lib-captura-editorial.cjs')
const { resolverReferenciasComCaptura } = require('./lib-referencias-editoriais.cjs')
const { imagensDeEstilo } = require('./lib-perfil-editorial.cjs')

const execFileAsync = promisify(execFile)
const ESTADOS = new Set(['planned', 'producing', 'ready', 'failed', 'cancelled'])
const TIPOS = new Set(['imagem', 'video'])
const TERMINAIS = new Set(['concluido', 'concluída', 'concluido_com_avisos', 'falhou', 'recusado', 'erro'])
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function agora() { return new Date().toISOString() }
function hash(valor) { return crypto.createHash('sha256').update(String(valor)).digest('hex').slice(0, 24) }
function clone(valor) { return JSON.parse(JSON.stringify(valor)) }
function lerJson(arquivo, fallback = null) { try { return fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : fallback } catch { return fallback } }
function gravarJson(arquivo, valor) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  const temporario = `${arquivo}.${process.pid}.tmp`
  fs.writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporario, arquivo)
}
function erro(codigo, mensagem) { const valor = new Error(mensagem); valor.codigo = codigo; return valor }
function parseSaida(stdout) {
  const texto = String(stdout || '').trim()
  if (!texto) return {}
  // Linhas avulsas só valem quando são objetos: um escalar solto no fim
  // (ex.: código de saída impresso pelo wrapper) não pode esconder o JSON
  // principal da CLI.
  for (const linha of texto.split(/\r?\n/).reverse()) {
    try {
      const valor = JSON.parse(linha)
      if (valor && typeof valor === 'object') return valor
    } catch {}
  }
  const inicio = texto.indexOf('{'); const fim = texto.lastIndexOf('}')
  if (inicio >= 0 && fim > inicio) { try { return JSON.parse(texto.slice(inicio, fim + 1)) } catch {} }
  return { texto }
}
function acharTrabalho(valor) {
  if (!valor || typeof valor !== 'object') return null
  for (const chave of ['trabalho', 'request_id', 'requestId', 'queue_id', 'queueId']) if (typeof valor[chave] === 'string' && valor[chave]) return valor[chave]
  for (const item of Object.values(valor)) { const encontrado = acharTrabalho(item); if (encontrado) return encontrado }
  return null
}
function acharEstadoFactory(valor) {
  if (!valor || typeof valor !== 'object') return typeof valor === 'string' ? valor : null
  for (const chave of ['estado', 'status']) if (typeof valor[chave] === 'string') return valor[chave].toLowerCase()
  return null
}
function acharCaminhos(valor, saida = []) {
  if (typeof valor === 'string' && /\.(?:png|jpe?g|webp)$/i.test(valor)) saida.push(valor)
  else if (Array.isArray(valor)) valor.forEach((item) => acharCaminhos(item, saida))
  else if (valor && typeof valor === 'object') Object.values(valor).forEach((item) => acharCaminhos(item, saida))
  return [...new Set(saida)]
}
function arquivosMidia(dir) {
  if (!fs.existsSync(dir)) return []
  const saida = []
  for (const nome of fs.readdirSync(dir)) {
    const arquivo = path.join(dir, nome); const stat = fs.statSync(arquivo)
    if (stat.isDirectory()) saida.push(...arquivosMidia(arquivo))
    else if (/\.(?:mp4|png|jpe?g|webp)$/i.test(nome)) saida.push(arquivo)
  }
  return saida
}
function lerSkill(skillsDir, nome) {
  const pasta = path.resolve(skillsDir, nome)
  const arquivos = [path.join(pasta, 'SKILL.md')]
  const refs = path.join(pasta, 'references')
  if (fs.existsSync(refs)) arquivos.push(...fs.readdirSync(refs).filter((item) => item.endsWith('.md')).sort().map((item) => path.join(refs, item)))
  return arquivos.filter((arquivo) => fs.existsSync(arquivo)).map((arquivo) => fs.readFileSync(arquivo, 'utf8')).join('\n\n')
}
function pidVivo(pid) { try { process.kill(Number(pid), 0); return true } catch (valor) { return valor.code !== 'ESRCH' } }
function dentro(arquivo, raiz) { const rel = path.relative(path.resolve(raiz), path.resolve(arquivo)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) }
// Extrai a entrega mantendo a atribuição por provedor: com --provedores both a
// revisão visual escolhe a melhor das duas saídas, então a origem importa.
function extrairEntregaPorProvedor(payload) {
  const entrega = payload?.entrega
  if (!entrega || typeof entrega !== 'object') throw erro('FACTORY_ENTREGA_INVALIDA', 'receber não devolveu entrega de provedor')
  if (payload.verificacao_mecanica && payload.verificacao_mecanica.ok === false) throw erro('FACTORY_VERIFICACAO_FALHOU', 'verificação mecânica da Image Factory falhou')
  const saidas = []
  for (const [nome, provedor] of Object.entries(entrega)) {
    if (!provedor || typeof provedor !== 'object') continue
    if (provedor.verificacao_mecanica && provedor.verificacao_mecanica.ok === false) throw erro('FACTORY_VERIFICACAO_FALHOU', 'verificação mecânica da Image Factory falhou')
    if (!Array.isArray(provedor.imagens)) continue
    const imagens = [...new Set(provedor.imagens.filter((arquivo) => typeof arquivo === 'string' && arquivo.trim()))]
    if (imagens.length) saidas.push({ provedor: String(nome), imagens })
  }
  return saidas
}

function criarJobsMidiasEditoriais({ fila, dataDir, completar = null, completarComImagens = null, logica = null, now = () => Date.now(), execFileImpl = execFileAsync, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), imageFactoryRoot = process.env.IMAGEGEN_ROOT || path.join(os.homedir(), 'Projects', 'ImageGenSource'), imageFactoryPython = process.env.IMAGE_FACTORY_PYTHON || (fs.existsSync(path.join(os.homedir(), '.agents', 'skills', 'imageproductionfactory', '.venv', 'bin', 'python')) ? path.join(os.homedir(), '.agents', 'skills', 'imageproductionfactory', '.venv', 'bin', 'python') : 'python3'), imageFactoryScript = path.join(os.homedir(), '.agents', 'skills', 'imageproductionfactory', 'scripts', 'image_production_factory.py'), vitrinePython = 'python3', vitrineCompose = path.join(os.homedir(), '.agents', 'skills', 'vitrine', 'scripts', 'compose.py'), skillsDir = path.join(os.homedir(), '.agents', 'skills'), autorizarGasto = false, pollMs = 2_000, timeoutMs = null, maxTentativasImagem = 2, onUpdate = null, gerarImagemCli = null, capturarUrl = undefined, portfolioDir = null, acervoDir = null, resolverRefs = resolverReferenciasComCaptura, executoresCaptura } = {}) {
  if (!fila || typeof fila.obter !== 'function' || typeof fila.atualizar !== 'function') throw new Error('jobs de mídia precisam da fila editorial')
  if (!dataDir) throw new Error('jobs de mídia precisam de dataDir')
  const base = path.join(path.resolve(dataDir), 'editorial', 'media-jobs')
  const configFile = path.join(path.dirname(base), 'midia-config.json')
  const configInicial = lerJson(configFile, { autorizarGasto: autorizarGasto === true })
  let config = { autorizarGasto: configInicial?.autorizarGasto === true }
  const jobs = new Map()
  const ativos = new Map()
  const processos = new Map()

  function validarId(id) { if (typeof id !== 'string' || !ID_RE.test(id)) throw erro('ID_INVALIDO', 'identificador de job inválido'); return id }
  function arquivo(id) {
    validarId(id)
    const destino = path.join(base, `${id}.json`)
    if (!dentro(destino, base)) throw erro('ID_INVALIDO', 'identificador fora da área de jobs')
    if (fs.existsSync(destino) && fs.lstatSync(destino).isSymbolicLink()) throw erro('CAMINHO_INVALIDO', 'arquivo de job é symlink')
    return destino
  }
  function emitir(job) { try { onUpdate?.(clone(job)) } catch {} return { job: clone(job) } }
  function persistir(job) { jobs.set(job.id, job); gravarJson(arquivo(job.id), job); emitir(job) }
  function relerConfig() {
    const salvo = lerJson(configFile, null)
    if (salvo && typeof salvo.autorizarGasto === 'boolean') config = { autorizarGasto: salvo.autorizarGasto }
    return config
  }
  function carregar() {
    fs.mkdirSync(base, { recursive: true })
    for (const nome of fs.readdirSync(base).filter((valor) => valor.endsWith('.json'))) {
      const job = lerJson(path.join(base, nome)); if (job?.id && ESTADOS.has(job.status)) jobs.set(job.id, job)
    }
  }
  function reler() {
    fs.mkdirSync(base, { recursive: true })
    const vistos = new Map()
    for (const nome of fs.readdirSync(base).filter((valor) => valor.endsWith('.json'))) {
      const caminho = path.join(base, nome)
      if (fs.lstatSync(caminho).isSymbolicLink()) continue
      const job = lerJson(caminho)
      if (job?.id && ESTADOS.has(job.status) && ID_RE.test(job.id)) vistos.set(job.id, job)
    }
    for (const [id, job] of vistos) jobs.set(id, job)
    for (const id of jobs.keys()) if (!vistos.has(id) && !ativos.has(id)) jobs.delete(id)
  }
  function lockFile(id) { validarId(id); return path.join(base, `${id}.lock`) }
  function adquirirLock(id) {
    const destino = lockFile(id)
    try {
      const fd = fs.openSync(destino, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, id, criadoEm: agora() }))
      fs.closeSync(fd)
      return true
    } catch (causa) {
      if (causa.code !== 'EEXIST') throw causa
      const dono = lerJson(destino)
      if (!dono || !pidVivo(dono.pid)) { try { fs.unlinkSync(destino) } catch {} ; return adquirirLock(id) }
      return false
    }
  }
  function liberarLock(id) { try { fs.unlinkSync(lockFile(id)) } catch (causa) { if (causa.code !== 'ENOENT') throw causa } }
  async function itemAtual(job) {
    const item = await fila.obter(job.itemId)
    if (!item) throw erro('ITEM_NAO_ENCONTRADO', 'item editorial não existe')
    if (item.revisao !== job.revisao) throw erro('REVISAO_OBSOLETA', 'a revisão da Fila mudou antes do job de mídia')
    if (!['pendente', 'erro'].includes(item.estado)) throw erro('ITEM_ESTADO_INVALIDO', `item não está disponível para mídia: ${item.estado}`)
    return item
  }
  function caminhoRealSeguro(valor, raiz, codigo = 'CAMINHO_INVALIDO') {
    const absoluto = path.resolve(raiz, valor)
    if (!dentro(absoluto, raiz)) throw erro(codigo, `caminho fora da área permitida: ${valor}`)
    let real
    let raizReal
    try { real = fs.realpathSync(absoluto); raizReal = fs.realpathSync(raiz) } catch { throw erro(codigo, `arquivo não encontrado: ${valor}`) }
    if (!dentro(real, raizReal)) throw erro(codigo, `caminho real fora da área permitida: ${valor}`)
    return real
  }
  function curadoriaDoJob(job) {
    if (typeof completar !== 'function') throw erro('COMPLETADOR_AUSENTE', 'imagem editorial precisa de completador injetado para preparar o plano')
    return criarCuradoriaMidia({ completar, completarComImagens, logica, perfilTexto: job?.params?.perfilId || 'gpt-5-6-sol-medium', perfilVisao: job?.params?.perfilVisao || job?.params?.perfilId || 'gpt-5-6-sol-medium' })
  }
  function lerTaxonomia() {
    const bruto = lerJson(path.join(imageFactoryRoot, 'PROMPTS', 'site-library', 'taxonomy.json'), null)
    const mapeados = (Array.isArray(bruto?.purposes) ? bruto.purposes : [])
      .map((proposito) => ({ id: proposito?.id, rotulo: proposito?.label_pt, textoPadrao: proposito?.default_text_policy }))
      .filter((proposito) => typeof proposito.id === 'string' && proposito.id)
    return mapeados.length ? mapeados : PROPOSITOS_PADRAO
  }
  // Combos (propósito, topologia, política) que a biblioteca real suporta para
  // target_kind project/mixed. A busca da Factory é ranqueada (fuzzy), mas o
  // validar é estrito: restringir a intenção a estes combos faz o contrato
  // nascer válido por construção.
  function lerCombosDisponiveis() {
    const bruto = lerJson(path.join(imageFactoryRoot, 'PROMPTS', 'site-library', 'cases.json'), null)
    const casos = Array.isArray(bruto?.cases) ? bruto.cases : Array.isArray(bruto) ? bruto : []
    const combos = new Map()
    for (const caso of casos) {
      const sem = caso?.semantics || {}
      const alvos = Array.isArray(sem.target_kinds) ? sem.target_kinds : []
      if (!alvos.includes('project') && !alvos.includes('mixed')) continue
      const chave = [sem.primary_purpose, sem.output_topology, sem.text_policy].join('|')
      if (chave.includes('undefined')) continue
      combos.set(chave, (combos.get(chave) || 0) + 1)
    }
    return [...combos.entries()].map(([chave, total]) => {
      const [output_purpose, output_topology, text_policy] = chave.split('|')
      return { output_purpose, output_topology, text_policy, casos: total }
    })
  }
  // Mesmas regras do validador da Factory (creative_planner._validate_item):
  // filtro client-side para o LLM só escolher entre opções que passam.
  function textoCompativel(politicaFonte, politicaPedida) {
    if (politicaPedida === 'forbidden') return politicaFonte !== 'required'
    if (politicaPedida === 'required') return politicaFonte !== 'forbidden'
    return true
  }
  function casoCompativel(caso, intencao) {
    const sem = caso?.semantics || {}
    const propositos = [sem.primary_purpose, ...(Array.isArray(sem.secondary_purposes) ? sem.secondary_purposes : [])]
    const alvos = Array.isArray(sem.target_kinds) ? sem.target_kinds : []
    return propositos.includes(intencao.output_purpose)
      && sem.output_topology === intencao.output_topology
      && (alvos.includes('project') || alvos.includes('mixed'))
      && textoCompativel(String(sem.text_policy || ''), intencao.text_policy)
  }
  function templateCompativel(template, intencao) {
    const propositos = Array.isArray(template?.propositos_compativeis) ? template.propositos_compativeis : Array.isArray(template?.compatible_purposes) ? template.compatible_purposes : []
    const alvos = Array.isArray(template?.tipos_de_alvo) ? template.tipos_de_alvo : Array.isArray(template?.target_kinds) ? template.target_kinds : []
    const topologia = template?.topologia || template?.output_topology
    const politica = String(template?.politica_texto || template?.text_policy || '')
    return propositos.includes(intencao.output_purpose)
      && topologia === intencao.output_topology
      && (alvos.includes('project') || alvos.includes('mixed'))
      && textoCompativel(politica, intencao.text_policy)
  }
  function lerImagemBase64(arquivo) {
    try {
      const stat = fs.statSync(arquivo)
      if (!stat.isFile() || stat.size === 0 || stat.size > 4 * 1024 * 1024) return null
      const buffer = fs.readFileSync(arquivo)
      const mime = mimeDaImagem(buffer)
      if (!mime) return null
      return { nome: path.basename(arquivo), mimeType: mime, base64: buffer.toString('base64') }
    } catch { return null }
  }
  async function casosBuscar(job, intencao, relaxar = false) {
    const args = ['buscar', '--consulta', intencao.consulta, '--proposito', intencao.output_purpose, '--tipo-alvo', 'project', '--limite', '10']
    if (!relaxar) args.push('--topologia', intencao.output_topology, '--politica-texto', intencao.text_policy)
    const saida = await cli('casos', args, job)
    return Array.isArray(saida?.biblioteca?.results) ? saida.biblioteca.results : []
  }
  async function modelosListar(job, intencao, relaxar = false) {
    const args = ['listar', '--proposito', intencao.output_purpose, '--tipo-alvo', 'project']
    if (!relaxar) args.push('--topologia', intencao.output_topology, '--politica-texto', intencao.text_policy)
    const saida = await cli('modelos', args, job)
    return Array.isArray(saida?.modelos) ? saida.modelos : []
  }
  // Grava intent-contract.json e production-brief.json (schema 2) do foco. Os
  // valores vêm da intenção/seleção/plano da curadoria — nada é fixo por pauta.
  function gravarContratos(job, { foco, intencao, selecao, plano, referencias }) {
    const target = job.params.alvo
    const runDir = path.join(imageFactoryRoot, 'ALVOS', target, 'PRODUCOES', foco)
    fs.mkdirSync(runDir, { recursive: true })
    const item = job.itemSnapshot
    const provedores = job.params.provedores === 'grok' ? ['grok'] : job.params.provedores === 'codex' ? ['codex'] : ['grok', 'codex']
    const intent = { schema_version: 2, target, focus: foco, target_kind: 'project', user_request: job.briefing || item.titulo, requested_output: `one ${intencao.output_purpose} image (${intencao.output_topology}, text ${intencao.text_policy})`, subject_role: 'DailyWork project evidence', output_purpose: intencao.output_purpose, output_topology: intencao.output_topology, output_count: 1, text_policy: intencao.text_policy, explicit_facts: [item.titulo, item.texto], allowed_transformations: ['layout', 'typography', 'color', 'diagram'], must_not_infer: intencao.must_not_infer.length ? intencao.must_not_infer : ['revenue', 'users', 'clients', 'awards'], allow_brand: false, allow_business: false, allow_profession: false, allow_full_catalog: false, catalog_include: [selecao.template_id], catalog_exclude: [], audience: intencao.publico, reviewed: true }
    const creative = { id: plano.id, title: plano.title, template_id: selecao.template_id, case_ids: selecao.case_ids, purpose: intencao.output_purpose, output_topology: intencao.output_topology, text_policy: intencao.text_policy, scene: plano.scene, action: plano.action, composition: plano.composition, camera: plano.camera, lighting: plano.lighting, styling: plano.styling, palette: plano.palette, mood: plano.mood, style_direction: plano.style_direction, aspect_ratio: plano.aspect_ratio, avoid: plano.avoid }
    if (intencao.text_policy !== 'forbidden' && plano.text_content) creative.text_content = plano.text_content
    const brief = { schema_version: 2, target, display_name: target, focus: foco, target_kind: 'project', output_purpose: intent.output_purpose, output_topology: intent.output_topology, output_count: 1, text_policy: intent.text_policy, intent_contract: 'intent-contract.json', allow_brand: false, allow_business: false, allow_profession: false, brand: '', identity_lock: 'Preserve only the project evidence and visual references supplied by the DailyWork item.', subject_description: 'DailyWork project evidence', audience: intent.audience, palette: plano.palette, hero_product: 'the documented project evidence', scene_direction: plano.scene, references: referencias, providers: provedores, creative_plan: [creative], catalog_include: intent.catalog_include, catalog_exclude: [] }
    gravarJson(path.join(runDir, 'intent-contract.json'), intent)
    gravarJson(path.join(runDir, 'production-brief.json'), brief)
  }
  // Preparo agentivo: intenção por pauta → busca real na biblioteca → escolha
  // de mecanismos → plano criativo com visão das referências. É a etapa que a
  // skill da Factory chama de "host agent"; antes era uma chamada única e fixa.
  async function prepararImagem(job) {
    const curadoria = curadoriaDoJob(job)
    const item = job.itemSnapshot || await itemAtual(job)
    job.itemSnapshot = item
    job.params.alvo = `DAILYWORK_${job.id}`
    job.params.foco = `editorial-${job.id}`
    // A Factory não dispara leva sem referência real legível (diagnosticar
    // reprova com REFERENCIA_ILEGIVEL); falha antes de gastar tokens de LLM.
    const origens = []
    for (const midia of (item.midias || [])) if (midia.tipo === 'imagem') origens.push({ arquivo: midia.arquivo, mime: midia.mime || 'image/png' })
    for (const referencia of (job.params.references || [])) origens.push({ arquivo: referencia, mime: 'image/png' })
    if (!origens.length) {
      const hunt = await caçarReferencias(item)
      for (const referencia of hunt.references) origens.push({ arquivo: referencia, mime: 'image/png' })
      if (hunt.references.length) {
        job.params.references = hunt.references
        job.params.referenciasOrigem = hunt.achados
      }
    }
    if (!origens.length) throw erro('FACTORY_SEM_REFERENCIA', 'a Image Factory exige uma referência real: o app não achou screenshot nem fonte pública do projeto')
    const intencao = await curadoria.intencao({ pauta: item, briefing: job.briefing, propositos: lerTaxonomia(), combos: lerCombosDisponiveis() })
    checkCancel(job)
    // A busca da Factory é ranqueada (fuzzy); o filtro estrito client-side
    // garante que só opções aceitas pelo validar cheguem à escolha do LLM.
    let casos = (await casosBuscar(job, intencao)).filter((caso) => casoCompativel(caso, intencao))
    if (!casos.length) casos = (await casosBuscar(job, intencao, true)).filter((caso) => casoCompativel(caso, intencao))
    if (!casos.length) throw erro('FACTORY_SEM_CASOS', 'a biblioteca da Image Factory não devolveu casos compatíveis com a intenção desta pauta')
    let templates = (await modelosListar(job, intencao)).filter((template) => templateCompativel(template, intencao))
    if (!templates.length) templates = (await modelosListar(job, intencao, true)).filter((template) => templateCompativel(template, intencao))
    if (!templates.length) throw erro('FACTORY_SEM_TEMPLATES', 'a Image Factory não devolveu templates compatíveis com a intenção desta pauta')
    const selecao = await curadoria.selecionarMecanismos({ pauta: item, briefing: job.briefing, intencao, casos, templates })
    checkCancel(job)
    const casosDetalhes = JSON.stringify(await cli('casos', ['ver', '--ids', selecao.case_ids.join(',')], job) || {}).slice(0, 6_000)
    const templateDetalhes = JSON.stringify(await cli('modelos', ['ver', '--ids', selecao.template_id], job) || {}).slice(0, 3_000)
    // Referências reais do item (máx. 3, contrato da Factory): copiadas para o
    // alvo e lidas em base64 para a visão do planejador.
    const targetDir = path.join(imageFactoryRoot, 'ALVOS', job.params.alvo)
    fs.mkdirSync(targetDir, { recursive: true })
    const refs = []
    const refsVisao = []
    for (const origemRef of origens.slice(0, 3)) {
      const origem = caminhoRealSeguro(origemRef.arquivo, path.join(dataDir, 'editorial'))
      const destino = path.join(targetDir, path.basename(origem))
      fs.copyFileSync(origem, destino)
      validarArtefato(destino, { kind: 'image', mime: origemRef.mime })
      refs.push(path.basename(destino))
      const visao = lerImagemBase64(destino)
      if (visao) refsVisao.push(visao)
    }
    const plano = await curadoria.planoCriativo({ pauta: item, briefing: job.briefing, intencao, selecao, casosDetalhes, templateDetalhes, referencias: refsVisao })
    checkCancel(job)
    gravarJson(path.join(targetDir, 'PERFIL.json'), { schema_version: 1, natureza: 'project', nome: job.params.alvo, fatos: [item.titulo, item.texto] })
    gravarContratos(job, { foco: job.params.foco, intencao, selecao, plano, referencias: refs })
    job.factoryPrepared = true
    job.preparacao = { intencao, selecao, plano, casosDetalhes, templateDetalhes, referencias: refs }
    job.atualizadoEm = agora(); persistir(job)
  }
  // Retentativa: novo foco com plano revisado a partir das notas da revisão
  // visual reprovada. Intenção e mecanismos se mantêm; a direção é corrigida.
  async function replanar(job, numero) {
    const foco = `${job.params.foco}-t${numero}`
    const anterior = job.tentativas[job.tentativas.length - 1]
    const notas = (anterior?.vereditos || []).map((veredito) => `${veredito.provedor}: ${veredito.notes}`).filter((entrada) => !entrada.endsWith(': ')).join(' | ')
    const targetDir = path.join(imageFactoryRoot, 'ALVOS', job.params.alvo)
    const refsVisao = (job.preparacao?.referencias || []).map((nome) => lerImagemBase64(path.join(targetDir, path.basename(nome)))).filter(Boolean)
    const plano = await curadoriaDoJob(job).planoCriativo({ pauta: job.itemSnapshot, briefing: job.briefing, intencao: job.preparacao.intencao, selecao: job.preparacao.selecao, casosDetalhes: job.preparacao.casosDetalhes, templateDetalhes: job.preparacao.templateDetalhes, referencias: refsVisao, revisaoAnterior: { notas } })
    gravarContratos(job, { foco, intencao: job.preparacao.intencao, selecao: job.preparacao.selecao, plano, referencias: job.preparacao.referencias || [] })
    job.preparacao[`planoT${numero}`] = plano
    job.atualizadoEm = agora(); persistir(job)
    return foco
  }
  function comando(args, job = null) {
    const resultado = execFileImpl(args.executable, args.args, { cwd: args.cwd, env: args.env || process.env, windowsHide: true })
    if (job && resultado && typeof resultado.then === 'function') processos.set(job.id, resultado)
    return resultado
  }
  async function cli(operacao, args, job) {
    const resultado = await comando({ executable: imageFactoryPython, args: [imageFactoryScript, operacao, ...args, '--root', imageFactoryRoot] }, job)
    processos.delete(job.id)
    return parseSaida(resultado?.stdout ?? resultado)
  }
  function checkCancel(job) { const atual = lerJson(arquivo(job.id), job); if (atual.status === 'cancelled') throw erro('JOB_CANCELADO', 'job de mídia cancelado') }
  function tipoArtefato(arquivo) { return /\.mp4$/i.test(arquivo) ? 'video' : 'image' }
  function manifestDoJob(job, arquivos) {
    const artifacts = arquivos.map((arquivo) => ({ path: path.relative(job.outputDir, arquivo), kind: tipoArtefato(arquivo), mime: /\.mp4$/i.test(arquivo) ? 'video/mp4' : (/\.png$/i.test(arquivo) ? 'image/png' : 'image/jpeg') }))
    return { version: 1, jobId: job.id, pautaId: job.pautaId, tipo: job.tipo === 'video' ? 'mini-vitrine' : 'image-factory', status: 'ready', outputDir: job.outputDir, request: job.request, artifacts }
  }
  async function anexar(job, arquivos) {
    checkCancel(job)
    await itemAtual(job)
    for (const arquivo of arquivos) if (tipoArtefato(arquivo) === 'image') validarImagemEditorial(arquivo)
    const manifest = validarManifest(manifestDoJob(job, arquivos), { exigirArquivos: true })
    checkCancel(job)
    await itemAtual(job)
    const anexado = await importarMidias({ manifest, dataDir, fila, itemId: job.itemId, revisao: job.revisao, beforeAnexo: () => checkCancel(job) })
    checkCancel(job)
    return anexado.midias
  }
  async function aguardarEReceber(job, trabalho) {
    const fim = Number.isFinite(timeoutMs) ? Number(now()) + Number(timeoutMs) : null
    while (fim === null || Number(now()) < fim) {
      checkCancel(job)
      const vista = await cli('acompanhar', ['--trabalho', trabalho], job)
      const estado = acharEstadoFactory(vista)
      if (TERMINAIS.has(estado)) {
        if (!['concluido', 'concluída', 'concluido_com_avisos'].includes(estado)) throw erro('FACTORY_FALHOU', `Image Factory terminou em ${estado}`)
        checkCancel(job)
        return cli('receber', ['--trabalho', trabalho], job)
      }
      await sleep(pollMs)
    }
    throw erro('FACTORY_TIMEOUT', 'tempo limite aguardando Image Factory')
  }
  function geradorDoJob() {
    return gerarImagemCli || criarGeradorImagensCli()
  }
  function referenciasDoJob(job) {
    const item = job.itemSnapshot || {}
    const destinos = []
    for (const midia of (job.params.sequencia ? [] : item.midias || [])) {
      if (midia.tipo !== 'imagem' || !midia.arquivo) continue
      const arquivo = path.isAbsolute(midia.arquivo) ? midia.arquivo : path.join(dataDir, 'editorial', midia.arquivo)
      if (fs.existsSync(arquivo)) destinos.push(arquivo)
    }
    for (const referencia of (job.params.references || [])) {
      const arquivo = path.isAbsolute(referencia) ? referencia : path.join(dataDir, 'editorial', referencia)
      if (fs.existsSync(arquivo)) destinos.push(arquivo)
    }
    return [...new Set(destinos)].slice(0, 4)
  }
  function validarImagemEditorial(arquivo) {
    const propriedades = validarArtefato(arquivo, { kind: 'image' })
    const { width, height } = propriedades
    if (Math.min(width, height) < 480 || Math.max(width, height) < 800 || width * height > 40_000_000) throw erro('IMAGEM_RESOLUCAO_BAIXA', 'Use uma imagem com pelo menos 800 px no lado maior e 480 px no menor, até 40 megapixels.')
    return propriedades
  }
  // Direção editorial usa a pauta aprovada e o gerador configurado. A biblioteca
  // Python da Factory permanece disponível como motor avançado, não obrigatório.
  async function executarImagemEditorial(job) {
    const curador = curadoriaDoJob(job)
    if (typeof completarComImagens !== 'function') throw erro('VISAO_INDISPONIVEL', 'Ative um provedor com visão antes de gerar imagens para revisão.')
    if (job.autorizarGasto !== true) throw erro('AUTORIZACAO_FACTORY_AUSENTE', 'A geração de imagem precisa estar permitida na configuração da Fila.')
    const refs = referenciasDoJob(job)
    const referencias = refs.map(lerImagemBase64).filter(Boolean)
    const intencao = await curador.intencao({ pauta: job.itemSnapshot, briefing: job.briefing })
    const selecao = { template_id: 'direcao-editorial', case_ids: [] }
    fs.mkdirSync(job.outputDir, { recursive: true })
    job.tentativas = Array.isArray(job.tentativas) ? job.tentativas : []
    let revisaoAnterior = null
    const max = Math.max(1, Math.min(3, Number(maxTentativasImagem) || 2))
    while (job.tentativas.length < max) {
      checkCancel(job); await itemAtual(job)
      const plano = await curador.planoCriativo({ pauta: job.itemSnapshot, briefing: job.briefing, intencao, selecao, referencias, revisaoAnterior })
      checkCancel(job); await itemAtual(job)
      job.preparacao = { intencao, plano }; persistir(job)
      const numero = job.tentativas.length + 1
      const provedor = job.params.provedores === 'grok' ? 'grok' : 'codex'
      const prompt = promptDoPlano(plano, job.itemSnapshot)
      gravarJson(path.join(job.outputDir, `direcao-${numero}.json`), { prompt, intencao, plano, referencias: refs, provedor })
      const gerada = await geradorDoJob().gerar({ provedor, prompt, refs, dest: path.join(job.outputDir, `editorial-${numero}.png`), aspectRatio: plano.aspect_ratio })
      checkCancel(job)
      validarImagemEditorial(gerada.path)
      const imagem = lerImagemBase64(gerada.path)
      if (!imagem) throw erro('IMAGEM_INVALIDA', 'A saída não pôde ser lida para a revisão visual.')
      const revisao = await curador.revisarSaidas({ pauta: job.itemSnapshot, intencao, plano, referencias, saidas: [{ provedor, ...imagem }] })
      job.tentativas.push({ numero, vencedor: revisao.vencedor, vereditos: revisao.vereditos, modelo: gerada.modelo, via: gerada.via, arquivo: path.relative(job.outputDir, gerada.path) })
      persistir(job)
      if (revisao.vencedor) {
        job.revisaoVisual = { ...revisao, tentativas: numero, motor: 'editorial', degradada: false }
        return anexar(job, [gerada.path])
      }
      revisaoAnterior = { notas: revisao.vereditos.map(v => v.notes).join('; ') }
    }
    throw erro('FACTORY_REVISAO_REPROVOU', `A imagem não passou na revisão: ${revisaoAnterior?.notas || 'veja as avaliações do job'}`)
  }
  async function executarImagemImportada(job) {
    const origem = caminhoRealSeguro(job.params.imagemImportada, job.outputDir)
    validarImagemEditorial(origem)
    const imagem = lerImagemBase64(origem)
    if (!imagem) throw erro('IMAGEM_INVALIDA', 'A imagem importada não pode ser analisada.')
    const revisao = await curadoriaDoJob(job).revisarSaidas({ pauta: job.itemSnapshot, referencias: referenciasDoJob(job).map(lerImagemBase64).filter(Boolean), saidas: [{ provedor: 'imagem-importada', ...imagem }] })
    job.revisaoVisual = { ...revisao, tentativas: 1, motor: 'importacao', degradada: false }
    persistir(job)
    if (!revisao.vencedor) throw erro('FACTORY_REVISAO_REPROVOU', revisao.vereditos.map(v => v.notes).join('; '))
    return anexar(job, [origem])
  }
  // Motor `cli`: gera pelas sessões Grok CLI / Codex (9Router) já logadas,
  // com o plano da curadoria e o mesmo portão de revisão visual da Factory.
  async function executarImagemCli(job) {
    if (!job.factoryPrepared || !job.preparacao?.intencao) await prepararImagem(job)
    const maxTentativas = Math.max(1, Math.min(3, Number(maxTentativasImagem) || 2))
    job.tentativas = Array.isArray(job.tentativas) ? job.tentativas : []
    const aprovada = job.tentativas[job.tentativas.length - 1]
    if (aprovada?.vencedor && !aprovada.degradada && aprovada.vereditos?.some(v => v.accepted) && aprovada.arquivos?.[aprovada.vencedor]) {
      const arquivo = path.join(job.outputDir, aprovada.arquivos[aprovada.vencedor])
      if (fs.existsSync(arquivo)) {
        job.artefatosComplementares = Object.values(aprovada.arquivos).filter((rel) => rel !== aprovada.arquivos[aprovada.vencedor])
        job.revisaoVisual = { tentativas: aprovada.numero, vencedor: aprovada.vencedor, vereditos: aprovada.vereditos, degradada: aprovada.degradada === true }
        return anexar(job, [arquivo])
      }
    }
    const nomes = job.params.provedores === 'grok' ? ['grok'] : job.params.provedores === 'codex' ? ['codex'] : ['grok', 'codex']
    const refs = referenciasDoJob(job)
    while (job.tentativas.length < maxTentativas) {
      const numero = job.tentativas.length + 1
      if (numero > 1) await replanar(job, numero)
      if (job.autorizarGasto !== true) throw erro('AUTORIZACAO_FACTORY_AUSENTE', 'produção de imagem exige autorizarGasto=true na configuração')
      checkCancel(job)
      const planoDaTentativa = numero === 1 ? job.preparacao?.plano : job.preparacao?.[`planoT${numero}`]
      const prompt = promptDoPlano(planoDaTentativa, job.itemSnapshot)
      fs.mkdirSync(job.outputDir, { recursive: true })
      const saidas = []
      const gerador = geradorDoJob()
      for (const provedor of nomes) {
        checkCancel(job)
        const destino = path.join(job.outputDir, `${provedor}-t${numero}.png`)
        if (fs.existsSync(destino) && fs.statSync(destino).size > 200) {
          saidas.push({ provedor, arquivo: destino, modelo: provedor === 'grok' ? 'grok-imagine-image-2.0' : 'cx/gpt-5.5-image', via: 'disco' })
          continue
        }
        const gerada = await gerador.gerar({ provedor, prompt, refs, dest: destino, aspectRatio: planoDaTentativa?.aspect_ratio || job.preparacao?.intencao?.aspect_ratio || '4:5' })
        saidas.push({ provedor, arquivo: gerada.path, modelo: gerada.modelo, via: gerada.via })
      }
      if (!saidas.length) throw erro('FACTORY_SEM_ARQUIVOS', 'o gerador CLI não devolveu imagens')
      const saidasVisao = saidas.map((saida) => ({ provedor: saida.provedor, ...lerImagemBase64(saida.arquivo) })).filter((saida) => saida.base64)
      if (!saidasVisao.length) throw erro('FACTORY_SEM_IMAGEM', 'nenhuma saída pôde ser lida para a revisão visual')
      let revisao
      try {
        revisao = await curadoriaDoJob(job).revisarSaidas({ pauta: job.itemSnapshot, intencao: job.preparacao?.intencao, plano: planoDaTentativa, saidas: saidasVisao, referencias: referenciasDoJob(job).map(lerImagemBase64).filter(Boolean) })
      } catch (causa) {
        throw causa
      }
      job.tentativas.push({ numero, motor: 'cli', vencedor: revisao.vencedor, vereditos: revisao.vereditos, degradada: revisao.degradada === true, modelos: Object.fromEntries(saidas.map((saida) => [saida.provedor, saida.modelo])), arquivos: Object.fromEntries(saidas.map((saida) => [saida.provedor, path.relative(job.outputDir, saida.arquivo)])) })
      job.atualizadoEm = agora(); persistir(job)
      if (revisao.vencedor) {
        const vencedora = saidas.find((saida) => saida.provedor === revisao.vencedor)
        job.artefatosComplementares = saidas.filter((saida) => saida !== vencedora).map((saida) => path.relative(job.outputDir, saida.arquivo))
        job.revisaoVisual = { tentativas: numero, vencedor: revisao.vencedor, vereditos: revisao.vereditos, degradada: revisao.degradada === true, motivo: revisao.motivo, motor: 'cli' }
        return anexar(job, [vencedora.arquivo])
      }
    }
    const notas = job.tentativas.flatMap((tentativa) => (tentativa.vereditos || []).map((veredito) => veredito.notes)).filter(Boolean).join(' | ')
    throw erro('FACTORY_REVISAO_REPROVOU', `nenhuma saída passou na revisão visual${notas ? `: ${notas.slice(0, 280)}` : ''}`)
  }
  async function executarSequenciaReal(job, refs) {
    checkCancel(job)
    if (refs.length !== job.params.references.length) throw erro('ARTEFATO_AUSENTE', 'Uma cena da sequência não está mais disponível.')
    const imagens = refs.map((origem, i) => {
      validarImagemEditorial(origem)
      const imagem = lerImagemBase64(origem)
      if (!imagem) throw erro('IMAGEM_INVALIDA', 'A cena não pôde ser lida.')
      const esperada = job.params.referenciasSelecionadas?.[i]?.sha256
      if (esperada && crypto.createHash('sha256').update(Buffer.from(imagem.base64, 'base64')).digest('hex') !== esperada) throw erro('REFERENCIA_ALTERADA', 'A cena mudou depois da seleção editorial.')
      return { provedor: `cena-${i + 1}`, ...imagem }
    })
    const revisao = await curadoriaDoJob(job).revisarSaidas({ pauta: job.itemSnapshot, intencao: { output_topology: 'ui-screen', text_policy: 'optional', reference_mode: 'unchanged-verified-capture' }, saidas: imagens })
    if (!imagens.every(i => revisao.vereditos.some(v => v.provedor === i.provedor && v.accepted))) throw erro('REFERENCIA_INADEQUADA', revisao.vereditos.filter(v => !v.accepted).map(v => v.notes).join('; '))
    checkCancel(job)
    // Revise e anexe exatamente os bytes enviados à visão, na mesma ordem.
    fs.mkdirSync(job.outputDir, { recursive: true })
    const arquivos = imagens.map((imagem, i) => {
      const destino = path.join(job.outputDir, `cena-${i + 1}${imagem.mimeType === 'image/jpeg' ? '.jpg' : '.png'}`)
      fs.writeFileSync(destino, Buffer.from(imagem.base64, 'base64'))
      return destino
    })
    job.revisaoVisual = { ...revisao, estrategia: 'referencia-real', sequencia: true, fontes: refs.map(p => path.basename(p)), degradada: false }
    return anexar(job, arquivos)
  }
  async function executarReferenciaReal(job) {
    const refs = referenciasDoJob(job)
    if (!refs.length) throw erro('FACTORY_SEM_REFERENCIA', 'a peça baseada em evidência precisa de uma captura real do projeto')
    if (job.params.sequencia) return executarSequenciaReal(job, refs)
    const motivos = []
    for (const origem of refs) {
      checkCancel(job)
      try {
        const { mime } = validarImagemEditorial(origem)
        const imagem = lerImagemBase64(origem)
        if (!imagem) throw erro('IMAGEM_INVALIDA', 'A captura não pôde ser lida para revisão.')
        const revisao = await curadoriaDoJob(job).revisarSaidas({ pauta: job.itemSnapshot, intencao: { output_topology: 'ui-screen', text_policy: 'optional', reference_mode: 'unchanged-verified-capture' }, exemplosEstilo: imagensDeEstilo(job.itemSnapshot.editorial?.perfilEditorial), saidas: [{ provedor: 'captura', ...imagem }] })
        if (!revisao.vencedor) { motivos.push(...revisao.vereditos.map(v => v.notes)); continue }
        fs.mkdirSync(job.outputDir, { recursive: true })
        const destino = path.join(job.outputDir, `evidencia-real${mime === 'image/jpeg' ? '.jpg' : '.png'}`)
        fs.copyFileSync(origem, destino)
        job.revisaoVisual = { ...revisao, tentativas: 1, estrategia: 'referencia-real', fonte: path.basename(origem), degradada: false }
        return anexar(job, [destino])
      } catch (causa) {
        if (!['IMAGEM_RESOLUCAO_BAIXA', 'IMAGEM_INVALIDA'].includes(causa.codigo)) throw causa
        motivos.push(causa.message)
      }
    }
    throw erro('REFERENCIA_INADEQUADA', `Nenhuma captura sustenta esta história: ${motivos.join('; ').slice(0, 500)}`)
  }
  // Execução com gate de revisão visual: dispara Grok + Codex, revisa as saídas
  // com visão, anexa a vencedora; reprovadas geram nova tentativa com plano
  // corrigido (até maxTentativasImagem). Sem aprovação, o job falha com as notas.
  async function executarImagem(job) {
    if (job.params.estrategia === 'importacao') return executarImagemImportada(job)
    if (job.params.estrategia === 'editorial') return executarImagemEditorial(job)
    if (job.params.estrategia === 'referencia-real') return executarReferenciaReal(job)
    if (!job.factoryPrepared || !job.preparacao?.intencao) await prepararImagem(job)
    const alvo = job.params.alvo
    if ((job.params.motor || 'cli') === 'cli') return executarImagemCli(job)
    const provedores = job.params.provedores || 'both'
    const maxTentativas = Math.max(1, Math.min(3, Number(maxTentativasImagem) || 2))
    job.tentativas = Array.isArray(job.tentativas) ? job.tentativas : []
    // Retomada: se o processo caiu depois da aprovação e antes do anexo,
    // reutiliza a saída vencedora já persistida em vez de gerar de novo.
    const aprovada = job.tentativas[job.tentativas.length - 1]
    if (aprovada?.vencedor && !aprovada.degradada && aprovada.vereditos?.some(v => v.accepted) && aprovada.arquivos?.[aprovada.vencedor]) {
      const arquivo = path.join(job.outputDir, aprovada.arquivos[aprovada.vencedor])
      if (fs.existsSync(arquivo)) {
        job.artefatosComplementares = Object.values(aprovada.arquivos).filter((rel) => rel !== aprovada.arquivos[aprovada.vencedor])
        job.revisaoVisual = { tentativas: aprovada.numero, vencedor: aprovada.vencedor, vereditos: aprovada.vereditos, degradada: aprovada.degradada === true }
        return anexar(job, [arquivo])
      }
    }
    while (job.tentativas.length < maxTentativas) {
      const numero = job.tentativas.length + 1
      const foco = numero === 1 ? job.params.foco : await replanar(job, numero)
      let trabalho = job.tentativaEmAndamento?.numero === numero ? job.tentativaEmAndamento.trabalho : null
      if (!trabalho) {
        await cli('descrever', [], job); checkCancel(job)
        await cli('validar', ['--alvo', alvo, '--foco', foco], job); checkCancel(job)
        await cli('diagnosticar', ['--alvo', alvo, '--foco', foco, '--provedores', provedores], job); checkCancel(job)
        if (job.autorizarGasto !== true) throw erro('AUTORIZACAO_FACTORY_AUSENTE', 'produção Image Factory exige autorizarGasto=true na configuração')
        const disparado = await cli('disparar', ['--alvo', alvo, '--foco', foco, '--provedores', provedores, '--chave', `${job.id}-t${numero}`, '--autorizar-gasto', 'SIM-GASTAR'], job)
        trabalho = acharTrabalho(disparado)
        if (!trabalho) throw erro('FACTORY_SEM_TRABALHO', 'disparar não devolveu trabalho')
        job.tentativaEmAndamento = { numero, foco, trabalho }
        job.factoryWork = trabalho; job.atualizadoEm = agora(); persistir(job)
      }
      const recebido = await aguardarEReceber(job, trabalho)
      checkCancel(job)
      const entregas = extrairEntregaPorProvedor(recebido)
      fs.mkdirSync(job.outputDir, { recursive: true })
      const saidas = []
      for (const entrega of entregas) {
        const origem = caminhoRealSeguro(entrega.imagens[0], imageFactoryRoot, 'FACTORY_ARQUIVO_INVALIDO')
        validarArtefato(origem, { kind: 'image', mime: 'image/png' })
        const destino = path.join(job.outputDir, `${entrega.provedor}-t${numero}-${path.basename(origem)}`)
        fs.copyFileSync(origem, destino)
        saidas.push({ provedor: entrega.provedor, arquivo: destino })
      }
      if (!saidas.length) throw erro('FACTORY_SEM_ARQUIVOS', 'receber não devolveu imagens verificáveis')
      checkCancel(job)
      const saidasVisao = saidas.map((saida) => ({ provedor: saida.provedor, ...lerImagemBase64(saida.arquivo) })).filter((saida) => saida.base64)
      if (!saidasVisao.length) throw erro('FACTORY_SEM_IMAGEM', 'nenhuma saída pôde ser lida para a revisão visual')
      const planoDaTentativa = numero === 1 ? job.preparacao?.plano : job.preparacao?.[`planoT${numero}`]
      let revisao
      try {
        revisao = await curadoriaDoJob(job).revisarSaidas({ pauta: job.itemSnapshot, intencao: job.preparacao?.intencao, plano: planoDaTentativa, saidas: saidasVisao, referencias: referenciasDoJob(job).map(lerImagemBase64).filter(Boolean) })
      } catch (causa) {
        throw causa
      }
      job.tentativas.push({ numero, foco, trabalho, vencedor: revisao.vencedor, vereditos: revisao.vereditos, degradada: revisao.degradada === true, arquivos: Object.fromEntries(saidas.map((saida) => [saida.provedor, path.relative(job.outputDir, saida.arquivo)])) })
      job.tentativaEmAndamento = null
      job.atualizadoEm = agora(); persistir(job)
      if (revisao.vencedor) {
        const vencedora = saidas.find((saida) => saida.provedor === revisao.vencedor)
        job.artefatosComplementares = saidas.filter((saida) => saida !== vencedora).map((saida) => path.relative(job.outputDir, saida.arquivo))
        job.revisaoVisual = { tentativas: numero, vencedor: revisao.vencedor, vereditos: revisao.vereditos, degradada: revisao.degradada === true, motivo: revisao.motivo }
        return anexar(job, [vencedora.arquivo])
      }
    }
    const notas = job.tentativas.flatMap((tentativa) => (tentativa.vereditos || []).map((veredito) => veredito.notes)).filter(Boolean).join(' | ')
    throw erro('FACTORY_REVISAO_REPROVOU', `nenhuma saída passou na revisão visual${notas ? `: ${notas.slice(0, 280)}` : ''}`)
  }
  function materializarRoteiro(job) {
    const origem = caminhoRealSeguro(job.params.roteiroFile, path.dirname(path.resolve(job.params.roteiroFile)), 'ROTEIRO_INVALIDO')
    const bruto = lerJson(origem, null)
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw erro('ROTEIRO_INVALIDO', 'roteiro deve ser objeto JSON')
    const spec = clone(bruto)
    const segmentos = Array.isArray(spec.segments) ? spec.segments : (Array.isArray(spec.cenas) ? spec.cenas : null)
    const campos = ['file', 'path', 'image', 'imagem', 'audio', 'wav', 'narration', 'narracao', 'voiceover', 'at', 'scene', 'slide']
    if (segmentos) {
      for (const segmento of segmentos) {
        if (!segmento || typeof segmento !== 'object') throw erro('ROTEIRO_INVALIDO', 'segmento inválido')
        for (const campo of campos) {
          if (typeof segmento[campo] !== 'string' || !segmento[campo]) continue
          const permitido = caminhoRealSeguro(segmento[campo], path.dirname(origem), 'ROTEIRO_ENTRADA_INVALIDA')
          segmento[campo] = permitido
        }
        if (Array.isArray(segmento.narr)) {
          for (const entrada of segmento.narr) {
            if (!Array.isArray(entrada) || typeof entrada[0] !== 'string') throw erro('ROTEIRO_INVALIDO', 'entrada narr inválida')
            entrada[0] = caminhoRealSeguro(entrada[0], path.dirname(origem), 'ROTEIRO_ENTRADA_INVALIDA')
          }
        }
      }
    }
    fs.mkdirSync(job.outputDir, { recursive: true })
    spec.out = 'video.mp4'
    const materializado = path.join(job.outputDir, 'roteiro.json')
    gravarJson(materializado, spec)
    return materializado
  }
  async function executarVideo(job) {
    let roteiro
    const referencias = []
    if (job.params.automatico === true) {
      const imagens = (job.itemSnapshot.midias || []).filter(m => m.tipo === 'imagem').slice(0, 4)
      if (!imagens.length) throw erro('VIDEO_SEM_CENAS', 'Prepare ou importe uma imagem da peça antes de criar o vídeo.')
      fs.mkdirSync(job.outputDir, { recursive: true })
      const segments = imagens.map((midia, i) => {
        const origem = caminhoRealSeguro(midia.arquivo, path.join(dataDir, 'editorial'))
        validarImagemEditorial(origem)
        const imagem = lerImagemBase64(origem)
        referencias.push(imagem)
        const destino = path.join(job.outputDir, `fonte-${i + 1}${imagem.mimeType === 'image/jpeg' ? '.jpg' : '.png'}`)
        fs.writeFileSync(destino, Buffer.from(imagem.base64, 'base64'))
        return { slide: destino, dur: 6, fit: 'contain' }
      })
      roteiro = path.join(job.outputDir, 'roteiro.json')
      gravarJson(roteiro, { size: [1280, 720], fps: 24, allow_silent: true, segments, out: 'video.mp4' })
      job.etapa = 'Montando vídeo com as imagens da peça'; persistir(job)
    } else roteiro = materializarRoteiro(job)
    checkCancel(job)
    await comando({ executable: vitrinePython, args: [vitrineCompose, roteiro], cwd: job.outputDir, env: process.env }, job)
    checkCancel(job)
    const arquivos = arquivosMidia(job.outputDir)
    const videos = arquivos.filter((arquivo) => /\.mp4$/i.test(arquivo))
    if (!videos.length) throw erro('VIDEO_AUSENTE', 'compose não produziu vídeo MP4')
    const principal = videos.find((arquivo) => path.basename(arquivo) === 'video.mp4') || videos[0]
    if (job.params.automatico === true) {
      job.etapa = 'Revisando as cenas do vídeo'; persistir(job)
      const saidas = []
      for (let i = 0; i < referencias.length; i++) {
        const frame = path.join(job.outputDir, `revisao-${i + 1}.jpg`)
        await comando({ executable: 'ffmpeg', args: ['-y', '-loglevel', 'error', '-ss', String(i * 6 + 3), '-i', principal, '-frames:v', '1', frame], cwd: job.outputDir, env: process.env }, job)
        saidas.push({ provedor: `cena-${i + 1}`, ...lerImagemBase64(frame) })
      }
      const revisao = await curadoriaDoJob(job).revisarSaidas({ pauta: job.itemSnapshot, referencias, saidas, intencao: { output_topology: 'ui-screen', text_policy: 'optional', reference_mode: 'unchanged-verified-capture' } })
      job.revisaoVisual = { ...revisao, tentativas: 1, estrategia: 'video-com-imagens', degradada: false }
      if (!saidas.every(s => revisao.vereditos.some(v => v.provedor === s.provedor && v.accepted))) throw erro('VIDEO_REPROVADO', 'Uma cena do vídeo não passou na revisão visual. As imagens anteriores foram preservadas.')
      checkCancel(job)
    }
    job.artefatosComplementares = arquivos.filter((arquivo) => arquivo !== principal).map((arquivo) => path.relative(job.outputDir, arquivo))
    return anexar(job, [principal])
  }
  async function executar(job) {
    if (!adquirirLock(job.id)) return
    try {
      const salvo = lerJson(arquivo(job.id), job)
      if (salvo.status === 'cancelled') return
      job = salvo
      job.status = 'producing'; job.iniciadoEm = agora(); persistir(job)
      checkCancel(job)
      await itemAtual(job)
      const midias = job.tipo === 'video' ? await executarVideo(job) : await executarImagem(job)
      checkCancel(job)
      const atual = lerJson(arquivo(job.id), job)
      if (atual.status === 'cancelled') return
      job.status = 'ready'; job.midias = midias; job.concluidoEm = agora(); job.atualizadoEm = agora(); persistir(job)
    } catch (causa) {
      const atual = lerJson(arquivo(job.id), job)
      job.status = atual.status === 'cancelled' ? 'cancelled' : 'failed'; job.erro = { codigo: causa.codigo || 'JOB_MIDIA_FALHOU', mensagem: causa.message }; job.atualizadoEm = agora(); persistir(job)
    } finally { processos.delete(job.id); ativos.delete(job.id); liberarLock(job.id) }
  }
  async function iniciar({ itemId, revisao, tipo, briefing = '', ...params } = {}) {
    if (!itemId || !Number.isInteger(revisao) || !TIPOS.has(tipo)) throw erro('ENTRADA_INVALIDA', 'itemId, revisao e tipo (imagem|video) são obrigatórios')
    const item = await fila.obter(itemId)
    if (!item) throw erro('ITEM_NAO_ENCONTRADO', 'item editorial não existe')
    if (item.revisao !== revisao) throw erro('REVISAO_OBSOLETA', 'a revisão da Fila mudou antes do job de mídia')
    if (!['pendente', 'erro'].includes(item.estado)) throw erro('ITEM_ESTADO_INVALIDO', `item não está disponível para mídia: ${item.estado}`)
    if (params.estrategia === 'referencia-real' && !params.references?.length) {
      const midia = item.editorial?.pauta?.midia
      const selecionadas = midia?.referencias || (midia?.referencia ? [{ arquivo: midia.referencia, sha256: midia.referenciaSha256 }] : [])
      if (selecionadas.length) {
        const raiz = fs.realpathSync(path.resolve(dataDir, 'editorial')) + path.sep
        params.references = selecionadas.map(ref => {
          const origem = fs.realpathSync(path.resolve(dataDir, 'editorial', ref.arquivo))
          if (!origem.startsWith(raiz) || !ref.sha256 || crypto.createHash('sha256').update(fs.readFileSync(origem)).digest('hex') !== ref.sha256) throw erro('REFERENCIA_ALTERADA', 'A captura escolhida mudou depois da seleção da pauta.')
          return ref.arquivo
        })
        params.sequencia = Boolean(midia.referencias?.length)
        params.referenciasSelecionadas = selecionadas
      }
    }
    if (params.sequencia && (!Array.isArray(params.references) || !params.references.length || params.references.length > 4 || new Set(params.references).size !== params.references.length)) throw erro('ENTRADA_INVALIDA', 'A sequência precisa de uma a quatro referências distintas.')
    reler(); relerConfig()
    let imagemBytes = null
    if (params.imagemBase64 != null) {
      if (tipo !== 'imagem' || typeof params.imagemBase64 !== 'string' || params.imagemBase64.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(params.imagemBase64)) throw erro('IMAGEM_INVALIDA', 'Envie uma imagem PNG ou JPEG em base64, com até 4 MB.')
      imagemBytes = Buffer.from(params.imagemBase64, 'base64')
      const mime = mimeDaImagem(imagemBytes)
      if (!['image/png', 'image/jpeg'].includes(mime) || imagemBytes.length > 4 * 1024 * 1024) throw erro('IMAGEM_INVALIDA', 'Envie uma imagem PNG ou JPEG com até 4 MB.')
      params.estrategia = 'importacao'; params.imagemHash = crypto.createHash('sha256').update(imagemBytes).digest('hex')
      delete params.imagemBase64
    }
    const existente = [...jobs.values()].find((job) => job.itemId === itemId && job.revisao === revisao && job.tipo === tipo && job.params?.estrategia === params.estrategia && job.params?.imagemHash === params.imagemHash && !['failed', 'cancelled'].includes(job.status))
    if (existente) {
      if (existente.status === 'producing' && !ativos.has(existente.id)) { const tarefa = executar(existente); ativos.set(existente.id, tarefa); void tarefa }
      return emitir(existente)
    }
    if (tipo === 'video' && !params.roteiroFile && params.automatico !== true) throw erro('ENTRADA_INVALIDA', 'Escolha a montagem automática ou forneça um roteiro de vídeo.')
    const id = `media-${hash(`${itemId}:${revisao}:${tipo}:${briefing}:${params.estrategia || ''}:${params.imagemHash || ''}`)}`
    if (imagemBytes) {
      const outputDir = path.join(base, id)
      fs.mkdirSync(outputDir, { recursive: true })
      const destino = path.join(outputDir, mimeDaImagem(imagemBytes) === 'image/jpeg' ? 'importada.jpg' : 'importada.png')
      fs.writeFileSync(destino, imagemBytes, { mode: 0o600 })
      validarImagemEditorial(destino)
      params.imagemImportada = path.basename(destino)
    }
    if (tipo === 'imagem' && !params.motor) params.motor = 'cli'
    if (tipo === 'imagem' && !(Array.isArray(params.references) && params.references.length)) {
      const hunt = await caçarReferencias(item)
      if (hunt.references.length) {
        params.references = hunt.references
        params.referenciasOrigem = hunt.achados
      }
    }
    const skill = [tipo === 'imagem' ? lerSkill(skillsDir, 'captura-editorial') : '', lerSkill(skillsDir, tipo === 'video' ? 'mini-vitrine' : 'imagem-editorial')].filter(Boolean).join('\n\n')
    const job = { id, itemId, revisao, tipo, briefing, autorizarGasto: config.autorizarGasto, itemSnapshot: { id: item.id, revisao: item.revisao, estado: item.estado, pautaId: item.pautaId, conta: item.conta, idioma: item.idioma, titulo: item.titulo, texto: item.texto, fontes: item.fontes, origem: item.origem, midias: item.midias, editorial: item.editorial }, params: clone(params), pautaId: params.pautaId || item.pautaId || itemId, outputDir: path.join(base, id), request: { briefing, skill }, status: 'planned', criadoEm: agora(), atualizadoEm: agora() }
    persistir(job); const tarefa = executar(job); ativos.set(id, tarefa); void tarefa
    return emitir(job)
  }
  function listar(filtros = {}) { reler(); return [...jobs.values()].filter((job) => !filtros.status || job.status === filtros.status).map(clone) }
  function obter(id) { validarId(id); reler(); const job = jobs.get(id) || lerJson(arquivo(id)); return job ? clone(job) : null }
  async function aguardar(id) { validarId(id); await ativos.get(id); return obter(id) }
  function cancelar(id) {
    const job = obter(id)
    if (!job) throw erro('NAO_ENCONTRADO', `job não encontrado: ${id}`)
    if (['ready', 'failed', 'cancelled'].includes(job.status)) return { job }
    job.status = 'cancelled'; job.atualizadoEm = agora(); job.erro = { codigo: 'JOB_CANCELADO', mensagem: 'cancelamento solicitado; nenhum novo anexo será feito' }; persistir(job)
    const processo = processos.get(id)
    const filho = processo?.child || processo
    if (filho && typeof filho.kill === 'function') { try { filho.kill('SIGTERM') } catch {} }
    return { job: clone(job) }
  }
  function configuracao() { relerConfig(); return clone(config) }
  function configurar(entrada = {}) {
    if (typeof entrada.autorizarGasto !== 'boolean') throw erro('CONFIG_INVALIDA', 'autorizarGasto deve ser boolean')
    config = { autorizarGasto: entrada.autorizarGasto }
    gravarJson(configFile, config)
    return clone(config)
  }
  const FALHAS_RETOMAVEIS = new Set(['FALHA_9ROUTER', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'JOB_INTERROMPIDO'])
  const midiaLocal = job => ['referencia-real', 'importacao'].includes(job.params?.estrategia)
  async function reconciliarPendentes() {
    reler()
    const reconciliados = []
    for (const salvo of jobs.values()) {
      if (!['planned', 'producing'].includes(salvo.status) || ativos.has(salvo.id) || !adquirirLock(salvo.id)) continue
      try {
        const job = lerJson(arquivo(salvo.id), salvo)
        if (!['planned', 'producing'].includes(job.status)) continue
        const item = await fila.obter(job.itemId)
        const anexadas = item?.midias?.filter(m => m.arquivo?.startsWith(`midias/${job.id}/`)) || []
        if (anexadas.length && anexadas.length === item.midias.length) {
          job.status = 'ready'; job.midias = anexadas; job.concluidoEm ||= agora(); delete job.erro
        } else {
          const codigo = !item ? 'ITEM_NAO_ENCONTRADO'
            : item.revisao !== job.revisao ? 'REVISAO_OBSOLETA'
              : !['pendente', 'erro'].includes(item.estado) ? 'ITEM_ESTADO_INVALIDO'
                : midiaLocal(job) ? 'JOB_INTERROMPIDO' : 'MIDIA_RECONCILIACAO_NECESSARIA'
          job.status = 'failed'
          job.erro = { codigo, mensagem: codigo === 'MIDIA_RECONCILIACAO_NECESSARIA'
            ? 'A geração foi interrompida. Confira o resultado anterior antes de gerar novamente.'
            : codigo === 'JOB_INTERROMPIDO' ? 'A preparação da mídia foi interrompida; a próxima rodada pode retomar esta etapa.'
              : 'O item foi removido ou mudou desde o início da mídia.' }
        }
        job.atualizadoEm = agora(); persistir(job); reconciliados.push(job.id)
      } finally { liberarLock(salvo.id) }
    }
    return { reconciliados }
  }
  async function retomarItem(itemId, revisao, { formatoMidia, reavaliar = false } = {}) {
    const item = await fila.obter(itemId)
    if (!item || item.revisao !== revisao || item.estado !== 'pendente') return null
    reler()
    if (formatoMidia === 'video' && item.midias?.some(m => m.tipo === 'imagem') && !item.midias.some(m => m.tipo === 'video')) {
      const anterior = [...jobs.values()].find(j => j.itemId === itemId && j.revisao === revisao && j.tipo === 'video')
      if (anterior?.status === 'cancelled') return null
      if (anterior?.status === 'failed' && !reavaliar && !FALHAS_RETOMAVEIS.has(anterior.erro?.codigo)) return null
      return iniciar({ itemId, revisao, tipo: 'video', automatico: true })
    }
    if (item.midias?.length) return null
    const anteriores = [...jobs.values()].filter(j => j.itemId === itemId && j.revisao === revisao && j.tipo === 'imagem')
      .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)))
    const anterior = anteriores[0]
    if (anterior) {
      if (!midiaLocal(anterior) || anterior.status !== 'failed' || !FALHAS_RETOMAVEIS.has(anterior.erro?.codigo)) return null
      return iniciar({ itemId, revisao, tipo: 'imagem', briefing: anterior.briefing, ...clone(anterior.params) })
    }
    const midia = item.editorial?.pauta?.midia
    if (midia?.tipo !== 'captura' || (!midia.referencia && !midia.referencias?.length)) return null
    return iniciar({ itemId, revisao, tipo: 'imagem', estrategia: 'referencia-real', briefing: midia.direcao || '' })
  }
  async function retomarPendentes() {
    await reconciliarPendentes()
    const retomados = []
    for (const job of listar()) {
      const iniciado = await retomarItem(job.itemId, job.revisao)
      if (iniciado?.job?.id) retomados.push(iniciado.job.id)
    }
    return { retomados }
  }
  async function caçarReferencias(item) {
    const entrada = { item, dataDir, portfolioDir, acervoDir }
    if (capturarUrl !== undefined) entrada.capturarUrl = capturarUrl
    return resolverRefs(entrada)
  }
  async function reabrirSemReferencia(job, item, params = {}) {
    const explicitas = Array.isArray(params.references) && params.references.length ? params.references : null
    const hunt = explicitas ? { references: explicitas, achados: params.referenciasOrigem || [] } : await caçarReferencias(item)
    if (!hunt.references.length) return null
    job.params.references = hunt.references
    job.params.referenciasOrigem = hunt.achados || []
    job.itemSnapshot = { id: item.id, revisao: item.revisao, estado: item.estado, pautaId: item.pautaId, conta: item.conta, idioma: item.idioma, titulo: item.titulo, texto: item.texto, fontes: item.fontes, origem: item.origem, midias: item.midias }
    job.status = 'planned'
    delete job.erro
    delete job.factoryPrepared
    delete job.preparacao
    job.autorizarGasto = config.autorizarGasto
    job.atualizadoEm = agora()
    persistir(job)
    if (!ativos.has(job.id)) { const tarefa = executar(job); ativos.set(job.id, tarefa); void tarefa }
    return job
  }
  async function retentarSemReferencia() {
    reler(); relerConfig()
    const recuperaveis = new Set(['FACTORY_SEM_REFERENCIA', 'ANEXO_INVALIDO'])
    const candidatos = [...jobs.values()].filter((job) => job.tipo === 'imagem' && job.status === 'failed' && recuperaveis.has(job.erro?.codigo))
    const retomados = []
    for (const bruto of candidatos) {
      if (ativos.has(bruto.id)) continue
      let item
      try { item = await fila.obter(bruto.itemId) } catch { continue }
      if (!item || item.revisao !== bruto.revisao || !['pendente', 'erro'].includes(item.estado)) continue
      const retomado = await reabrirSemReferencia(bruto, item, bruto.params)
      if (retomado) {
        retomados.push(retomado.id)
        const tarefa = ativos.get(retomado.id)
        if (tarefa && typeof tarefa.then === 'function') { try { await tarefa } catch {} }
      }
    }
    return { retomados }
  }
  const capturas = criarCapturaEditorial({ dataDir, completar, completarComImagens, ...(executoresCaptura ? { executores: executoresCaptura } : {}) })
  carregar()
  return { capturarPauta: capturas.preparar, iniciar, listar, obter, aguardar, cancelar, reconciliarPendentes, retomarItem, retomarPendentes, retentarSemReferencia, configuracao, configurar }
}

module.exports = { criarJobsMidiasEditoriais, parseSaida, acharTrabalho, acharEstadoFactory }
