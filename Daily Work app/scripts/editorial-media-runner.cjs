#!/usr/bin/env node
// Runner pequeno e controlado para jobs de mídia editoriais.
// O manifesto é a interface entre as skills e a Fila. O runner não publica.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile, execFileSync } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const ESTADOS = new Set(['planned', 'producing', 'ready', 'failed'])
const TIPOS = new Set(['image-factory', 'mini-vitrine', 'captura-real'])
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function sha256Arquivo(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
}
function dimensoesImagem(arquivo) {
  const dados = fs.readFileSync(arquivo)
  if (dados.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', width: dados.readUInt32BE(16), height: dados.readUInt32BE(20) }
  if (dados[0] === 0xff && dados[1] === 0xd8) {
    let indice = 2
    while (indice + 9 < dados.length) {
      if (dados[indice] !== 0xff) { indice++; continue }
      const marcador = dados[indice + 1]
      const tamanho = dados.readUInt16BE(indice + 2)
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marcador)) return { mime: 'image/jpeg', height: dados.readUInt16BE(indice + 5), width: dados.readUInt16BE(indice + 7) }
      indice += 2 + tamanho
    }
  }
  throw erro('IMAGEM_INVALIDA', `imagem não é PNG/JPEG reconhecível: ${arquivo}`)
}
function validarVideo(arquivo) {
  let dados
  try { dados = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', arquivo], { encoding: 'utf8' })) } catch (causa) { throw erro('VIDEO_INVALIDO', `ffprobe não validou o vídeo: ${causa.message}`) }
  const video = (dados.streams || []).find((stream) => stream.codec_type === 'video')
  const duracao = Number(dados.format?.duration || 0)
  if (!video || !Number.isFinite(duracao) || duracao <= 0) throw erro('VIDEO_INVALIDO', `vídeo sem faixa de vídeo/duração: ${arquivo}`)
  return { mime: 'video/mp4', duration: duracao, width: video.width, height: video.height }
}
function validarArtefato(arquivo, artefato) {
  if (String(artefato.kind || '').toLowerCase() === 'video' || String(artefato.mime || '').startsWith('video/')) return validarVideo(arquivo)
  if (String(artefato.kind || '').toLowerCase() === 'image' || String(artefato.mime || '').startsWith('image/')) return dimensoesImagem(arquivo)
  return { mime: artefato.mime || 'application/octet-stream' }
}
function lerJson(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'))
}
function escreverJson(arquivo, valor) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  const temporario = `${arquivo}.${process.pid}.tmp`
  fs.writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporario, arquivo)
}
function dentroDe(raiz, arquivo) {
  const relativo = path.relative(path.resolve(raiz), path.resolve(arquivo))
  return relativo === '' || (!relativo.startsWith('..') && !path.isAbsolute(relativo))
}
function realSeguro(arquivo, raiz, codigo = 'CAMINHO_INVALIDO') {
  const absoluto = path.resolve(arquivo)
  if (!dentroDe(raiz, absoluto)) throw erro(codigo, `caminho fora da área permitida: ${arquivo}`)
  let realRaiz
  let realArquivo
  try {
    realRaiz = fs.realpathSync(raiz)
    realArquivo = fs.realpathSync(absoluto)
  } catch {
    throw erro(codigo, `arquivo não encontrado: ${arquivo}`)
  }
  if (!dentroDe(realRaiz, realArquivo)) throw erro(codigo, `caminho real fora da área permitida: ${arquivo}`)
  return realArquivo
}
function erro(codigo, mensagem) {
  const resultado = new Error(mensagem)
  resultado.codigo = codigo
  return resultado
}

