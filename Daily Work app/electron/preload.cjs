// Ponte segura entre o renderer (canvas) e o processo principal (filesystem).
// O renderer passa a ter window.dailyworkApi disponível (ver src/lib/api.ts).
const { contextBridge, ipcRenderer } = require('electron')
const candidaturasAcoes = ['estado','observar','configurar','reorientar','iniciar','reiniciar','responder','reabrir','controlar','missao','obter','reservar','atualizar','intencao','captura','resultado','evidencia','executorEstado','autorizar']
contextBridge.exposeInMainWorld('candidaturasApi', { operar: (acao, entrada) => {
  if (!candidaturasAcoes.includes(acao)) throw new Error('Operação de candidaturas inválida.')
  return ipcRenderer.invoke('candidaturas:' + acao, entrada)
} })

contextBridge.exposeInMainWorld('dailyworkApi', {
  listar: (dia) => ipcRenderer.invoke('blocos:listar', dia),
  obter: (id, dia) => ipcRenderer.invoke('blocos:obter', id, dia),
  criar: (bloco, dia) => ipcRenderer.invoke('blocos:criar', bloco, dia),
  atualizar: (id, patch, dia) => ipcRenderer.invoke('blocos:atualizar', id, patch, dia),
  excluir: (id, dia) => ipcRenderer.invoke('blocos:excluir', id, dia),
  salvar: (blocos, opts) => ipcRenderer.invoke('blocos:salvar', blocos, opts),
  listarDias: () => ipcRenderer.invoke('dias:listar'),
  listarSessoes: () => ipcRenderer.invoke('sessoes:listar'),
  criarSessao: (id) => ipcRenderer.invoke('sessoes:criar', id),
  carregarSessao: (id) => ipcRenderer.invoke('sessoes:carregar', id),
  salvarSessao: (id, snapshot) => ipcRenderer.invoke('sessoes:salvar', id, snapshot),
  excluirSessao: (id) => ipcRenderer.invoke('sessoes:excluir', id),
  carregarFoto: () => ipcRenderer.invoke('asset:foto'),
  salvarMidiaPortfolio: (entrada) => ipcRenderer.invoke('portfolio:midia-salvar', entrada),
  carregarMidiaPortfolio: (caminho) => ipcRenderer.invoke('portfolio:midia-ler', caminho),
  listarConhecimento: () => ipcRenderer.invoke('conhecimento:listar'),
  obterNotaConhecimento: (caminho) => ipcRenderer.invoke('conhecimento:obter', caminho),
  salvarNotaConhecimento: (caminho, conteudo, etag) =>
    ipcRenderer.invoke('conhecimento:salvar', caminho, conteudo, etag),
  salvarPosicoesConhecimento: (posicoes) =>
    ipcRenderer.invoke('conhecimento:salvar-posicoes', posicoes),
  removerPosicaoConhecimento: (caminho) =>
    ipcRenderer.invoke('conhecimento:remover-posicao', caminho),
  excluirNotaConhecimento: (caminho) =>
    ipcRenderer.invoke('conhecimento:excluir', caminho),
  contextoPrincipal: () => ipcRenderer.invoke('conhecimento:contexto-principal'),
  prepararDia: (entrada) => ipcRenderer.invoke('fluxo:preparar-dia', entrada),
  confirmarPropostas: (entrada) => ipcRenderer.invoke('fluxo:confirmar-propostas', entrada),
  revisarFechamento: (entrada) => ipcRenderer.invoke('fluxo:revisar-fechamento', entrada),
  confirmarFechamento: (entrada) => ipcRenderer.invoke('fluxo:confirmar-fechamento', entrada),
  revisarSemana: (entrada) => ipcRenderer.invoke('fluxo:revisar-semana', entrada),
  rascunharDia: (entrada) => ipcRenderer.invoke('fluxo:rascunhar-dia', entrada),
  configurarAgente: () => ipcRenderer.invoke('agente:config'),
  salvarConfiguracaoAgente: (entrada) => ipcRenderer.invoke('agente:salvar-config', entrada),
  sondarProvedoresAgente: () => ipcRenderer.invoke('agente:sondar-provedores'),
  inspecionarContextoAgente: (entrada) => ipcRenderer.invoke('agente:contexto', entrada),
  conversarComAgente: (entrada) => ipcRenderer.invoke('agente:chat', entrada),
  confirmarAcaoAgente: (entrada) => ipcRenderer.invoke('agente:confirmar', entrada),
  iniciarExecutorNativo: (entrada) => ipcRenderer.invoke('executor:iniciar', entrada),
  obterEstadoExecutorNativo: (dia) => ipcRenderer.invoke('executor:estado', dia),
  cancelarExecutorNativo: (entrada) => ipcRenderer.invoke('executor:cancelar', entrada),
  obterSumario: (dia) => ipcRenderer.invoke('sumario:obter', dia),
  obterInputsSumario: (dia) => ipcRenderer.invoke('sumario:inputs-obter', dia),
  coletarSumario: (dia) => ipcRenderer.invoke('sumario:coletar', dia),
  obterAnaliseSumario: (dia) => ipcRenderer.invoke('sumario:analise-obter', dia),
  analisarSumario: (dia, perfilId) => ipcRenderer.invoke('sumario:analisar', dia, perfilId),
  interagirSumario: (dia, entrada) => ipcRenderer.invoke('sumario:interagir', dia, entrada),
  obterStatusSite: () => ipcRenderer.invoke('site:status'),
  configurarSite: (entrada) => ipcRenderer.invoke('site:configurar', entrada),
  obterMetricasSite: () => ipcRenderer.invoke('site:metricas'),
  prepararPublicacaoSite: () => ipcRenderer.invoke('site:preparar-publicacao'),
  confirmarPublicacaoSite: (entrada) => ipcRenderer.invoke('site:confirmar-publicacao', entrada),
  listarConexoes: () => ipcRenderer.invoke('integracoes:listar'),
  obterStatusConexao: (id) => ipcRenderer.invoke('integracoes:status', id),
  sessaoVisual: (acao, entrada) => ipcRenderer.invoke('integracoes:sessao-visual', acao, entrada),
  configurarConexao: (id, entrada) => ipcRenderer.invoke('integracoes:configurar', id, entrada),
  desconectarConexao: (id) => ipcRenderer.invoke('integracoes:desconectar', id),
  autorizarConexao: (id) => ipcRenderer.invoke('integracoes:autorizar', id),
  obterPerfilConexao: (id) => ipcRenderer.invoke('integracoes:perfil', id),
  obterSinaisConexao: (id, dia, opcoes) => ipcRenderer.invoke('integracoes:sinais', id, dia, opcoes),
  prepararPublicacaoConexao: (id, entrada) => ipcRenderer.invoke('integracoes:preparar-publicacao', id, entrada),
  confirmarPublicacaoConexao: (entrada) => ipcRenderer.invoke('integracoes:confirmar-publicacao', entrada),
  cancelarPublicacaoConexao: (entrada) => ipcRenderer.invoke('integracoes:cancelar-publicacao', entrada),
  rascunharPublicacaoConexao: (entrada) => ipcRenderer.invoke('integracoes:rascunhar', entrada),
  limparSessaoConexao: (id) => ipcRenderer.invoke('integracoes:limpar-sessao', id),
  prepararSessaoConexao: (id, opcoes) => ipcRenderer.invoke('integracoes:preparar-sessao', id, opcoes),
  // Assinatura: avisa quando um agente escreveu em data/ (ver main.cjs).
  onBlocosExternos: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('blocos:externos', listener)
    return () => ipcRenderer.removeListener('blocos:externos', listener)
  },
  onConhecimentoExterno: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('conhecimento:externo', listener)
    return () => ipcRenderer.removeListener('conhecimento:externo', listener)
  },
  onSumarioAtualizado: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('sumario:atualizado', listener)
    return () => ipcRenderer.removeListener('sumario:atualizado', listener)
  },
  onAnaliseSumarioProgresso: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('sumario:analise-progresso', listener)
    return () => ipcRenderer.removeListener('sumario:analise-progresso', listener)
  },
  onAnaliseSumarioAtualizada: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('sumario:analise-atualizada', listener)
    return () => ipcRenderer.removeListener('sumario:analise-atualizada', listener)
  },
  onExecutorAtualizado: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('executor:atualizado', listener)
    return () => ipcRenderer.removeListener('executor:atualizado', listener)
  },
  obterEscala: () => ipcRenderer.invoke('interface:escala'),
  alterarEscala: (direcao) => ipcRenderer.invoke('interface:escala-alterar', direcao),
  resetarEscala: () => ipcRenderer.invoke('interface:escala-resetar'),
  onEscala: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('interface:escala', listener)
    return () => ipcRenderer.removeListener('interface:escala', listener)
  },
  campanhaOperacao: (acao, entrada, campanhaId) => {
    const permitidas = ['catalogo', 'campanha-criar', 'campanha-configurar', 'pesquisa', 'pesquisa-salvar', 'pesquisar', 'cancelar', 'navegador-importar', 'navegador-mostrar', 'navegador-abrir']
    if (!permitidas.includes(acao)) throw new Error('Operação inválida')
    return ['catalogo', 'navegador-importar', 'navegador-mostrar'].includes(acao) ? ipcRenderer.invoke('automacoes:' + acao) : ['pesquisa', 'pesquisar'].includes(acao) ? ipcRenderer.invoke('automacoes:' + acao, campanhaId) : ipcRenderer.invoke('automacoes:' + acao, entrada, campanhaId)
  },
  bibliotecaAutomacoes: (campanhaId) => ipcRenderer.invoke('automacoes:biblioteca', campanhaId),
  fonteAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:fonte', entrada, campanhaId),
  selecaoAutomacoes: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:selecao', entrada, campanhaId),
  prepararContextoAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:contexto-preparar', entrada, campanhaId),
  contextoAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:contexto', entrada, campanhaId),
  gerarMaterialAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:material-gerar', entrada, campanhaId),
  materialAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:material', entrada, campanhaId),
  conferirInteracaoAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:interacao-conferir', entrada, campanhaId),
  estadoAutomacoes: (campanhaId) => ipcRenderer.invoke('automacoes:estado', campanhaId),
  executarAutomacao: (campanhaId) => ipcRenderer.invoke('automacoes:executar', campanhaId),
  abrirPerfilAutomacao: (campanhaId) => ipcRenderer.invoke('automacoes:abrir-perfil', campanhaId),
  evidenciaAutomacao: (arquivo, campanhaId) => ipcRenderer.invoke('automacoes:evidencia', arquivo, campanhaId),
  alvoAutomacao: (entrada, campanhaId) => ipcRenderer.invoke('automacoes:alvo', entrada, campanhaId),
})

