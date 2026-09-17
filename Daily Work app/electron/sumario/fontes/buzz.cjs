const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { promisify } = require('node:util')
const { DatabaseSync } = require('node:sqlite')
const {
  cobertura,
  criarMensagem,
  dentroDaJanela,
  mesclarConversas,
  textoDeConteudo,
} = require('../shared.cjs')

const execFile = promisify(childProcess.execFile)
const TAMANHO_PAGINA = 500

const SCRIPT_CREDENCIAL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DailyWorkCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr buffer);
}
'@
$pointer = [IntPtr]::Zero
if (-not [DailyWorkCredential]::CredRead('secrets.buzz-desktop', 1, 0, [ref]$pointer)) { exit 2 }
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][DailyWorkCredential+Credential])
  $bytes = New-Object byte[] $credential.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
  $json = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
  $vault = $json | ConvertFrom-Json
  $identity = [string]$vault.identity
  [Array]::Clear($bytes, 0, $bytes.Length)
  if (-not $identity) { exit 3 }
  [Console]::Out.Write($identity)
} finally {
  [DailyWorkCredential]::CredFree($pointer)
}
`

function abrirDb(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true })
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000')
  return db
}

function urlHttp(relay) {
  const valor = String(relay || '').trim()
  if (valor.startsWith('wss://')) return `https://${valor.slice(6)}`
  if (valor.startsWith('ws://')) return `http://${valor.slice(5)}`
  return valor
}

function lerAgentes(arquivo) {
  if (!fs.existsSync(arquivo)) return { agentes: new Map(), relay: null }
  try {
    const itens = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    const lista = Array.isArray(itens) ? itens : []
    return {
      agentes: new Map(
        lista
        .filter((item) => item?.pubkey)
        .map((item) => [String(item.pubkey), item.display_name || item.name || 'Agente Buzz'])
      ),
      relay: urlHttp(lista.find((item) => item?.relay_url)?.relay_url),
    }
  } catch {
    return { agentes: new Map(), relay: null }
  }
}

function executaveisBuzz(ctx) {
  if (process.platform === 'win32') return [path.join(ctx.localAppDataDir, 'Buzz', 'buzz.exe')]
  return [
    path.join(ctx.localAppDataDir, 'Buzz', 'buzz'),
    path.join(ctx.homeDir, '.local', 'bin', 'buzz'),
    '/usr/bin/buzz',
  ]
}

async function lerIdentidadeBuzz(ctx) {
  if (ctx.readBuzzIdentity) return ctx.readBuzzIdentity()
  const arquivo = path.join(ctx.appDataDir, 'xyz.block.buzz.app', 'identity.key')
  if (fs.existsSync(arquivo)) return fs.readFileSync(arquivo, 'utf8').trim()
  if (process.platform !== 'win32') {
    throw new Error('identidade do Buzz não encontrada em identity.key')
  }
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const encoded = Buffer.from(SCRIPT_CREDENCIAL, 'utf16le').toString('base64')
  let stdout
  try {
    ;({ stdout } = await execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      }
    ))
  } catch {
    throw new Error('identidade do Buzz não pôde ser lida do Cofre de Credenciais')
  }
  const identidade = String(stdout || '').trim()
  if (!identidade) throw new Error('identidade do Buzz não encontrada no Cofre de Credenciais')
  return identidade
}

async function executarBuzz(ctx, executavel, relay, identidade, args) {
  if (ctx.runBuzz) return ctx.runBuzz({ relay, args })
  const { stdout } = await execFile(
    executavel,
    ['--relay', relay, '--format', 'json', ...args],
    {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, BUZZ_PRIVATE_KEY: identidade },
    }
  )
  return JSON.parse(String(stdout || '[]'))
}

function idsDeDm(itens) {
  const ids = []
  for (const item of Array.isArray(itens) ? itens : []) {
    const id = item?.channel_id || item?.channelId || item?.conversation_id || item?.conversationId || item?.id
    if (id) ids.push({ channel_id: String(id), name: item.name || item.title || 'Mensagem direta' })
  }
  return ids
}

async function mapLimit(itens, limite, visitar) {
  const resultado = new Array(itens.length)
  let proximo = 0
  async function worker() {
    while (proximo < itens.length) {
      const indice = proximo
      proximo += 1
      resultado[indice] = await visitar(itens[indice], indice)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, () => worker()))
  return resultado
}

async function mensagensDoCanal(ctx, executavel, relay, identidade, canal) {
  const mensagens = []
  const vistos = new Set()
  let before = ctx.janela.fimUnix
  for (let pagina = 0; pagina < 200; pagina += 1) {
    const lote = await executarBuzz(ctx, executavel, relay, identidade, [
      'messages', 'get',
      '--channel', canal.channel_id,
      '--since', String(ctx.janela.inicioUnix - 1),
      '--before', String(before),
      '--limit', String(TAMANHO_PAGINA),
    ])
    const itens = Array.isArray(lote) ? lote : []
    if (!itens.length) break
    let maisAntigo = before
    for (const item of itens) {
      const id = String(item?.id || '')
      if (!id || vistos.has(id)) continue
      vistos.add(id)
      if (dentroDaJanela(item.created_at, ctx.janela)) mensagens.push(item)
      const criado = Number(item.created_at)
      if (Number.isFinite(criado)) maisAntigo = Math.min(maisAntigo, criado)
    }
    if (itens.length < TAMANHO_PAGINA || maisAntigo >= before) break
    before = maisAntigo - 1
    if (before < ctx.janela.inicioUnix) break
  }
  return mensagens
}