function validarManifest(manifest, { exigirArquivos = false } = {}) {
  if (!manifest || typeof manifest !== 'object') throw erro('MANIFEST_INVALIDO', 'manifesto deve ser um objeto JSON')
  for (const campo of ['jobId', 'pautaId', 'tipo', 'outputDir']) if (!String(manifest[campo] || '').trim()) throw erro('MANIFEST_INVALIDO', `${campo} é obrigatório`)
  if (!ID_RE.test(String(manifest.jobId))) throw erro('MANIFEST_INVALIDO', 'jobId inválido')
  if (!TIPOS.has(manifest.tipo)) throw erro('MANIFEST_INVALIDO', `tipo de mídia inválido: ${manifest.tipo}`)
  if (!ESTADOS.has(manifest.status || 'planned')) throw erro('MANIFEST_INVALIDO', `estado inválido: ${manifest.status}`)
  if (!manifest.request || typeof manifest.request !== 'object') throw erro('MANIFEST_INVALIDO', 'request é obrigatório')
  const outputDir = path.resolve(manifest.outputDir)
  if (fs.existsSync(outputDir)) {
    const realOutput = realSeguro(outputDir, outputDir)
    if (realOutput !== fs.realpathSync(outputDir)) throw erro('MANIFEST_INVALIDO', 'outputDir inválido')
  }
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw erro('MANIFEST_INVALIDO', 'artifacts deve conter ao menos uma saída declarada')
  const arquivos = manifest.artifacts.map((artefato) => {
    if (!artefato || !String(artefato.path || '').trim()) throw erro('MANIFEST_INVALIDO', 'cada artifact precisa de path')
      const arquivo = path.resolve(outputDir, artefato.path)
      if (!dentroDe(outputDir, arquivo) || path.resolve(artefato.path) === outputDir) throw erro('MANIFEST_INVALIDO', `artifact fora do outputDir: ${artefato.path}`)
    return { ...artefato, path: path.relative(outputDir, arquivo) }
  })
  if (manifest.command != null) {
    if (!manifest.command || typeof manifest.command !== 'object' || !String(manifest.command.executable || '').trim() || !Array.isArray(manifest.command.args)) throw erro('MANIFEST_INVALIDO', 'command deve ter executable e args[]')
    if (manifest.command.args.some((arg) => typeof arg !== 'string')) throw erro('MANIFEST_INVALIDO', 'command.args deve conter somente strings')
  }
  if (manifest.commands != null) {
    if (!Array.isArray(manifest.commands) || !manifest.commands.length) throw erro('MANIFEST_INVALIDO', 'commands deve conter ao menos um comando')
    for (const comando of manifest.commands) {
      if (!comando || !String(comando.executable || '').trim() || !Array.isArray(comando.args) || comando.args.some((arg) => typeof arg !== 'string')) throw erro('MANIFEST_INVALIDO', 'cada command precisa de executable e args[] de strings')
    }
  }
  const normalizado = { ...manifest, status: manifest.status || 'planned', outputDir, artifacts: arquivos }
  if (exigirArquivos) {
    for (const artefato of arquivos) {
      const arquivo = path.join(outputDir, artefato.path)
      if (!fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile() || fs.statSync(arquivo).size === 0) throw erro('ARTEFATO_AUSENTE', `saída não encontrada ou vazia: ${artefato.path}`)
      const realOutput = realSeguro(outputDir, outputDir)
      const realArquivo = realSeguro(arquivo, realOutput)
      if (!dentroDe(realOutput, realArquivo)) throw erro('ARTEFATO_INVALIDO', `artifact aponta para symlink fora do outputDir: ${artefato.path}`)
      const tamanho = fs.statSync(arquivo).size
      const sha256 = sha256Arquivo(arquivo)
      const propriedades = validarArtefato(arquivo, artefato)
      if (artefato.size != null && Number(artefato.size) !== tamanho) throw erro('ARTEFATO_DIVERGENTE', `tamanho divergente: ${artefato.path}`)
      if (artefato.sha256 && artefato.sha256 !== sha256) throw erro('ARTEFATO_DIVERGENTE', `hash divergente: ${artefato.path}`)
      artefato.size = tamanho
      artefato.sha256 = sha256
      artefato.propriedades = propriedades
    }
  }
  return normalizado
}

