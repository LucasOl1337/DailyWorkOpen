// Sessão do Chromium instalado → viewer das conexões. Lê o banco de cookies do
// perfil do navegador da pessoa (Chromium, Chrome ou Brave), decifra com a
// chave do Safe Storage (keyring via secret-tool, ou "peanuts" no modo
// básico) e grava os cookies dos domínios da conexão na partição do webview.
// Só roda no processo principal, por pedido da pessoa; nada sai do computador.

const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

// Diferença entre a época do Chromium (1601) e a Unix (1970), em segundos.
const EPOCA_CHROMIUM_S = 11644473600n
const IV_CHROMIUM = Buffer.alloc(16, ' ')
const SENHA_BASICA = 'peanuts'

// Provedores de identidade que os sites usam em "Continuar com…". Entram em
// toda partição para o login federado já vir feito.
const DOMINIOS_IDENTIDADE = Object.freeze(['google.com', 'apple.com', 'live.com', 'microsoftonline.com'])

const NAVEGADORES = Object.freeze([
  { id: 'chromium', nome: 'Chromium', pasta: 'chromium', aplicacao: 'chromium' },
  { id: 'chrome', nome: 'Google Chrome', pasta: 'google-chrome', aplicacao: 'chrome' },
  { id: 'brave', nome: 'Brave', pasta: path.join('BraveSoftware', 'Brave-Browser'), aplicacao: 'brave' },
])

function derivarChave(senha) {
  return crypto.pbkdf2Sync(String(senha), 'saltysalt', 1, 16, 'sha1')
}

// Formato do Chromium no Linux: "v10"/"v11" + AES-128-CBC(PKCS7, IV de
// espaços). Versões recentes ainda prefixam o texto com SHA-256 do host_key.
function decifrarValor(bruto, chaves, hostKey) {
  const buffer = Buffer.from(bruto || [])
  if (buffer.length < 3) return ''
  const versao = buffer.subarray(0, 3).toString('latin1')
  const chave = chaves[versao]
  if (!chave) throw new Error(`versão de cifra desconhecida: ${versao}`)
  const decifrador = crypto.createDecipheriv('aes-128-cbc', chave, IV_CHROMIUM)
  let texto = Buffer.concat([decifrador.update(buffer.subarray(3)), decifrador.final()])
  if (texto.length >= 32) {
    const hash = crypto.createHash('sha256').update(String(hostKey)).digest()
    if (texto.subarray(0, 32).equals(hash)) texto = texto.subarray(32)
  }
  return texto.toString('utf8')
}

function cifrarValor(texto, senha, hostKey, versao = 'v11', comPrefixo = true) {
  const cifrador = crypto.createCipheriv('aes-128-cbc', derivarChave(senha), IV_CHROMIUM)
  const corpo = comPrefixo
    ? Buffer.concat([crypto.createHash('sha256').update(String(hostKey)).digest(), Buffer.from(texto, 'utf8')])
    : Buffer.from(texto, 'utf8')
  return Buffer.concat([Buffer.from(versao, 'latin1'), cifrador.update(corpo), cifrador.final()])
}

function hostPertence(hostKey, dominios) {
  const host = String(hostKey || '').replace(/^\./, '').toLowerCase()
  return dominios.some((dominio) => host === dominio || host.endsWith(`.${dominio}`))
}

function mapearSameSite(valor) {
  const numero = Number(valor)
  if (numero === 0) return 'no_restriction'
  if (numero === 1) return 'lax'
  if (numero === 2) return 'strict'
  return 'unspecified'
}

// Converte uma linha do banco em um cookie no formato de session.cookies.set.
function mapearCookie(linha, valor) {
  const hostKey = String(linha.host_key || '')
  const host = hostKey.replace(/^\./, '')
  const seguro = Number(linha.is_secure) === 1
  const caminho = String(linha.path || '/') || '/'
  const cookie = {
    url: `${seguro ? 'https' : 'http'}://${host}${caminho}`,
    name: String(linha.name || ''),
    value: valor,
    path: caminho,
    secure: seguro,
    httpOnly: Number(linha.is_httponly) === 1,
    sameSite: mapearSameSite(linha.samesite),
  }
  if (hostKey.startsWith('.')) cookie.domain = hostKey
  if (Number(linha.has_expires) === 1) {
    const expiraUs = BigInt(linha.expires_utc || 0)
    if (expiraUs > 0n) cookie.expirationDate = Number(expiraUs / 1000000n - EPOCA_CHROMIUM_S)
  }
  return cookie
}

