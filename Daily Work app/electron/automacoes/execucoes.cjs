const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { erro, listarJson, arquivoPorId, lerJson } = require('./arquivos.cjs')
const { listarExecutores } = require('./executores.cjs')

function alvosNaFila(arquivos) {
  const dados = arquivos.lerEstado()
  return [...(dados.fila_manual || []).map((v, i) => ({ ...v, id: v.id || `legado-${i}` })), ...listarJson(path.join(arquivos.runs, 'fila'))]
}

function exigirAlvo(arquivos, alvoId) {
  if (typeof alvoId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(alvoId)) throw erro('ALVO_INVALIDO', 'Informe um alvo da fila para o disparo imediato.')
  const alvo = alvosNaFila(arquivos).find(a => a.id === alvoId)
  if (!alvo || alvo.status !== 'na_fila') throw erro('ALVO_INVALIDO', 'Esse alvo não está na fila da campanha.', 409)
  return alvo
}

function montarEnvCiclo({ lucasOlDir, dataDir, campanhaId, tipo, cadastro, agenda, briefing, limite, alvoId }) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', LUCASOL_DIR: lucasOlDir, LUCASOL_REPO: lucasOlDir, DAILYWORK_DATA_DIR: dataDir, AUTOMACOES_CAMPANHA_ID: campanhaId, AUTOMACOES_TIPO: tipo }
  if (alvoId) { env.AUTOMACOES_ALVO_ID = alvoId; env.AUTOMACOES_LIMITE = '1' }
  if (agenda) {
    env.DAILYWORK_AGENDA_ID = agenda.id
    env.DAILYWORK_AGENDA_DB = agenda.arquivo
    env.AUTOMACOES_BRIEFING = briefing
    env.AUTOMACOES_LIMITE = alvoId ? '1' : String(limite || 1)
    env.AUTOMACOES_EXECUTOR = cadastro.executor
  }
  return env
}

