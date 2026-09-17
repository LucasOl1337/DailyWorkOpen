const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { origemLocal } = require('./lib-api-local.cjs')

const ROTULOS_ORIGEM = {
  shared: 'Compartilhada',
  'hermes-native': 'Nativa do Hermes',
  'codex-native': 'Nativa do Codex',
  observada: 'Observada nos logs',
}
const PROPOSITO_OBSERVADA = 'Skill observada nos registros de uso, mas ausente do catálogo atual.'
const MAX_BUFFER_RG = 32 * 1024 * 1024

function diaLocal(data) {
  const d = data instanceof Date ? data : new Date(data)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function executar(comando, args) {
  return new Promise((resolve, reject) => {
    execFile(comando, args, { maxBuffer: MAX_BUFFER_RG }, (erro, stdout, stderr) => {
      if (erro) {
        erro.stderr = stderr
        return reject(erro)
      }
      resolve(stdout)
    })
  })
}

function limparValorYaml(valor) {
  const texto = valor.trim()
  if (texto.length >= 2 && ((texto.startsWith('"') && texto.endsWith('"')) || (texto.startsWith("'") && texto.endsWith("'")))) return texto.slice(1, -1)
  return texto
}

function lerFrontmatter(conteudo) {
  const texto = String(conteudo || '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)
  if (!m) return ''
  const linhas = m[1].split(/\r?\n/)
  for (let i = 0; i < linhas.length; i += 1) {
    const par = /^description:\s*(.*)$/.exec(linhas[i].trim())
    if (!par) continue
    const valor = par[1].trim()
    if (!['>', '|'].includes(valor)) return limparValorYaml(valor)
    const partes = []
    for (let j = i + 1; j < linhas.length && /^\s+\S/.test(linhas[j]); j += 1) partes.push(linhas[j].trim())
    return (valor === '>' ? partes.join(' ') : partes.join('\n')).trim()
  }
  return ''
}

function catalogoFallback(homeDir) {
  const roots = [
    ['shared', path.join(homeDir, '.agents/skills')],
    ['hermes-native', path.join(homeDir, '.hermes/skills')],
    ['codex-native', path.join(homeDir, '.codex/skills')],
  ]
  const vistos = new Set()
  const itens = []
  function varrer(dir, origem, profundidade) {
    if (profundidade > 6) return
    let entradas
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      const nome = entrada.name
      if (nome.startsWith('.') && nome !== '.system') continue
      const completo = path.join(dir, nome)
      if (entrada.isDirectory()) {
        if (/backup|cache/i.test(nome)) continue
        varrer(completo, origem, profundidade + 1)
      } else if (nome === 'SKILL.md') {
        let real
        try {
          real = fs.realpathSync(completo)
        } catch {
          continue
        }
        if (vistos.has(real)) continue
        vistos.add(real)
        itens.push({ name: path.basename(dir), origin: origem, path: completo, sha256: null })
      }
    }
  }
  for (const [origem, raiz] of roots) varrer(raiz, origem, 0)
  return itens
}

async function catalogoPadrao(homeDir) {
  const binario = path.join(homeDir, '.agents/bin/agent-hub')
  try {
    const saida = await executar(binario, ['catalog'])
    const lista = JSON.parse(saida)
    if (Array.isArray(lista)) return lista
  } catch {
    return catalogoFallback(homeDir)
  }
  return catalogoFallback(homeDir)
}

async function buscarEventosPadrao(tipo, caminhos) {
  const padroes = {
    claude: '"name":"Skill"',
    codex: '<skill>\\n<name>',
  }
  const padrao = padroes[tipo]
  if (!padrao) return []
  const existentes = caminhos.filter((c) => {
    try {
      return fs.statSync(c).isDirectory() || fs.statSync(c).isFile()
    } catch {
      return false
    }
  })
  if (!existentes.length) throw new Error('nenhum caminho de eventos encontrado')
  try {
    const saida = await executar('rg', ['--no-filename', '--fixed-strings', '--glob', '*.jsonl', padrao, ...existentes])
    return saida.split('\n').filter(Boolean)
  } catch (erro) {
    if (erro.code === 1) return []
    throw erro
  }
}

function isoValido(valor) {
  if (!valor) return null
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? null : data.toISOString()
}

function extrairTextos(valor, encontrados) {
  if (typeof valor === 'string') {
    encontrados.push(valor)
  } else if (Array.isArray(valor)) {
    for (const item of valor) extrairTextos(item, encontrados)
  } else if (valor && typeof valor === 'object') {
    for (const item of Object.values(valor)) extrairTextos(item, encontrados)
  }
  return encontrados
}

function parseLinhasJson(linhas) {
  const registros = []
  let invalidas = 0
  for (const linha of linhas) {
    try {
      registros.push(JSON.parse(linha))
    } catch {
      invalidas += 1
    }
  }
  return { registros, invalidas }
}

function eventosClaude(linhas) {
  const { registros, invalidas } = parseLinhasJson(linhas)
  const eventos = []
  for (const registro of registros) {
    if (registro?.type !== 'assistant') continue
    const conteudo = registro.message?.content
    if (!Array.isArray(conteudo)) continue
    for (const item of conteudo) {
      if (item?.type === 'tool_use' && item?.name === 'Skill' && typeof item.input?.skill === 'string' && item.input.skill) {
        eventos.push({
          skill: item.input.skill,
          harness: 'Claude Code',
          agente: String(registro.message?.model || 'Claude Code'),
          em: new Date(registro.timestamp),
        })
      }
    }
  }
  return { eventos, invalidas }
}

function eventosCodex(linhas) {
  const { registros, invalidas } = parseLinhasJson(linhas)
  const eventos = []
  for (const registro of registros) {
    const em = new Date(registro?.timestamp)
    if (Number.isNaN(em.getTime())) continue
    for (const texto of extrairTextos(registro?.payload ?? registro, [])) {
      const re = /<skill>\s*<name>([^<]+)<\/name>/g
      let m
      while ((m = re.exec(texto))) {
        eventos.push({ skill: m[1].trim(), harness: 'Codex', agente: 'Codex', em })
      }
    }
  }
  return { eventos, invalidas }
}

function eventosDevin(conteudo) {
  if (!conteudo) return { eventos: [], invalidas: 0 }
  const eventos = []
  let invalidas = 0
  for (const linha of String(conteudo).split('\n')) {
    if (!linha.trim()) continue
    try {
      const registro = JSON.parse(linha)
      if (registro?.event_kind === 'activated' && registro.skill_name) {
        eventos.push({
          skill: String(registro.skill_name),
          harness: 'Devin CLI',
          agente: 'Devin',
          em: new Date(registro.occurred_at),
        })
      }
    } catch {
      invalidas += 1
    }
  }
  return { eventos, invalidas }
}

function eventosHermesLog(conteudo) {
  const eventos = []
  if (!conteudo) return eventos
  for (const linha of String(conteudo).split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}).*tool skill_view completed/.exec(linha)
    if (m) eventos.push({ skill: null, harness: 'Hermes', agente: 'Hermes Agent', em: new Date(`${m[1]}T${m[2]}`) })
  }
  return eventos
}