async function executarManifest(manifest, { autorizarExecucao = false, manifestFile = null, importacao = null } = {}) {
  let atual = validarManifest(manifest)
  const salvar = () => { if (manifestFile) escreverJson(manifestFile, atual) }
  if (!autorizarExecucao) {
    atual = { ...atual, status: 'planned', atualizadoEm: new Date().toISOString(), observacao: 'job preparado; execução requer autorização explícita' }
    salvar()
    return atual
  }
  const comandos = atual.commands || (atual.command ? [atual.command] : [])
  if (!comandos.length) throw erro('EXECUTOR_AUSENTE', 'manifesto pronto para execução precisa de command(s)')
  atual = { ...atual, status: 'producing', iniciadoEm: new Date().toISOString() }
  salvar()
  try {
    const saidas = []
    for (const comando of comandos) {
      const resultado = await execFileAsync(comando.executable, comando.args, {
      cwd: comando.cwd ? path.resolve(comando.cwd) : undefined,
      env: { ...process.env, ...(comando.env || {}) },
      windowsHide: true,
      })
      if (resultado.stdout) saidas.push(String(resultado.stdout).trim())
    }
    atual = validarManifest({ ...atual, status: 'ready' }, { exigirArquivos: true })
    atual.execution = { stdout: saidas.filter(Boolean) }
    if (importacao) {
      const anexado = await importarMidias({ manifest: atual, ...importacao })
      atual = { ...atual, midias: anexado.midias, item: anexado.item }
    }
    atual = { ...atual, concluidoEm: new Date().toISOString() }
  } catch (causa) {
    const aguardandoRecepcao = atual.request?.assincrono && causa.codigo === 'ARTEFATO_AUSENTE'
    atual = { ...atual, status: aguardandoRecepcao ? 'producing' : 'failed', erro: { codigo: causa.codigo || 'JOB_MIDIA_FALHOU', mensagem: causa.message }, ...(aguardandoRecepcao ? { pendencia: 'aguarda acompanhar/receber e nova validação dos artefatos' } : {}) }
  }
  salvar()
  return atual
}

function criarManifestImagem({ jobId, pautaId, outputDir, alvo, foco, root = process.env.IMAGEGEN_ROOT || path.join(os.homedir(), 'Projects', 'ImageGenSource'), python = process.env.IMAGE_FACTORY_PYTHON || (fs.existsSync(path.join(os.homedir(), '.agents', 'skills', 'imageproductionfactory', '.venv', 'bin', 'python')) ? path.join(os.homedir(), '.agents', 'skills', 'imageproductionfactory', '.venv', 'bin', 'python') : 'python3'), script = path.join(os.homedir(), '.agents', 'skills', 'imageproductionfactory', 'scripts', 'image_production_factory.py'), artefatos = [{ path: 'saida.png', kind: 'image', mime: 'image/png' }], provedores = 'grok', request = {} } = {}) {
  if (!jobId || !pautaId || !outputDir || !alvo || !foco) throw erro('MANIFEST_INVALIDO', 'imagem editorial precisa de jobId, pautaId, outputDir, alvo e foco')
  const base = (operacao, extras = []) => ({ executable: python, args: [script, operacao, ...extras, '--root', root] })
  const disparar = ['--alvo', alvo, '--foco', foco, '--provedores', provedores, '--autorizar-gasto', 'SIM-GASTAR']
  return validarManifest({ version: 1, jobId, pautaId, tipo: 'image-factory', status: 'planned', outputDir: path.resolve(outputDir), request: { ...request, assincrono: true, alvo, foco, provedores }, commands: [base('descrever'), base('validar', ['--alvo', alvo, '--foco', foco]), base('diagnosticar', ['--alvo', alvo, '--foco', foco, '--provedores', provedores]), base('disparar', disparar)], artifacts: artefatos })
}

function criarManifestMiniVitrine({ jobId, pautaId, outputDir, roteiroFile, python = 'python3', compose = path.join(os.homedir(), '.agents', 'skills', 'vitrine', 'scripts', 'compose.py'), artefatos = [{ path: 'video.mp4', kind: 'video', mime: 'video/mp4' }, { path: 'poster.jpg', kind: 'image', mime: 'image/jpeg' }], request = {} } = {}) {
  if (!jobId || !pautaId || !outputDir || !roteiroFile) throw erro('MANIFEST_INVALIDO', 'mini vitrine precisa de jobId, pautaId, outputDir e roteiroFile')
  return validarManifest({ version: 1, jobId, pautaId, tipo: 'mini-vitrine', status: 'planned', outputDir: path.resolve(outputDir), request: { ...request, roteiroFile }, command: { executable: python, args: [compose, roteiroFile] }, artifacts: artefatos })
}

