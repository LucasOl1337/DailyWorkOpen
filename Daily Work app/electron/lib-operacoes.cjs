// Registro único de operações de domínio: IPC e HTTP executam as mesmas funções.
function registrarOperacoes({ registrar, lib, fluxoLucasOL, agente, executorNativo, sumario, analiseSumario, coletarSumarioENotificar, analisarSumarioENotificar, integracoes, redator, filaEditorial, producaoEditorial, jobsMidiasEditoriais, logicaEditorial, exigirIdJobMidia, prepararSessaoConexao, session, estadoEscala, alterarEscala, resetarEscala, siteIntegration, automacoes, candidaturas, agenda, modoCaptura = false }) {
  require('./agenda/runtime.cjs').registrarAgenda(registrar, agenda)
  require('./candidaturas/operacoes.cjs').registrarCandidaturas(registrar, candidaturas)
  registrar('blocos:listar', (dia) => lib.listarBlocos(dia))
  registrar('blocos:obter', (id, dia) => {
    const bloco = lib.obterBloco(id, dia)
    if (!bloco) throw Object.assign(new Error(`bloco não encontrado: ${id}`), {codigo: 'NAO_ENCONTRADO', status: 404})
    return bloco
  })
  registrar('blocos:criar', (b, dia) => lib.criarBloco(b, dia))
  registrar('blocos:atualizar', (id, patch, dia) => {
    const bloco = lib.atualizarBloco(id, patch, dia)
    if (!bloco) throw Object.assign(new Error(`bloco não encontrado: ${id}`), {codigo: 'NAO_ENCONTRADO', status: 404})
    return bloco
  })
  registrar(
    'blocos:excluir',
    (id, dia) => ({ excluido: lib.excluirBloco(id, dia) })
  )
  registrar('blocos:salvar', (blocos, opts) => lib.salvarSnapshot(blocos, opts))
  registrar('dias:listar', () => lib.listarDias())
  registrar('sessoes:listar', () => lib.listarSessoes())
  registrar('sessoes:criar', (id) => lib.criarSessao(id))
  registrar('sessoes:carregar', (id) => lib.carregarSessao(id))
  registrar('sessoes:salvar', (id, snapshot) => lib.salvarSessao(id, snapshot))
  registrar('sessoes:excluir', (id) => lib.excluirSessao(id))
  registrar('asset:foto', () => lib.lerFoto())
  registrar('portfolio:midia-salvar', (entrada) => lib.salvarMidiaPortfolio(entrada))
  registrar('portfolio:midia-ler', (caminho) => lib.lerMidiaPortfolio(caminho))
  registrar('conhecimento:listar', () => lib.listarConhecimento())
  registrar('conhecimento:obter', (caminho) => {
    const nota = lib.obterNotaConhecimento(caminho)
    if (!nota) throw Object.assign(new Error(`nota não encontrada: ${caminho}`), {codigo: 'NAO_ENCONTRADO', status: 404})
    return nota
  })
  registrar(
    'conhecimento:salvar',
    (caminho, conteudo, etag) => lib.salvarNotaConhecimento(caminho, conteudo, etag)
  )
  registrar('conhecimento:salvar-posicoes', (novasPosicoes) =>
    lib.salvarPosicoesConhecimento(novasPosicoes)
  )
  registrar('conhecimento:remover-posicao', (caminho) =>
    lib.removerPosicaoConhecimento(caminho)
  )
  registrar('conhecimento:excluir', (caminho) =>
    lib.excluirNotaConhecimento(caminho)
  )
  registrar('conhecimento:contexto-principal', () => lib.contextoPrincipal())
  registrar('fluxo:preparar-dia', (entrada) => fluxoLucasOL.prepararDia(entrada))
  registrar(
    'fluxo:confirmar-propostas',
    (entrada) => fluxoLucasOL.confirmarPropostas(entrada)
  )
  registrar('fluxo:revisar-fechamento', (entrada) => fluxoLucasOL.revisarFechamento(entrada))
  registrar(
    'fluxo:confirmar-fechamento',
    (entrada) => fluxoLucasOL.confirmarFechamento(entrada)
  )
  registrar('fluxo:revisar-semana', (entrada) => fluxoLucasOL.revisarSemana(entrada))
  registrar('fluxo:rascunhar-dia', (entrada) => agente.rascunharDia(entrada))
  registrar('agente:config', () => agente.configuracao())
  registrar('agente:salvar-config', (entrada) => agente.salvarConfiguracao(entrada))
  registrar('agente:sondar-provedores', () => agente.sondarProvedores())
  registrar('agente:contexto', (entrada) => agente.inspecionarContexto(entrada || {}))
  registrar('agente:chat', (entrada) => agente.conversar(entrada))
  registrar('agente:confirmar', (entrada) => agente.confirmarAcao(entrada))
  registrar('executor:iniciar', (entrada) => executorNativo.iniciar(entrada))
  registrar('executor:estado', (dia) => executorNativo.estado(dia))
  registrar('executor:cancelar', (entrada) => executorNativo.cancelar(entrada))
  registrar('sumario:obter', (dia) => sumario.obter(dia))
  registrar('sumario:inputs-obter', (dia) => sumario.obterInputs(dia))
  registrar('sumario:coletar', (dia) => coletarSumarioENotificar(dia))
  registrar('sumario:analise-obter', (dia) => analiseSumario.obter(dia))
  registrar(
    'sumario:analisar',
    (dia, perfilId) => analisarSumarioENotificar(dia, perfilId)
  )
  registrar(
    'sumario:interagir',
    (dia, entrada) => analiseSumario.interagir(dia, entrada)
  )
  registrar('integracoes:listar', () => integracoes.listar())
  registrar('integracoes:status', (id) => integracoes.status(id))
  registrar('integracoes:configurar', (id, entrada) => integracoes.configurar(id, entrada))
  registrar('integracoes:desconectar', (id) => integracoes.desconectar(id))
  registrar('integracoes:autorizar', (id) => integracoes.autorizar(id))
  registrar('integracoes:perfil', (id) => integracoes.perfil(id))
  registrar('integracoes:sessao-visual', (acao, entrada) => integracoes.sessaoVisual(acao, entrada))
  registrar('integracoes:sinais', (id, dia, opcoes) => integracoes.sinais(id, dia, opcoes || {}))
  registrar(
    'integracoes:preparar-publicacao',
    (id, entrada) => integracoes.prepararPublicacao(id, entrada)
  )
  registrar(
    'integracoes:confirmar-publicacao',
    (entrada) => integracoes.confirmarPublicacao(entrada)
  )
  registrar(
    'integracoes:cancelar-publicacao',
    (entrada) => integracoes.cancelarPublicacao(entrada)
  )
  registrar('integracoes:rascunhar', (entrada) => redator.rascunhar(entrada))
  registrar('editorial:listar', (filtros) => filaEditorial.listar(filtros || {}))
  registrar('editorial:capacidades', () => integracoes.listar({ comStatus: false }))
  registrar('editorial:obter', (id) => filaEditorial.obter(id))
  registrar('editorial:criar', (entrada) => filaEditorial.criar(entrada))
  registrar('editorial:atualizar', (id, entrada) => filaEditorial.atualizar(id, entrada))
  registrar('editorial:excluir-muitos', (entrada) => filaEditorial.excluirMuitos(entrada || {}))
  registrar('editorial:publicar', (id, entrada) => filaEditorial.publicar(id, entrada))
  registrar('editorial:agendar', (id, entrada) => filaEditorial.agendar(id, entrada))
  registrar('editorial:verificar', (id) => filaEditorial.verificar(id))
  registrar('editorial:politica-publicacao', () => filaEditorial.politicaPublicacao())
  registrar('editorial:configurar-publicacao', (entrada) => filaEditorial.configurarPublicacao(entrada || {}))
  registrar('editorial:recusar', (id, entrada) => filaEditorial.recusar(id, entrada))
  registrar('editorial:reabrir', (id, entrada) => filaEditorial.reabrir(id, entrada))
  registrar('editorial:espelhar', (id, entrada) => {
    if (!producaoEditorial) throw Object.assign(new Error('produção editorial indisponível.'), { codigo: 'PRODUCAO_INDISPONIVEL', status: 503 })
    return producaoEditorial.espelhar(id, entrada || {})
  })
  registrar('editorial:estado', () => {
    if (!producaoEditorial) return { producao: { status: 'ociosa' }, config: null }
    return producaoEditorial.estado()
  })
  registrar('editorial:gerar', (entrada) => {
    if (!producaoEditorial) throw Object.assign(new Error('produção editorial indisponível.'), { codigo: 'PRODUCAO_INDISPONIVEL', status: 503 })
    return producaoEditorial.iniciar(entrada || {})
  })
  registrar('editorial:cancelar-producao', () => {
    if (!producaoEditorial) throw Object.assign(new Error('produção editorial indisponível.'), { codigo: 'PRODUCAO_INDISPONIVEL', status: 503 })
    return producaoEditorial.cancelar()
  })
  registrar('editorial:config', (entrada) => {
    if (!producaoEditorial) throw Object.assign(new Error('produção editorial indisponível.'), { codigo: 'PRODUCAO_INDISPONIVEL', status: 503 })
    return producaoEditorial.configurar(entrada || {})
  })
  registrar('editorial:logica', () => {
    const servico = logicaEditorial || require('./lib-logica-editorial.cjs').criarLogicaEditorial({ dataDir: lib?.DATA_DIR })
    return servico.obter()
  })
  registrar('editorial:logica-salvar', (entrada) => {
    const servico = logicaEditorial || require('./lib-logica-editorial.cjs').criarLogicaEditorial({ dataDir: lib?.DATA_DIR })
    return servico.salvar(entrada || {})
  })
  registrar('editorial:logica-restaurar', () => {
    const servico = logicaEditorial || require('./lib-logica-editorial.cjs').criarLogicaEditorial({ dataDir: lib?.DATA_DIR })
    return servico.restaurar()
  })
  registrar('editorial:midia', async (itemId, midiaId) => {
    const media = await filaEditorial.lerMidia(itemId, midiaId)
    return `data:${media.mime};base64,${media.dados.toString('base64')}`
  })
  registrar('editorial:historico', (filtros) => filaEditorial.historico(filtros || {}))
  registrar('editorial:comprovante', async (id) => {
    const media = await filaEditorial.lerComprovante(id)
    return `data:${media.mime};base64,${media.dados.toString('base64')}`
  })
  registrar('editorial:capturar-comprovante', (id) => filaEditorial.capturarComprovante(id))
  registrar('editorial:midia-job-listar', (filtros) => jobsMidiasEditoriais.listar(filtros || {}))
  registrar('editorial:midia-configuracao', () => jobsMidiasEditoriais.configuracao())
  registrar('editorial:midia-configurar', (entrada) => jobsMidiasEditoriais.configurar(entrada || {}))
  registrar('editorial:midia-job-obter', (id) => jobsMidiasEditoriais.obter(exigirIdJobMidia(id)))
  registrar('editorial:midia-job-iniciar', (entrada) => jobsMidiasEditoriais.iniciar(entrada || {}))
  registrar('editorial:midia-job-cancelar', (id) => jobsMidiasEditoriais.cancelar(exigirIdJobMidia(id)))
  registrar('editorial:midia-job-retomar', () => {
    if (modoCaptura) return { retomados: [] }
    return jobsMidiasEditoriais.retomarPendentes()
  })
  registrar('integracoes:preparar-sessao', (id, opcoes) => prepararSessaoConexao(id, opcoes || {}))
  registrar(
    'integracoes:limpar-sessao',
    async (id) => {
      const conexao = integracoes.obterConexao(id)
      await session.fromPartition(conexao.partition).clearStorageData()
      return { limpa: true, partition: conexao.partition }
    }
  )
  registrar('interface:escala', () => estadoEscala())
  registrar('interface:escala-alterar', (direcao) => alterarEscala(direcao))
  registrar('interface:escala-resetar', () => resetarEscala())
  registrar('site:status', () => siteIntegration.status())
  registrar('site:configurar', (entrada) => siteIntegration.configurar(entrada))
  registrar('site:metricas', () => siteIntegration.metricas())
  registrar('site:preparar-publicacao', () => siteIntegration.prepararPublicacao())
  registrar(
    'site:confirmar-publicacao',
    (entrada) => siteIntegration.confirmarPublicacao(entrada)
  )
  registrar('automacoes:biblioteca', (campanhaId) => automacoes.paraCampanha(campanhaId).biblioteca())
  registrar('automacoes:fonte', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).fonte(entrada))
  registrar('automacoes:selecao', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).salvarSelecao(entrada))
  registrar('automacoes:contexto-preparar', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).prepararContexto(entrada))
  registrar('automacoes:contexto', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).obterContexto(entrada))
  registrar('automacoes:material-gerar', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).gerarMaterial(entrada))
  registrar('automacoes:material', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).obterMaterial(entrada))
  registrar('automacoes:interacao-conferir', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).conferirInteracao(entrada))
  registrar('automacoes:estado', (campanhaId) => automacoes.paraCampanha(campanhaId).estado())
  registrar('automacoes:executar', (campanhaId) => automacoes.paraCampanha(campanhaId).executarAgora())
  registrar('automacoes:abrir-perfil', (campanhaId) => automacoes.paraCampanha(campanhaId).abrirPerfil())
  registrar('automacoes:evidencia', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).evidencia(entrada))
  registrar('automacoes:alvo', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).adicionarAlvo(entrada))
  registrar('automacoes:pesquisa', (campanhaId) => automacoes.paraCampanha(campanhaId).pesquisa())
  registrar('automacoes:pesquisa-salvar', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).salvarPesquisa(entrada))
  registrar('automacoes:pesquisar', (campanhaId) => automacoes.paraCampanha(campanhaId).pesquisar())
  registrar('automacoes:cancelar', (entrada, campanhaId) => automacoes.paraCampanha(campanhaId).cancelar(entrada))
  registrar('automacoes:catalogo', () => automacoes.catalogo())
  registrar('automacoes:campanha-criar', entrada => automacoes.criarCampanha(entrada))
  registrar('automacoes:campanha-configurar', (entrada, campanhaId) => automacoes.configurarCampanha(campanhaId, entrada))
  registrar('automacoes:navegador-importar', () => automacoes.importarSessao())
  registrar('automacoes:navegador-abrir', entrada => automacoes.abrirPagina(entrada))
  registrar('automacoes:navegador-mostrar', () => automacoes.mostrarNavegador())
}
module.exports = { registrarOperacoes }
