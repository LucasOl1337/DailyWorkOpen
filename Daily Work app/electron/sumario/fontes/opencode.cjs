const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const {
  cobertura,
  criarMensagem,
  idEstavel,
  listarArquivos,
  mesclarConversas,
  podarVazios,
  textoDeConteudo,
} = require('../shared.cjs')

function abrirDb(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true })
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000')
  return db
}

function bancos(ctx) {
  const candidatos = [path.join(ctx.homeDir, '.local', 'share', 'opencode', 'opencode.db')]
  const amr = path.join(ctx.homeDir, '.amr', 'opencode-sessions')
  candidatos.push(...listarArquivos(
    amr,
    (_arquivo, nome) => /^opencode.*\.db$/i.test(nome) && !/-wal$|-shm$/i.test(nome)
  ))
  return [...new Set(candidatos)].filter((arquivo) => fs.existsSync(arquivo))
}

function papelMensagem(dados) {
  if (dados?.role === 'assistant') return 'assistant'
  if (dados?.role === 'user') return 'user'
  if (dados?.role === 'system') return 'system'
  return 'participant'
}

// Wrappers gravam contexto de grupo como role=user; o envelope de canal comprova que não foi digitado diretamente.
function contextoDeGrupo(textos) {
  return textos.some((texto) => /<group\b/i.test(texto) && /<current-channel-uuid\b/i.test(texto))
}

function sessaoNaoInterativa(valor) {
  let regras = valor
  if (typeof regras === 'string') {
    try { regras = JSON.parse(regras) } catch { return false }
  }
  if (!Array.isArray(regras)) return false
  const bloqueadas = new Set(regras
    .filter((regra) => regra?.action === 'deny' && regra?.pattern === '*')
    .map((regra) => regra.permission))
  return ['question', 'plan_enter', 'plan_exit'].every((permissao) => bloqueadas.has(permissao))
}

function dentroDoDiretorio(diretorio, raiz) {
  if (!diretorio || !raiz) return false
  const relativo = path.relative(path.resolve(raiz), path.resolve(diretorio))
  return relativo === '' || (
    relativo !== '..'
    && !relativo.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativo)
  )
}

function origemAutomatica(linha, ctx, arquivo) {
  if (dentroDoDiretorio(arquivo, path.join(ctx.homeDir, '.amr', 'opencode-sessions'))) {
    return 'amr_session'
  }
  if (sessaoNaoInterativa(linha.session_permission)) return 'opencode_run'
  if (dentroDoDiretorio(linha.directory, path.join(ctx.homeDir, '.buzz'))) return 'agent_workspace'
  return null
}

async function coletarOpenCode(ctx) {
  const arquivos = bancos(ctx)
  const discovered = arquivos.length > 0
  const conversas = []
  const errors = []
  let records = 0

  for (const arquivo of arquivos) {
    let db
    try {
      db = abrirDb(arquivo)
      const identificadorDb = idEstavel('db', arquivo)
      const consulta = db.prepare(`
        SELECT
          m.id AS message_id,
          m.session_id,
          m.time_created AS message_created,
          m.data AS message_data,
          s.title,
          s.directory,
          s.permission AS session_permission,
          s.time_created AS session_created,
          s.time_updated AS session_updated,
          p.id AS part_id,
          p.time_created AS part_created,
          p.data AS part_data
        FROM message m
        JOIN session s ON s.id = m.session_id
        LEFT JOIN part p ON p.message_id = m.id
        WHERE m.time_created >= ? AND m.time_created < ?
        ORDER BY m.time_created, m.id, p.time_created, p.id
      `)
      const agrupadas = new Map()
      for (const linha of consulta.iterate(ctx.janela.inicioMs, ctx.janela.fimMs)) {
        records += 1
        const chave = String(linha.message_id)
        if (!agrupadas.has(chave)) {
          let dados = {}
          try { dados = JSON.parse(String(linha.message_data || '{}')) } catch {}
          agrupadas.set(chave, { linha, dados, partes: [] })
        }
        if (linha.part_id) {
          let parte = {}
          try { parte = JSON.parse(String(linha.part_data || '{}')) } catch {}
          agrupadas.get(chave).partes.push({
            id: String(linha.part_id),
            timestamp: Number(linha.part_created) || Number(linha.message_created),
            ...parte,
          })
        }
      }

      const porSessao = new Map()
      for (const grupo of agrupadas.values()) {
        const { linha, dados, partes } = grupo
        const sessionId = String(linha.session_id)
        if (!porSessao.has(sessionId)) {
          porSessao.set(sessionId, {
            id: `opencode:${identificadorDb}:${sessionId}`,
            source: 'opencode',
            app: arquivo.includes(`${path.sep}.amr${path.sep}`) ? 'AMR / OpenCode' : 'OpenCode',
            title: linha.title || `Sessão ${sessionId.slice(0, 8)}`,
            cwd: linha.directory || null,
            startedAt: linha.session_created ? new Date(Number(linha.session_created)).toISOString() : null,
            updatedAt: linha.session_updated ? new Date(Number(linha.session_updated)).toISOString() : null,
            sourcePath: arquivo,
            messages: [],
          })
        }
        const partesTexto = partes.filter((parte) => parte.type === 'text')
        const textos = partesTexto
          .map((parte) => textoDeConteudo(parte.text))
          .filter(Boolean)
        const grupoAutomatico = dados?.role === 'user' && contextoDeGrupo(textos)
        const textoSintetico = dados?.role === 'user'
          && partesTexto.length > 0
          && partesTexto.every((parte) => parte.synthetic === true)
        const automatico = grupoAutomatico || textoSintetico
        const mecanismo = dados?.role === 'user' && !automatico
          ? origemAutomatica(linha, ctx, arquivo)
          : null
        const role = automatico ? 'tool' : papelMensagem(dados)
        const texto = textos.join('\n')
        const mensagem = criarMensagem({
          source: 'opencode',
          conversationId: sessionId,
          recordId: `${identificadorDb}:${linha.message_id}`,
          timestamp: Number(linha.message_created),
          role,
          kind: automatico ? 'tool_context' : 'message',
          text: automatico ? '' : texto,
          content: automatico
            ? {
                type: grupoAutomatico ? 'group_context' : 'synthetic_context',
                parts: partes.length,
                characters: texto.length,
              }
            : { message: podarVazios(dados), parts: podarVazios(partes) },
          provenance: { path: arquivo, recordId: linha.message_id },
        })
        if (mecanismo) {
          mensagem.role = 'system'
          mensagem.kind = 'delegated_task'
          mensagem.provenance.delegation = { mechanism: mecanismo }
        }
        porSessao.get(sessionId).messages.push(mensagem)
      }
      conversas.push(...porSessao.values())
    } catch (erro) {
      errors.push(`${path.basename(arquivo)}: ${String(erro.message || erro)}`)
    } finally {
      try { db?.close() } catch {}
    }
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'opencode',
      label: 'OpenCode / AMR',
      discovered,
      conversations: normalizadas,
      files: arquivos.length,
      records,
      errors,
      notes: ['Banco principal do OpenCode e bancos isolados de sessões AMR; execuções não interativas e workspaces de agentes entram como contexto.'],
    }),
  }
}

module.exports = { coletarOpenCode }