async function importarMidias({ manifest, dataDir, fila = null, itemId = null, revisao = null, beforeAnexo = null } = {}) {
  const pronto = validarManifest({ ...manifest, status: 'ready' }, { exigirArquivos: true })
  if (!dataDir) throw erro('IMPORTACAO_SEM_DATA_DIR', 'dataDir é obrigatório para importar mídia')
  const baseEditorial = path.join(path.resolve(dataDir), 'editorial')
  const destinoBase = path.join(baseEditorial, 'midias', pronto.jobId)
  fs.mkdirSync(destinoBase, { recursive: true })
  realSeguro(destinoBase, baseEditorial)
  beforeAnexo?.()
  const midias = pronto.artifacts.map((artefato) => {
    const origem = path.join(pronto.outputDir, artefato.path)
    const destino = path.join(destinoBase, path.basename(artefato.path))
    realSeguro(origem, pronto.outputDir)
    if (!dentroDe(destinoBase, destino)) throw erro('IMPORTACAO_CAMINHO_INVALIDO', 'destino de mídia inválido')
    if (fs.existsSync(destino) && fs.lstatSync(destino).isSymbolicLink()) throw erro('IMPORTACAO_CAMINHO_INVALIDO', 'destino de mídia é symlink')
    fs.copyFileSync(origem, destino)
    const tipo = artefato.kind === 'video' ? 'video' : 'imagem'
    return { id: `${pronto.jobId}-${hashSha(path.basename(artefato.path))}`, tipo, arquivo: path.relative(baseEditorial, destino), mime: artefato.mime, sha256: artefato.sha256, tamanho: artefato.size }
  })
  let item = null
  if (fila && itemId) {
    beforeAnexo?.()
    if (!Number.isInteger(revisao)) throw erro('REVISAO_OBRIGATORIA', 'revisao é obrigatória para anexar mídia à fila')
    const atual = typeof fila.obter === 'function' ? await fila.obter(itemId) : null
    item = await fila.atualizar(itemId, { revisao, formato: pronto.tipo === 'mini-vitrine' ? 'video' : 'imagem', texto: atual?.texto || 'Mídia editorial pronta para revisão.', titulo: atual?.titulo || `Mídia ${pronto.jobId}`, pautaId: atual?.pautaId || pronto.pautaId, conta: atual?.conta || 'linkedin', idioma: atual?.idioma || 'pt-BR', campos: atual?.campos || {}, fontes: atual?.fontes || [], origem: atual?.origem || { tipo: 'dia' }, midias })
  }
  return { ...pronto, midias, item }
}
function hashSha(valor) { return crypto.createHash('sha256').update(String(valor)).digest('hex').slice(0, 12) }

async function main(argv) {
  const comando = argv[2]
  const entrada = argv[3]
  if (!['validate', 'prepare', 'run'].includes(comando) || !entrada) throw erro('USO', 'uso: editorial-media-runner.cjs validate|prepare|run manifesto.json [--execute]')
  const manifesto = lerJson(path.resolve(entrada))
  const arquivo = path.resolve(entrada)
  if (comando === 'validate') return validarManifest(manifesto, { exigirArquivos: manifesto.status === 'ready' })
  if (comando === 'prepare') return executarManifest({ ...manifesto, status: 'planned' }, { manifestFile: arquivo })
  return executarManifest(manifesto, { autorizarExecucao: argv.includes('--execute'), manifestFile: arquivo })
}

if (require.main === module) {
  main(process.argv).then((resultado) => process.stdout.write(`${JSON.stringify({ ok: true, data: resultado })}\n`)).catch((causa) => {
    process.stdout.write(`${JSON.stringify({ ok: false, erro: { codigo: causa.codigo || 'RUNNER_FALHOU', mensagem: causa.message } })}\n`)
    process.exitCode = 1
  })
}

module.exports = { validarManifest, executarManifest, sha256Arquivo, criarManifestImagem, criarManifestMiniVitrine, importarMidias, validarArtefato }
