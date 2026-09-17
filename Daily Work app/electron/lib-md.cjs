// Camada de serviço dos arquivos .md (blocos) e .tldr (sessões) — única fonte
// de verdade para filesystem. Usada pelo Electron (main.cjs) e pelo dev server
// (vite.config.ts via createRequire). ATENÇÃO: o formato do frontmatter é
// espelhado de src/lib/md.ts — mudou lá, mude aqui.
//
// Agent-First: todas as mutações registram auditoria em data/_log.ndjson e
// salvarSnapshot suporta dry-run (diff sem gravar).

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const RAIZ = path.join(__dirname, '..')
const DATA_DIR = process.env.DAILYWORK_DATA_DIR || path.join(RAIZ, 'data')
const DIAS_DIR = path.join(DATA_DIR, 'dias')
const ARQUIVO_DIR = path.join(DATA_DIR, '_arquivo')
const LOG_ARQUIVO = path.join(DATA_DIR, '_log.ndjson')
const SESSOES_DIR = process.env.DAILYWORK_SESSOES_DIR || path.join(RAIZ, 'sessoes')
const SESSOES_ARQUIVO_DIR = path.join(SESSOES_DIR, '_arquivo')
const ASSETS_DIR = process.env.DAILYWORK_ASSETS_DIR || path.join(RAIZ, 'assets')
const PORTFOLIO_ASSETS_DIR = path.join(ASSETS_DIR, 'portfolio')
const CONHECIMENTO_DIR =
  process.env.LUCAS_KNOWLEDGE_DIR ||
  path.join(RAIZ, '..', 'LucasOL', 'Knowledge')
const CONHECIMENTO_POSICOES = path.join(
  CONHECIMENTO_DIR,
  '.obsidian',
  'plugins',
  'lucas-hierarchy-graph',
  'data.json'
)

const TIPOS = ['nota', 'tarefa', 'projeto', 'link', 'pessoa', 'imagem']
const STATUS = ['pendente', 'fazendo', 'feito']
const PAPEIS = ['direction', 'plan', 'front', 'checkpoint', 'decision', 'closure']
const FASES = ['discover', 'design', 'build', 'validate', 'release', 'operate']
const ORIGENS = ['human', 'agent', 'signal', 'context-pack']
const CAMPOS_SEMANTICOS = [
  'projeto',
  'responsavel',
  'repositorio',
  'branch',
  'worktree',
  'carryoverDe',
  'concluidoEm',
]
const LISTAS_SEMANTICAS = ['fontes', 'evidencias', 'bloqueadoPor']

// ===================== Auditoria =====================

function registrarLog(acao, detalhes) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(
      LOG_ARQUIVO,
      JSON.stringify({ ts: new Date().toISOString(), acao, ...detalhes }) + '\n',
      'utf8'
    )
  } catch {
    // auditoria nunca derruba a operação
  }
}

// ===================== Escopos (Principal x dia) =====================

function dataValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false
  const [ano, mes, dia] = data.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

function validarDia(dia) {
  if (dia == null || dia === '') return null
  if (!dataValida(dia)) throw new Error(`data de dia inválida: ${dia}`)
  return dia
}

function diretorioBlocos(dia) {
  const data = validarDia(dia)
  return data ? path.join(DIAS_DIR, data) : DATA_DIR
}

function diretorioArquivo(dia) {
  const data = validarDia(dia)
  return data ? path.join(DIAS_DIR, data, '_arquivo') : ARQUIVO_DIR
}

function contextoLog(dia) {
  return dia ? { escopo: 'dia', dia } : { escopo: 'principal' }
}

// ===================== Supressão de eco (escrita própria vs externa) =====================
// A UI salva snapshot a cada mudança; essas escritas NÃO devem disparar o
// reload por "mudança externa". Escritas via CRUD/arquivo são de agentes e
// devem disparar. Janela de supressão: 1.5s após a última escrita própria.

let ultimaEscritaPropria = 0

function marcarEscritaPropria() {
  ultimaEscritaPropria = Date.now()
}

function foiEscritaExterna() {
  return Date.now() - ultimaEscritaPropria > 1500
}

// ===================== Frontmatter =====================

