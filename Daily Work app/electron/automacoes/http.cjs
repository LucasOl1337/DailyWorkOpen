const { origemLocal, lerJson, erro } = require('../lib-api-local.cjs')

function criarMiddlewareAutomacoes(global) {
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    try {
      if (!origemLocal(req)) throw erro('ORIGEM_NAO_PERMITIDA', 'Automações aceita somente chamadas locais.', 403)
      const url = new URL(req.url || '/', 'http://localhost')
      const rota = url.pathname.replace(/\/$/, '') || '/'
      const chave = `${req.method} ${rota}`
      const campanhaId = url.searchParams.get('campanha') || 'cognition'
      const servico = global.paraCampanha(campanhaId)
      const rotas = {
        'GET /campanhas': () => global.catalogo(),
        'POST /campanhas': async () => global.criarCampanha(await lerJson(req, 32 * 1024)),
        'POST /campanha-configurar': async () => global.configurarCampanha(campanhaId, await lerJson(req, 32 * 1024)),
        'GET /pesquisa': () => servico.pesquisa(),
        'POST /pesquisa': async () => servico.salvarPesquisa(await lerJson(req, 256 * 1024)),
        'POST /pesquisar': () => servico.pesquisar(),
        'POST /cancelar': async () => servico.cancelar(await lerJson(req, 32 * 1024)),
        'POST /navegador-importar': () => global.importarSessao(),
        'POST /navegador-abrir': async () => global.abrirPagina(await lerJson(req, 32 * 1024)),
        'POST /navegador-mostrar': () => global.mostrarNavegador(),
        'GET /': () => servico.estado(),
        'POST /executar': () => servico.executarAgora(),
        'POST /abrir-perfil': () => servico.abrirPerfil(),
        'GET /evidencia': () => servico.evidencia(url.searchParams.get('arquivo')),
        'POST /alvo': async () => servico.adicionarAlvo(await lerJson(req, 32 * 1024)),
        'GET /biblioteca': () => servico.biblioteca(),
        'GET /fonte': () => servico.fonte(url.searchParams.get('id')),
        'POST /selecao': async () => servico.salvarSelecao(await lerJson(req, 32 * 1024)),
        'POST /contexto': async () => servico.prepararContexto(await lerJson(req, 32 * 1024)),
        'GET /contexto': () => servico.obterContexto(url.searchParams.get('id')),
        'POST /material': async () => servico.gerarMaterial(await lerJson(req, 32 * 1024)),
        'GET /material': () => servico.obterMaterial(url.searchParams.get('id')),
        'POST /interacao-conferir': async () => servico.conferirInteracao(await lerJson(req, 32 * 1024)),
      }
      if (!rotas[chave]) throw erro('ROTA_INEXISTENTE', 'Operação de automações não encontrada.', 404)
      res.end(JSON.stringify({ ok: true, data: await rotas[chave]() }))
    } catch (e) {
      res.statusCode = e.status || 500
      res.end(JSON.stringify({ ok: false, erro: { codigo: e.codigo || 'ERRO_INTERNO', mensagem: e.codigo ? e.message : 'Não foi possível concluir a operação de automações.' } }))
    }
  }
}
module.exports = { criarMiddlewareAutomacoes }
