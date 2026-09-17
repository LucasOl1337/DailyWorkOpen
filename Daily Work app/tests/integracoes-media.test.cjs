const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { criarConexaoLinkedIn } = require('../electron/integracoes/linkedin.cjs')
const { criarConexaoX } = require('../electron/integracoes/x.cjs')
const { temporario, json, cofreEmMemoria } = require('./integracoes-suporte.cjs')

function respostaVazia(status = 200, headers = {}) {
  return new Response('', { status, headers })
}

const PNG_FIXTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function fixtureMidia(t, nome, bytes, mime, tipo) {
  const dataDir = temporario(t, 'dailywork-media-')
  const arquivo = path.join(dataDir, 'editorial', 'midias', 'job', nome)
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  if (tipo === 'video') execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', arquivo])
  else fs.writeFileSync(arquivo, bytes)
  bytes = fs.readFileSync(arquivo)
  return {
    dataDir,
    bytes,
    item: { id: nome, tipo, mime, arquivo: `midias/job/${nome}`, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  }
}

test('LinkedIn imagem valida hash, envia bytes e somente depois publica', async (t) => {
  const bytes = PNG_FIXTURE
  const { dataDir, item } = fixtureMidia(t, 'cover.png', bytes, 'image/png', 'imagem')
  const cofre = cofreEmMemoria(t)
  await cofre.guardar('linkedin', { accessToken: 'token' })
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url: String(url), init })
    if (String(url).endsWith('/userinfo')) return json({ sub: '42', name: 'Pessoa' })
    if (String(url).includes('/images?action=initializeUpload')) return json({ value: { uploadUrl: 'https://upload.invalid/image', image: 'urn:li:image:1' } })
    if (String(url) === 'https://upload.invalid/image') {
      assert.equal(init.method, 'PUT'); assert.deepEqual(Buffer.from(init.body), bytes); return respostaVazia()
    }
    if (String(url).endsWith('/posts')) return respostaVazia(201, { 'x-restli-id': 'urn:li:share:1' })
    throw new Error(`rota LinkedIn inesperada: ${url}`)
  }
  const conexao = criarConexaoLinkedIn({ cofre, fetchImpl, dataDir })
  const preparada = await conexao.prepararPublicacao({ texto: 'imagem', midias: [item] })
  assert.equal(chamadas.length, 0)
  const recibo = await conexao.publicar(preparada.payload)
  assert.equal(recibo.id, 'urn:li:share:1')
  const post = chamadas.find((c) => c.url.endsWith('/posts'))
  assert.equal(JSON.parse(post.init.body).content.media.id, 'urn:li:image:1')
  await assert.rejects(() => conexao.prepararPublicacao({ texto: 'mudou', midias: [{ ...item, sha256: '0'.repeat(64) }] }), (erro) => erro.codigo === 'MIDIA_HASH_INVALIDO')
})

test('LinkedIn vídeo exige ETag, finalize e cabeçalhos oficiais antes do post', async (t) => {
  const fixture = fixtureMidia(t, 'clip.mp4', Buffer.from('fixture-video'), 'video/mp4', 'video')
  const { dataDir, item, bytes } = fixture
  const cofre = cofreEmMemoria(t); await cofre.guardar('linkedin', { accessToken: 'token' })
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url: String(url), init })
    if (String(url).endsWith('/userinfo')) return json({ sub: '42', name: 'Pessoa' })
    if (String(url).includes('/videos?action=initializeUpload')) return json({ value: { video: 'urn:li:video:1', uploadToken: 'upload-token', uploadInstructions: [{ firstByte: 0, lastByte: bytes.length - 1, uploadUrl: 'https://upload.invalid/video' }] } })
    if (String(url) === 'https://upload.invalid/video') return respostaVazia(200, { etag: '"etag-part-1"' })
    if (String(url).includes('videos?action=finalizeUpload')) {
      assert.equal(init.method, 'POST'); const pedido = JSON.parse(init.body)
      assert.deepEqual(pedido.finalizeUploadRequest, { video: 'urn:li:video:1', uploadToken: 'upload-token', uploadedPartIds: ['etag-part-1'] })
      assert.ok(init.headers['LinkedIn-Version']); assert.equal(init.headers['X-Restli-Protocol-Version'], '2.0.0')
      return json({})
    }
    if (String(url).includes('/rest/videos/urn%3Ali%3Avideo%3A1')) {
      assert.ok(init.headers['LinkedIn-Version']); assert.equal(init.headers['X-Restli-Protocol-Version'], '2.0.0')
      return json({ status: 'AVAILABLE' })
    }
    if (String(url).endsWith('/posts')) return respostaVazia(201, { 'x-restli-id': 'urn:li:share:video' })
    throw new Error(`rota LinkedIn inesperada: ${url}`)
  }
  const conexao = criarConexaoLinkedIn({ cofre, fetchImpl, dataDir })
  const preparada = await conexao.prepararPublicacao({ texto: 'video', midias: [item] })
  const recibo = await conexao.publicar(preparada.payload)
  assert.equal(recibo.id, 'urn:li:share:video')
})

