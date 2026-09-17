const NOMES = {
  candidaturas: 'dailywork-candidaturas',
  campanhas: 'dailywork-campanhas',
  redes: 'dailywork-redes',
}
const HIGIENE = 'Higiene: reutilize a aba de pesquisa e a aba da mesma URL; feche abas próprias sem próxima ação depois de salvar comprovante; preserve formulários pendentes e envios incertos com o motivo no checkpoint. Não feche abas de outro agente ou do humano.'
const PROIBIDO = 'Não use padrao, Chromium pessoal, workspaces 1–5, chrome-devtools-axi nem um nome-2. Não execute stop, gc ou resume durante a rodada. Se o humano assumiu a bancada, aguarde a devolução.'

function protocolo({ frente = 'candidaturas', via = 'nativo' } = {}) {
  const nome = NOMES[frente]
  if (!nome) throw new Error('Frente de bancada desconhecida.')
  const inicio = `Bancada estável: ${nome}, workspaces 6–11.`
  const rota = via === 'nativo'
    ? 'Use só as ferramentas desta missão; o serviço já preparou o Chromium. Formulários: lote, aplicar_preset e as ações de aba, nunca CUA/pixels.'
    : via === 'campanha'
      ? 'A ponte JSON desta campanha é a rota principal. CDP ou CUA extras só nesta bancada; não use dailywork-candidaturas nem padrao para posts. Leia a skill dailywork-bancada se a ponte faltar.'
      : `Leia a skill dailywork-bancada. Se o CDP faltar, rode ~/.agents/skills/dailywork-bancada/scripts/preparar ${frente}. Preferir MCP agent-bench-mcp (bench_ensure, bench_cdp, CUA com bench=${nome}).`
  return [inicio, rota, `CDP exclusivo em ~/.agents/desktop/sessions/${nome}/chromium/DevToolsActivePort.`, PROIBIDO, HIGIENE].join(' ')
}

module.exports = { NOMES, protocolo }