function novoBlocoId() {
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

function escalar(v) {
  return String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function listaParaMd(nome, valores) {
  if (!Array.isArray(valores) || valores.length === 0) return []
  return [`${nome}:`, ...valores.map((valor) => `  - ${escalar(valor)}`)]
}

function blocoParaMd(b) {
  const linhas = [
    '---',
    `id: ${escalar(b.id)}`,
    `tipo: ${escalar(b.tipo)}`,
    `titulo: ${escalar(b.titulo)}`,
    `status: ${escalar(b.status)}`,
    `x: ${Math.round(b.x)}`,
    `y: ${Math.round(b.y)}`,
    `w: ${Math.round(b.w)}`,
    `h: ${Math.round(b.h)}`,
    ...(b.midia ? [`midia: ${escalar(b.midia)}`] : []),
    ...(PAPEIS.includes(b.papel) ? [`papel: ${escalar(b.papel)}`] : []),
    ...(FASES.includes(b.fase) ? [`fase: ${escalar(b.fase)}`] : []),
    ...(ORIGENS.includes(b.origem) ? [`origem: ${escalar(b.origem)}`] : []),
    ...CAMPOS_SEMANTICOS.flatMap((campo) => b[campo] ? [`${campo}: ${escalar(b[campo])}`] : []),
    'conexoes:',
    ...(b.conexoes || []).map((c) => `  - ${escalar(c)}`),
    ...LISTAS_SEMANTICAS.flatMap((campo) => listaParaMd(campo, b[campo])),
    '---',
    '',
  ]
  return linhas.join('\n') + (b.corpo ?? '').trim() + '\n'
}

function mdParaBloco(nomeArquivo, texto) {
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return null
  const [, fm, corpo] = m

  const campos = {}
  const listas = Object.fromEntries(['conexoes', ...LISTAS_SEMANTICAS].map((nome) => [nome, []]))
  let listaAtual = null
  for (const linha of fm.split(/\r?\n/)) {
    const item = linha.match(/^\s+-\s+(.+)$/)
    if (listaAtual && item) {
      listas[listaAtual].push(item[1].trim())
      continue
    }
    const kv = linha.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (kv) {
      listaAtual = Object.hasOwn(listas, kv[1]) && !kv[2].trim() ? kv[1] : null
      if (!listaAtual) campos[kv[1]] = kv[2].trim()
    }
  }

  const num = (v, def) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : def
  }

  const bloco = {
    id: campos.id || nomeArquivo.replace(/\.md$/, ''),
    tipo: TIPOS.includes(campos.tipo) ? campos.tipo : 'nota',
    titulo: campos.titulo || '(sem título)',
    status: STATUS.includes(campos.status) ? campos.status : 'pendente',
    x: num(campos.x, 0),
    y: num(campos.y, 0),
    w: num(campos.w, 260),
    h: num(campos.h, 140),
    conexoes: listas.conexoes,
    corpo: corpo.replace(/^\r?\n/, '').replace(/\s+$/, ''),
  }
  if (campos.midia) bloco.midia = campos.midia
  if (PAPEIS.includes(campos.papel)) bloco.papel = campos.papel
  if (FASES.includes(campos.fase)) bloco.fase = campos.fase
  if (ORIGENS.includes(campos.origem)) bloco.origem = campos.origem
  for (const campo of CAMPOS_SEMANTICOS) {
    if (campos[campo]) bloco[campo] = campos[campo]
  }
  for (const campo of LISTAS_SEMANTICAS) {
    if (listas[campo].length) bloco[campo] = listas[campo]
  }
  return bloco
}

function normalizarBloco(b = {}) {
  const base = mdParaBloco('x.md', '---\n---\n') // defaults
  const bloco = {
    ...base,
    ...b,
    id: b.id || novoBlocoId(),
    tipo: TIPOS.includes(b.tipo) ? b.tipo : 'nota',
    status: STATUS.includes(b.status) ? b.status : 'pendente',
    conexoes: Array.isArray(b.conexoes) ? b.conexoes.map(String) : [],
    corpo: typeof b.corpo === 'string' ? b.corpo : '',
  }
  if (typeof b.midia === 'string' && b.midia.trim()) bloco.midia = b.midia.trim()
  else delete bloco.midia
  if (!PAPEIS.includes(b.papel)) delete bloco.papel
  if (!FASES.includes(b.fase)) delete bloco.fase
  if (!ORIGENS.includes(b.origem)) delete bloco.origem
  for (const campo of CAMPOS_SEMANTICOS) {
    if (typeof b[campo] === 'string' && b[campo].trim()) bloco[campo] = b[campo].trim()
    else delete bloco[campo]
  }
  for (const campo of LISTAS_SEMANTICAS) {
    if (Array.isArray(b[campo]) && b[campo].length) bloco[campo] = b[campo].map(String)
    else delete bloco[campo]
  }
  return bloco
}

// ===================== Blocos =====================

function garantirPastas(dia) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(DIAS_DIR, { recursive: true })
  fs.mkdirSync(diretorioBlocos(dia), { recursive: true })
  fs.mkdirSync(diretorioArquivo(dia), { recursive: true })
}

