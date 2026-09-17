const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-editorial-'))
  let seq = 0
  const chamadas = { preparar: 0, confirmar: 0 }
  const registro = {
    async prepararPublicacao(_conta, entrada) { chamadas.preparar++; return { proposalId: `proposal-${++seq}`, entrada } },
    async confirmarPublicacao() { chamadas.confirmar++; return { id: `remote-${seq}`, url: `https://example.test/${seq}` } },
  }
  return { dataDir, registro, chamadas }
}
function entrada(extra = {}) {
  return { pautaId: 'pauta-1', conta: 'x', idioma: 'pt-BR', formato: 'texto', titulo: 'Título', texto: 'Texto exato', ...extra }
}

test('persiste e reinstancia a fila', async () => {
  const f = fixture(); const primeira = criarFilaEditorial(f)
  const item = await primeira.criar(entrada())
  const segunda = criarFilaEditorial(f)
  assert.equal((await segunda.obter(item.id)).texto, 'Texto exato')
  assert.equal((await segunda.listar()).length, 1)
})

test('exclusão em massa arquiva itens e valida revisão', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const primeiro = await fila.criar(entrada({ pautaId: 'massa-1' }))
  const segundo = await fila.criar(entrada({ pautaId: 'massa-2' }))
  const resultado = await fila.excluirMuitos({ itens: [{ id: primeiro.id, revisao: primeiro.revisao }, { id: segundo.id, revisao: segundo.revisao - 1 }] })
  assert.deepEqual(resultado.excluidos, [primeiro.id])
  assert.equal(resultado.falhas[0].codigo, 'REVISAO_OBSOLETA')
  assert.equal(await fila.obter(primeiro.id), null)
  assert.equal((await fila.obter(segundo.id)).id, segundo.id)
  const arquivados = fs.readdirSync(path.join(f.dataDir, 'editorial', '_arquivo', 'itens'))
  assert.equal(arquivados.some((nome) => nome.endsWith(`-${primeiro.id}.json`)), true)
})

test('exclusão em massa não remove item durante envio', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const item = await fila.criar(entrada())
  const arquivo = path.join(f.dataDir, 'editorial', 'itens', `${item.id}.json`)
  fs.writeFileSync(arquivo, JSON.stringify({ ...item, estado: 'publicando' }))
  const resultado = await fila.excluirMuitos({ itens: [{ id: item.id, revisao: item.revisao }] })
  assert.deepEqual(resultado.excluidos, [])
  assert.equal(resultado.falhas[0].codigo, 'ESTADO_INVALIDO')
  assert.equal((await fila.obter(item.id)).estado, 'publicando')
})

test('rejeita revisão obsoleta e edição de agendado revoga consentimento', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const item = await fila.criar(entrada())
  const agendado = await fila.agendar(item.id, { revisao: item.revisao, agendadoPara: new Date(Date.now() + 60_000).toISOString() })
  const editado = await fila.atualizar(item.id, { revisao: agendado.revisao, texto: 'Novo texto' })
  assert.equal(editado.estado, 'pendente'); assert.equal(editado.agendadoPara, undefined); assert.equal(editado.aprovacao, undefined)
  await assert.rejects(() => fila.atualizar(item.id, { revisao: item.revisao, texto: 'velho' }), (erro) => erro.codigo === 'REVISAO_OBSOLETA')
})

test('timer só publica agenda vencida, e publicação duplicada não duplica envio', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const futuro = await fila.criar(entrada({ pautaId: 'futuro' }))
  await fila.agendar(futuro.id, { revisao: futuro.revisao, agendadoPara: new Date(Date.now() + 60_000).toISOString() })
  const vencido = await fila.criar(entrada({ pautaId: 'vencido' }))
  await fila.agendar(vencido.id, { revisao: vencido.revisao, agendadoPara: new Date(Date.now() - 1).toISOString() }).catch(() => {})
  // Agenda no passado é recusada pela API; publicar manualmente permanece protegido.
  const atual = await fila.obter(vencido.id)
  assert.equal(atual.estado, 'pendente')
  await Promise.all([fila.publicar(vencido.id, { revisao: atual.revisao }), fila.publicar(vencido.id, { revisao: atual.revisao })].map((p) => p.catch((e) => e)))
  assert.equal(f.chamadas.confirmar, 1)
})

