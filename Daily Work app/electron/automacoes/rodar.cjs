const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { criarArquivos, gravarJson, arquivoPorId, comTrava, erro } = require('./arquivos.cjs')
const { criarBiblioteca } = require('./biblioteca.cjs')
const { criarCampanha } = require('./campanha.cjs')
const { protocolo } = require('../bancada-protocolo.cjs')

async function executarCiclo(navegador) {
  process.stdout.on('error', () => {})
  const lucasOlDir = process.env.LUCASOL_DIR || path.resolve(__dirname, '../../../LucasOL')
  const arquivos = criarArquivos({ lucasOlDir, dataDir: process.env.DAILYWORK_DATA_DIR || path.resolve(__dirname, '../../data'), campanhaId: process.env.AUTOMACOES_CAMPANHA_ID || 'cognition' })
  const { criarCatalogoCampanhas, criarPesquisa } = require('./campanhas.cjs')
  const cadastro = criarCatalogoCampanhas(arquivos).obter(arquivos.campanhaId)
  const tipo = process.env.AUTOMACOES_TIPO || 'ciclo'
  const agenda = require('../agenda/guarda.cjs').ambiente()
  if(agenda)require('../agenda/guarda.cjs').conferir(agenda)
  if(process.env.AUTOMACOES_EXECUTOR)cadastro.executor=process.env.AUTOMACOES_EXECUTOR
  if (!['ciclo', 'pesquisa'].includes(tipo)) throw new Error('Tipo de execução inválido.')
  const biblioteca = criarBiblioteca(arquivos)
  const campanha = criarCampanha(arquivos, biblioteca)
  const id = randomUUID()
  const destino = arquivoPorId(path.join(arquivos.runs, 'execucoes'), id)
  const execucao = { id, agenda, pid: process.pid, pidInicio: fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(') ')[1].split(' ')[19], campanhaId: arquivos.campanhaId, tipo, executor: cadastro.executor, criadoEm: new Date().toISOString(), status: 'preparando' }
  gravarJson(destino, execucao)
  let filho
  let cancelado = false
  let encerramento
  function sinalizar(sinal) {
    if (!filho?.pid) return
    try { process.kill(-filho.pid, sinal) } catch (e) { if (e.code !== 'ESRCH') throw e }
  }
  function encerrarGrupo() {
    if (!filho?.pid) return Promise.resolve()
    if (!encerramento) encerramento = (async () => {
      sinalizar('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 500))
      sinalizar('SIGKILL')
      await require('./navegador.cjs').encerrarOperacoes(id)
    })()
    return encerramento
  }
  const interromper = () => { cancelado = true; void encerrarGrupo() }
  process.on('SIGTERM', interromper)
  process.on('SIGINT', interromper)
  const prazo = setTimeout(interromper, 50 * 60 * 1000)
  try {
    if (tipo === 'ciclo' && campanha.pendentes().length) throw new Error('Há envios sem confirmação. Confira as interações antes de iniciar outro ciclo.')
    const operacional = campanha.estado()
    const pesquisa = criarPesquisa(arquivos)
    const pesquisaAntes = pesquisa.obter()
    const alvoId = process.env.AUTOMACOES_ALVO_ID
    let alvoFocado
    if (alvoId) {
      alvoFocado = operacional.fila.find(f => f.id === alvoId)
      if (!alvoFocado || alvoFocado.status !== 'na_fila') throw erro('ALVO_INVALIDO', 'Esse alvo não está na fila da campanha.', 409)
    }
    const browser = await garantirBancada(navegador)
    const navegadorCli = path.join(__dirname, 'navegador.cjs')
    const instrucaoNavegador = instrucaoDaPonte(browser, navegadorCli)
    let briefing = tipo === 'pesquisa' ? 'Pesquise esta empresa e salve pessoas, fontes e notas. Nenhum contato ou candidatura deve ser enviado.' : 'Execute a campanha conforme as orientações incluídas.'
    if (agenda) briefing += `\nPlanejamento de hoje: ${process.env.AUTOMACOES_BRIEFING||''}\nLimite desta rodada: ${process.env.AUTOMACOES_LIMITE||1} interações. Respeite a autorização vigente antes de cada ação.`
    if (alvoFocado) {
      briefing += `\nContate exclusivamente o alvo ${alvoFocado.url} (canal ${alvoFocado.canal}, id ${alvoFocado.id}). Limite desta rodada: 1 interação. Não envie para outros destinos.`
      if (alvoFocado.autorizacaoExplicita) briefing += '\nO titular autorizou explicitamente este contato avulso agora. Para este item, a autorização atual substitui a janela de cadência registrada anteriormente; ainda não repita um envio já comprovado para este mesmo URL.'
      if (alvoFocado.identidadeX) briefing += `\nA identidade X autorizada e já verificada pelo DailyWork para este contato é ${alvoFocado.identidadeX}. Confira esse @ na interface antes de agir.`
    }
    const contexto = await biblioteca.preparar({ tipo, idioma: 'pt-BR', briefing }, { execucaoId: id, cadastro, pesquisa: pesquisaAntes, base: arquivos.base, controle: path.join(__dirname, 'controle.cjs'), navegador: instrucaoNavegador, operacional })
    if (cancelado) throw new Error('A preparação foi cancelada. Nenhum executor foi iniciado.')
    Object.assign(execucao, { contextoId: contexto.id, status: 'executando', modelo: cadastro.executor })
    gravarJson(destino, execucao)
    arquivos.auditar('executor-iniciar', { execucaoId: id, contextoId: contexto.id, hash: contexto.hash })
    const resultadoPath = path.join(arquivos.runs, `${id}.resultado.local.txt`)
    const promptPath = path.join(arquivos.runs, `${id}.pedido.local.txt`)
    fs.writeFileSync(promptPath, contexto.mensagens.map(m => `## ${m.role}\n${m.content}`).join('\n\n'), { mode: 0o600 })
    const comando = require('./executores.cjs').comandoExecutor(cadastro.executor, { cwd: lucasOlDir, promptPath, resultadoPath })
    const saida = fs.openSync(path.join(arquivos.runs, `${id}.cli.local.log`), 'w', 0o600)
    let codigo
    let resumoCli = ''
    try {
      codigo = await new Promise((resolve, reject) => {
        filho = spawn(comando.bin, comando.args, { cwd: lucasOlDir, detached: true, stdio: ['pipe', 'pipe', saida], env: { ...process.env, ...comando.env, AGENT_BENCH_OWNER: 'dailywork', AUTOMACOES_CAMPANHA_ID: arquivos.campanhaId, AUTOMACOES_CONTEXTO_ID: contexto.id, AUTOMACOES_EXECUCAO_ID: id } })
        filho.stdout.setEncoding('utf8')
        filho.stdout.on('data', dados => { fs.writeSync(saida, dados); resumoCli = (resumoCli + dados.toString()).slice(-8000) })
        filho.once('error', () => reject(new Error(`${comando.nome} não iniciou. Verifique a instalação e autenticação.`)))
        filho.once('spawn', () => { execucao.filhoPid = filho.pid; gravarJson(destino, execucao); process.stdout.write(`AUTOMACOES_INICIO=${id}\n`) })
        filho.once('close', resolve)
        filho.stdin.on('error', () => {})
        filho.stdin.end(comando.stdin)
      })
    } finally { fs.closeSync(saida) }
    if (codigo !== 0 || cancelado) throw new Error('O executor terminou com falha ou foi interrompido. Confira as interações antes de repetir contatos.')
    if (tipo === 'pesquisa') {
      const resultado = pesquisa.obter()
      if (resultado.execucaoId !== id || resultado.revisao === pesquisaAntes.revisao) throw erro('PESQUISA_SEM_RESULTADO', 'O executor encerrou sem salvar a pesquisa desta rodada. Confira o histórico antes de tentar novamente.', 409)
      execucao.resultado = { tipo: 'pesquisa', pesquisaRevisao: resultado.revisao, pessoas: resultado.pessoas.length, fontes: resultado.fontes.length }
    }
    Object.assign(execucao, { status: tipo === 'ciclo' && campanha.pendentes().length ? 'requer_revisao' : 'concluida', resumo: fs.existsSync(resultadoPath) ? fs.readFileSync(resultadoPath, 'utf8').slice(0, 8000) : resumoCli.trim() || 'Ciclo encerrado sem resumo. Consulte os registros de interação.' })
  } catch (e) {
    execucao.status = cancelado ? 'interrompida' : 'falhou'
    execucao.erro = e.codigo ? e.message : String(e.message || 'Falha na execução.')
    if (e.codigo) execucao.codigo = e.codigo
    process.exitCode = 1
  } finally {
    clearTimeout(prazo)
    await encerrarGrupo()
    execucao.concluidoEm = new Date().toISOString()
    gravarJson(destino, execucao)
    arquivos.auditar('executor-concluir', { execucaoId: id, status: execucao.status })
    process.removeListener('SIGTERM', interromper)
    process.removeListener('SIGINT', interromper)
  }
}
function instrucaoDaPonte(browser, navegadorCli) {
  return `Navegue exclusivamente na bancada ${browser.nome}, workspace ${browser.workspace}. Use node ${JSON.stringify(navegadorCli)} <arquivo-json>. Sem arquivo, lista abas. JSON: {acao: abas|abrir|ler|clicar|preencher|tecla|capturar|fechar, aba: id retornado, url?, role?, nome?, seletor?, texto?, tecla?, arquivo?}. Liste e reutilize abas antes de abrir; abrir reutiliza a mesma URL. Ao concluir uma pesquisa ou salvar o comprovante de uma interação, feche a aba própria sem próxima ação. Preserve somente formulários pendentes e envios incertos, registrando o motivo no checkpoint. Leia com acao ler antes de escolher elementos. Essa ponte respeita a devolução de controle humano. Não conecte diretamente ao Chromium pessoal, não use entrada global e não execute resume. O @Browser da interface Codex não é transportado automaticamente ao CLI; use esta ponte compartilhada. ${protocolo({ frente: 'campanhas', via: 'campanha' })}`
}

async function garantirBancada(navegador) {
  async function tentar() {
    const browser = navegador.preparar ? await navegador.preparar() : await navegador.estado()
    if (!browser.conectado || (browser.controle && browser.controle !== 'agente')) {
      throw erro(browser.controle === 'humano' ? 'CONTROLE_HUMANO' : 'NAVEGADOR_INDISPONIVEL', 'O navegador da bancada não está disponível para o agente.', browser.controle === 'humano' ? 409 : 503)
    }
    return browser
  }
  try { return await tentar() }
  catch (e) {
    if (!['BANCADA_INDISPONIVEL', 'NAVEGADOR_INDISPONIVEL'].includes(e.codigo)) throw e
    await new Promise(resolve => setTimeout(resolve, Number(process.env.AUTOMACOES_BANCADA_RETRY_MS || 10000)))
    return await tentar()
  }
}

async function rodar({ navegador = require('./navegador.cjs').criarNavegador() } = {}) {
  return comTrava(navegador.trava, () => executarCiclo(navegador))
}
if (require.main === module) rodar().catch(e => { process.stderr.write(`${e.codigo || 'ERRO'}: ${e.message}\n`); process.exitCode = 1 })
module.exports = { rodar, garantirBancada, instrucaoDaPonte }
