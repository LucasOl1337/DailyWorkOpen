const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const {
  DOMINIOS_IDENTIDADE,
  cifrarValor,
  criarImportadorSessaoChromium,
  decifrarValor,
  derivarChave,
  hostPertence,
  localizarPerfis,
  mapearCookie,
} = require('../electron/integracoes/sessao-chromium.cjs')
const { temporario } = require('./integracoes-suporte.cjs')

const SENHA = 'senha-do-keyring'
const AGORA_MS = Date.UTC(2026, 8, 5, 12, 0, 0)
const EPOCA = 11644473600n

function expiraEm(segundosUnix) {
  return (BigInt(segundosUnix) + EPOCA) * 1000000n
}

// Monta um perfil falso do Chromium com o banco de cookies real (sqlite).
function perfilFalso(t, linhas, { pasta = 'chromium', perfil = 'Default', localState = null } = {}) {
  const home = temporario(t)
  const raiz = path.join(home, '.config', pasta)
  const dir = path.join(raiz, perfil)
  fs.mkdirSync(dir, { recursive: true })
  if (localState) fs.writeFileSync(path.join(raiz, 'Local State'), JSON.stringify(localState))
  const db = new DatabaseSync(path.join(dir, 'Cookies'))
  db.exec(`create table cookies (
    host_key text, name text, value text, encrypted_value blob, path text, expires_utc integer,
    has_expires integer, is_secure integer, is_httponly integer, samesite integer)`)
  const inserir = db.prepare('insert into cookies values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const l of linhas) {
    inserir.run(
      l.host, l.name, l.plain || '', l.plain ? null : cifrarValor(l.value, l.senha || SENHA, l.host, l.versao || 'v11', l.prefixo !== false),
      l.path || '/', l.expira ?? expiraEm(2_000_000_000), l.expira === 0n ? 0 : 1, l.secure ? 1 : 0, l.httpOnly ? 1 : 0, l.samesite ?? -1,
    )
  }
  db.close()
  return { home, dir }
}

function sessaoFalsa(iniciais = []) {
  const guardados = [...iniciais]
  const removidos = []
  return {
    guardados,
    removidos,
    cookies: {
      async get() { return guardados.map((c) => ({ ...c })) },
      async set(cookie) {
        if (cookie.name === 'quebra') throw new Error('rejeitado')
        guardados.push(cookie)
      },
      async remove(url, name) { removidos.push({ url, name }) },
    },
  }
}

test('decifra v11 com prefixo SHA-256 do host e v10 com a senha básica', () => {
  const chaves = { v10: derivarChave('peanuts'), v11: derivarChave(SENHA) }
  assert.equal(decifrarValor(cifrarValor('abc123', SENHA, '.github.com'), chaves, '.github.com'), 'abc123')
  assert.equal(decifrarValor(cifrarValor('sem-prefixo', SENHA, '.github.com', 'v11', false), chaves, '.github.com'), 'sem-prefixo')
  assert.equal(decifrarValor(cifrarValor('basico', 'peanuts', 'x.com', 'v10'), chaves, 'x.com'), 'basico')
  assert.throws(() => decifrarValor(Buffer.from('v99abc'), chaves, 'x.com'), /versão de cifra/)
})

test('mapeia domínio, host-only, samesite e expiração para o formato do Electron', () => {
  const dominio = mapearCookie({ host_key: '.github.com', name: 'logged_in', path: '/', expires_utc: expiraEm(1_900_000_000), has_expires: 1, is_secure: 1, is_httponly: 1, samesite: 1 }, 'yes')
  assert.deepEqual(dominio, { url: 'https://github.com/', name: 'logged_in', value: 'yes', path: '/', secure: true, httpOnly: true, sameSite: 'lax', domain: '.github.com', expirationDate: 1_900_000_000 })
  const host = mapearCookie({ host_key: 'github.com', name: '__Host-user_session_same_site', path: '/', has_expires: 0, is_secure: 1, is_httponly: 0, samesite: 2 }, 'v')
  assert.equal(host.domain, undefined)
  assert.equal(host.sameSite, 'strict')
  assert.equal(host.expirationDate, undefined)
  assert.equal(mapearCookie({ host_key: 'a.com', name: 'n', samesite: 0, is_secure: 0 }, 'v').sameSite, 'no_restriction')
  assert.equal(mapearCookie({ host_key: 'a.com', name: 'n', samesite: 0, is_secure: 0 }, 'v').url, 'http://a.com/')
})

test('hostPertence casa domínio exato e subdomínios, nunca sufixos parciais', () => {
  assert.equal(hostPertence('.google.com', ['google.com']), true)
  assert.equal(hostPertence('accounts.google.com', ['google.com']), true)
  assert.equal(hostPertence('notgoogle.com', ['google.com']), false)
  assert.equal(hostPertence('x.com', ['x.com', 'twitter.com']), true)
})