function responder(res, status, valor) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(valor))
}

function criarServicoSkills(opcoes = {}) {
  const homeDir = opcoes.homeDir || os.homedir()
  const agora = () => {
    const valor = typeof opcoes.agora === 'function' ? opcoes.agora() : opcoes.agora
    return valor ? new Date(valor) : new Date()
  }
  const catalogar = opcoes.catalogar || (() => catalogoPadrao(homeDir))
  const buscarEventos = opcoes.buscarEventos || buscarEventosPadrao
  const lerArquivo =
    opcoes.lerArquivo ||
    (async (caminho) => {
      try {
        return fs.readFileSync(caminho, 'utf8')
      } catch {
        return null
      }
    })

  async function dashboard({ dias = 30 } = {}) {
    const totalDias = Math.min(365, Math.max(1, Math.round(Number(dias)) || 30))
    const fim = agora()
    const diaFim = diaLocal(fim)
    const inicioData = new Date(fim)
    inicioData.setDate(inicioData.getDate() - (totalDias - 1))
    const diaInicio = diaLocal(inicioData)
    const alertas = []
    const fontes = []
    const eventos = []
    const usoHermes = new Map()

    let catalogo = []
    try {
      catalogo = await catalogar()
      if (!Array.isArray(catalogo)) throw new Error('catálogo inválido')
    } catch (erro) {
      alertas.push(`Catálogo de skills indisponível: ${String(erro?.message || erro)}`)
      fontes.push({ harness: 'Catálogo', status: 'indisponivel', detalhe: 'agent-hub catalog falhou e o fallback não retornou entradas.' })
      catalogo = []
    }

    const skills = new Map()
    for (const item of catalogo) {
      if (!item || !item.name) continue
      const id = `${item.name}@${item.origin || 'desconhecida'}`
      if (skills.has(id)) continue
      let proposito = ''
      if (item.path) {
        const conteudo = await lerArquivo(item.path).catch(() => null)
        proposito = lerFrontmatter(conteudo)
      }
      skills.set(id, {
        id,
        nome: String(item.name),
        proposito,
        origem: String(item.origin || 'desconhecida'),
        origemRotulo: ROTULOS_ORIGEM[item.origin] || String(item.origin || 'desconhecida'),
        caminho: item.path || null,
        catalogada: true,
        usosPeriodo: 0,
        usosConhecidos: 0,
        dias: new Set(),
        ultimoUso: null,
        harnesses: new Map(),
        agentes: new Map(),
      })
    }

    function resolverSkill(nome) {
      const candidatas = [...skills.values()].filter((s) => s.nome === nome)
      let alvo = candidatas.find((s) => s.origem === 'shared') || candidatas[0]
      if (!alvo) {
        const id = `${nome}@observada`
        alvo = {
          id,
          nome,
          proposito: PROPOSITO_OBSERVADA,
          origem: 'observada',
          origemRotulo: ROTULOS_ORIGEM.observada,
          caminho: null,
          catalogada: false,
          usosPeriodo: 0,
          usosConhecidos: 0,
          dias: new Set(),
          ultimoUso: null,
          harnesses: new Map(),
          agentes: new Map(),
        }
        skills.set(id, alvo)
      }
      return alvo
    }

    async function fonte(nome, detalheOk, coletar) {
      try {
        const resultado = await coletar()
        const parcial = resultado?.invalidas > 0
        fontes.push({
          harness: nome,
          status: parcial ? 'parcial' : 'ok',
          detalhe: parcial ? `${detalheOk}; ${resultado.invalidas} linhas ilegíveis.` : detalheOk,
        })
        if (parcial) alertas.push(`${nome}: ${resultado.invalidas} linhas ilegíveis ignoradas.`)
        return resultado
      } catch (erro) {
        fontes.push({ harness: nome, status: 'indisponivel', detalhe: String(erro?.message || erro) })
        alertas.push(`${nome}: fonte indisponível (${String(erro?.message || erro)}).`)
        return { eventos: [], invalidas: 0 }
      }
    }

    const caminhoClaude = path.join(homeDir, '.claude/projects')
    const claude = await fonte('Claude Code', 'Transcrições JSONL varridas.', () =>
      buscarEventos('claude', [caminhoClaude]).then(eventosClaude)
    )
    eventos.push(...claude.eventos)

    const codex = await fonte('Codex', 'Sessões e arquivadas varridas.', () =>
      buscarEventos('codex', [
        path.join(homeDir, '.codex/sessions'),
        path.join(homeDir, '.codex/archived_sessions'),
      ]).then(eventosCodex)
    )
    eventos.push(...codex.eventos)

    const devin = await fonte('Devin CLI', 'Spool de eventos lido.', async () => {
      const conteudo = await lerArquivo(path.join(homeDir, '.local/share/devin/cli/skill_events_spool.jsonl'))
      if (conteudo === null) throw new Error('skill_events_spool.jsonl ausente')
      return eventosDevin(conteudo)
    })
    eventos.push(...devin.eventos)

    await fonte('Hermes', 'Uso agregado e log diário lidos.', async () => {
      const bruto = await lerArquivo(path.join(homeDir, '.hermes/skills/.usage.json'))
      if (bruto) {
        try {
          const dados = JSON.parse(bruto)
          for (const [nome, info] of Object.entries(dados || {})) {
            const usos = Number(info?.use_count) || 0
            usoHermes.set(nome, { usos, ultimoUso: info?.last_used_at || null })
          }
        } catch {
          return { eventos: eventosHermesLog(await lerArquivo(path.join(homeDir, '.hermes/logs/agent.log'))), invalidas: 1 }
        }
      }
      const log = await lerArquivo(path.join(homeDir, '.hermes/logs/agent.log'))
      const evs = eventosHermesLog(log)
      if (!bruto && !log) throw new Error('.usage.json e agent.log ausentes')
      return { eventos: evs, invalidas: 0 }
    }).then((r) => eventos.push(...(r?.eventos || [])))

    const dentroDoPeriodo = (em) => {
      const dia = diaLocal(em)
      return dia >= diaInicio && dia <= diaFim
    }

    const serie = new Map()
    for (let i = 0; i < totalDias; i += 1) {
      const d = new Date(inicioData)
      d.setDate(d.getDate() + i)
      serie.set(diaLocal(d), { dia: diaLocal(d), total: 0, porHarness: {} })
    }

    const cruzamentos = new Map()
    for (const evento of eventos) {
      if (Number.isNaN(evento.em.getTime())) continue
      const dia = diaLocal(evento.em)
      if (dentroDoPeriodo(evento.em)) {
        const celula = serie.get(dia)
        if (celula) {
          celula.total += 1
          celula.porHarness[evento.harness] = (celula.porHarness[evento.harness] || 0) + 1
        }
      }
      if (!evento.skill) continue
      const skill = resolverSkill(evento.skill)
      skill.usosConhecidos += 1
      if (dentroDoPeriodo(evento.em)) {
        skill.usosPeriodo += 1
        skill.dias.add(dia)
      }
      const iso = evento.em.toISOString()
      if (!skill.ultimoUso || iso > skill.ultimoUso) skill.ultimoUso = iso
      skill.harnesses.set(evento.harness, (skill.harnesses.get(evento.harness) || 0) + 1)
      skill.agentes.set(evento.agente, (skill.agentes.get(evento.agente) || 0) + 1)
      const chave = `${skill.id}|${evento.harness}|${evento.agente}`
      const atual = cruzamentos.get(chave) || { skillId: skill.id, skill: skill.nome, harness: evento.harness, agente: evento.agente, usos: 0, ultimoUso: null, cobertura: 'evento' }
      atual.usos += 1
      if (!atual.ultimoUso || iso > atual.ultimoUso) atual.ultimoUso = iso
      cruzamentos.set(chave, atual)
    }

    for (const [nome, info] of usoHermes) {
      if (info.usos <= 0) continue
      const skill = resolverSkill(nome)
      skill.usosConhecidos += info.usos
      const isoAgregado = isoValido(info.ultimoUso)
      if (isoAgregado && (!skill.ultimoUso || isoAgregado > skill.ultimoUso)) skill.ultimoUso = isoAgregado
      skill.harnesses.set('Hermes', (skill.harnesses.get('Hermes') || 0) + info.usos)
      skill.agentes.set('Hermes Agent', (skill.agentes.get('Hermes Agent') || 0) + info.usos)
      const chave = `${skill.id}|Hermes|Hermes Agent|agregado`
      cruzamentos.set(chave, {
        skillId: skill.id,
        skill: skill.nome,
        harness: 'Hermes',
        agente: 'Hermes Agent',
        usos: info.usos,
        ultimoUso: isoAgregado,
        cobertura: 'agregado',
      })
    }

    const listaSkills = [...skills.values()]
      .map((s) => ({
        id: s.id,
        nome: s.nome,
        proposito: s.proposito,
        origem: s.origem,
        origemRotulo: s.origemRotulo,
        caminho: s.caminho,
        catalogada: s.catalogada,
        usosPeriodo: s.usosPeriodo,
        usosConhecidos: s.usosConhecidos,
        diasAtivos: s.dias.size,
        ultimoUso: s.ultimoUso,
        harnesses: [...s.harnesses.entries()].map(([nome, usos]) => ({ nome, usos })).sort((a, b) => b.usos - a.usos || a.nome.localeCompare(b.nome)),
        agentes: [...s.agentes.entries()].map(([nome, usos]) => ({ nome, usos })).sort((a, b) => b.usos - a.usos || a.nome.localeCompare(b.nome)),
      }))
      .sort((a, b) => b.usosConhecidos - a.usosConhecidos || a.nome.localeCompare(b.nome))

    const porHarness = new Map()
    for (const evento of eventos) {
      if (Number.isNaN(evento.em.getTime())) continue
      const h = porHarness.get(evento.harness) || { nome: evento.harness, usosPeriodo: 0, usosConhecidos: 0, skills: new Set(), agentes: new Set(), ultimoUso: null, temEvento: false, temAgregado: false }
      h.temEvento = true
      h.agentes.add(evento.agente)
      const iso = evento.em.toISOString()
      if (!h.ultimoUso || iso > h.ultimoUso) h.ultimoUso = iso
      if (dentroDoPeriodo(evento.em)) h.usosPeriodo += 1
      if (evento.skill) {
        h.usosConhecidos += 1
        h.skills.add(evento.skill)
      }
      porHarness.set(evento.harness, h)
    }
    for (const [nome, info] of usoHermes) {
      if (info.usos <= 0) continue
      const h = porHarness.get('Hermes') || { nome: 'Hermes', usosPeriodo: 0, usosConhecidos: 0, skills: new Set(), agentes: new Set(), ultimoUso: null, temEvento: false, temAgregado: false }
      h.temAgregado = true
      h.usosConhecidos += info.usos
      h.skills.add(nome)
      h.agentes.add('Hermes Agent')
      const isoUltimo = isoValido(info.ultimoUso)
      if (isoUltimo && (!h.ultimoUso || isoUltimo > h.ultimoUso)) h.ultimoUso = isoUltimo
      porHarness.set('Hermes', h)
    }
    const harnesses = [...porHarness.values()]
      .map((h) => ({
        nome: h.nome,
        usosPeriodo: h.usosPeriodo,
        usosConhecidos: h.usosConhecidos,
        skills: h.skills.size,
        agentes: [...h.agentes].sort(),
        ultimoUso: h.ultimoUso,
        cobertura: h.temEvento && h.temAgregado ? 'evento+agregado' : h.temAgregado ? 'agregado' : 'evento',
      }))
      .sort((a, b) => b.usosConhecidos - a.usosConhecidos || a.nome.localeCompare(b.nome))

    const usadas = listaSkills.filter((s) => s.usosConhecidos > 0).length
    const origens = new Set(listaSkills.filter((s) => s.catalogada).map((s) => s.origem)).size
    const usosPeriodo = [...serie.values()].reduce((s, d) => s + d.total, 0)
    const usosConhecidos = listaSkills.reduce((s, skill) => s + skill.usosConhecidos, 0)

    return {
      geradoEm: fim.toISOString(),
      periodo: { dias: totalDias, inicio: diaInicio, fim: diaFim },
      resumo: {
        inventario: listaSkills.filter((s) => s.catalogada).length,
        usadas,
        usosPeriodo,
        usosConhecidos,
        harnesses: harnesses.length,
        origens,
      },
      skills: listaSkills,
      serieDiaria: [...serie.values()],
      harnesses,
      cruzamentos: [...cruzamentos.values()].sort((a, b) => b.usos - a.usos || String(a.skill).localeCompare(String(b.skill))),
      fontes,
      alertas,
    }
  }

  return { dashboard }
}

function criarMiddlewareSkills(servico) {
  return async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname !== '/dashboard') return next ? next() : responder(res, 404, { ok: false, erro: { codigo: 'ROTA_INEXISTENTE', mensagem: 'Use /dashboard.' } })
    res.setHeader('Cache-Control', 'no-store')
    if (!origemLocal(req)) {
      return responder(res, 403, { ok: false, erro: { codigo: 'ORIGEM_NAO_PERMITIDA', mensagem: 'API disponível somente em loopback e origem local.' } })
    }
    if (req.method !== 'GET') {
      return responder(res, 405, { ok: false, erro: { codigo: 'METODO_NAO_SUPORTADO', mensagem: 'Use GET /dashboard.' } })
    }
    try {
      const dias = url.searchParams.has('dias') ? Number(url.searchParams.get('dias')) : undefined
      const data = await servico.dashboard({ dias })
      return responder(res, 200, { ok: true, data })
    } catch (e) {
      return responder(res, 500, { ok: false, erro: { codigo: 'ERRO_INTERNO', mensagem: String(e?.message || e) } })
    }
  }
}

module.exports = { criarServicoSkills, criarMiddlewareSkills }
