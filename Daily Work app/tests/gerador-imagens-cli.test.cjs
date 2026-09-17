const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { criarGeradorImagensCli, promptDoPlano, tamanhoDoAspecto, mimeDaImagem } = require('../electron/lib-gerador-imagens-cli.cjs')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-gerador-cli-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function authGrok(dir) {
  const arquivo = path.join(dir, 'grok.json')
  fs.writeFileSync(arquivo, JSON.stringify({ default: { key: 'grok-token', expires_at: '2099-01-01' } }))
  return arquivo
}
function authCodex(dir) {
  const arquivo = path.join(dir, 'codex.json')
  fs.writeFileSync(arquivo, JSON.stringify({ tokens: { access_token: 'codex-token', account_id: 'acct-1' } }))
  return arquivo
}

test('promptDoPlano junta cena, restrições e o assunto da pauta', () => {
  const texto = promptDoPlano({ title: 'Capa', scene: 'Uma mesa com evidência', avoid: ['números inventados'], palette: 'ink' }, { titulo: 'Fila vira galeria', texto: 'Cards quadrados.' })
  assert.match(texto, /Uma mesa com evidência/)
  assert.match(texto, /números inventados/)
  assert.match(texto, /Fila vira galeria/)
})

test('tamanhoDoAspecto escolhe retrato, paisagem ou quadrado', () => {
  assert.equal(tamanhoDoAspecto('4:5').size, '1024x1536')
  assert.equal(tamanhoDoAspecto('16:9').size, '1536x1024')
  assert.equal(tamanhoDoAspecto('1:1').size, '1024x1024')
})

test('Grok CLI chama Imagine Image 2.0 com qualidade medium', async () => {
  const chamadas = []
  const gerador = criarGeradorImagensCli({
    grokAuthPath: authGrok(TMP),
    fetchImpl: async (url, init) => {
      chamadas.push({ url, body: init.body ? JSON.parse(init.body) : null })
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) }
    },
  })
  const dest = path.join(TMP, 'grok.png')
  const saida = await gerador.gerar({ provedor: 'grok', prompt: 'uma evidência sobre a mesa', dest })
  assert.equal(saida.modelo, 'grok-imagine-image-2.0')
  assert.equal(saida.via, 'grok-cli')
  assert.equal(chamadas[0].body.model, 'grok-imagine-image-2.0')
  assert.equal(chamadas[0].body.quality, 'medium')
  assert.equal(fs.existsSync(dest), true)
})

test('Codex prefere 9Router cx/gpt-5.5-image e cai na sessão se o roteador falhar', async () => {
  const dest = path.join(TMP, 'codex.png')
  const via9r = criarGeradorImagensCli({
    nineRouterUrl: 'http://9r.test',
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/v1\/images\/generations/)
      assert.equal(JSON.parse(init.body).model, 'cx/gpt-5.5-image')
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) }
    },
  })
  const ok = await via9r.gerar({ provedor: 'codex', prompt: 'capa editorial', dest })
  assert.equal(ok.via, '9router')
  assert.equal(ok.modelo, 'cx/gpt-5.5-image')

  const chamadas = []
  const fallback = criarGeradorImagensCli({
    nineRouterUrl: 'http://9r.test',
    codexAuthPath: authCodex(TMP),
    fetchImpl: async (url, init) => {
      chamadas.push(String(url))
      if (String(url).includes('9r.test')) return { ok: false, status: 503, text: async () => '{"error":"down"}' }
      assert.match(String(url), /chatgpt.com\/backend-api\/codex\/responses/)
      assert.equal(JSON.parse(init.body).tools[0].model, 'gpt-image-2.5-sunburst')
      return { ok: true, status: 200, text: async () => JSON.stringify({ b64_json: PNG.toString('base64') }) }
    },
  })
  const segunda = await fallback.gerar({ provedor: 'codex', prompt: 'capa editorial', dest: path.join(TMP, 'codex-2.png') })
  assert.equal(segunda.via, 'codex-cli')
  assert.equal(segunda.modelo, 'gpt-image-2.5-sunburst')
  assert.equal(chamadas.some((url) => url.includes('9r.test')), true)
})

test('JPEG do Grok gravado como .png vira PNG real', async () => {
  const jpeg = path.join(TMP, 'fonte.jpg')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', jpeg])
  const bytes = fs.readFileSync(jpeg)
  assert.equal(mimeDaImagem(bytes), 'image/jpeg')
  const gerador = criarGeradorImagensCli({
    grokAuthPath: authGrok(TMP),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }) }),
  })
  const dest = path.join(TMP, 'grok-jpeg.png')
  await gerador.gerar({ provedor: 'grok', prompt: 'x', dest })
  assert.equal(mimeDaImagem(fs.readFileSync(dest)), 'image/png')
})

test('Grok sem sessão falha cedo com orientação de login', async () => {
  const gerador = criarGeradorImagensCli({ grokAuthPath: path.join(TMP, 'ausente.json'), fetchImpl: async () => { throw new Error('não deveria chamar rede') } })
  await assert.rejects(
    () => gerador.gerar({ provedor: 'grok', prompt: 'x', dest: path.join(TMP, 'x.png') }),
    (e) => e.codigo === 'GROK_CLI_SEM_SESSAO',
  )
})
