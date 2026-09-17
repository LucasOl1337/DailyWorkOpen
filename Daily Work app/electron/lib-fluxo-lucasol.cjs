const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const LUCASOL_DIR_PADRAO = process.env.LUCASOL_DIR || path.resolve(__dirname, '..', '..', 'LucasOL')

const FONTES_APOSENTADAS = new Set(['zcode'])
const STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
  'entre', 'essa', 'esse', 'esta', 'este', 'foi', 'mais', 'na', 'nas', 'no', 'nos',
  'o', 'os', 'ou', 'para', 'pela', 'pelo', 'por', 'que', 'se', 'sem', 'ser', 'um',
  'uma', 'usar', 'antes', 'depois', 'atual', 'projeto', 'trabalho', 'frente',
])

function semAcento(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function textoComparavel(valor) {
  return semAcento(valor).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokens(valor) {
  return new Set(
    semAcento(valor)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((item) => item.length >= 3 && !STOPWORDS.has(item))
  )
}

function intersecao(a, b) {
  let total = 0
  for (const item of a) if (b.has(item)) total += 1
  return total
}

function listarMarkdown(diretorio) {
  if (!fs.existsSync(diretorio)) return []
  const arquivos = []
  for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
    if (entrada.name.startsWith('.')) continue
    const absoluto = path.join(diretorio, entrada.name)
    if (entrada.isDirectory()) arquivos.push(...listarMarkdown(absoluto))
    else if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.md')) arquivos.push(absoluto)
  }
  return arquivos
}

function tituloMarkdown(conteudo, fallback) {
  const titulo = String(conteudo).match(/^#\s+(.+)$/m)?.[1]?.trim()
  return titulo || fallback.replace(/\.md$/i, '').replace(/[-_]/g, ' ')
}

function resumoMarkdown(conteudo, limite = 360) {
  const limpo = String(conteudo)
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trim()}…` : limpo
}

function lerJson(arquivo, fallback) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  } catch {
    return fallback
  }
}

function relativoSeguro(raiz, arquivo) {
  return path.relative(raiz, arquivo).replace(/\\/g, '/')
}

function extrairFrontmatter(conteudo) {
  const bloco = String(conteudo).match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!bloco) return {}
  const resultado = {}
  for (const linha of bloco[1].split(/\r?\n/)) {
    const par = linha.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (par) resultado[par[1]] = par[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return resultado
}

function primeiraAcao(conteudo) {
  const secao = String(conteudo).match(/##\s+Pr[oó]xima a[cç][aã]o\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i)?.[1]
  return secao?.match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.+)$/m)?.[1]?.trim() || null
}

function campoDoCorpo(conteudo, nomes) {
  const alternativas = new Set(nomes.map((nome) => semAcento(nome).toLowerCase()))
  for (const linha of String(conteudo || '').split(/\r?\n/)) {
    const separador = linha.search(/[:=]/)
    if (separador < 0) continue
    const chave = semAcento(linha.slice(0, separador)).trim().toLowerCase()
    if (alternativas.has(chave)) return linha.slice(separador + 1).trim()
  }
  return null
}

function primeiraAcaoDoCorpo(conteudo) {
  return String(conteudo || '').match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.+)$/m)?.[1]?.trim() || null
}

function idadeEmHoras(data, agora) {
  const instante = Date.parse(data)
  if (!Number.isFinite(instante)) return Number.POSITIVE_INFINITY
  return Math.max(0, (agora.getTime() - instante) / 3_600_000)
}

function hash(valor) {
  return crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex').slice(0, 16)
}

function recuarDia(dia, n) {
  const [ano, mes, data] = String(dia).split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, data - n)).toISOString().slice(0, 10)
}

function inferirProjeto(projetos, texto) {
  const comparavel = textoComparavel(texto)
  if (!comparavel) return null
  let melhor = null
  let melhorTamanho = 0
  for (const projeto of projetos) {
    const nomes = [projeto.id, projeto.name, ...(projeto.aliases || [])]
    for (const nome of nomes) {
      const chave = textoComparavel(nome)
      if (chave && chave.length >= 3 && comparavel.includes(chave) && chave.length > melhorTamanho) {
        melhor = projeto
        melhorTamanho = chave.length
      }
    }
  }
  return melhor
}

function extrairBulletsSumario(markdown) {
  const texto = String(markdown || '')
  const secoes = [
    { titulo: 'Próximo passo', kind: 'proximo' },
    { titulo: 'O que pede atenção', kind: 'atencao' },
  ]
  const bullets = []
  for (const secao of secoes) {
    const titulo = secao.titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const bloco = texto.match(new RegExp(`##\\s+${titulo}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s|$)`, 'i'))?.[1] || ''
    for (const linha of bloco.split(/\r?\n/)) {
      const item = linha.match(/^\s*-\s+(?:\*\*(.+?)\*\*\s*[:—–-]?\s*)?(.*)$/)
      if (!item) continue
      const rotulo = (item[1] || '').trim().replace(/[:：]\s*$/, '')
      const detalhe = (item[2] || '').trim()
      const tituloBullet = (rotulo || detalhe).slice(0, 80)
      const objetivo = detalhe || rotulo
      if (!tituloBullet || !objetivo) continue
      bullets.push({ secao: secao.kind, rotulo, objetivo, titulo: tituloBullet })
    }
  }
  return bullets
}