test('agenda futura só dispara quando o relógio alcança o horário, uma vez', async () => {
  const f = fixture(); let relogio = 1_000
  const fila = criarFilaEditorial({ ...f, now: () => relogio })
  const item = await fila.criar(entrada())
  await fila.agendar(item.id, { revisao: item.revisao, agendadoPara: new Date(2_000).toISOString() })
  assert.equal((await fila.processarAgendados()).processados, 0)
  relogio = 2_001
  assert.equal((await fila.processarAgendados()).processados, 1)
  assert.equal((await fila.processarAgendados()).processados, 0)
  assert.equal(f.chamadas.confirmar, 1)
})

test('agenda fixa hash e recusa mídia alterada antes do horário', async () => {
  const f = fixture(); let relogio = 1_000
  const midiaDir = path.join(f.dataDir, 'editorial', 'midias', 'job'); fs.mkdirSync(midiaDir, { recursive: true })
  const arquivo = path.join(midiaDir, 'capa.png'); fs.writeFileSync(arquivo, 'versão aprovada')
  const fila = criarFilaEditorial({ ...f, now: () => relogio })
  const item = await fila.criar(entrada({ formato: 'imagem', midias: [{ id: 'm1', tipo: 'imagem', mime: 'image/png', arquivo: 'midias/job/capa.png' }] }))
  const agendado = await fila.agendar(item.id, { revisao: item.revisao, agendadoPara: new Date(2_000).toISOString() })
  assert.equal(agendado.midias[0].sha256.length, 64)
  fs.writeFileSync(arquivo, 'versão alterada')
  relogio = 2_001
  assert.equal((await fila.processarAgendados()).processados, 0)
  assert.equal((await fila.obter(item.id)).estado, 'erro')
  assert.equal(f.chamadas.preparar, 0); assert.equal(f.chamadas.confirmar, 0)
})

test('lock vivo durante envio impede recuperação e segundo envio', async () => {
  const f = fixture(); let liberar; const bloqueio = new Promise((resolve) => { liberar = resolve })
  const registro = {
    async prepararPublicacao() { return { proposalId: 'p-lock' } },
    async confirmarPublicacao() { await bloqueio; return { id: 'remote-lock' } },
  }
  const fila = criarFilaEditorial({ dataDir: f.dataDir, registro })
  const item = await fila.criar(entrada())
  const envio = fila.publicar(item.id, { revisao: item.revisao })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const segunda = criarFilaEditorial({ dataDir: f.dataDir, registro })
  assert.equal((await segunda.obter(item.id)).estado, 'publicando')
  const terceira = criarFilaEditorial({ dataDir: f.dataDir, registro })
  assert.equal((await terceira.obter(item.id)).estado, 'publicando')
  assert.equal(fs.existsSync(path.join(f.dataDir, 'editorial', '.locks', `${item.id}.lock`)), true)
  liberar()
  const publicado = await envio
  assert.equal(publicado.estado, 'publicado')
})

test('publicar e agendar recusam revisão obsoleta', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f); const item = await fila.criar(entrada())
  await fila.atualizar(item.id, { revisao: item.revisao, texto: 'novo' })
  await assert.rejects(() => fila.publicar(item.id, { revisao: item.revisao }), (erro) => erro.codigo === 'REVISAO_OBSOLETA')
  await assert.rejects(() => fila.agendar(item.id, { revisao: item.revisao, agendadoPara: new Date(Date.now() + 60_000).toISOString() }), (erro) => erro.codigo === 'REVISAO_OBSOLETA')
})

test('edição do texto atualiza o corpo enviado ao GitHub e publicado é imutável', async () => {
  const f = fixture(); let entradaEnviada
  f.registro.prepararPublicacao = async (_conta, entrada) => { entradaEnviada = entrada; return { proposalId: 'github' } }
  const fila = criarFilaEditorial(f)
  let item = await fila.criar(entrada({ conta: 'github', campos: { tipo: 'gist', publico: false, arquivo: 'a.md' } }))
  item = await fila.atualizar(item.id, { revisao: item.revisao, texto: 'corpo editado' })
  item = await fila.publicar(item.id, { revisao: item.revisao })
  assert.equal(entradaEnviada.corpo, 'corpo editado')
  await assert.rejects(() => fila.atualizar(item.id, { revisao: item.revisao, texto: 'não mexer' }), (erro) => erro.codigo === 'ESTADO_INVALIDO')
})