function caminhoBloco(id, dia) {
  return path.join(diretorioBlocos(dia), `${id}.md`)
}

function idBlocoValido(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,80}$/.test(id)
}

// Compatibilidade com o formato usado até 23/07/2026: dias eram sessões
// opacas `sessoes/dia-AAAA-MM-DD.tldr`. Na primeira abertura do dia, converte
// shapes que já têm meta de bloco para Markdown, sem apagar o snapshot legado.
function migrarSessaoDiariaLegada(dia) {
  if (!dia) return false
  const dir = diretorioBlocos(dia)
  const marcador = path.join(dir, '.migrado-de-sessao')
  const legado = path.join(SESSOES_DIR, `dia-${dia}.tldr`)
  if (fs.existsSync(marcador) || !fs.existsSync(legado)) return false
  if (fs.readdirSync(dir).some((nome) => nome.endsWith('.md'))) return false

  const texto = fs.readFileSync(legado, 'utf8').trim()
  if (!texto) return false
  const snapshot = JSON.parse(texto)
  const store = snapshot?.document?.store || snapshot?.store || {}
  const registros = Object.values(store)
  const shapes = registros.filter(
    (r) => r?.typeName === 'shape' && r?.meta && idBlocoValido(r.meta.blockId)
  )
  const shapePorId = new Map(shapes.map((shape) => [shape.id, shape]))
  const conexoes = new Map()

  for (const seta of registros.filter((r) => r?.typeName === 'shape' && r?.type === 'arrow')) {
    const bindings = registros.filter((r) => r?.typeName === 'binding' && r?.fromId === seta.id)
    const inicio = bindings.find((r) => r?.props?.terminal === 'start')
    const fim = bindings.find((r) => r?.props?.terminal === 'end')
    const origem = shapePorId.get(inicio?.toId)
    const destino = shapePorId.get(fim?.toId)
    if (!origem || !destino) continue
    const lista = conexoes.get(origem.meta.blockId) || []
    if (!lista.includes(destino.meta.blockId)) lista.push(destino.meta.blockId)
    conexoes.set(origem.meta.blockId, lista)
  }

  for (const shape of shapes) {
    const props = shape.props || {}
    const meta = shape.meta || {}
    const bloco = normalizarBloco({
      id: meta.blockId,
      tipo: meta.tipo,
      titulo: meta.titulo,
      status: meta.status,
      x: shape.x,
      y: shape.y,
      w: props.w,
      h: props.h,
      conexoes: conexoes.get(meta.blockId) || [],
      corpo: meta.corpo,
    })
    fs.writeFileSync(caminhoBloco(bloco.id, dia), blocoParaMd(bloco), 'utf8')
  }

  fs.writeFileSync(
    marcador,
    `Migrado de sessoes/dia-${dia}.tldr em ${new Date().toISOString()}.\n`,
    'utf8'
  )
  registrarLog('dia:migrar-sessao-legada', {
    ...contextoLog(dia),
    origem: `sessoes/dia-${dia}.tldr`,
    total: shapes.length,
  })
  return true
}

function listarBlocos(dia) {
  dia = validarDia(dia)
  garantirPastas(dia)
  migrarSessaoDiariaLegada(dia)
  const blocos = []
  const dir = diretorioBlocos(dia)
  for (const nome of fs.readdirSync(dir)) {
    if (!nome.endsWith('.md')) continue
    const bloco = mdParaBloco(nome, fs.readFileSync(path.join(dir, nome), 'utf8'))
    if (bloco) blocos.push(bloco)
  }
  return blocos
}

function obterBloco(id, dia) {
  dia = validarDia(dia)
  garantirPastas(dia)
  if (!idBlocoValido(id)) return null
  const arquivo = caminhoBloco(id, dia)
  if (!fs.existsSync(arquivo)) return null
  return mdParaBloco(`${id}.md`, fs.readFileSync(arquivo, 'utf8'))
}

function criarBloco(parcial, dia) {
  dia = validarDia(dia)
  garantirPastas(dia)
  const bloco = normalizarBloco(parcial || {})
  if (!idBlocoValido(bloco.id)) throw new Error(`id de bloco inválido: ${bloco.id}`)
  fs.writeFileSync(caminhoBloco(bloco.id, dia), blocoParaMd(bloco), 'utf8')
  registrarLog('bloco:criar', { ...contextoLog(dia), id: bloco.id, titulo: bloco.titulo })
  return bloco
}

