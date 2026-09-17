#!/usr/bin/env node
// Ensaio explícito com produto e estado reais, em Fila isolada. Usa o
// provedor de texto/visão local; não configura transportes de publicação.
const fs = require('node:fs')
const path = require('node:path')
const { criarServicoAgente } = require('../electron/lib-agente-9router.cjs')
const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
const { criarJobsMidiasEditoriais } = require('../electron/lib-jobs-midias-editoriais.cjs')
const { criarProducaoEditorial } = require('../electron/lib-producao-editorial.cjs')

async function main() {
  const [destino, repositorio] = process.argv.slice(2)
  if (!destino || !path.isAbsolute(repositorio || '')) throw Error('Uso: validar-captura-omarchy.cjs <diretório novo> <repositório absoluto>')
  const dataDir = path.resolve(destino)
  if (fs.existsSync(dataDir)) throw Error('Use um diretório novo para preservar ensaios anteriores.')
  fs.mkdirSync(path.join(dataDir, 'editorial/fontes-projetos'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'editorial/fontes-projetos/omarchy-agents.json'), JSON.stringify({
    id: 'omarchy-agents', nome: 'Omarchy Agents',
    registro: 'A pessoa desenvolveu o Omarchy Agents, um painel no Omarchy para consultar o uso real de agentes nesta máquina. A aba All reúne os agentes; a aba Codex mostra limites e consumo por modelo. O painel oferece filtros Day, Week, Month e Total.',
    fontes: [{ rotulo: 'Repositório público do plugin', url: 'https://github.com/example/omarchy-agents' }],
    atividade: [{ hash: 'abcdef0123456789', data: '2026-09-13T00:00:00Z' }],
    captura: { executor: 'omarchy-agents', ambiente: 'produto-real', repositorio, capacidade: 'Consultar o uso dos agentes em um painel do Omarchy, do conjunto ao detalhe por modelo.', cenas: [{ id: 'all', descricao: 'Painel All em operação com agentes, filtros de período e uso real agregado por modelo.' }, { id: 'codex', descricao: 'Painel Codex em operação com limite semanal e uso real por modelo.' }] },
  }, null, 2))
  const lib = { DATA_DIR: dataDir, listarBlocos: () => [] }
  const agente = criarServicoAgente({ lib, provider: '9router' })
  const registro = { prepararPublicacao: async () => { throw Error('Publicação desabilitada no ensaio') }, confirmarPublicacao: async () => { throw Error('Publicação desabilitada no ensaio') }, obterConexao: id => ({ id, nome: id, capacidades: { midia: { imagem: true } }, esquemaPublicacao: [{ campo: 'texto', rotulo: 'Texto', tipo: 'textarea', max: 3000 }] }) }
  const completar = entrada => agente.completar(entrada)
  const completarComImagens = entrada => agente.completarComImagens(entrada)
  const fila = criarFilaEditorial({ dataDir, registro })
  const jobsMidias = criarJobsMidiasEditoriais({ fila, dataDir, completar, completarComImagens })
  let ultimaEtapa
  const produtor = criarProducaoEditorial({ lib, fila, registro, jobsMidias, dataDir, completar, onUpdate: ({ producao }) => {
    if (producao.etapa && producao.etapa !== ultimaEtapa) { ultimaEtapa = producao.etapa; process.stdout.write(`${ultimaEtapa}\n`) }
  } })
  produtor.iniciar({ dia: '2026-09-13', desde: '2026-09-13', ate: '2026-09-13', projetos: ['omarchy-agents'], quantidade: 1, contas: ['linkedin'], idiomas: ['pt-BR'], exigirMidia: true, perfilId: 'gpt-5-6-sol', perfilEditor: 'gpt-5-6-sol', perfilVisao: 'gpt-5-6-sol', briefing: 'Post curto em português sobre a consulta de uso real dos agentes pelo painel. Use as duas cenas complementares e o link público do repositório. Explique o que foi desenvolvido para alguém que ainda não conhece o painel.' })
  while (produtor.estado().producao.status === 'executando') await new Promise(r => setTimeout(r, 500))
  const estado = produtor.estado().producao
  const itens = await fila.listar()
  fs.writeFileSync(path.join(dataDir, 'resultado.json'), JSON.stringify({ estado, itens }, null, 2))
  if (estado.status !== 'concluida' || itens.length !== 1 || itens[0].midias.length !== 2) throw Error(estado.mensagem || 'A sequência não chegou inteira à Fila.')
  process.stdout.write(JSON.stringify({ status: estado.status, item: itens[0].id, midias: itens[0].midias.length, texto: itens[0].texto, dataDir }) + '\n')
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
