// Jobs duráveis e um único dono do perfil, inclusive com Electron e Vite juntos.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const stable = require('fast-json-stable-stringify')
const { DatabaseSync } = require('node:sqlite')
const { perfilUrl: perfilLinkedIn } = require('./linkedin-browser.cjs')
const { perfilUrl: perfilX } = require('./x-browser.cjs')
const { criarDriverBancada } = require('./bench.cjs')
const hash = (v) => crypto.createHash('sha256').update(stable(v)).digest('hex')
const falhar = (codigo, mensagem) => {
  throw Object.assign(new Error(mensagem), { codigo, status: 409 })
}
const TERMINAIS = new Set(['publicado', 'incerto', 'falhou', 'cancelado', 'expirado'])

function criarServicoSessoes({
  dataDir,
  conta = 'linkedin',
  driver = criarDriverBancada({ conta }),
  now = Date.now,
  intervaloMs = 5000,
} = {}) {
  if (!['linkedin', 'x'].includes(conta)) throw new Error('Sessão visual desconhecida.')
  const rede = conta === 'x'
    ? { nome: 'X', perfilUrl: perfilX, limite: 280, imagem: true, video: false }
    : { nome: 'LinkedIn', perfilUrl: perfilLinkedIn, limite: 3000, imagem: true, video: false }
  const mesmoPerfil = (a, b) => conta === 'x'
    ? String(a || '').toLowerCase() === String(b || '').toLowerCase()
    : a === b
  const dir = path.join(dataDir, 'editorial', '.sessoes')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const arquivo = path.join(dir, 'estado.sqlite')
  const db = new DatabaseSync(arquivo)
  fs.chmodSync(arquivo, 0o600)
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS registros (tipo TEXT, id TEXT, valor TEXT NOT NULL, PRIMARY KEY(tipo,id));
    CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER, token TEXT);`)
  let timer = null,
    fechado = false,
    ativo = null
  const ler = (tipo, id) => {
    const r = db.prepare('SELECT valor FROM registros WHERE tipo=? AND id=?').get(tipo, id)
    return r ? JSON.parse(r.valor) : null
  }
  const gravar = (tipo, id, valor) =>
    db.prepare('INSERT OR REPLACE INTO registros VALUES(?,?,?)').run(tipo, id, JSON.stringify(valor))
  const todos = (tipo) =>
    db
      .prepare('SELECT valor FROM registros WHERE tipo=?')
      .all(tipo)
      .map((r) => JSON.parse(r.valor))
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      db.exec('COMMIT')
      return r
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  function persistirComprovante(png, pastaId) {
    const id = String(pastaId || '').replace(/[^A-Za-z0-9_-]/g, '')
    if (!id) falhar('COMPROVANTE_INVALIDO', 'Identificador do comprovante inválido.')
    let dados
    try { dados = Buffer.from(String(png || ''), 'base64') } catch { dados = Buffer.alloc(0) }
    if (dados.length < 32 || dados.length > 8 * 1024 * 1024 || dados.subarray(0, 8).compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) !== 0)
      falhar('COMPROVANTE_INVALIDO', 'A captura não devolveu uma imagem PNG válida.')
    const raiz = path.join(dataDir, 'editorial', 'comprovantes')
    const pasta = path.join(raiz, id)
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 })
    const nome = `${now()}-${crypto.randomBytes(3).toString('hex')}.png`
    const absoluto = path.join(pasta, nome)
    fs.writeFileSync(absoluto, dados, { mode: 0o600 })
    return {
      arquivo: path.posix.join('comprovantes', id, nome),
      sha256: crypto.createHash('sha256').update(dados).digest('hex'),
      capturadoEm: new Date(now()).toISOString(),
    }
  }
  function auditar(acao, dados) {
    // Falha da auditoria impede avançar para o clique irreversível.
    fs.appendFileSync(
      path.join(dataDir, '_log.ndjson'),
      JSON.stringify({ ts: new Date(now()).toISOString(), acao, ...dados }) + '\n',
      { mode: 0o600 },
    )
  }
  function adquirir() {
    return tx(() => {
      const dono = db.prepare('SELECT * FROM lease WHERE id=1').get()
      if (dono) {
        try {
          process.kill(dono.pid, 0)
          return null
        } catch (e) {
          if (e.code !== 'ESRCH') return null
        }
        for (const j of todos('job').filter((j) => ['preparando', 'envio_iniciado'].includes(j.estado))) {
          j.estado = j.estado === 'envio_iniciado' ? 'incerto' : 'aguardando_executor'
          j.erro = 'O executor anterior terminou; o estado foi recuperado sem repetir envio.'
          gravar('job', j.id, j)
        }
      }
      const token = crypto.randomUUID()
      db.prepare('INSERT OR REPLACE INTO lease VALUES(1,?,?)').run(process.pid, token)
      return token
    })
  }
  function liberar(token) {
    db.prepare('DELETE FROM lease WHERE token=?').run(token)
  }
  function exigirLease(token) {
    if (fechado || db.prepare('SELECT token FROM lease WHERE id=1').get()?.token !== token)
      falhar('LEASE_PERDIDO', 'O executor perdeu o controle do perfil.')
  }
  async function exclusivo(fn) {
    const token = adquirir()
    if (!token) falhar('EXECUTOR_OCUPADO', 'A sessão está em uso por outro trabalho.')
    try {
      return await fn(token)
    } finally {
      liberar(token)
    }
  }
  const config = () => ler('config', conta) || { perfilUrl: null, nome: null, preferir: false }
  function estado() {
    const c = config(),
      observado = ler('observacao', conta)
    const fresco = observado && now() - observado.em < 5 * 60_000
    const sessao = fresco ? observado.sessao : 'desconhecida'
    return {
      transporte: c.preferir ? 'sessao_visual' : 'api',
      sessao,
      contaEsperada: c.perfilUrl ? { perfilUrl: c.perfilUrl, nome: c.nome } : null,
      contaVerificada: fresco ? observado.contaVerificada : null,
      verificadaEm: observado ? new Date(observado.em).toISOString() : null,
      capacidades: {
        perfil: true,
        atividadePropria: false,
        publicarTexto: true,
        publicarImagem: rede.imagem,
        publicarVideo: rede.video,
      },
      disponivel:
        !!c.perfilUrl && sessao === 'autenticada' && mesmoPerfil(observado.contaVerificada?.perfilUrl, c.perfilUrl),
    }
  }
  async function obterEstado() {
    return {
      ...estado(),
      executor: db.prepare('SELECT id FROM lease').get() ? 'ocupado' : await driver.disponivel(),
    }
  }
  async function observar() {
    const r = await driver.verificar()
    const c = config()
    if (r.sessao === 'autenticada' && c.perfilUrl && !mesmoPerfil(r.contaVerificada?.perfilUrl, c.perfilUrl))
      r.sessao = 'conta_divergente'
    gravar('observacao', conta, { ...r, em: now() })
    return r
  }
  async function verificar() {
    await exclusivo(observar)
    return obterEstado()
  }
  async function vincular(entrada = {}) {
    return exclusivo(async () => {
      const r = await observar()
      const url = rede.perfilUrl(entrada.perfilUrl)
      if (
        !url ||
        (r.sessao !== 'autenticada' && r.sessao !== 'conta_divergente') ||
        !mesmoPerfil(r.contaVerificada?.perfilUrl, url)
      )
        falhar('CONTA_NAO_VERIFICADA', 'Confira e selecione o perfil autenticado na bancada.')
      auditar('sessoes:vincular', { conta, perfilUrl: url })
      gravar('config', conta, { perfilUrl: url, nome: r.contaVerificada.nome, preferir: true })
      gravar('observacao', conta, { ...r, sessao: 'autenticada', em: now() })
      return obterEstado()
    })
  }
  async function importar() {
    return exclusivo(async () => {
      const r = await driver.importar()
      await observar()
      return { ...r, ...(await obterEstado()) }
    })
  }
  async function consultar() {
    return exclusivo(async () => {
      const c = config()
      if (!c.perfilUrl) falhar('CONTA_NAO_VINCULADA', 'Vincule a conta da bancada em Conexões.')
      return driver.consultar({ perfilUrl: c.perfilUrl })
    })
  }
  function preparar(entrada = {}) {
    const c = config()
    if (!c.perfilUrl) falhar('CONTA_NAO_VINCULADA', 'Vincule o perfil da bancada em Conexões.')
    const midiasEntrada = Array.isArray(entrada.midias) ? entrada.midias : []
    if (!rede.imagem && ((entrada.formato && entrada.formato !== 'texto') || midiasEntrada.length))
      falhar('MIDIA_NAO_SUPORTADA', `A sessão visual do ${rede.nome} aceita apenas texto nesta versão; a mídia não será descartada.`)
    const limiteImagens = conta === 'x' ? 4 : 20
    if (midiasEntrada.length > limiteImagens || midiasEntrada.some((midia) => midia.tipo !== 'imagem' && !String(midia.mime || '').startsWith('image/')))
      falhar('MIDIA_NAO_SUPORTADA', `O envio visual do ${rede.nome} aceita até ${limiteImagens} imagens por post.`)
    const raizMidias = path.resolve(dataDir, 'editorial', 'midias')
    const midias = midiasEntrada.map((midia) => {
      const arquivo = path.resolve(dataDir, 'editorial', String(midia.arquivo || ''))
      if (arquivo !== raizMidias && !arquivo.startsWith(raizMidias + path.sep)) falhar('MIDIA_INVALIDA', 'A imagem está fora da área editorial.')
      if (!fs.statSync(arquivo, { throwIfNoEntry: false })?.isFile()) falhar('MIDIA_INVALIDA', 'A imagem aprovada não foi encontrada.')
      return { id: midia.id, tipo: 'imagem', arquivo, sha256: midia.sha256, tamanho: midia.tamanho }
    })
    const texto = String(entrada.texto || '')
    if (!texto.trim() || [...texto].length > rede.limite)
      falhar('TEXTO_INVALIDO', `O ${rede.nome} aceita texto de até ${rede.limite} caracteres neste executor.`)
    if (conta === 'linkedin' && entrada.visibilidade && entrada.visibilidade !== 'PUBLIC')
      falhar('PUBLICO_NAO_SUPORTADO', 'A sessão visual aceita somente publicação pública.')
    const payload = {
      conta,
      texto,
      perfilUrl: c.perfilUrl,
      nome: c.nome,
      visibilidade: 'PUBLIC',
      midias,
      origem: entrada.origemEditorial || null,
      ...(entrada.origemAgenda ? {agenda:entrada.origemAgenda} : {}),
    }
    const proposalId = `sv-${conta}-` + crypto.randomUUID(),
      expiresAt = now() + 10 * 60_000
    const p = {
      proposalId,
      payload,
      hash: hash(payload),
      expiresAt,
      expiraEnvioEm: entrada.expiraEnvioEm || null,
    }
    gravar('proposta', proposalId, p)
    return {
      proposalId,
      transporte: 'sessao_visual',
      conta,
      tipo: 'post',
      resumo: `Publicação pública no ${rede.nome} pela sessão da bancada`,
      hash: p.hash,
      expiresAt: new Date(expiresAt).toISOString(),
      preview: { titulo: `${rede.nome} · ${c.nome}`, corpo: texto, destino: c.perfilUrl },
    }
  }
  function confirmar({ proposalId } = {}) {
    return tx(() => {
      const existente = ler('job', proposalId)
      if (existente) return publico(existente)
      const p = ler('proposta', proposalId)
      if (!p || now() > p.expiresAt) falhar('PROPOSTA_EXPIRADA', 'A proposta expirou; revise novamente.')
      if (p.payload.perfilUrl !== config().perfilUrl)
        falhar('CONTA_DIVERGENTE', 'A conta vinculada mudou depois da proposta.')
      const j = {
        id: proposalId,
        estado: 'aguardando_executor',
        payload: p.payload,
        hash: p.hash,
        criadoEm: now(),
        expiraEm: Math.min(now() + 10 * 60_000, p.expiraEnvioEm || Infinity),
      }
      auditar('sessoes:aprovar', {
        jobId: j.id,
        hash: j.hash,
        conta,
        perfilUrl: j.payload.perfilUrl,
      })
      gravar('job', j.id, j)
      db.prepare('DELETE FROM registros WHERE tipo=? AND id=?').run('proposta', proposalId)
      return publico(j)
    })
  }
  function publico(j) {
    return j
      ? {
          id: j.id,
          jobId: j.id,
          transporte: 'sessao_visual',
          nome: rede.nome,
          conta,
          resumo: 'Publicação pela sessão da bancada',
          estado: j.estado,
          hash: j.hash,
          criadoEm: new Date(j.criadoEm).toISOString(),
          expiraEm: new Date(j.expiraEm).toISOString(),
          erro: j.erro || null,
          recibo: j.recibo || null,
        }
      : null
  }
  function obterJob(id) {
    const job = ler('job', String(id))
    return job?.payload?.conta === conta || (conta === 'linkedin' && !job?.payload?.conta) ? publico(job) : null
  }
  function porOrigem(chave) {
    return publico(todos('job').find((j) => (j.payload.conta === conta || (conta === 'linkedin' && !j.payload.conta)) && j.payload.origem?.chave === chave))
  }
  function cancelar(id) {
    return tx(() => {
      const j = ler('job', id)
      if (!j || (j.payload.conta && j.payload.conta !== conta)) falhar('JOB_NAO_ENCONTRADO', 'Trabalho não encontrado.')
      if (j.estado === 'envio_iniciado' || TERMINAIS.has(j.estado))
        falhar('ENVIO_JA_INICIADO', 'Confira o resultado; o envio já pode ter acontecido.')
      j.estado = 'cancelado'
      gravar('job', j.id, j)
      auditar('sessoes:cancelar', { jobId: id })
      return publico(j)
    })
  }
  function cancelarProposta(id) {
    db.prepare('DELETE FROM registros WHERE tipo=? AND id=?').run('proposta', id)
    return { cancelada: true }
  }
  async function capturarComprovante({ url, perfilUrl, itemId } = {}) {
    const c = config()
    if (!c.perfilUrl) falhar('CONTA_NAO_VINCULADA', 'Vincule o perfil da bancada em Conexões.')
    if (perfilUrl && !mesmoPerfil(perfilUrl, c.perfilUrl)) falhar('CONTA_DIVERGENTE', 'A conta vinculada mudou.')
    return exclusivo(async () => {
      if (typeof driver.capturar !== 'function') falhar('COMPROVANTE_INDISPONIVEL', 'O driver da bancada não captura comprovante nesta versão.')
      const r = await driver.capturar({ url, perfilUrl: c.perfilUrl })
      if (!r?.comprovantePng) falhar('COMPROVANTE_FALHOU', 'A bancada não devolveu o comprovante do post.')
      const comprovante = persistirComprovante(r.comprovantePng, itemId || r.id || 'avulso')
      auditar('sessoes:comprovante', { conta, url: r.url, sha256: comprovante.sha256, itemId: itemId || null })
      return { id: r.id, url: r.url, perfilUrl: r.perfilUrl, comprovante }
    })
  }
  function validar(j, token) {
    if(j.payload.agenda)require('../agenda/guarda.cjs').conferir(j.payload.agenda)
    exigirLease(token)
    if (ler('job', j.id)?.estado === 'cancelado') falhar('CANCELADO', 'Trabalho cancelado.')
    if (now() > j.expiraEm) falhar('APROVACAO_EXPIRADA', 'A janela de envio expirou; revise novamente.')
    if (j.hash !== hash(j.payload) || !mesmoPerfil(config().perfilUrl, j.payload.perfilUrl))
      falhar('APROVACAO_INVALIDA', 'Conteúdo ou conta mudou.')
    for (const midia of j.payload.midias || []) {
      let sha256
      try { sha256 = crypto.createHash('sha256').update(fs.readFileSync(midia.arquivo)).digest('hex') } catch { falhar('MIDIA_INVALIDA', 'A imagem aprovada não está mais disponível.') }
      if (!midia.sha256 || sha256 !== midia.sha256) falhar('MIDIA_DIVERGENTE', 'A imagem mudou depois da aprovação.')
    }
    const origem = j.payload.origem
    if (origem) {
      if (!/^[\w-]+$/.test(origem.itemId)) falhar('ORIGEM_INVALIDA', 'Item inválido.')
      const item = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'editorial/itens', origem.itemId + '.json'), 'utf8'),
      )
      if (
        item.revisao !== origem.revisao ||
        item.publicacao?.chave !== origem.chave ||
        !['aguardando_executor', 'publicando'].includes(item.estado) ||
        item.texto !== j.payload.texto ||
        JSON.stringify((item.midias || []).map((midia) => ({ id: midia.id, sha256: midia.sha256 }))) !== JSON.stringify((j.payload.midias || []).map((midia) => ({ id: midia.id, sha256: midia.sha256 })))
      )
        falhar('REVISAO_OBSOLETA', 'A peça mudou depois da aprovação.')
    }
  }
  async function processar() {
    if (fechado || ativo) return
    const token = adquirir()
    if (!token) return
    const j = todos('job').find((j) => (j.payload.conta === conta || (conta === 'linkedin' && !j.payload.conta)) && ['aguardando_executor', 'aguardando_humano'].includes(j.estado))
    if (!j) {
      liberar(token)
      return
    }
    ativo = j.id
    try {
      validar(j, token)
      const disponibilidade = await driver.disponivel()
      validar(j, token)
      if (disponibilidade !== 'livre') {
        j.estado = disponibilidade === 'controle_humano' ? 'aguardando_humano' : 'aguardando_executor'
        gravar('job', j.id, j)
        return
      }
      j.estado = 'preparando'
      delete j.erro
      gravar('job', j.id, j)
      const identidade = await observar()
      if (
        identidade.sessao !== 'autenticada' ||
        !mesmoPerfil(identidade.contaVerificada?.perfilUrl, j.payload.perfilUrl)
      )
        falhar('LOGIN_NECESSARIO', 'Confirme o login e a identidade na bancada.')
      validar(j, token)
      const preparado = await driver.preparar(j.payload)
      if (!preparado?.preparado || Number(preparado.midias || 0) !== (j.payload.midias || []).length)
        falhar('PREPARACAO_FALHOU', 'O compositor não confirmou o texto e as imagens aprovadas.')
      validar(j, token)
      if ((await driver.disponivel()) !== 'livre')
        falhar('CONTROLE_HUMANO', 'A bancada está sob controle humano.')
      tx(() => {
        validar(j, token)
        j.estado = 'envio_iniciado'
        gravar('job', j.id, j)
        auditar('sessoes:envio-iniciado', { jobId: j.id, hash: j.hash, conta })
      })
      const r = await driver.enviar({ ...j.payload, expiraEm: j.expiraEm })
      const urlValida = conta === 'x'
        ? /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(String(r?.url || ''))
        : r?.url?.startsWith('https://www.linkedin.com/feed/update/urn:li:activity:')
      if (!urlValida || !mesmoPerfil(r?.perfilUrl, j.payload.perfilUrl) || r?.texto !== j.payload.texto || Number(r?.midias || 0) !== (j.payload.midias || []).length)
        falhar('RESULTADO_INCERTO', 'Não foi possível verificar o recibo remoto.')
      j.recibo = {
        id: r.id,
        url: r.url,
        hash: j.hash,
        conta,
        publishedAt: new Date(now()).toISOString(),
      }
      if (r.comprovantePng) {
        try {
          j.recibo.comprovante = persistirComprovante(r.comprovantePng, j.payload.origem?.itemId || j.id)
          auditar('sessoes:comprovante', { jobId: j.id, hash: j.hash, conta, sha256: j.recibo.comprovante.sha256 })
        } catch { /* comprovante não impede o recibo já verificado */ }
      }
      auditar('integracoes:publicar', {
        jobId: j.id,
        hash: j.hash,
        conta,
        id: r.id,
        url: r.url,
        transporte: 'sessao_visual',
      })
      j.estado = 'publicado'
    } catch (e) {
      const cancelado = ler('job', j.id)?.estado === 'cancelado'
      j.estado = cancelado
        ? 'cancelado'
        : j.estado === 'envio_iniciado'
          ? 'incerto'
          : e.codigo === 'APROVACAO_EXPIRADA'
            ? 'expirado'
            : ['CONTROLE_HUMANO', 'LOGIN_NECESSARIO'].includes(e.codigo)
              ? 'aguardando_humano'
              : 'falhou'
      j.erro = e.codigo ? e.message : 'A execução foi interrompida; confira a bancada.'
      try {
        auditar(j.estado === 'incerto' ? 'sessoes:resultado-incerto' : 'sessoes:interromper', {
          jobId: j.id,
          hash: j.hash,
          estado: j.estado,
          codigo: e.codigo || 'ERRO',
        })
      } catch {}
    } finally {
      tx(() => {
        if (ler('job', j.id)?.estado === 'cancelado') j.estado = 'cancelado'
        gravar('job', j.id, j)
      })
      ativo = null
      liberar(token)
    }
  }
  function iniciar() {
    if (!timer) {
      fechado = false
      timer = setInterval(() => {
        void processar().catch(() => {})
      }, intervaloMs)
      timer.unref?.()
    }
  }
  function parar() {
    fechado = true
    if (timer) clearInterval(timer)
    timer = null
  }
  function fechar() {
    parar()
    if (ativo) falhar('EXECUTOR_OCUPADO', 'Aguarde a operação local terminar.')
    db.close()
  }
  return {
    estado,
    obterEstado,
    verificar,
    vincular,
    importar,
    consultar,
    capturarComprovante,
    preparar,
    confirmar,
    cancelar,
    cancelarProposta,
    obterJob,
    porOrigem,
    listarJobs: () => todos('job').filter((j) => j.payload.conta === conta || (conta === 'linkedin' && !j.payload.conta)).map(publico),
    processar,
    iniciar,
    parar,
    fechar,
  }
}
module.exports = { criarServicoSessoes }