test('X imagem usa media.write e nunca publica se o upload falhar', async (t) => {
  const bytes = PNG_FIXTURE
  const { dataDir, item } = fixtureMidia(t, 'x.png', bytes, 'image/png', 'imagem')
  const cofre = cofreEmMemoria(t); await cofre.guardar('x', { accessToken: 'token', usuario: { id: '42', username: 'lucasol', nome: 'Pessoa' } })
  const chamadas = []
  let falhar = false
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url: String(url), init })
    if (String(url).endsWith('/media/upload')) {
      if (falhar) return json({ detail: 'upload indisponível' }, 500)
      const pedido = JSON.parse(init.body); assert.equal(pedido.media, bytes.toString('base64')); assert.equal(pedido.media_category, 'tweet_image')
      return json({ data: { id: 'media-1' } })
    }
    if (String(url).endsWith('/tweets')) return json({ data: { id: 'post-1' } }, 201)
    throw new Error(`rota X inesperada: ${url}`)
  }
  const conexao = criarConexaoX({ cofre, fetchImpl, dataDir })
  const preparada = await conexao.prepararPublicacao({ texto: 'imagem', midias: [item] })
  const recibo = await conexao.publicar(preparada.payload)
  assert.equal(recibo.id, 'post-1')
  falhar = true
  await assert.rejects(() => conexao.publicar(preparada.payload), (erro) => erro.codigo === 'FALHA_X')
  assert.equal(chamadas.filter((c) => c.url.endsWith('/tweets')).length, 1)
})

test('X vídeo percorre initialize, append, finalize e STATUS antes do post', async (t) => {
  const { dataDir, item } = fixtureMidia(t, 'x.mp4', Buffer.from('x-video'), 'video/mp4', 'video')
  const cofre = cofreEmMemoria(t); await cofre.guardar('x', { accessToken: 'token', usuario: { id: '42', username: 'lucasol', nome: 'Pessoa' } })
  const chamadas = []
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url: String(url), init })
    if (String(url).endsWith('/media/upload/initialize')) return json({ data: { id: 'video-1' } })
    if (String(url).includes('/media/upload/video-1/append')) return json({})
    if (String(url).includes('/media/upload/video-1/finalize')) return json({ data: { processing_info: { state: 'pending', check_after_secs: 0 } } })
    if (String(url).includes('/media/upload?media_id=video-1&command=STATUS')) return json({ data: { processing_info: { state: 'succeeded' } } })
    if (String(url).endsWith('/tweets')) return json({ data: { id: 'post-video' } }, 201)
    throw new Error(`rota X inesperada: ${url}`)
  }
  const conexao = criarConexaoX({ cofre, fetchImpl, dataDir })
  const preparada = await conexao.prepararPublicacao({ texto: 'video', midias: [item] })
  const recibo = await conexao.publicar(preparada.payload)
  assert.equal(recibo.id, 'post-video')
  const finalize = chamadas.find((c) => c.url.includes('/media/upload/video-1/finalize'))
  assert.equal(finalize.init.body, undefined)
})