function atualizarBloco(id, patch, dia) {
  dia = validarDia(dia)
  garantirPastas(dia)
  const atual = obterBloco(id, dia)
  if (!atual) return null
  const atualizado = normalizarBloco({ ...atual, ...patch, id: atual.id })
  fs.writeFileSync(caminhoBloco(id, dia), blocoParaMd(atualizado), 'utf8')
  registrarLog('bloco:atualizar', {
    ...contextoLog(dia),
    id,
    campos: Object.keys(patch || {}),
  })
  return atualizado
}

function excluirBloco(id, dia) {
  dia = validarDia(dia)
  garantirPastas(dia)
  if (!idBlocoValido(id)) return false
  const arquivo = caminhoBloco(id, dia)
  if (!fs.existsSync(arquivo)) return false
  fs.renameSync(arquivo, path.join(diretorioArquivo(dia), `${Date.now()}-${id}.md`))
  registrarLog('bloco:excluir', { ...contextoLog(dia), id })
  return true
}

// Diff entre um snapshot recebido e o estado do disco (base do dry-run).
function diffSnapshot(blocos, dia) {
  dia = validarDia(dia)
  garantirPastas(dia)
  const diff = { criar: [], atualizar: [], arquivar: [] }
  const vistos = new Set()
  for (const b of blocos) {
    if (!b || !b.id) continue
    vistos.add(b.id)
    const atual = obterBloco(b.id, dia)
    if (!atual) {
      diff.criar.push(b.id)
    } else if (blocoParaMd(normalizarBloco({ ...atual, ...b, id: b.id })) !== blocoParaMd(atual)) {
      diff.atualizar.push(b.id)
    }
  }
  for (const nome of fs.readdirSync(diretorioBlocos(dia))) {
    if (!nome.endsWith('.md')) continue
    const id = nome.replace(/\.md$/, '')
    if (!vistos.has(id)) diff.arquivar.push(id)
  }
  return diff
}

// Reconcilia o snapshot com a pasta data/. Com dry=true, só devolve o diff.
function salvarSnapshot(blocos, { dry = false, dia = null } = {}) {
  dia = validarDia(dia)
  garantirPastas(dia)
  // Proteção: snapshot vazio nunca arquiva nada. Um bug de carga no cliente
  // não pode varrer a pasta data/.
  if (!Array.isArray(blocos) || blocos.length === 0) {
    registrarLog('snapshot:ignorado-vazio', contextoLog(dia))
    return { ignorado: true, diff: { criar: [], atualizar: [], arquivar: [] } }
  }
  // Uma falha transitória ao reidratar o data URL não pode converter uma
  // imagem persistente em nota e apagar seu caminho do frontmatter. Mudança
  // deliberada de tipo/mídia deve usar PATCH individual, que é explícito.
  const reconciliados = blocos.map((bloco) => {
    if (!bloco?.id) return bloco
    const atual = obterBloco(bloco.id, dia)
    if (atual?.tipo === 'imagem' && atual.midia && !bloco.midia) {
      return { ...bloco, tipo: 'imagem', midia: atual.midia }
    }
    return bloco
  })
  const diff = diffSnapshot(reconciliados, dia)
  if (dry) {
    registrarLog('snapshot:dry-run', { ...contextoLog(dia), total: blocos.length, diff })
    return { dry: true, diff }
  }
  const inalterado = diff.criar.length === 0 && diff.atualizar.length === 0 && diff.arquivar.length === 0
  if (inalterado) {
    // Abertura, fechamento e reenquadramento de câmera podem produzir eventos
    // internos no tldraw. Um snapshot idêntico não toca nos arquivos nem gera
    // ruído de auditoria; somente mutações reais são persistidas.
    return { total: reconciliados.length, diff, inalterado: true }
  }
  const idsParaGravar = new Set([...diff.criar, ...diff.atualizar])
  for (const b of reconciliados) {
    if (!b || !b.id || !idsParaGravar.has(b.id)) continue
    fs.writeFileSync(caminhoBloco(b.id, dia), blocoParaMd(normalizarBloco(b)), 'utf8')
  }
  for (const id of diff.arquivar) {
    fs.renameSync(
      caminhoBloco(id, dia),
      path.join(diretorioArquivo(dia), `${Date.now()}-${id}.md`)
    )
  }
  marcarEscritaPropria()
  registrarLog('snapshot:salvo', { ...contextoLog(dia), total: reconciliados.length, diff })
  return { total: reconciliados.length, diff }
}

function listarDias() {
  garantirPastas()
  return fs
    .readdirSync(DIAS_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory() && dataValida(item.name))
    .map((item) => item.name)
    .sort()
}

