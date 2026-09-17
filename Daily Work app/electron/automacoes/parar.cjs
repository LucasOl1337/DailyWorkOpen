// Por padrão apenas lista. --executar exige a empresa explícita.
const { criarServicoAutomacoes } = require('../lib-automacoes.cjs')
async function main() {
  const args = process.argv.slice(2)
  const executar = args.includes('--executar')
  if (executar && args.includes('--dry-run')) throw new Error('Escolha --dry-run ou --executar, sem combinar os dois.')
  const pos = args.indexOf('--campanha')
  const id = pos >= 0 ? args[pos + 1] : undefined
  if (pos >= 0 && (!id || id.startsWith('--'))) throw new Error('Informe o identificador depois de --campanha.')
  if (executar && !id) throw new Error('Use --campanha <id> --executar para encerrar os executores dessa empresa.')
  if (args.some((a, i) => !['--executar', '--dry-run', '--campanha'].includes(a) && !(pos >= 0 && i === pos + 1))) throw new Error('Use [--campanha <id>] [--dry-run | --executar].')
  const servico = criarServicoAutomacoes()
  const catalogo = await servico.catalogo()
  const campanhas = id ? [catalogo.campanhas.find(c => c.id === id)] : catalogo.campanhas
  if (campanhas.some(c => !c)) throw new Error('Campanha não encontrada.')
  const resultado = []
  for (const c of campanhas) {
    const campanha = servico.paraCampanha(c.id)
    const antes = (await campanha.estado()).execucoes.filter(e => ['preparando', 'executando'].includes(e.status))
    if (executar) for (const e of antes) await campanha.cancelar({ id: e.id })
    const ativas = executar ? (await campanha.estado()).execucoes.filter(e => ['preparando', 'executando'].includes(e.status)) : antes
    resultado.push({ campanha: c.id, execucoes: ativas.map(e => ({ id: e.id, status: e.status, executor: e.executor })), ...(executar ? { encerradas: antes.map(e => e.id), quieto: ativas.length === 0 } : {}) })
  }
  console.log(JSON.stringify({ executado: executar, campanhas: resultado, agendamento: 'O timer permanece configurado; este comando encerra somente as execuções atuais.' }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