function criarExecucoes(arquivos, { executarComando = promisify(execFile), navegador, obterCadastro } = {}) {
  const { runs, lucasOlDir, dataDir, auditar, campanhaId } = arquivos
  async function timer() {
    if (campanhaId !== 'cognition') return { ativo: false }
    try {
      const { stdout } = await executarComando('systemctl', ['--user', 'show', 'cognition-campanha.timer', '-p', 'ActiveState', '-p', 'NextElapseUSecRealtime', '-p', 'LastTriggerUSec'], { timeout: 3000 })
      const dados = Object.fromEntries(stdout.trim().split('\n').map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
      return { ativo: dados.ActiveState === 'active', proxima: dados.NextElapseUSecRealtime || '', ultima: dados.LastTriggerUSec || '' }
    } catch { return { ativo: false, erro: 'Agendamento systemd indisponível neste ambiente.' } }
  }
  function listar() {
    return listarJson(path.join(runs, 'execucoes')).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 20).map(e => {
      if (['preparando', 'executando'].includes(e.status)) {
        try { process.kill(e.pid, 0) }
        catch (falha) { if (falha.code === 'ESRCH') return { ...e, status: 'interrompida', erro: 'O executor foi interrompido. Confira os resultados antes de repetir contatos.' } }
      }
      return e
    })
  }
  async function iniciar({ tipo = 'ciclo', agenda, briefing = '', executor, limite, alvoId } = {}) {
    if (!['ciclo', 'pesquisa'].includes(tipo)) throw erro('TIPO_INVALIDO', 'Escolha campanha ou pesquisa.')
    if (alvoId && tipo !== 'ciclo') throw erro('TIPO_INVALIDO', 'O disparo imediato só vale para o ciclo de contato.')
    arquivos.lerEstado()
    if (alvoId) exigirAlvo(arquivos, alvoId)
    const cadastro = obterCadastro()
    if(executor)cadastro.executor=executor
    if (!listarExecutores().some(e => e.id === cadastro.executor && e.instalado)) throw erro('EXECUTOR_INDISPONIVEL', 'Escolha um executor instalado.', 503)
    const browser = await navegador.preparar()
    if (browser.controle === 'humano') throw erro('CONTROLE_HUMANO', 'Aguarde a devolução do navegador pelo humano.', 409)
    if (browser.conectado === false) throw erro('NAVEGADOR_INDISPONIVEL', 'O navegador da bancada ainda não respondeu.', 503)
    fs.mkdirSync(runs, { recursive: true, mode: 0o700 })
    const env = montarEnvCiclo({ lucasOlDir, dataDir, campanhaId, tipo, cadastro, agenda, briefing, limite, alvoId })
    return new Promise((resolve, reject) => {
      const filho = spawn('flock', ['--no-fork', '-n', '-E', '75', path.join(runs, 'ciclo.lock'), process.execPath, path.join(__dirname, 'rodar.cjs')], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env })
      let recebido = '', falha = '', iniciou = false
      const prazo = setTimeout(() => { if (!iniciou) { filho.kill('SIGTERM'); reject(erro('INICIO_EXPIRADO', 'O executor não confirmou a inicialização. Confira o histórico.', 504)) } }, 80_000)
      filho.once('error', () => { clearTimeout(prazo); reject(erro('EXECUTOR_INDISPONIVEL', 'Não foi possível iniciar o executor.', 503)) })
      filho.stderr.on('data', d => { falha = (falha + d.toString()).slice(-1000) })
      filho.stdout.on('data', dados => {
        recebido = (recebido + dados.toString()).slice(-2000)
        const id = recebido.match(/^AUTOMACOES_INICIO=([a-f0-9-]{36})\n/m)?.[1]
        if (!id || iniciou) return
        iniciou = true; clearTimeout(prazo)
        auditar('ciclo-iniciar', { execucaoId: id, tipo, executor: cadastro.executor })
        filho.stdout.destroy(); filho.stderr.destroy(); filho.unref()
        resolve({ iniciado: true, id, pid: filho.pid })
      })
      filho.once('exit', code => {
        clearTimeout(prazo)
        if (!iniciou) reject(erro(code === 75 || falha.includes('EM_EXECUCAO') ? 'EM_EXECUCAO' : 'EXECUTOR_FALHOU', code === 75 || falha.includes('EM_EXECUCAO') ? 'Já existe uma execução usando a campanha ou o navegador. Aguarde o término.' : 'O executor não iniciou. Confira o histórico, o navegador e o login da CLI.', code === 75 || falha.includes('EM_EXECUCAO') ? 409 : 503))
      })
    })
  }
  async function cancelar({ id } = {}) {
    const destino = arquivoPorId(path.join(runs, 'execucoes'), id)
    const job = lerJson(destino)
    if (!job) throw erro('NAO_ENCONTRADO', 'Execução não encontrada.', 404)
    if (!['preparando', 'executando'].includes(job.status)) return { encerrado: true }
    let cmd, inicio
    try { cmd = fs.readFileSync(`/proc/${job.pid}/cmdline`, 'utf8'); inicio = fs.readFileSync(`/proc/${job.pid}/stat`, 'utf8').split(') ')[1].split(' ')[19] }
    catch (e) { if (e.code === 'ENOENT') return { encerrado: true }; throw e }
    if (!cmd.split('\0').includes(path.join(__dirname, 'rodar.cjs')) || job.pidInicio && job.pidInicio !== inicio) throw erro('PROCESSO_DIVERGENTE', 'A identidade do executor mudou; nenhum processo foi encerrado.', 409)
    process.kill(job.pid, 'SIGTERM')
    for (let n = 0; n < 80; n++) {
      if (!['preparando', 'executando'].includes(lerJson(destino)?.status)) { auditar('execucao-cancelar', { execucaoId: id }); return { encerrado: true } }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw erro('CANCELAMENTO_PENDENTE', 'O executor ainda não confirmou o encerramento. Confira o histórico.', 409)
  }
  return { timer, listar, iniciar, cancelar }
}
module.exports = { criarExecucoes, montarEnvCiclo, exigirAlvo }
