const { diaLocal } = require('./sumario/shared.cjs')

const DIAS_PARA_RECUPERAR = 7
const ATRASO_INICIAL_MS = 15_000
const INTERVALO_MS = 15 * 60_000

function diaComDeslocamento(agora, deslocamento) {
  const data = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate() + deslocamento,
    12
  )
  return diaLocal(data)
}

function criarRotinaSumario({
  coletar,
  obterAnalise,
  analisar,
  now = () => new Date(),
  diasParaRecuperar = DIAS_PARA_RECUPERAR,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = (erro) => console.error('[sumario] Falha na rotina automatica:', erro),
} = {}) {
  if (typeof coletar !== 'function') throw new Error('A rotina exige uma função de coleta.')
  if (typeof obterAnalise !== 'function') throw new Error('A rotina exige a leitura das análises.')
  if (typeof analisar !== 'function') throw new Error('A rotina exige uma função de análise.')
  let emAndamento = null
  let timerInicial = null
  let timerIntervalo = null

  async function executar() {
    const agora = now()
    const hoje = diaLocal(agora)
    const resultados = []
    try {
      resultados.push({ dia: hoje, tipo: 'coleta', resultado: await coletar(hoje) })
    } catch (erro) {
      onError(erro)
      resultados.push({ dia: hoje, tipo: 'erro', erro })
    }

    for (let atraso = 1; atraso <= diasParaRecuperar; atraso += 1) {
      const dia = diaComDeslocamento(agora, -atraso)
      try {
        const existente = obterAnalise(dia)
        if (existente.status === 'complete' && existente.analysis?.finalizedAt) continue
        const coleta = await coletar(dia)
        resultados.push({ dia, tipo: 'coleta-final', resultado: coleta })
        if (coleta.completeness === 'not_collected') continue
        resultados.push({
          dia,
          tipo: 'analise-final',
          resultado: await analisar(dia, { finalizar: true }),
        })
      } catch (erro) {
        onError(erro)
        resultados.push({ dia, tipo: 'erro', erro })
      }
    }
    return resultados
  }

  function executarAgora() {
    if (emAndamento) return emAndamento
    emAndamento = executar().finally(() => {
      emAndamento = null
    })
    return emAndamento
  }

  function executarComProtecao() {
    executarAgora().catch(onError)
  }

  function iniciar() {
    if (timerInicial || timerIntervalo) return
    timerInicial = setTimeoutFn(executarComProtecao, ATRASO_INICIAL_MS)
    timerIntervalo = setIntervalFn(executarComProtecao, INTERVALO_MS)
  }

  function parar() {
    if (timerInicial) clearTimeoutFn(timerInicial)
    if (timerIntervalo) clearIntervalFn(timerIntervalo)
    timerInicial = null
    timerIntervalo = null
  }

  return { executarAgora, iniciar, parar }
}

module.exports = { criarRotinaSumario }