test('falha de rede após confirmação deixa incerto e não tenta novamente', async () => {
  const f = fixture(); let confirmacoes = 0
  f.registro.confirmarPublicacao = async () => { confirmacoes++; throw new Error('offline') }
  const fila = criarFilaEditorial(f); const item = await fila.criar(entrada())
  await assert.rejects(() => fila.publicar(item.id, { revisao: item.revisao }))
  assert.equal((await fila.obter(item.id)).estado, 'incerto'); assert.equal(confirmacoes, 1)
})

test('a fila delega formato e mídia ao conector, sem sucesso silencioso', async () => {
  const f = fixture(); f.registro.prepararPublicacao = async () => { f.chamadas.preparar++; const erro = new Error('mídia não suportada'); erro.codigo = 'MIDIA_NAO_SUPORTADA'; throw erro }
  fs.mkdirSync(path.join(f.dataDir, 'editorial', 'midias'), { recursive: true }); fs.writeFileSync(path.join(f.dataDir, 'editorial', 'midias', 'm1.png'), 'png')
  const fila = criarFilaEditorial(f)
  const item = await fila.criar(entrada({ formato: 'imagem', midias: [{ id: 'm1', tipo: 'imagem', arquivo: 'midias/m1.png' }] }))
  await assert.rejects(() => fila.publicar(item.id, { revisao: item.revisao }), (erro) => erro.codigo === 'MIDIA_NAO_SUPORTADA')
  assert.equal(f.chamadas.preparar, 1); assert.equal(f.chamadas.confirmar, 0)
  assert.equal((await fila.obter(item.id)).estado, 'erro')
})

test('lock órfão é recuperado como incerto', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f); const item = await fila.criar(entrada())
  const itemFile = path.join(f.dataDir, 'editorial', 'itens', `${item.id}.json`)
  fs.writeFileSync(itemFile, JSON.stringify({ ...item, estado: 'publicando', revisao: 2 }))
  const lockFile = path.join(f.dataDir, 'editorial', '.locks', `${item.id}.lock`)
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid + 1_000_000, criadoEm: new Date().toISOString() }))
  const reiniciada = criarFilaEditorial(f)
  assert.equal((await reiniciada.obter(item.id)).estado, 'incerto')
})

test('reinício durante publicação vira incerto sem reenvio automático', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const item = await fila.criar(entrada())
  const arquivo = path.join(f.dataDir, 'editorial', 'itens', `${item.id}.json`)
  const persistido = { ...item, estado: 'publicando', revisao: item.revisao + 1 }
  fs.writeFileSync(arquivo, JSON.stringify(persistido))
  const reiniciada = criarFilaEditorial(f)
  const recuperado = await reiniciada.obter(item.id)
  assert.equal(recuperado.estado, 'incerto')
  assert.equal(f.chamadas.confirmar, 0)
})

test('preview de mídia aceita somente arquivo contido em editorial/midias', async () => {
  const f = fixture(); const midias = path.join(f.dataDir, 'editorial', 'midias'); fs.mkdirSync(midias, { recursive: true }); fs.writeFileSync(path.join(midias, 'ok.png'), 'png')
  const fila = criarFilaEditorial(f)
  const item = await fila.criar(entrada({ midias: [{ id: 'm1', tipo: 'imagem', arquivo: 'midias/ok.png', mime: 'image/png' }] }))
  const media = await fila.lerMidia(item.id, 'm1'); assert.equal(media.mime, 'image/png'); assert.equal(media.dados.toString(), 'png')
  await assert.rejects(() => fila.criar(entrada({ pautaId: 'fora', midias: [{ id: 'm2', tipo: 'imagem', arquivo: '../itens/' + item.id + '.json' }] })), (erro) => erro.codigo === 'MIDIA_FORA_DA_AREA')
})

