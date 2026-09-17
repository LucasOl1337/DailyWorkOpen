const fs = require('node:fs')
const path = require('node:path')
const {
  cobertura,
  criarMensagem,
  dentroDaJanela,
  mesclarConversas,
} = require('../shared.cjs')

const SOURCE_ID = 'league-of-legends'
const LABEL = 'League of Legends'
const SETTINGS_RELATIVE_PATH = path.join(
  'Riot Games',
  'Metadata',
  'league_of_legends.live',
  'league_of_legends.live.product_settings.yaml'
)
const SESSION_DIRECTORY = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/
const NOTE = 'Partidas comprovadas pelos GameLogs locais; os logs não comprovam o texto digitado no chat.'

async function coletarLeague(ctx) {
  const settingsPath = path.join(ctx.programDataDir, SETTINGS_RELATIVE_PATH)
  const discovered = fs.existsSync(settingsPath)
  const errors = []
  const sessions = discovered ? lerSessoes(settingsPath, ctx.janela, errors) : []
  const conversations = mesclarConversas(sessions.map(conversaDaSessao))

  return {
    conversations,
    coverage: cobertura({
      id: SOURCE_ID,
      label: LABEL,
      discovered,
      conversations,
      files: sessions.length,
      records: sessions.length,
      errors,
      notes: [NOTE],
    }),
  }
}

function lerSessoes(settingsPath, janela, errors) {
  let installDir
  try {
    installDir = lerDiretorioDeInstalacao(settingsPath)
  } catch (error) {
    errors.push(String(error.message || error))
    return []
  }

  const logsDir = path.join(installDir, 'Logs', 'GameLogs')
  if (!fs.existsSync(logsDir)) return []

  let entries
  try {
    entries = fs.readdirSync(logsDir, { withFileTypes: true })
  } catch (error) {
    errors.push(`GameLogs: ${String(error.message || error)}`)
    return []
  }

  const sessions = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const timestamp = timestampDaSessao(entry.name)
    if (!timestamp || !dentroDaJanela(timestamp, janela)) continue
    const sessionDir = path.join(logsDir, entry.name)
    try {
      const evidenceFile = fs.readdirSync(sessionDir)
        .find((name) => name.endsWith('_r3dlog.txt'))
      if (!evidenceFile) continue
      sessions.push({
        id: entry.name,
        timestamp,
        evidencePath: path.join(sessionDir, evidenceFile),
      })
    } catch (error) {
      errors.push(`${entry.name}: ${String(error.message || error)}`)
    }
  }
  return sessions
}

function lerDiretorioDeInstalacao(settingsPath) {
  const settings = fs.readFileSync(settingsPath, 'utf8')
  const match = settings.match(/^\s*product_install_full_path:\s*(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/m)
  const installDir = String(match?.[1] || match?.[2] || match?.[3] || '').trim()
  if (!installDir || !path.isAbsolute(installDir)) {
    throw new Error('product_install_full_path ausente ou inválido nos metadados do League')
  }
  return path.normalize(installDir)
}

function timestampDaSessao(directoryName) {
  const match = directoryName.match(SESSION_DIRECTORY)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const timestamp = new Date(year, month - 1, day, hour, minute, second)
  if (
    timestamp.getFullYear() !== year
    || timestamp.getMonth() !== month - 1
    || timestamp.getDate() !== day
    || timestamp.getHours() !== hour
    || timestamp.getMinutes() !== minute
    || timestamp.getSeconds() !== second
  ) return null
  return timestamp
}

function conversaDaSessao(session) {
  const time = [session.timestamp.getHours(), session.timestamp.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  const conversationId = `${SOURCE_ID}:${session.id}`
  return {
    id: conversationId,
    source: SOURCE_ID,
    app: LABEL,
    title: `Partida às ${time}`,
    sourcePath: session.evidencePath,
    messages: [criarMensagem({
      source: SOURCE_ID,
      conversationId,
      recordId: `session:${session.id}`,
      timestamp: session.timestamp,
      role: 'tool',
      kind: 'tool_activity',
      text: 'Partida registrada nos logs locais do League of Legends.',
      provenance: { path: session.evidencePath },
    })],
  }
}

module.exports = { coletarLeague }
