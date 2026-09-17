// Símbolo não pode ser fornecido nos argumentos JSON do modelo.
const ENVIO_REVISADO = Symbol('envio-revisado')
const FINAL = /submit application|send application|enviar candidatura|enviar inscricao|enviar curriculo|finalizar candidatura|^(submit|enviar|finalizar)$/i
function ehEnvioFinal(texto) {
  return FINAL.test(String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
}
function validarAcaoFormulario(a) {
  if (a.acao === 'lote') {
    for (const passo of a.passos || []) validarAcaoFormulario(passo)
    return
  }
  const aciona = a.acao === 'clicar' || a.acao === 'tecla' && /enter|space/i.test(a.tecla || '')
  if (aciona && !a[ENVIO_REVISADO] && ['nome', 'label', 'campo', 'textoAlvo'].some(k => ehEnvioFinal(a[k]))) {
    throw new Error('Use enviar para o envio final, com candidaturaId revisada.')
  }
}
module.exports = { ENVIO_REVISADO, ehEnvioFinal, validarAcaoFormulario }