function metadadosDoArquivo(arquivo) {
  if (!fs.existsSync(arquivo)) return { relays: [], identidadePubkey: null, canais: [] }
  let db
  try {
    db = abrirDb(arquivo)
    const relays = [...db.prepare('SELECT DISTINCT relay_url FROM archived_events').iterate()]
      .map((linha) => urlHttp(linha.relay_url))
      .filter(Boolean)
    const identidadePubkey = db.prepare('SELECT identity_pubkey FROM archived_events LIMIT 1').get()?.identity_pubkey || null
    const canais = [...db.prepare(`
      SELECT DISTINCT channel_id
      FROM observer_channel_index
      WHERE channel_id IS NOT NULL AND channel_id != ''
    `).iterate()].map((linha) => String(linha.channel_id))
    return { relays, identidadePubkey, canais }
  } finally {
    try { db?.close() } catch {}
  }
}

async function coletarBuzz(ctx) {
  const executavel = executaveisBuzz(ctx).find((candidato) => fs.existsSync(candidato))
  const arquivoDb = path.join(ctx.homeDir, '.buzz', 'archive', 'archive.db')
  const discovered = Boolean(executavel) || fs.existsSync(arquivoDb)
  const conversas = []
  const errors = []
  let records = 0
  if (!discovered || !executavel) {
    if (discovered) errors.push('Buzz instalado, mas o CLI oficial não foi encontrado.')
    return {
      conversations: [],
      coverage: cobertura({ id: 'buzz', label: 'Buzz', discovered, conversations: [], errors }),
    }
  }

  let meta = { relays: [], identidadePubkey: null, canais: [] }
  try { meta = metadadosDoArquivo(arquivoDb) } catch (erro) { errors.push(`arquivo local: ${String(erro.message || erro)}`) }
  const configuracaoAgentes = lerAgentes(
    path.join(ctx.appDataDir, 'xyz.block.buzz.app', 'agents', 'managed-agents.json')
  )
  const agentes = configuracaoAgentes.agentes
  const relay = meta.relays[0] || configuracaoAgentes.relay
  if (!relay) {
    errors.push('Relay do Buzz não pôde ser identificado.')
    return {
      conversations: [],
      coverage: cobertura({ id: 'buzz', label: 'Buzz', discovered, conversations: [], errors }),
    }
  }

  let identidade
  try { identidade = await lerIdentidadeBuzz(ctx) } catch (erro) {
    errors.push(String(erro.message || erro))
    return {
      conversations: [],
      coverage: cobertura({ id: 'buzz', label: 'Buzz', discovered, conversations: [], errors }),
    }
  }

  try {
    const canaisVisiveis = await executarBuzz(ctx, executavel, relay, identidade, [
      'channels', 'list', '--member', '--limit', '500',
    ])
    const dms = await executarBuzz(ctx, executavel, relay, identidade, ['dms', 'list', '--limit', '500'])
    const porId = new Map()
    for (const canal of Array.isArray(canaisVisiveis) ? canaisVisiveis : []) {
      if (canal?.channel_id) porId.set(String(canal.channel_id), canal)
    }
    for (const canal of idsDeDm(dms)) porId.set(canal.channel_id, canal)
    for (const id of meta.canais) {
      if (!porId.has(id)) porId.set(id, { channel_id: id, name: `Canal ${id.slice(0, 8)}` })
    }

    const resultados = await mapLimit([...porId.values()], 4, async (canal) => {
      try {
        return { canal, itens: await mensagensDoCanal(ctx, executavel, relay, identidade, canal) }
      } catch (erro) {
        errors.push(`${canal.name || canal.channel_id}: ${String(erro.message || erro)}`)
        return { canal, itens: [] }
      }
    })

    for (const { canal, itens } of resultados) {
      records += itens.length
      if (!itens.length) continue
      const messages = itens.map((item) => {
        const autor = String(item.pubkey || '')
        const role = autor === String(meta.identidadePubkey || '') ? 'user'
          : agentes.has(autor) ? 'assistant' : 'participant'
        return criarMensagem({
          source: 'buzz',
          conversationId: canal.channel_id,
          recordId: item.id,
          timestamp: item.created_at,
          role,
          kind: 'message',
          text: textoDeConteudo(item.content),
          content: { kind: item.kind, tags: item.tags, author: autor, agentName: agentes.get(autor) || null },
          provenance: { relay, channelId: canal.channel_id, eventId: item.id },
        })
      })
      conversas.push({
        id: `buzz:${canal.channel_id}`,
        source: 'buzz',
        app: 'Buzz',
        title: canal.name || `Canal ${canal.channel_id.slice(0, 8)}`,
        cwd: null,
        sourcePath: relay,
        messages,
      })
    }
  } catch (erro) {
    errors.push(String(erro.message || erro))
  } finally {
    identidade = null
  }

  const normalizadas = mesclarConversas(conversas)
  return {
    conversations: normalizadas,
    coverage: cobertura({
      id: 'buzz',
      label: 'Buzz',
      discovered,
      conversations: normalizadas,
      files: fs.existsSync(arquivoDb) ? 1 : 0,
      records,
      errors,
      notes: ['Canais e DMs paginados pelo CLI oficial com a identidade do Cofre de Credenciais; chaves nunca entram no arquivo.'],
    }),
  }
}

module.exports = { coletarBuzz }