test('localiza o perfil ativo pelo Local State e respeita DAILYWORK_CHROMIUM_PROFILE', (t) => {
  const { home } = perfilFalso(t, [], { perfil: 'Profile 2', localState: { profile: { last_used: 'Profile 2' } } })
  const perfis = localizarPerfis({ home, env: {} })
  assert.equal(perfis.length, 1)
  assert.equal(perfis[0].nome, 'Chromium')
  assert.match(perfis[0].dir, /Profile 2$/)

  const explicito = perfilFalso(t, [], { pasta: 'google-chrome' })
  const comEnv = localizarPerfis({ home: temporario(t), env: { DAILYWORK_CHROMIUM_PROFILE: explicito.dir } })
  assert.equal(comEnv[0].nome, 'Google Chrome')
  assert.equal(localizarPerfis({ home: temporario(t), env: {} }).length, 0)
})

test('importa só os domínios da conexão mais provedores de identidade, pulando expirados', async (t) => {
  const { home } = perfilFalso(t, [
    { host: '.github.com', name: 'logged_in', value: 'yes', secure: true, httpOnly: true, samesite: 1 },
    { host: 'github.com', name: 'user_session', value: 'sess', secure: true, httpOnly: true },
    { host: '.github.com', name: 'velho', value: 'x', expira: expiraEm(1_000) },
    { host: 'accounts.google.com', name: 'SID', value: 'google', secure: true },
    { host: '.linkedin.com', name: 'li_at', value: 'nao-entra' },
    { host: '.github.com', name: 'aberto', plain: 'texto-plano' },
  ])
  const chamadas = []
  const importador = criarImportadorSessaoChromium({
    home,
    env: {},
    now: () => AGORA_MS,
    execFileImpl: async (cmd, args) => { chamadas.push([cmd, ...args]); return { stdout: `${SENHA}\n` } },
  })
  const sessao = sessaoFalsa()
  const resultado = await importador.importar({ sessao, dominios: ['github.com'] })
  assert.equal(resultado.navegador, 'Chromium')
  assert.equal(resultado.importados, 4)
  assert.equal(resultado.ignorados, 1)
  assert.deepEqual(sessao.guardados.map((c) => c.name).sort(), ['SID', 'aberto', 'logged_in', 'user_session'])
  assert.equal(sessao.guardados.find((c) => c.name === 'aberto').value, 'texto-plano')
  assert.equal(sessao.guardados.find((c) => c.name === 'user_session').value, 'sess')
  assert.deepEqual(chamadas, [['secret-tool', 'lookup', 'application', 'chromium']])
  assert.ok(DOMINIOS_IDENTIDADE.includes('google.com'))

  // Segunda importação reaproveita a senha e, com forcar, remove os cookies antigos dos mesmos domínios.
  const outra = sessaoFalsa([{ domain: '.github.com', name: 'antigo', path: '/', secure: true }, { domain: '.reddit.com', name: 'fica', path: '/', secure: true }])
  const forcado = await importador.importar({ sessao: outra, dominios: ['github.com'], forcar: true })
  assert.equal(forcado.removidos, 1)
  assert.deepEqual(outra.removidos, [{ url: 'https://github.com/', name: 'antigo' }])
  assert.equal(chamadas.length, 1, 'senha do keyring fica em cache')
})

test('sem secret-tool cai na senha básica; sem perfil explica o motivo', async (t) => {
  const { home } = perfilFalso(t, [{ host: '.x.com', name: 'auth_token', value: 'basico', senha: 'peanuts' }])
  const importador = criarImportadorSessaoChromium({ home, env: {}, now: () => AGORA_MS, execFileImpl: async () => { throw new Error('sem keyring') } })
  const sessao = sessaoFalsa()
  const resultado = await importador.importar({ sessao, dominios: ['x.com'] })
  assert.equal(resultado.importados, 1)
  assert.equal(sessao.guardados[0].value, 'basico')

  const vazio = criarImportadorSessaoChromium({ home: temporario(t), env: {}, execFileImpl: async () => ({ stdout: '' }) })
  const nada = await vazio.importar({ sessao: sessaoFalsa(), dominios: ['x.com'] })
  assert.equal(nada.importados, 0)
  assert.match(nada.motivo, /Nenhum perfil/)
})

test('senha errada gera motivo claro e não grava nada', async (t) => {
  const { home } = perfilFalso(t, [{ host: '.x.com', name: 'auth_token', value: 'segredo', senha: 'outra' }])
  const importador = criarImportadorSessaoChromium({ home, env: {}, now: () => AGORA_MS, execFileImpl: async () => ({ stdout: 'errada\n' }) })
  const resultado = await importador.importar({ sessao: sessaoFalsa(), dominios: ['x.com'] })
  assert.equal(resultado.importados, 0)
  assert.match(resultado.motivo, /Safe Storage/)
})