contextBridge.exposeInMainWorld('dailyworkPrincipal', {
  carregar: () => ipcRenderer.invoke('principal:canvas-carregar'),
  salvar: (snapshot) => ipcRenderer.invoke('principal:canvas-salvar', snapshot),
})

contextBridge.exposeInMainWorld('dailyworkSkills', {
  dashboard: (entrada) => ipcRenderer.invoke('skills:dashboard', entrada),
})

contextBridge.exposeInMainWorld('dailyworkEditorial', {
  listar: (filtros) => ipcRenderer.invoke('editorial:listar', filtros || {}),
  capacidades: () => ipcRenderer.invoke('editorial:capacidades'),
  obter: (id) => ipcRenderer.invoke('editorial:obter', id),
  criar: (entrada) => ipcRenderer.invoke('editorial:criar', entrada),
  atualizar: (id, entrada) => ipcRenderer.invoke('editorial:atualizar', id, entrada),
  excluirMuitos: (entrada) => ipcRenderer.invoke('editorial:excluir-muitos', entrada),
  publicar: (id, entrada) => ipcRenderer.invoke('editorial:publicar', id, entrada),
  agendar: (id, entrada) => ipcRenderer.invoke('editorial:agendar', id, entrada),
  verificar: (id) => ipcRenderer.invoke('editorial:verificar', id),
  politicaPublicacao: () => ipcRenderer.invoke('editorial:politica-publicacao'),
  configurarPublicacao: (entrada) => ipcRenderer.invoke('editorial:configurar-publicacao', entrada),
  recusar: (id, entrada) => ipcRenderer.invoke('editorial:recusar', id, entrada),
  reabrir: (id, entrada) => ipcRenderer.invoke('editorial:reabrir', id, entrada),
  espelhar: (id, entrada) => ipcRenderer.invoke('editorial:espelhar', id, entrada),
  estado: () => ipcRenderer.invoke('editorial:estado'),
  gerar: (entrada) => ipcRenderer.invoke('editorial:gerar', entrada),
  cancelarProducao: () => ipcRenderer.invoke('editorial:cancelar-producao'),
  configurar: (entrada) => ipcRenderer.invoke('editorial:config', entrada),
  logica: () => ipcRenderer.invoke('editorial:logica'),
  salvarLogica: (entrada) => ipcRenderer.invoke('editorial:logica-salvar', entrada),
  restaurarLogica: () => ipcRenderer.invoke('editorial:logica-restaurar'),
  lerMidia: (itemId, midiaId) => ipcRenderer.invoke('editorial:midia', itemId, midiaId),
  historico: (filtros) => ipcRenderer.invoke('editorial:historico', filtros || {}),
  lerComprovante: (id) => ipcRenderer.invoke('editorial:comprovante', id),
  capturarComprovante: (id) => ipcRenderer.invoke('editorial:capturar-comprovante', id),
  configuracaoMidia: () => ipcRenderer.invoke('editorial:midia-configuracao'),
  configurarMidia: (entrada) => ipcRenderer.invoke('editorial:midia-configurar', entrada),
  listarJobsMidia: (filtros) => ipcRenderer.invoke('editorial:midia-job-listar', filtros || {}),
  obterJobMidia: (id) => ipcRenderer.invoke('editorial:midia-job-obter', id),
  iniciarJobMidia: (entrada) => ipcRenderer.invoke('editorial:midia-job-iniciar', entrada),
  cancelarJobMidia: (id) => ipcRenderer.invoke('editorial:midia-job-cancelar', id),
  retomarJobsMidia: () => ipcRenderer.invoke('editorial:midia-job-retomar'),
  onJobMidiaAtualizado: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('editorial:midia-job-atualizado', listener)
    return () => ipcRenderer.removeListener('editorial:midia-job-atualizado', listener)
  },
  onAtualizado: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('editorial:atualizado', listener)
    return () => ipcRenderer.removeListener('editorial:atualizado', listener)
  },
  onProducaoAtualizada: (callback) => {
    const listener = (_evento, payload) => callback(payload)
    ipcRenderer.on('editorial:producao-atualizada', listener)
    return () => ipcRenderer.removeListener('editorial:producao-atualizada', listener)
  },
})

// Transporte limitado de comandos tipados; não expõe ipcRenderer nem avaliação de código.
contextBridge.exposeInMainWorld('dailyworkCanvas', {
  conectar: (callback) => {
    const listener = (_evento, mensagem) => callback(mensagem)
    ipcRenderer.on('canvas:comando', listener)
    ipcRenderer.send('canvas:conectar')
    return () => ipcRenderer.removeListener('canvas:comando', listener)
  },
  responder: (resposta) => ipcRenderer.send('canvas:resposta', resposta),
})

contextBridge.exposeInMainWorld('agendaApi', { operar: (acao, entrada) => {
  if (!['estado','detalhes','configurar','instruir','executar','controlar'].includes(acao)) return Promise.reject(new Error('Operação inválida.'))
  return ipcRenderer.invoke('agenda:' + acao, entrada)
} })