// ===================== Sessões livres (.tldr) =====================

function idSessaoValido(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(id)
}

function garantirPastasSessoes() {
  fs.mkdirSync(SESSOES_DIR, { recursive: true })
  fs.mkdirSync(SESSOES_ARQUIVO_DIR, { recursive: true })
}

function listarSessoes() {
  garantirPastasSessoes()
  return fs
    .readdirSync(SESSOES_DIR)
    .filter((n) => n.endsWith('.tldr'))
    .map((n) => n.replace(/\.tldr$/, ''))
    .sort()
}

function criarSessao(id) {
  garantirPastasSessoes()
  if (!idSessaoValido(id)) throw new Error(`id de sessão inválido: ${id}`)
  const arquivo = path.join(SESSOES_DIR, `${id}.tldr`)
  if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, '', 'utf8')
  marcarEscritaPropria()
  registrarLog('sessao:criar', { id })
  return { ok: true }
}

function carregarSessao(id) {
  garantirPastasSessoes()
  if (!idSessaoValido(id)) return null
  const arquivo = path.join(SESSOES_DIR, `${id}.tldr`)
  if (!fs.existsSync(arquivo)) return null
  const texto = fs.readFileSync(arquivo, 'utf8').trim()
  if (!texto) return null // sessão recém-criada, canvas vazio
  return JSON.parse(texto)
}

function salvarSessao(id, snapshot) {
  garantirPastasSessoes()
  if (!idSessaoValido(id)) throw new Error(`id de sessão inválido: ${id}`)
  fs.writeFileSync(path.join(SESSOES_DIR, `${id}.tldr`), JSON.stringify(snapshot), 'utf8')
  marcarEscritaPropria()
  registrarLog('sessao:salvar', { id })
  return { ok: true }
}

function excluirSessao(id) {
  garantirPastasSessoes()
  if (!idSessaoValido(id)) return { ok: false }
  const arquivo = path.join(SESSOES_DIR, `${id}.tldr`)
  if (fs.existsSync(arquivo)) {
    fs.renameSync(arquivo, path.join(SESSOES_ARQUIVO_DIR, `${Date.now()}-${id}.tldr`))
  }
  registrarLog('sessao:excluir', { id })
  return { ok: true }
}

// ===================== Foto =====================

function lerFoto() {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
  for (const ext of Object.keys(mime)) {
    const arquivo = path.join(ASSETS_DIR, `eu${ext}`)
    if (fs.existsSync(arquivo)) {
      const base64 = fs.readFileSync(arquivo).toString('base64')
      return `data:${mime[ext]};base64,${base64}`
    }
  }
  return null
}

// ===================== Mídia do portfólio =====================

const MIME_MIDIA = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function caminhoEstaDentro(caminhoFilho, caminhoPai) {
  const relativo = path.relative(path.resolve(caminhoPai), path.resolve(caminhoFilho))
  return relativo !== '..' && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo)
}

function salvarMidiaPortfolio(entrada = {}) {
  let mimeType = String(entrada.mimeType || '').toLowerCase()
  let base64 = String(entrada.base64 || '')
  const dataUrl = base64.match(/^data:([^;,]+);base64,(.+)$/s)
  if (dataUrl) {
    mimeType = mimeType || dataUrl[1].toLowerCase()
    base64 = dataUrl[2]
  }
  const extensao = MIME_MIDIA[mimeType]
  if (!extensao) throw new Error(`tipo de mídia não suportado: ${mimeType || '(vazio)'}`)

  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length) throw new Error('mídia vazia')
  if (buffer.length > 25 * 1024 * 1024) throw new Error('mídia excede o limite de 25 MB')

  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16)
  const nomeBase = path
    .basename(String(entrada.nome || 'imagem'), path.extname(String(entrada.nome || '')))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'imagem'
  const nomeArquivo = `${nomeBase}-${hash}${extensao}`
  const arquivo = path.join(PORTFOLIO_ASSETS_DIR, nomeArquivo)
  fs.mkdirSync(PORTFOLIO_ASSETS_DIR, { recursive: true })
  if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, buffer)

  const caminho = `assets/portfolio/${nomeArquivo}`
  registrarLog('portfolio:midia-salvar', { caminho, bytes: buffer.length, mimeType })
  return {
    caminho,
    mimeType,
    bytes: buffer.length,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  }
}