function criarFluxoLucasOL({
  daily,
  lucasOlDir = LUCASOL_DIR_PADRAO,
  agora = () => new Date(),
  obterAnaliseSumario = null,
  obterInputsSumario = null,
} = {}) {
  if (!daily || typeof daily.listarBlocos !== 'function' || typeof daily.listarDias !== 'function') {
    throw new Error('daily precisa expor listarBlocos e listarDias')
  }
  if (!lucasOlDir) throw new Error('lucasOlDir é obrigatório')

  function lerProjetos() {
    const arquivo = path.join(lucasOlDir, 'Workspace', 'projects', 'registry.json')
    const registro = lerJson(arquivo, { version: 1, projects: [] })
    return {
      arquivo,
      projects: Array.isArray(registro.projects) ? registro.projects : [],
    }
  }

  function resolverProjeto(projetos, projetoId, blocos) {
    if (projetoId) {
      const chave = semAcento(projetoId).toLowerCase()
      return projetos.find((projeto) =>
        [projeto.id, projeto.name, ...(projeto.aliases || [])]
          .map((item) => semAcento(item).toLowerCase())
          .includes(chave)
      ) || null
    }
    const ids = blocos.map((bloco) => bloco.projeto).filter(Boolean)
    return projetos.find((projeto) => ids.includes(projeto.id)) || null
  }

  function blocoPertenceAoProjeto(bloco, projeto) {
    if (!projeto) return true
    const nomes = [projeto.id, projeto.name, ...(projeto.aliases || [])]
      .map((item) => semAcento(item).toLowerCase().trim())
      .filter(Boolean)
    if (bloco.projeto) return nomes.includes(semAcento(bloco.projeto).toLowerCase().trim())
    const texto = semAcento(`${bloco.titulo || ''}\n${bloco.corpo || ''}`).toLowerCase()
    return nomes.some((nome) => nome.length >= 3 && texto.includes(nome))
  }

  function lerPacket(projeto) {
    if (!projeto?.packet) return null
    const absoluto = path.resolve(lucasOlDir, projeto.packet)
    const relativo = path.relative(lucasOlDir, absoluto)
    if (relativo.startsWith('..') || path.isAbsolute(relativo) || !fs.existsSync(absoluto)) return null
    const conteudo = fs.readFileSync(absoluto, 'utf8')
    return { absoluto, conteudo, resumo: resumoMarkdown(conteudo, 700), proximaAcao: primeiraAcao(conteudo) }
  }

  function selecionarConhecimento(consulta, limite = 6) {
    const base = tokens(consulta)
    return listarMarkdown(path.join(lucasOlDir, 'Knowledge'))
      .map((arquivo) => {
        const conteudo = fs.readFileSync(arquivo, 'utf8')
        const titulo = tituloMarkdown(conteudo, path.basename(arquivo))
        const score = intersecao(base, tokens(`${titulo}\n${conteudo}`))
        return {
          caminho: relativoSeguro(path.join(lucasOlDir, 'Knowledge'), arquivo),
          titulo,
          resumo: resumoMarkdown(conteudo),
          score,
          sourceRef: `Knowledge/${relativoSeguro(path.join(lucasOlDir, 'Knowledge'), arquivo)}`,
        }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.titulo.localeCompare(b.titulo, 'pt-BR'))
      .slice(0, limite)
      .map(({ score: _score, ...item }) => item)
  }

  function selecionarSkills(consulta, limite = 4) {
    const base = tokens(consulta)
    return listarMarkdown(path.join(lucasOlDir, 'skills'))
      .filter((arquivo) => path.basename(arquivo).toLowerCase() === 'skill.md')
      .map((arquivo) => {
        const conteudo = fs.readFileSync(arquivo, 'utf8')
        const meta = extrairFrontmatter(conteudo)
        const id = meta.name || path.basename(path.dirname(arquivo))
        const descricao = meta.description || resumoMarkdown(conteudo)
        let score = intersecao(base, tokens(`${id} ${descricao}`))
        if (/falha|bug|regress|erro/i.test(consulta) && /diagnos|bug/i.test(`${id} ${descricao}`)) score += 8
        if (/test|valid/i.test(consulta) && /tdd|test/i.test(`${id} ${descricao}`)) score += 5
        if (/arquitet|m[oó]dul|interface/i.test(consulta) && /design|domain|arquitet/i.test(`${id} ${descricao}`)) score += 5
        if (/handoff|continuar|agente/i.test(consulta) && /handoff/i.test(`${id} ${descricao}`)) score += 5
        return {
          id,
          descricao,
          caminho: relativoSeguro(lucasOlDir, arquivo),
          score,
          sourceRef: relativoSeguro(lucasOlDir, arquivo),
        }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limite)
      .map(({ score: _score, ...item }) => item)
  }

  function lerSinais(projeto, instante) {
    const arquivo = path.join(lucasOlDir, 'Private', 'work-signals', 'data', 'daily-context.json')
    const exportacao = lerJson(arquivo, null)
    if (!exportacao || !Array.isArray(exportacao.signals)) {
      return { arquivo, generatedAt: null, sinais: [], status: 'unavailable' }
    }
    const idadeExportacao = idadeEmHoras(exportacao.generatedAt, instante)
    const sinais = exportacao.signals
      .filter((sinal) => !FONTES_APOSENTADAS.has(String(sinal.source).toLowerCase()))
      .filter((sinal) => !projeto || !sinal.projectId || sinal.projectId === 'global' || sinal.projectId === projeto.id)
      .filter((sinal) => idadeEmHoras(sinal.occurredAt, instante) <= 72)
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
      .slice(0, 8)
    return {
      arquivo,
      generatedAt: exportacao.generatedAt,
      sinais,
      status: idadeExportacao <= 24 ? 'fresh' : 'stale',
    }
  }

  function detectarRiscos({ hoje, projeto, sinaisInfo, instante }) {
    const riscos = []
    if (sinaisInfo.status === 'stale') {
      riscos.push({ code: 'STALE_SIGNALS', message: 'Sinais de trabalho desatualizados não influenciam prioridades.' })
    }
    if (projeto?.updatedAt && idadeEmHoras(`${projeto.updatedAt}T23:59:59Z`, instante) > 30 * 24) {
      riscos.push({
        code: 'STALE_PROJECT',
        message: `A memória de ${projeto.name} não é verificada há mais de 30 dias.`,
      })
    }
    const porBranch = new Map()
    for (const bloco of hoje.filter((item) => item.status !== 'feito' && item.repositorio && item.branch)) {
      const chave = `${String(bloco.repositorio).toLowerCase()}|${String(bloco.branch).toLowerCase()}`
      const grupo = porBranch.get(chave) || []
      grupo.push(bloco)
      porBranch.set(chave, grupo)
    }
    for (const grupo of porBranch.values()) {
      const responsaveis = new Set(grupo.map((bloco) => bloco.responsavel).filter(Boolean))
      if (grupo.length > 1 && responsaveis.size > 1) {
        riscos.push({
          code: 'CONCURRENT_BRANCH',
          message: `${[...responsaveis].join(' e ')} estão na mesma branch ${grupo[0].branch}; isole o trabalho antes de continuar.`,
        })
      }
    }
    return riscos
  }

  function localizarAnaliseRecente(dia) {
    if (typeof obterAnaliseSumario !== 'function') return null
    for (let n = 1; n <= 3; n += 1) {
      const candidato = recuarDia(dia, n)
      try {
        const resultado = obterAnaliseSumario(candidato)
        const markdown = resultado?.analysis?.summaryMarkdown
        if (typeof markdown === 'string' && markdown.trim()) {
          return { dia: candidato, summaryMarkdown: markdown }
        }
      } catch {
        // Análise ausente ou ilegível não bloqueia a preparação.
      }
    }
    return null
  }

  function lerDitados(dia) {
    if (typeof obterInputsSumario !== 'function') return []
    try {
      const indice = obterInputsSumario(dia)
      const inputs = Array.isArray(indice?.inputs) ? indice.inputs : []
      return inputs
        .filter((item) => item?.source === 'sussurro' && String(item.text || '').trim())
        .slice(-40)
        .map((item) => ({
          timestamp: item.timestamp || null,
          text: String(item.text).trim().slice(0, 4_000),
        }))
    } catch {
      return []
    }
  }

  function prepararDia({ dia, projetoId } = {}) {
    if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      throw new Error('dia inválido')
    }
    const instante = agora()
    const hoje = daily.listarBlocos(dia)
    const diasAnteriores = daily.listarDias().filter((item) => item < dia).sort().reverse()
    const diaAnterior = diasAnteriores[0] || null
    const anteriores = diaAnterior ? daily.listarBlocos(diaAnterior) : []
    const candidatosCarryover = anteriores.filter(
      (bloco) => ['tarefa', 'projeto'].includes(bloco.tipo) && bloco.status !== 'feito'
    )
    const registro = lerProjetos()
    const projeto = resolverProjeto(registro.projects, projetoId, [...hoje, ...candidatosCarryover])
    if (projetoId && !projeto) throw new Error(`projeto não encontrado: ${projetoId}`)
    const carryovers = projeto
      ? candidatosCarryover.filter((bloco) => blocoPertenceAoProjeto(bloco, projeto))
      : candidatosCarryover
    const packet = lerPacket(projeto)
    const sinaisInfo = lerSinais(projeto, instante)
    const analiseRecente = localizarAnaliseRecente(dia)
    const ditados = lerDitados(dia)
    const idsHoje = new Set(hoje.map((bloco) => bloco.id))
    const carryoversHoje = new Set(hoje.map((bloco) => bloco.carryoverDe).filter(Boolean))
    const propostas = []
    const tituloLivre = (titulo) => {
      const chave = textoComparavel(titulo)
      if (!chave) return false
      if (hoje.some((bloco) => textoComparavel(bloco.titulo) === chave)) return false
      return !propostas.some((item) => textoComparavel(item.bloco.titulo) === chave)
    }

    for (const bullet of extrairBulletsSumario(analiseRecente?.summaryMarkdown)) {
      if (!tituloLivre(bullet.titulo)) continue
      const projetoBullet = inferirProjeto(registro.projects, `${bullet.rotulo} ${bullet.objetivo}`)
      propostas.push({
        id: `sumario-${hash(`${analiseRecente.dia}:${bullet.secao}:${bullet.titulo}`)}`,
        kind: 'sumario_proximo_passo',
        reason: bullet.secao === 'atencao'
          ? `Atenção no Sumário de ${analiseRecente.dia}.`
          : `Próximo passo no Sumário de ${analiseRecente.dia}.`,
        bloco: {
          tipo: 'tarefa',
          titulo: bullet.titulo,
          status: 'pendente',
          corpo: `Objetivo: ${bullet.objetivo}\n\n- ${bullet.objetivo}\n\nPRONTO = avanço concreto registrado neste dia.`,
          papel: 'front',
          projeto: projetoBullet?.id,
          origem: 'context-pack',
          fontes: [`sumario:${analiseRecente.dia}/analise`],
        },
      })
    }

    for (const bloco of carryovers.filter((bloco) => !idsHoje.has(bloco.id) && !carryoversHoje.has(bloco.id))) {
      if (!tituloLivre(bloco.titulo)) continue
      propostas.push({
        id: `carryover-${bloco.id}`,
        kind: 'carryover',
        reason: `Frente aberta em ${diaAnterior}.`,
        bloco: {
          tipo: bloco.tipo,
          titulo: bloco.titulo,
          status: bloco.status === 'fazendo' ? 'fazendo' : 'pendente',
          corpo: bloco.corpo || '',
          papel: 'front',
          projeto: bloco.projeto || projeto?.id,
          fase: bloco.fase,
          origem: 'context-pack',
          carryoverDe: bloco.id,
          fontes: [`dailywork:${diaAnterior}/${bloco.id}`],
        },
      })
    }

    const projetosAtivos = registro.projects
      .filter((item) => item.status !== 'archived')
      .slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.name.localeCompare(b.name, 'pt-BR'))
    for (const candidato of projetosAtivos) {
      const packetProjeto = candidato.id === projeto?.id ? packet : lerPacket(candidato)
      if (!packetProjeto?.proximaAcao) continue
      const titulo = packetProjeto.proximaAcao.slice(0, 80)
      if (!tituloLivre(titulo)) continue
      propostas.push({
        id: `project-next-${candidato.id}`,
        kind: 'project_next_action',
        reason: 'Próxima ação registrada na memória canônica do projeto.',
        bloco: {
          tipo: 'tarefa',
          titulo,
          status: 'pendente',
          corpo: `Objetivo: avançar ${candidato.name} pela próxima ação canônica.\n\n- ${packetProjeto.proximaAcao}\n\nPRONTO = ação executada e evidência registrada.`,
          papel: 'front',
          projeto: candidato.id,
          origem: 'context-pack',
          fontes: [candidato.packet].filter(Boolean),
        },
      })
    }

    const consulta = [
      projeto?.name,
      ...(projeto?.aliases || []),
      packet?.conteudo,
      analiseRecente?.summaryMarkdown,
      ...ditados.map((ditado) => ditado.text),
      ...hoje.map((bloco) => `${bloco.titulo} ${bloco.corpo || ''}`),
      ...carryovers.map((bloco) => `${bloco.titulo} ${bloco.corpo || ''}`),
      ...sinaisInfo.sinais.map((sinal) => `${sinal.title} ${sinal.evidence || ''}`),
      ...propostas.map((proposta) => `${proposta.bloco.titulo} ${proposta.bloco.corpo || ''} ${proposta.reason}`),
    ].filter(Boolean).join('\n')
    const conhecimento = selecionarConhecimento(consulta)
    const skills = selecionarSkills(consulta)
    const fontes = [
      { kind: 'project_registry', source: 'workspace', ref: relativoSeguro(lucasOlDir, registro.arquivo), status: fs.existsSync(registro.arquivo) ? 'available' : 'unavailable' },
      ...(packet ? [{ kind: 'project_packet', source: 'workspace', ref: projeto.packet, status: 'available' }] : []),
      ...(analiseRecente
        ? [{ kind: 'daily_summary', source: 'daily-summary', ref: `sumario:${analiseRecente.dia}/analise`, status: 'available' }]
        : []),
      ...(ditados.length
        ? [{ kind: 'dictation', source: 'sussurro', ref: `sumario:${dia}/sussurro`, status: 'available' }]
        : []),
      ...conhecimento.map((item) => ({ kind: 'knowledge', source: 'knowledge', ref: item.sourceRef, status: 'available' })),
      ...skills.map((item) => ({ kind: 'skill', source: 'skills', ref: item.sourceRef, status: 'available' })),
      { kind: 'work_signals', source: 'work-signals', ref: relativoSeguro(lucasOlDir, sinaisInfo.arquivo), status: sinaisInfo.status },
    ]
    const base = {
      schemaVersion: 1,
      generatedAt: instante.toISOString(),
      dia,
      projeto: projeto ? { ...projeto, packetSummary: packet?.resumo || null } : null,
      projetosDisponiveis: registro.projects
        .filter((item) => item.status !== 'archived')
        .map(({ id, name, aliases, status }) => ({ id, name, aliases: aliases || [], status })),
      carryovers,
      conhecimento,
      skills,
      sinais: sinaisInfo.sinais,
      riscos: detectarRiscos({ hoje, projeto, sinaisInfo, instante }),
      propostas: propostas.slice(0, 10),
      analiseRecente,
      ditados,
      fontes,
    }
    const { generatedAt: _generatedAt, ...conteudoEstavel } = base
    return { ...base, packId: hash(conteudoEstavel) }
  }

  function confirmarPropostas({ dia, packId, propostaIds, projetoId } = {}) {
    if (typeof daily.criarBloco !== 'function') {
      throw new Error('daily precisa expor criarBloco para confirmar propostas')
    }
    if (!Array.isArray(propostaIds) || propostaIds.length === 0) {
      throw new Error('selecione ao menos uma proposta')
    }
    const marcadores = new Map(
      propostaIds.map((propostaId) => [propostaId, `context-pack:${packId}/${propostaId}`])
    )
    const existentes = daily.listarBlocos(dia).filter((bloco) =>
      Array.isArray(bloco.fontes) && [...marcadores.values()].some((marcador) => bloco.fontes.includes(marcador))
    )
    if (existentes.length === propostaIds.length) {
      return propostaIds.map((propostaId) => {
        const bloco = existentes.find((item) => item.fontes.includes(marcadores.get(propostaId)))
        return { propostaId, blocoId: bloco.id, bloco }
      })
    }
    if (existentes.length > 0) throw new Error('CONFLITO: confirmação parcialmente aplicada')

    const atual = prepararDia({ dia, projetoId })
    if (atual.packId !== packId) {
      throw new Error('CONFLITO: o contexto mudou; revise as propostas novamente')
    }
    const porId = new Map(atual.propostas.map((proposta) => [proposta.id, proposta]))
    const selecionadas = propostaIds.map((id) => porId.get(id))
    if (selecionadas.some((proposta) => !proposta)) {
      throw new Error('CONFLITO: uma proposta não existe mais no pacote atual')
    }
    return selecionadas.map((proposta) => {
      const marcador = marcadores.get(proposta.id)
      const bloco = daily.criarBloco(
        {
          id: `b-context-${hash(`${packId}/${proposta.id}`)}`,
          x: 0,
          y: 0,
          w: 320,
          h: 200,
          conexoes: [],
          ...proposta.bloco,
          fontes: [...new Set([...(proposta.bloco.fontes || []), marcador])],
        },
        dia
      )
      return { propostaId: proposta.id, blocoId: bloco.id, bloco }
    })
  }

  function revisarFechamento({ dia } = {}) {
    if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('dia inválido')
    const instante = agora()
    const frentes = daily.listarBlocos(dia).filter((bloco) => ['tarefa', 'projeto'].includes(bloco.tipo))
    const concluidas = frentes.filter((bloco) => bloco.status === 'feito')
    const abertas = frentes.filter((bloco) => bloco.status !== 'feito')
    const comprovadas = concluidas.filter((bloco) => Array.isArray(bloco.evidencias) && bloco.evidencias.length)
    const semEvidencia = concluidas.filter((bloco) => !Array.isArray(bloco.evidencias) || !bloco.evidencias.length)
    const handoffs = abertas.map((bloco) => ({
      blocoId: bloco.id,
      projectId: bloco.projeto || null,
      titulo: bloco.titulo,
      objetivo: campoDoCorpo(bloco.corpo, ['Objetivo', 'Foco', 'Missão']) || bloco.titulo,
      estado: bloco.status,
      evidencias: bloco.evidencias || [],
      proximaAcao: primeiraAcaoDoCorpo(bloco.corpo) || 'Definir a próxima ação concreta.',
      pronto: campoDoCorpo(bloco.corpo, ['PRONTO', 'SAÍDA']) || null,
    }))

    const registro = lerProjetos()
    const porProjeto = new Map()
    for (const bloco of frentes.filter((item) => item.projeto)) {
      const grupo = porProjeto.get(bloco.projeto) || { concluidas: [], abertas: [] }
      grupo[bloco.status === 'feito' ? 'concluidas' : 'abertas'].push(bloco)
      porProjeto.set(bloco.projeto, grupo)
    }
    const workspace = [...porProjeto.entries()].flatMap(([projectId, grupo]) => {
      const projeto = registro.projects.find((item) => item.id === projectId)
      if (!projeto?.packet) return []
      const linhas = [
        `## ${dia}`,
        '',
        ...(grupo.concluidas.length ? ['### Resultados comprovados', ...grupo.concluidas.map((bloco) => `- ${bloco.titulo}${bloco.evidencias?.length ? ` — ${bloco.evidencias.join('; ')}` : ' — sem evidência'}`), ''] : []),
        ...(grupo.abertas.length ? ['### Continuidade', ...grupo.abertas.map((bloco) => `- ${bloco.titulo}: ${primeiraAcaoDoCorpo(bloco.corpo) || 'definir próxima ação'}`), ''] : []),
      ]
      return [{
        projectId,
        projectName: projeto.name,
        path: `Workspace/projects/${projectId}/LOG.md`,
        content: linhas.join('\n').trim(),
      }]
    })

    const knowledgeCandidates = comprovadas.flatMap((bloco) => {
      const aprendizado = campoDoCorpo(bloco.corpo, ['Aprendizado', 'Lição'])
      if (!aprendizado) return []
      return [{
        id: hash(`knowledge:${dia}:${bloco.id}:${aprendizado}`),
        title: `Aprendizado de ${bloco.titulo}`,
        content: aprendizado,
        projectId: bloco.projeto || null,
        sourceRefs: [`dailywork:${dia}/${bloco.id}`, ...(bloco.evidencias || [])],
      }]
    })
    const portfolioCandidates = comprovadas.flatMap((bloco) => {
      const resultado = campoDoCorpo(bloco.corpo, ['Resultado'])
      if (!resultado) return []
      return [{
        id: hash(`portfolio:${dia}:${bloco.id}:${resultado}`),
        title: bloco.titulo,
        content: resultado,
        projectId: bloco.projeto || null,
        evidenceRefs: bloco.evidencias || [],
      }]
    })
    const resumo = {
      total: frentes.length,
      concluidas: concluidas.length,
      abertas: abertas.length,
      semEvidencia: semEvidencia.length,
    }
    const dailyUpdate = {
      title: `Fechamento de ${dia}`,
      content: [
        `Fechamento: ${concluidas.length} concluída${concluidas.length === 1 ? '' : 's'} e ${abertas.length} aberta${abertas.length === 1 ? '' : 's'}.`,
        ...(comprovadas.length ? ['', 'Resultados comprovados:', ...comprovadas.map((bloco) => `- ${bloco.titulo}: ${(bloco.evidencias || []).join('; ')}`)] : []),
        ...(abertas.length ? ['', 'Continuidade:', ...handoffs.map((item) => `- ${item.titulo}: ${item.proximaAcao}`)] : []),
        '',
        `PRONTO = fechamento revisado com ${semEvidencia.length} conclusão(ões) sem evidência.`,
      ].join('\n'),
    }
    const base = {
      schemaVersion: 1,
      dia,
      resumo,
      alertas: semEvidencia.length
        ? [`${semEvidencia.length} frente(s) marcada(s) como concluída(s) sem evidência; não foram promovidas.`]
        : [],
      handoffs,
      destinos: { daily: dailyUpdate, workspace, knowledgeCandidates, portfolioCandidates },
    }
    return { ...base, generatedAt: instante.toISOString(), reviewId: hash(base) }
  }

  function confirmarFechamento({ dia, reviewId, destinos } = {}) {
    const permitidos = new Set(['daily', 'workspace', 'knowledgeCandidates', 'portfolioCandidates'])
    if (!Array.isArray(destinos) || destinos.length === 0 || destinos.some((item) => !permitidos.has(item))) {
      throw new Error('destinos de fechamento inválidos')
    }
    const revisao = revisarFechamento({ dia })
    if (revisao.reviewId !== reviewId) {
      throw new Error('CONFLITO: o dia mudou; revise o fechamento novamente')
    }
    const recibos = []
    if (destinos.includes('daily')) {
      if (typeof daily.criarBloco !== 'function') throw new Error('daily precisa expor criarBloco')
      const marcador = `closure-review:${reviewId}`
      let bloco = daily.listarBlocos(dia).find((item) => item.fontes?.includes(marcador))
      if (!bloco) {
        bloco = daily.criarBloco({
          id: `b-closure-${reviewId}`,
          tipo: 'nota',
          titulo: revisao.destinos.daily.title,
          status: 'feito',
          x: 0,
          y: 0,
          w: 360,
          h: 220,
          conexoes: [],
          corpo: revisao.destinos.daily.content,
          papel: 'closure',
          origem: 'context-pack',
          fontes: [marcador],
          evidencias: [],
          concluidoEm: agora().toISOString(),
        }, dia)
      }
      recibos.push({ destino: 'daily', ref: bloco.id })
    }
    if (destinos.includes('workspace')) {
      for (const atualizacao of revisao.destinos.workspace) {
        const arquivo = path.join(lucasOlDir, atualizacao.path)
        fs.mkdirSync(path.dirname(arquivo), { recursive: true })
        const marcador = `<!-- closure-review:${reviewId} -->`
        const existente = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '# Log do projeto\n'
        if (!existente.includes(marcador)) {
          fs.writeFileSync(arquivo, `${existente.trim()}\n\n${marcador}\n${atualizacao.content}\n`, 'utf8')
        }
        recibos.push({ destino: 'workspace', ref: atualizacao.path })
      }
    }
    const gravarCandidatos = (destino, pasta, candidatos, prefixo) => {
      if (!destinos.includes(destino)) return
      const diretorio = path.join(lucasOlDir, 'Research', pasta)
      fs.mkdirSync(diretorio, { recursive: true })
      for (const candidato of candidatos) {
        const relativo = `Research/${pasta}/${dia}-${candidato.id}.md`
        const arquivo = path.join(lucasOlDir, relativo)
        if (!fs.existsSync(arquivo)) {
          const referencias = candidato.sourceRefs || candidato.evidenceRefs || []
          fs.writeFileSync(
            arquivo,
            `# ${candidato.title}\n\nStatus: candidato; requer aprovação humana.\n\n${prefixo}: ${candidato.content}\n\n## Fontes\n${referencias.map((item) => `- ${item}`).join('\n')}\n`,
            'utf8'
          )
        }
        recibos.push({ destino, ref: relativo })
      }
    }
    gravarCandidatos('knowledgeCandidates', 'knowledge-candidates', revisao.destinos.knowledgeCandidates, 'Aprendizado candidato')
    gravarCandidatos('portfolioCandidates', 'portfolio-candidates', revisao.destinos.portfolioCandidates, 'Resultado candidato')
    return recibos
  }

  function revisarSemana({ ate } = {}) {
    if (typeof ate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new Error('data final inválida')
    const final = new Date(`${ate}T12:00:00Z`)
    if (!Number.isFinite(final.getTime())) throw new Error('data final inválida')
    const inicio = new Date(final)
    inicio.setUTCDate(inicio.getUTCDate() - 6)
    const de = inicio.toISOString().slice(0, 10)
    const dias = daily.listarDias().filter((dia) => dia >= de && dia <= ate).sort()
    const entradas = dias.flatMap((dia) =>
      daily.listarBlocos(dia)
        .filter((bloco) => ['tarefa', 'projeto'].includes(bloco.tipo))
        .map((bloco) => ({ dia, bloco }))
    )
    const concluidas = entradas.filter(({ bloco }) => bloco.status === 'feito')
    const concluidasComEvidencia = concluidas.filter(({ bloco }) => bloco.evidencias?.length)
    const porFrente = new Map()
    for (const { dia, bloco } of entradas) {
      const chave = `${bloco.projeto || 'sem-projeto'}|${semAcento(bloco.titulo).toLowerCase()}`
      const atual = porFrente.get(chave) || { titulo: bloco.titulo, projectId: bloco.projeto || null, dias: new Set(), estados: new Set() }
      atual.dias.add(dia)
      atual.estados.add(bloco.status)
      porFrente.set(chave, atual)
    }
    const frentesRecorrentes = [...porFrente.values()]
      .filter((item) => item.dias.size > 1)
      .map((item) => ({
        titulo: item.titulo,
        projectId: item.projectId,
        dias: item.dias.size,
        periodo: [...item.dias].sort(),
        estados: [...item.estados],
      }))
      .sort((a, b) => b.dias - a.dias || a.titulo.localeCompare(b.titulo, 'pt-BR'))

    let linksLocaisQuebrados = 0
    for (const arquivo of listarMarkdown(path.join(lucasOlDir, 'Knowledge'))) {
      const conteudo = fs.readFileSync(arquivo, 'utf8')
      for (const match of conteudo.matchAll(/file:\/\/\/[^)\s>]+/g)) {
        try {
          let local = decodeURIComponent(match[0].slice(8)).replace(/\//g, path.sep)
          if (/^\\[A-Za-z]:/.test(local)) local = local.slice(1)
          if (!fs.existsSync(local)) linksLocaisQuebrados += 1
        } catch {
          linksLocaisQuebrados += 1
        }
      }
    }
    const resumo = {
      diasComTrabalho: dias.length,
      frentesRegistradas: entradas.length,
      concluidasComEvidencia: concluidasComEvidencia.length,
      concluidasSemEvidencia: concluidas.length - concluidasComEvidencia.length,
      aindaAbertas: entradas.filter(({ bloco }) => bloco.status !== 'feito').length,
    }
    const base = {
      schemaVersion: 1,
      periodo: { de, ate },
      resumo,
      frentesRecorrentes,
      conhecimento: { linksLocaisQuebrados },
    }
    return { ...base, generatedAt: agora().toISOString(), weekId: hash(base) }
  }

  return { prepararDia, confirmarPropostas, revisarFechamento, confirmarFechamento, revisarSemana }
}

module.exports = { criarFluxoLucasOL, FONTES_APOSENTADAS, LUCASOL_DIR_PADRAO, extrairBulletsSumario }
