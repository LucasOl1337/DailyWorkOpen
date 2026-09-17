const fs = require('node:fs')
const path = require('node:path')
const { criarArquivos } = require('./arquivos.cjs')
const { criarBiblioteca } = require('./biblioteca.cjs')
const { criarCampanha } = require('./campanha.cjs')

async function main() {
  const arquivos = criarArquivos({ lucasOlDir: process.env.LUCASOL_DIR || path.resolve(__dirname, '../../../LucasOL'), dataDir: process.env.DAILYWORK_DATA_DIR || path.resolve(__dirname, '../../data'), campanhaId: process.env.AUTOMACOES_CAMPANHA_ID || 'cognition' })
  const campanha = criarCampanha(arquivos, criarBiblioteca(arquivos))
  const acao = process.argv[2]
  const entrada = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {}
  const pesquisa = require('./campanhas.cjs').criarPesquisa(arquivos)
  const operacoes = { estado: campanha.estado, atualizar: campanha.atualizarEstado, registrar: campanha.registrar, concluir: campanha.concluir, pesquisa: pesquisa.obter, 'pesquisa-salvar': pesquisa.salvar }
  if (!operacoes[acao]) throw new Error('Use estado, atualizar, registrar, concluir, pesquisa ou pesquisa-salvar. A entrada é o caminho de um JSON local.')
  process.stdout.write(JSON.stringify({ ok: true, data: await operacoes[acao](entrada) }) + '\n')
}
if (require.main === module) main().catch(e => { process.stderr.write(JSON.stringify({ ok: false, codigo: e.codigo || 'ERRO', mensagem: e.message }) + '\n'); process.exitCode = 1 })