function lerMidiaPortfolio(caminho) {
  const relativo = String(caminho || '').replace(/\\/g, '/')
  if (!relativo.startsWith('assets/portfolio/')) return null
  const dentroDePortfolio = relativo.slice('assets/portfolio/'.length)
  const arquivo = path.resolve(PORTFOLIO_ASSETS_DIR, ...dentroDePortfolio.split('/'))
  if (!caminhoEstaDentro(arquivo, PORTFOLIO_ASSETS_DIR) || !fs.existsSync(arquivo)) return null
  const extensao = path.extname(arquivo).toLowerCase()
  const mimeType =
    Object.entries(MIME_MIDIA).find(([, ext]) => ext === extensao)?.[0] || 'application/octet-stream'
  return `data:${mimeType};base64,${fs.readFileSync(arquivo).toString('base64')}`
}

// ===================== Knowledge do workspace (fonte canônica externa) =====================

function normalizarCaminhoConhecimento(caminho) {
  const recebido = String(caminho || '').replace(/\\/g, '/')
  const normalizado = path.posix.normalize(recebido).replace(/^\.\//, '')
  if (
    !normalizado ||
    path.posix.isAbsolute(normalizado) ||
    normalizado === '..' ||
    normalizado.startsWith('../') ||
    !normalizado.toLowerCase().endsWith('.md')
  ) {
    throw new Error(`caminho de conhecimento inválido: ${recebido}`)
  }
  const absoluto = path.resolve(CONHECIMENTO_DIR, ...normalizado.split('/'))
  if (!caminhoEstaDentro(absoluto, CONHECIMENTO_DIR)) {
    throw new Error(`caminho fora do Knowledge do workspace: ${recebido}`)
  }
  return { relativo: normalizado, absoluto }
}

function listarArquivosMarkdown(diretorio, raiz = diretorio) {
  if (!fs.existsSync(diretorio)) return []
  const arquivos = []
  for (const item of fs.readdirSync(diretorio, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue
    const absoluto = path.join(diretorio, item.name)
    if (item.isDirectory()) arquivos.push(...listarArquivosMarkdown(absoluto, raiz))
    else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
      arquivos.push(path.relative(raiz, absoluto).split(path.sep).join('/'))
    }
  }
  return arquivos.sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function separarNotaConhecimento(conteudo) {
  const match = String(conteudo).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: '', corpo: String(conteudo) }
  return { frontmatter: match[1], corpo: match[2] }
}

function tituloDaNota(caminho, corpo) {
  const titulo = String(corpo).match(/^#\s+(.+)$/m)?.[1]?.trim()
  return titulo || path.posix.basename(caminho, '.md')
}

function textoLimpoMarkdown(texto) {
  return String(texto)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, alvo, rotulo) =>
      String(rotulo || path.posix.basename(String(alvo))).trim()
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s*\[![^\]]+\].*$/gm, ' ')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[\*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resumoDaNota(corpo, limite = 240) {
  const limpo = textoLimpoMarkdown(corpo)
  if (limpo.length <= limite) return limpo
  const corte = limpo.slice(0, limite + 1)
  const ultimoEspaco = corte.lastIndexOf(' ')
  return `${corte.slice(0, ultimoEspaco > limite * 0.7 ? ultimoEspaco : limite).trim()}…`
}

function etagDoConteudo(conteudo) {
  return crypto.createHash('sha256').update(String(conteudo), 'utf8').digest('hex')
}

function lerPosicoesConhecimento() {
  try {
    const dados = JSON.parse(fs.readFileSync(CONHECIMENTO_POSICOES, 'utf8'))
    return dados && typeof dados.positions === 'object' ? dados.positions : {}
  } catch {
    return {}
  }
}

function chaveNota(valor) {
  return String(valor || '')
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .toLocaleLowerCase('pt-BR')
}

function extrairAlvosWiki(conteudo) {
  const alvos = []
  const regex = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
  for (const match of String(conteudo).matchAll(regex)) {
    const alvo = match[1].trim()
    if (alvo && !alvos.includes(alvo)) alvos.push(alvo)
  }
  return alvos
}

function grupoDaNota(caminho) {
  const primeiro = caminho.split('/')[0]
  if (caminho === 'LUCAS.md') return 'Raiz'
  if (primeiro === 'Painel Essencial') return 'Painel essencial'
  if (primeiro === 'Inteligência Artificial') return 'Inteligência artificial'
  if (primeiro === 'Desenvolvimento de Software') return 'Desenvolvimento de software'
  if (primeiro === 'Núcleo de Identidade') return 'Núcleo de identidade'
  if (primeiro === '01 Mapas') return 'Orientação'
  return primeiro
}

function listarConhecimento() {
  if (!fs.existsSync(CONHECIMENTO_DIR)) {
    return { disponivel: false, raiz: CONHECIMENTO_DIR, notas: [] }
  }

  const caminhos = listarArquivosMarkdown(CONHECIMENTO_DIR)
  const fontes = caminhos.map((caminho) => {
    const absoluto = normalizarCaminhoConhecimento(caminho).absoluto
    const conteudo = fs.readFileSync(absoluto, 'utf8')
    const partes = separarNotaConhecimento(conteudo)
    return { caminho, absoluto, conteudo, ...partes }
  })
  const porCaminho = new Map(fontes.map((nota) => [chaveNota(nota.caminho), nota.caminho]))
  const porNome = new Map()
  for (const nota of fontes) {
    const nome = chaveNota(path.posix.basename(nota.caminho))
    const existentes = porNome.get(nome) || []
    existentes.push(nota.caminho)
    porNome.set(nome, existentes)
  }
  const posicoes = lerPosicoesConhecimento()

  const notas = fontes.map((nota) => {
    const links = []
    for (const alvo of extrairAlvosWiki(nota.conteudo)) {
      const porAlvo = porCaminho.get(chaveNota(alvo))
      const porBasename = porNome.get(chaveNota(path.posix.basename(alvo)))
      const resolvido = porAlvo || (porBasename?.length === 1 ? porBasename[0] : null)
      if (resolvido && resolvido !== nota.caminho && !links.includes(resolvido)) links.push(resolvido)
    }
    const posicao = posicoes[nota.caminho]
    const titulo = tituloDaNota(nota.caminho, nota.corpo)
    return {
      caminho: nota.caminho,
      titulo,
      resumo: resumoDaNota(nota.corpo),
      grupo: grupoDaNota(nota.caminho),
      links,
      modificadaEm: fs.statSync(nota.absoluto).mtime.toISOString(),
      noMapa: Number.isFinite(posicao?.x) && Number.isFinite(posicao?.y),
      ...(Number.isFinite(posicao?.x) && Number.isFinite(posicao?.y)
        ? { posicao: { x: posicao.x, y: posicao.y } }
        : {}),
    }
  })
  return { disponivel: true, raiz: CONHECIMENTO_DIR, notas }
}

function obterNotaConhecimento(caminho) {
  const { relativo, absoluto } = normalizarCaminhoConhecimento(caminho)
  if (!fs.existsSync(absoluto)) return null
  const conteudo = fs.readFileSync(absoluto, 'utf8')
  const partes = separarNotaConhecimento(conteudo)
  const resumo = listarConhecimento().notas.find((nota) => nota.caminho === relativo)
  return {
    ...(resumo || {
      caminho: relativo,
      titulo: tituloDaNota(relativo, partes.corpo),
      resumo: resumoDaNota(partes.corpo),
      grupo: grupoDaNota(relativo),
      links: [],
      modificadaEm: fs.statSync(absoluto).mtime.toISOString(),
      noMapa: false,
    }),
    conteudo,
    corpo: partes.corpo,
    frontmatter: partes.frontmatter,
    etag: etagDoConteudo(conteudo),
  }
}

function salvarNotaConhecimento(caminho, conteudo, etagEsperado) {
  const { relativo, absoluto } = normalizarCaminhoConhecimento(caminho)
  if (relativo === 'LUCAS.md') throw new Error('a nota raiz LUCAS.md é imutável')
  if (!fs.existsSync(absoluto)) throw new Error(`nota não encontrada: ${relativo}`)
  if (typeof conteudo !== 'string') throw new Error('conteúdo da nota deve ser texto')
  if (Buffer.byteLength(conteudo, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('nota excede o limite de 2 MB')
  }
  const atual = fs.readFileSync(absoluto, 'utf8')
  if (etagEsperado && etagEsperado !== etagDoConteudo(atual)) {
    throw new Error('CONFLITO: a nota mudou no vault desde que foi aberta')
  }

  const backupDir = path.join(ARQUIVO_DIR, 'conhecimento')
  fs.mkdirSync(backupDir, { recursive: true })
  const hashCaminho = crypto.createHash('sha1').update(relativo).digest('hex').slice(0, 8)
  const nomeBackup = `${Date.now()}-${hashCaminho}-${path.posix.basename(relativo)}`
  fs.writeFileSync(path.join(backupDir, nomeBackup), atual, 'utf8')
  fs.writeFileSync(absoluto, conteudo, 'utf8')
  registrarLog('conhecimento:atualizar', { caminho: relativo, backup: nomeBackup })
  return obterNotaConhecimento(relativo)
}

function salvarPosicoesConhecimento(novasPosicoes) {
  if (!novasPosicoes || typeof novasPosicoes !== 'object') {
    throw new Error('posições inválidas')
  }
  let dados = { positions: {} }
  try {
    if (fs.existsSync(CONHECIMENTO_POSICOES)) {
      dados = JSON.parse(fs.readFileSync(CONHECIMENTO_POSICOES, 'utf8')) || { positions: {} }
    }
  } catch {
    dados = { positions: {} }
  }
  if (!dados.positions || typeof dados.positions !== 'object') {
    dados.positions = {}
  }
  for (const [caminho, pos] of Object.entries(novasPosicoes)) {
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      dados.positions[caminho] = { x: Math.round(pos.x), y: Math.round(pos.y) }
    }
  }
  fs.mkdirSync(path.dirname(CONHECIMENTO_POSICOES), { recursive: true })
  fs.writeFileSync(CONHECIMENTO_POSICOES, JSON.stringify(dados, null, 2), 'utf8')
  registrarLog('conhecimento:salvar-posicoes', { total: Object.keys(novasPosicoes).length })
  return { ok: true, positions: dados.positions }
}

function removerPosicaoConhecimento(caminho) {
  if (!caminho || typeof caminho !== 'string') return { ok: false }
  let dados = { positions: {} }
  try {
    if (fs.existsSync(CONHECIMENTO_POSICOES)) {
      dados = JSON.parse(fs.readFileSync(CONHECIMENTO_POSICOES, 'utf8')) || { positions: {} }
    }
  } catch {
    return { ok: true }
  }
  if (dados.positions && dados.positions[caminho]) {
    delete dados.positions[caminho]
    fs.writeFileSync(CONHECIMENTO_POSICOES, JSON.stringify(dados, null, 2), 'utf8')
    registrarLog('conhecimento:remover-posicao', { caminho })
  }
  return { ok: true }
}

function excluirNotaConhecimento(caminho) {
  const { relativo, absoluto } = normalizarCaminhoConhecimento(caminho)
  if (relativo === 'LUCAS.md') throw new Error('a nota raiz LUCAS.md não pode ser excluída')
  if (!fs.existsSync(absoluto)) return false

  const backupDir = path.join(ARQUIVO_DIR, 'conhecimento')
  fs.mkdirSync(backupDir, { recursive: true })
  const nomeArquivo = `${Date.now()}-${path.posix.basename(relativo)}`
  fs.renameSync(absoluto, path.join(backupDir, nomeArquivo))

  removerPosicaoConhecimento(relativo)
  registrarLog('conhecimento:excluir', { caminho: relativo, arquivo: nomeArquivo })
  return true
}

function contextoPrincipal() {
  const conhecimento = listarConhecimento()
  const orientacao = conhecimento.notas.find((nota) => nota.caminho === '01 Mapas/Orientação.md')
  const essenciais = conhecimento.notas.filter(
    (nota) => nota.caminho.startsWith('Painel Essencial/') && nota.caminho.split('/').length >= 3
  )
  return {
    portfolio: listarBlocos().map(({ id, tipo, titulo, status, corpo, midia, conexoes }) => ({
      id,
      tipo,
      titulo,
      status,
      corpo,
      ...(midia ? { midia } : {}),
      conexoes,
    })),
    conhecimento: {
      disponivel: conhecimento.disponivel,
      raiz: conhecimento.raiz,
      total: conhecimento.notas.length,
      orientacao: orientacao ? obterNotaConhecimento(orientacao.caminho) : null,
      painelEssencial: essenciais,
    },
  }
}

module.exports = {
  DATA_DIR,
  DIAS_DIR,
  SESSOES_DIR,
  ASSETS_DIR,
  PORTFOLIO_ASSETS_DIR,
  CONHECIMENTO_DIR,
  CONHECIMENTO_POSICOES,
  listarBlocos,
  obterBloco,
  criarBloco,
  atualizarBloco,
  excluirBloco,
  diffSnapshot,
  salvarSnapshot,
  listarDias,
  dataValida,
  listarSessoes,
  criarSessao,
  carregarSessao,
  salvarSessao,
  excluirSessao,
  lerFoto,
  salvarMidiaPortfolio,
  lerMidiaPortfolio,
  listarConhecimento,
  obterNotaConhecimento,
  salvarNotaConhecimento,
  salvarPosicoesConhecimento,
  removerPosicaoConhecimento,
  excluirNotaConhecimento,
  contextoPrincipal,
  marcarEscritaPropria,
  foiEscritaExterna,
  // expostos para testes
  blocoParaMd,
  mdParaBloco,
  novoBlocoId,
}
