const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { executarManifest, validarManifest, criarManifestImagem, criarManifestMiniVitrine, importarMidias } = require('../scripts/editorial-media-runner.cjs')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-media-runner-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function baseManifest(nome) {
  const outputDir = path.join(TMP, nome)
  fs.mkdirSync(outputDir, { recursive: true })
  return { version: 1, jobId: `job-${nome}`, pautaId: 'pauta-1', tipo: 'image-factory', status: 'planned', outputDir, request: { purpose: 'editorial-proof' }, artifacts: [{ path: 'saida.png', kind: 'image', mime: 'image/png' }] }
}

test('runner mantém job planejado sem simular mídia pronta', async () => {
  const manifest = baseManifest('planned')
  const resultado = await executarManifest(manifest)
  assert.equal(resultado.status, 'planned')
  assert.equal(fs.existsSync(path.join(manifest.outputDir, 'saida.bin')), false)
})

test('runner executa comando controlado e só marca pronto após validar arquivo e hash', async () => {
  const manifest = baseManifest('ready')
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  manifest.command = { executable: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(path.join(manifest.outputDir, 'saida.png'))}, Buffer.from(${JSON.stringify(png)}, 'base64'))`] }
  const manifestFile = path.join(manifest.outputDir, 'manifest.json')
  const resultado = await executarManifest(manifest, { autorizarExecucao: true, manifestFile })
  assert.equal(resultado.status, 'ready')
  assert.equal(resultado.artifacts[0].size, 68)
  assert.match(resultado.artifacts[0].sha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).status, 'ready')
  assert.doesNotThrow(() => validarManifest(resultado, { exigirArquivos: true }))
})

test('runner denuncia saída ausente e rejeita artefato fora da pasta', async () => {
  const manifest = baseManifest('failed')
  manifest.command = { executable: process.execPath, args: ['-e', 'process.exit(0)'] }
  const resultado = await executarManifest(manifest, { autorizarExecucao: true })
  assert.equal(resultado.status, 'failed')
  assert.throws(() => validarManifest({ ...baseManifest('unsafe'), artifacts: [{ path: '../fora.bin' }] }), /fora do outputDir/)
})

test('adaptadores montam argv concreto da Image Factory e da mini vitrine', () => {
  const imagem = criarManifestImagem({ jobId: 'img-1', pautaId: 'pauta-1', outputDir: path.join(TMP, 'img-adapter'), alvo: 'editorial', foco: 'aprendizado', python: '/venv/bin/python', script: '/factory/image_production_factory.py', root: '/factory' })
  assert.deepEqual(imagem.commands.map((comando) => comando.args[1]), ['descrever', 'validar', 'diagnosticar', 'disparar'])
  assert.equal(imagem.commands[3].args.includes('--autorizar-gasto'), true)
  const mini = criarManifestMiniVitrine({ jobId: 'mini-1', pautaId: 'pauta-1', outputDir: path.join(TMP, 'mini-adapter'), roteiroFile: '/tmp/roteiro.json', python: '/venv/bin/python', compose: '/vitrine/compose.py' })
  assert.deepEqual(mini.command.args, ['/vitrine/compose.py', '/tmp/roteiro.json'])
})

test('mini vitrine aceita fixture real ffmpeg, valida vídeo/imagem e importa na fila', async () => {
  const origem = path.join(TMP, 'fixture-source.mp4')
  const posterOrigem = path.join(TMP, 'fixture-source.jpg')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', origem])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', origem, '-frames:v', '1', posterOrigem])
  const outputDir = path.join(TMP, 'mini-real')
  const copiar = path.join(TMP, 'copy-media.cjs')
  fs.writeFileSync(copiar, `const fs=require('fs');fs.mkdirSync(process.argv[2],{recursive:true});fs.copyFileSync(process.argv[3],process.argv[2]+'/video.mp4');fs.copyFileSync(process.argv[4],process.argv[2]+'/poster.jpg')`)
  const manifest = criarManifestMiniVitrine({ jobId: 'mini-real', pautaId: 'pauta-1', outputDir, roteiroFile: '/tmp/roteiro.json', python: process.execPath, compose: copiar })
  manifest.command.args = [copiar, outputDir, origem, posterOrigem]
  const pronto = await executarManifest(manifest, { autorizarExecucao: true })
  assert.equal(pronto.status, 'ready')
  const atualizado = await importarMidias({ manifest: pronto, dataDir: path.join(TMP, 'data'), fila: { atualizar: async (id, patch) => ({ id, ...patch }) }, itemId: 'item-1', revisao: 2 })
  assert.equal(atualizado.midias.length, 2)
  assert.equal(fs.existsSync(path.join(TMP, 'data', 'editorial', 'midias', 'mini-real', 'video.mp4')), true)
})
