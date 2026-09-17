const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarCofreCredenciais } = require('../electron/integracoes/credenciais.cjs')

function temporario(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-cofre-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  return raiz
}

test('cofre com safeStorage nunca grava o segredo em texto puro', async (t) => {
  const userDataDir = temporario(t)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (valor) => Buffer.from(`enc:${valor}`),
    decryptString: (valor) => valor.toString('utf8').replace(/^enc:/, ''),
  }
  const cofre = criarCofreCredenciais({ userDataDir, safeStorage })
  await cofre.guardar('github', { token: 'ghp_segredo_muito_secreto_1234567890' })
  const bruto = fs.readFileSync(path.join(userDataDir, 'integracoes.json'), 'utf8')
  assert.doesNotMatch(bruto, /ghp_segredo/)
  assert.match(bruto, /"esquema":"safe-storage"/)
  assert.deepEqual(await cofre.ler('github'), { token: 'ghp_segredo_muito_secreto_1234567890' })
  assert.equal(cofre.esquema(), 'safe-storage')
})

test('cofre sem safeStorage usa chave local 0600 com AES-GCM', async (t) => {
  const userDataDir = temporario(t)
  const cofre = criarCofreCredenciais({ userDataDir })
  await cofre.guardar('reddit', { clientSecret: 'segredo-reddit-abc' })
  const bruto = fs.readFileSync(path.join(userDataDir, 'integracoes.json'), 'utf8')
  assert.doesNotMatch(bruto, /segredo-reddit/)
  assert.match(bruto, /"esquema":"aes-gcm"/)
  const chave = fs.statSync(path.join(userDataDir, 'integracoes.key'))
  if (process.platform !== 'win32') assert.equal(chave.mode & 0o777, 0o600)
  const outro = criarCofreCredenciais({ userDataDir })
  assert.deepEqual(await outro.ler('reddit'), { clientSecret: 'segredo-reddit-abc' })
})

test('cofre atualiza, lista e remove contas isoladamente', async (t) => {
  const cofre = criarCofreCredenciais({ userDataDir: temporario(t) })
  await cofre.guardar('x', { clientId: 'a' })
  await cofre.guardar('linkedin', { accessToken: 'b' })
  await cofre.atualizar('x', { accessToken: 'c' })
  assert.deepEqual(await cofre.ler('x'), { clientId: 'a', accessToken: 'c' })
  assert.deepEqual((await cofre.listar()).sort(), ['linkedin', 'x'])
  assert.equal(await cofre.remover('x'), true)
  assert.equal(await cofre.remover('x'), false)
  assert.equal(await cofre.ler('x'), null)
  assert.equal(await cofre.existe('linkedin'), true)
})
