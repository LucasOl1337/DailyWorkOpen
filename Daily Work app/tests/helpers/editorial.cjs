// Respostas de fronteira do modelo para testes de orquestração. Não testa a
// qualidade de um LLM: os contratos adversariais têm fixtures próprias.
function pautaFixture(registro = 'A fila preserva as fontes e revoga a aprovação quando o texto muda.') {
  return { decisao: 'produzir', titulo: 'Revisão ligada à peça', natureza: 'observacao', leitor: 'Pessoa que revisa publicações do próprio trabalho', situacao: 'O texto pode mudar após a revisão.', tese: registro.slice(0, 700), interesse: 'Conferir a versão exata antes de publicar.', limites: 'Não há números de uso ou ganho de tempo.', tema: 'A revisão da fila fica ligada à peça exata.', problema: 'Uma edição posterior pode invalidar a decisão anterior.', resolucao: 'A pessoa construiu a fila para ligar a revisão à peça e a pessoa confere a versão atual antes de publicar.', conclusao: 'A peça alterada volta para revisão, evitando que uma aprovação antiga libere texto modificado.', evidencias: [{ trecho: registro.slice(0, 1800), sustenta: 'O comportamento está descrito no registro.' }], midia: { tipo: 'captura', objetivo: 'Mostrar o estado da revisão na interface.', direcao: 'Captura real legível.' } }
}
function coberturaCompleta(trecho) {
  return Object.fromEntries(['tema', 'problema', 'resolucao', 'conclusao'].map(chave => [chave, { atendido: true, trecho }]))
}
function completarComEditor(redacao) {
  return async entrada => {
    const sistema = entrada.mensagens[0].content
    if (sistema.startsWith('ETAPA_EDITORIAL: pauta')) {
      const dados = JSON.parse(entrada.mensagens[1].content)
      return { mensagem: JSON.stringify(pautaFixture(dados.registro)), perfil: { id: 'editor-fixture' } }
    }
    if (sistema.startsWith('ETAPA_EDITORIAL: revisao')) {
      const dados = JSON.parse(entrada.mensagens[1].content)
      const trecho = dados.campos.texto || dados.campos.corpo || dados.campos.titulo
      return { mensagem: JSON.stringify({ aprovado: true, notas: { evidencia: 5, especificidade: 4, utilidade: 4, voz: 4, adequacao: 4 }, cobertura: coberturaCompleta(trecho), afirmacoes: [{ trecho, sustentada: true, evidencias: ['e1'], motivo: 'Suporte presente na fixture.' }], problemas: [], parecer: 'Peça concreta para este leitor.' }), perfil: { id: 'editor-fixture' } }
    }
    return redacao(entrada)
  }
}
module.exports = { completarComEditor, pautaFixture, coberturaCompleta }
