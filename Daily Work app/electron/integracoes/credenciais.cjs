// Cofre das credenciais das conexões externas (GitHub, LinkedIn, X, Reddit).
// Um único arquivo cifrado em userData; o renderer nunca vê segredos.
// No Electron a cifra é o safeStorage do sistema. Fora dele (dev server),
// uma chave local AES-256-GCM com permissão 0600 cumpre o mesmo papel.

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const VERSAO = 1

function criarCofreCredenciais({ userDataDir, safeStorage = null, nomeArquivo = 'integracoes.json' }) {
  if (!userDataDir) throw new Error('cofre de credenciais sem diretório de dados')
  const arquivo = path.join(userDataDir, nomeArquivo)
  const arquivoChave = path.join(userDataDir, 'integracoes.key')
  let chaveLocal = null

  function usarSafeStorage() {
    return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable())
  }

  async function chaveLocalAtual() {
    if (chaveLocal) return chaveLocal
    try {
      const lida = await fs.readFile(arquivoChave)
      if (lida.length === 32) {
        chaveLocal = lida
        return chaveLocal
      }
    } catch (erro) {
      if (erro.code !== 'ENOENT') throw erro
    }
    await fs.mkdir(userDataDir, { recursive: true })
    chaveLocal = crypto.randomBytes(32)
    await fs.writeFile(arquivoChave, chaveLocal, { mode: 0o600 })
    return chaveLocal
  }

  async function cifrar(texto) {
    if (usarSafeStorage()) {
      return { esquema: 'safe-storage', cifrado: safeStorage.encryptString(texto).toString('base64') }
    }
    const chave = await chaveLocalAtual()
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv)
    const dados = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return { esquema: 'aes-gcm', cifrado: Buffer.concat([iv, tag, dados]).toString('base64') }
  }

  async function decifrar(registro) {
    const bytes = Buffer.from(String(registro.cifrado || ''), 'base64')
    if (registro.esquema === 'safe-storage') {
      if (!usarSafeStorage()) throw new Error('criptografia segura do sistema indisponível')
      return safeStorage.decryptString(bytes)
    }
    if (registro.esquema === 'aes-gcm') {
      const chave = await chaveLocalAtual()
      const iv = bytes.subarray(0, 12)
      const tag = bytes.subarray(12, 28)
      const dados = bytes.subarray(28)
      const decipher = crypto.createDecipheriv('aes-256-gcm', chave, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(dados), decipher.final()]).toString('utf8')
    }
    throw new Error(`esquema de cifra desconhecido: ${registro.esquema}`)
  }

  async function lerArquivo() {
    try {
      const conteudo = JSON.parse(await fs.readFile(arquivo, 'utf8'))
      if (conteudo?.version !== VERSAO || typeof conteudo.contas !== 'object') return { version: VERSAO, contas: {} }
      return conteudo
    } catch (erro) {
      if (erro.code === 'ENOENT') return { version: VERSAO, contas: {} }
      throw erro
    }
  }

  async function gravarArquivo(conteudo) {
    await fs.mkdir(userDataDir, { recursive: true })
    const temporario = `${arquivo}.tmp`
    await fs.writeFile(temporario, `${JSON.stringify(conteudo)}\n`, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporario, arquivo)
  }

  async function ler(id) {
    const conteudo = await lerArquivo()
    const registro = conteudo.contas[id]
    if (!registro) return null
    try {
      return JSON.parse(await decifrar(registro))
    } catch (erro) {
      throw new Error(`credenciais de ${id} ilegíveis: ${erro.message}`)
    }
  }

  async function guardar(id, dados) {
    if (!dados || typeof dados !== 'object') throw new Error('credenciais precisam ser um objeto')
    const conteudo = await lerArquivo()
    conteudo.contas[id] = { ...(await cifrar(JSON.stringify(dados))), atualizadoEm: new Date().toISOString() }
    await gravarArquivo(conteudo)
  }

  async function atualizar(id, patch) {
    const atual = (await ler(id)) || {}
    await guardar(id, { ...atual, ...patch })
    return ler(id)
  }

  async function remover(id) {
    const conteudo = await lerArquivo()
    if (!conteudo.contas[id]) return false
    delete conteudo.contas[id]
    await gravarArquivo(conteudo)
    return true
  }

  async function existe(id) {
    const conteudo = await lerArquivo()
    return Boolean(conteudo.contas[id])
  }

  async function listar() {
    return Object.keys((await lerArquivo()).contas)
  }

  return { ler, guardar, atualizar, remover, existe, listar, arquivo, esquema: () => (usarSafeStorage() ? 'safe-storage' : 'aes-gcm') }
}

module.exports = { criarCofreCredenciais }