// Portão de publicação: canal api (agentes) versus canal desktop (humano).
function aprovado(texto, item) {
  const { hashConteudo } = require('../electron/lib-editor-editorial.cjs')
  const base = { pautaId: 'pauta-portao', conta: 'x', idioma: 'pt-BR', formato: 'texto', titulo: 'Título', texto, ...item }
  const editorial = { versao: 'teste', pauta: { titulo: 'T', leitor: 'L', situacao: 'S', tese: 'T', interesse: 'I', limites: 'L', evidencias: [{ id: 'e1', trecho: 'trecho de evidência com tamanho', sustenta: 'ok' }], midia: { tipo: 'nenhuma', objetivo: 'texto basta' }, ...(item?.pautaMidia ? { midia: item.pautaMidia } : {}) }, qualidade: { estado: 'aprovada', aprovado: true, notas: { evidencia: 5, especificidade: 4, utilidade: 4, voz: 4, adequacao: 4 }, problemas: [] } }
  delete base.pautaMidia
  editorial.qualidade.conteudoHash = hashConteudo(base)
  return { ...base, editorial }
}

test('portão: sem publicação automática, agente não publica nem agenda; humano continua podendo', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const item = await fila.criar(aprovado('Texto limpo e específico.'))
  assert.equal(fila.politicaPublicacao().modo, 'supervisionado')
  await assert.rejects(() => fila.publicar(item.id, { revisao: item.revisao, canal: 'api' }), (erro) => erro.codigo === 'APROVACAO_HUMANA_PENDENTE')
  await assert.rejects(() => fila.agendar(item.id, { revisao: item.revisao, canal: 'api', agendadoPara: new Date(Date.now() + 60_000).toISOString() }), (erro) => erro.codigo === 'APROVACAO_HUMANA_PENDENTE')
  const auditoria = fs.readFileSync(path.join(f.dataDir, 'editorial', '_auditoria.ndjson'), 'utf8')
  assert.match(auditoria, /publicacao-bloqueada/)
  const publicado = await fila.publicar(item.id, { revisao: item.revisao })
  assert.equal(publicado.estado, 'publicado')
})

test('portão: em modo automático, agente só publica peça revisada, sem slop e com a imagem que a história pede', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  fila.configurarPublicacao({ modo: 'automatico' })
  const semRevisao = await fila.criar(entrada({ pautaId: 'p-sem-revisao' }))
  const comSlop = await fila.criar(aprovado('Não é sobre velocidade. É sobre controle — e isso muda tudo.', { pautaId: 'p-slop' }))
  const semImagem = await fila.criar(aprovado('Texto limpo com captura prometida.', { pautaId: 'p-sem-imagem', pautaMidia: { tipo: 'captura', objetivo: 'mostrar a tela' } }))
  const pronta = await fila.criar(aprovado('Texto limpo e específico.', { pautaId: 'p-pronta' }))
  const codigos = async (item) => { try { await fila.publicar(item.id, { revisao: item.revisao, canal: 'api' }); return [] } catch (erro) { assert.equal(erro.codigo, 'PUBLICACAO_BLOQUEADA'); return erro.bloqueios.map((b) => b.codigo) } }
  assert.deepEqual(await codigos(semRevisao), ['SEM_REVISAO_VALIDA'])
  assert.deepEqual(await codigos(comSlop), ['ESTILO_REPROVADO'])
  assert.deepEqual(await codigos(semImagem), ['SEM_MIDIA'])
  const lista = await fila.listar()
  assert.equal(lista.find((i) => i.id === pronta.id).prontidao.pronta, true)
  assert.deepEqual(lista.find((i) => i.id === comSlop.id).prontidao.bloqueios[0].sinais.map((x) => x.padrao).sort(), ['contraste-binario', 'inflacao-importancia', 'travessao-aparte'])
  assert.equal((await fila.verificar(semImagem.id)).bloqueios[0].codigo, 'SEM_MIDIA')
  const publicado = await fila.publicar(pronta.id, { revisao: pronta.revisao, canal: 'api' })
  assert.equal(publicado.estado, 'publicado')
})