function lerBanco(arquivo) {
  // node:sqlite existe no Node ≥ 22.5 e no Electron ≥ 33.
  const { DatabaseSync } = require('node:sqlite')
  const copia = path.join(os.tmpdir(), `dailywork-cookies-${process.pid}-${Date.now()}.db`)
  fs.copyFileSync(arquivo, copia)
  try {
    const db = new DatabaseSync(copia, { readOnly: true, readBigInts: true })
    try {
      return db
        .prepare('select host_key, name, value, encrypted_value, path, expires_utc, has_expires, is_secure, is_httponly, samesite from cookies')
        .all()
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(copia, { force: true })
  }
}

function perfilAtivo(raiz) {
  try {
    const estado = JSON.parse(fs.readFileSync(path.join(raiz, 'Local State'), 'utf8'))
    const ultimo = estado?.profile?.last_used
    if (typeof ultimo === 'string' && ultimo && fs.existsSync(path.join(raiz, ultimo, 'Cookies'))) return ultimo
  } catch {
    // sem Local State legível
  }
  return 'Default'
}

// Lista perfis com banco de cookies, em ordem de preferência. A variável
// DAILYWORK_CHROMIUM_PROFILE aponta para uma pasta de perfil específica.
function localizarPerfis({ home = os.homedir(), env = process.env } = {}) {
  const perfis = []
  const explicito = env.DAILYWORK_CHROMIUM_PROFILE
  if (explicito) {
    const dir = path.resolve(explicito)
    const navegador = NAVEGADORES.find((n) => dir.includes(path.sep + n.pasta + path.sep)) || NAVEGADORES[0]
    if (fs.existsSync(path.join(dir, 'Cookies'))) perfis.push({ ...navegador, dir })
  }
  for (const navegador of NAVEGADORES) {
    const raiz = path.join(home, '.config', navegador.pasta)
    const dir = path.join(raiz, perfilAtivo(raiz))
    if (fs.existsSync(path.join(dir, 'Cookies')) && !perfis.some((p) => p.dir === dir)) perfis.push({ ...navegador, dir })
  }
  return perfis
}

function criarImportadorSessaoChromium({
  home = os.homedir(),
  env = process.env,
  execFileImpl = promisify(childProcess.execFile),
  now = () => Date.now(),
  lerLinhas = lerBanco,
} = {}) {
  const senhas = new Map()

  async function senhaSafeStorage(aplicacao) {
    if (senhas.has(aplicacao)) return senhas.get(aplicacao)
    let senha = ''
    try {
      const { stdout } = await execFileImpl('secret-tool', ['lookup', 'application', aplicacao], { timeout: 8000 })
      senha = String(stdout || '').replace(/\n$/, '')
    } catch {
      senha = ''
    }
    senhas.set(aplicacao, senha)
    return senha
  }

  // Lê os cookies dos domínios pedidos no primeiro perfil encontrado.
  async function lerCookies(dominios, { perfil = null } = {}) {
    const alvo = perfil || localizarPerfis({ home, env })[0]
    if (!alvo) return { navegador: null, perfil: null, cookies: [], ignorados: 0, motivo: 'Nenhum perfil do Chromium, Chrome ou Brave encontrado nesta máquina.' }
    const senha = await senhaSafeStorage(alvo.aplicacao)
    const chaves = { v10: derivarChave(SENHA_BASICA), v11: derivarChave(senha || SENHA_BASICA) }
    const agoraS = BigInt(Math.floor(now() / 1000))
    const cookies = []
    let ignorados = 0
    let falhasCifra = 0
    for (const linha of lerLinhas(path.join(alvo.dir, 'Cookies'))) {
      if (!hostPertence(linha.host_key, dominios)) continue
      if (Number(linha.has_expires) === 1 && BigInt(linha.expires_utc || 0) / 1000000n - EPOCA_CHROMIUM_S <= agoraS) {
        ignorados += 1
        continue
      }
      let valor = String(linha.value || '')
      if (!valor && linha.encrypted_value && Buffer.from(linha.encrypted_value).length > 0) {
        try {
          valor = decifrarValor(linha.encrypted_value, chaves, linha.host_key)
        } catch {
          falhasCifra += 1
          continue
        }
      }
      cookies.push(mapearCookie(linha, valor))
    }
    const motivo = falhasCifra && !cookies.length
      ? 'Não foi possível decifrar os cookies: a senha do Safe Storage do navegador não está acessível pelo keyring.'
      : null
    return { navegador: alvo.nome, perfil: alvo.dir, cookies, ignorados, falhasCifra, motivo }
  }

  // Grava os cookies em uma session do Electron (ou objeto com a mesma API).
  async function importar({ sessao, dominios, forcar = false }) {
    const lista = [...new Set([...(dominios || []), ...DOMINIOS_IDENTIDADE])]
    const resultado = await lerCookies(lista)
    if (!resultado.cookies.length) return { ...resultado, importados: 0, removidos: 0 }
    let removidos = 0
    if (forcar) {
      // Substitui apenas os domínios em que o navegador tem sessão; um domínio
      // sem cookies no Chromium não derruba o login feito dentro do viewer.
      const presentes = lista.filter((dominio) => resultado.cookies.some((cookie) => hostPertence(cookie.domain || new URL(cookie.url).hostname, [dominio])))
      const existentes = await sessao.cookies.get({})
      for (const cookie of existentes) {
        if (!hostPertence(cookie.domain, presentes)) continue
        const host = String(cookie.domain || '').replace(/^\./, '')
        await sessao.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`, cookie.name).catch(() => {})
        removidos += 1
      }
    }
    let importados = 0
    const erros = []
    for (const cookie of resultado.cookies) {
      try {
        await sessao.cookies.set(cookie)
        importados += 1
      } catch (erro) {
        erros.push(`${cookie.name}@${cookie.domain || cookie.url}: ${erro.message}`)
      }
    }
    return { navegador: resultado.navegador, perfil: resultado.perfil, importados, removidos, ignorados: resultado.ignorados, erros, motivo: null }
  }

  return { localizarPerfis: () => localizarPerfis({ home, env }), lerCookies, importar }
}

module.exports = {
  DOMINIOS_IDENTIDADE,
  cifrarValor,
  criarImportadorSessaoChromium,
  decifrarValor,
  derivarChave,
  hostPertence,
  localizarPerfis,
  mapearCookie,
}