test('portão: agenda feita por agente é reavaliada na hora do disparo', async () => {
  let agora = Date.now()
  const f = fixture(); const fila = criarFilaEditorial({ ...f, now: () => agora })
  fila.configurarPublicacao({ modo: 'automatico' })
  const item = await fila.criar(aprovado('Texto limpo e específico.'))
  const agendado = await fila.agendar(item.id, { revisao: item.revisao, canal: 'api', agendadoPara: new Date(agora + 60_000).toISOString() })
  assert.equal(agendado.aprovacao.canal, 'api')
  fila.configurarPublicacao({ modo: 'supervisionado' })
  agora += 120_000
  await fila.processarAgendados()
  const depois = await fila.obter(item.id)
  assert.equal(depois.estado, 'pendente')
  assert.equal(depois.erro.codigo, 'APROVACAO_HUMANA_PENDENTE')
  assert.equal(f.chamadas.preparar, 0)
})

test('portão: modo inválido é recusado', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  assert.throws(() => fila.configurarPublicacao({ modo: 'livre' }), (erro) => erro.codigo === 'CAMPO_INVALIDO')
})

test('aceita origem manual e pedido', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const manual = await fila.criar(entrada({ pautaId: 'manual-1', origem: { tipo: 'manual' }, titulo: 'Post meu' }))
  assert.equal(manual.origem.tipo, 'manual')
  const pedido = await fila.criar(entrada({ pautaId: 'pedido-1', origem: { tipo: 'pedido', projeto: 'sussurro' } }))
  assert.equal(pedido.origem.tipo, 'pedido')
})

test('lista peças pela produção, mais recente em cima', async () => {
  const f = fixture(); let relogio = 1_000
  const fila = criarFilaEditorial({ ...f, now: () => ++relogio })
  const antiga = await fila.criar(entrada({ pautaId: 'antiga', titulo: 'Antiga' }))
  await fila.criar(entrada({ pautaId: 'nova', titulo: 'Nova' }))
  await fila.atualizar(antiga.id, { revisao: antiga.revisao, texto: 'Texto atualizado depois da peça nova' })
  const lista = await fila.listar()
  assert.equal(lista[0].titulo, 'Nova')
  assert.equal(lista[1].titulo, 'Antiga')
})

test('histórico lista publicados ativos e arquivados em ordem', async () => {
  const f = fixture(); let relogio = 1_000
  const fila = criarFilaEditorial({ ...f, now: () => ++relogio })
  const primeiro = await fila.criar(entrada({ pautaId: 'hist-1', titulo: 'Primeiro' }))
  const segundo = await fila.criar(entrada({ pautaId: 'hist-2', titulo: 'Segundo' }))
  await fila.publicar(primeiro.id, { revisao: primeiro.revisao })
  await fila.publicar(segundo.id, { revisao: segundo.revisao })
  const segundoPub = await fila.obter(segundo.id)
  await fila.excluirMuitos({ itens: [{ id: segundo.id, revisao: segundoPub.revisao }] })
  const historico = await fila.historico()
  assert.equal(historico.length, 2)
  assert.equal(historico[0].titulo, 'Segundo')
  assert.equal(historico[0].arquivado, true)
  assert.equal(historico[1].titulo, 'Primeiro')
  assert.equal(historico[1].arquivado, false)
  assert.equal((await fila.historico({ conta: 'linkedin' })).length, 0)
})

test('comprovante só existe para publicado e a leitura recusa caminho fora da pasta', async () => {
  const f = fixture(); const fila = criarFilaEditorial(f)
  const pendente = await fila.criar(entrada())
  await assert.rejects(() => fila.capturarComprovante(pendente.id), (erro) => erro.codigo === 'ESTADO_INVALIDO')
  const item = await fila.publicar(pendente.id, { revisao: pendente.revisao })
  await assert.rejects(() => fila.capturarComprovante(item.id), (erro) => erro.codigo === 'SESSAO_INDISPONIVEL')
  await assert.rejects(() => fila.lerComprovante(item.id), (erro) => erro.codigo === 'NAO_ENCONTRADO')
  const arquivo = path.join(f.dataDir, 'editorial', 'itens', `${item.id}.json`)
  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  gravado.recibo.comprovante = { arquivo: '../secret.png', sha256: 'x', capturadoEm: gravado.atualizadoEm }
  fs.writeFileSync(arquivo, JSON.stringify(gravado, null, 2))
  await assert.rejects(() => fila.lerComprovante(item.id), (erro) => erro.codigo === 'MIDIA_FORA_DA_AREA')
})
