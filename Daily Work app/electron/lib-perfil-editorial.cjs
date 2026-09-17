const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

// A memória aprovada no Knowledge é lida a cada lote. O snapshot acompanha
// a peça, para texto e imagem usarem a mesma versão mesmo após novos feedbacks.
function carregarPerfilEditorial({ knowledgeDir } = {}) {
  const raiz = knowledgeDir || process.env.LUCAS_KNOWLEDGE_DIR || path.resolve(__dirname, '../../LucasOL/Knowledge')
  const arquivo = path.join(raiz, 'Editorial', 'perfil-editorial.md')
  let documento
  try { documento = fs.readFileSync(arquivo, 'utf8') } catch (erro) {
    if (erro.code === 'ENOENT') return null
    throw erro
  }
  const versao = Number(documento.match(/^Versão (\d+)\b/m)?.[1])
  const diretrizes = documento.match(/<!-- preferencias:inicio -->([\s\S]*?)<!-- preferencias:fim -->/)?.[1]?.trim()
  if (!versao || !diretrizes || documento.length > 32_000) {
    throw Object.assign(new Error('Perfil editorial precisa de versão e bloco de preferências válido (até 32 mil caracteres).'), { codigo: 'PERFIL_EDITORIAL_INVALIDO' })
  }
  const corpusArquivo = path.join(path.dirname(arquivo), 'referencias.json')
  const corpus = fs.existsSync(corpusArquivo) ? fs.readFileSync(corpusArquivo, 'utf8') : ''
  const todos = corpus ? JSON.parse(corpus).exemplos : []
  if (corpus.length > 200_000 || !Array.isArray(todos) || todos.length > 60) throw Object.assign(new Error('Acervo de referências editorial inválido.'), { codigo: 'PERFIL_EDITORIAL_INVALIDO' })
  // O que vai ao modelo: aprovados inteiros (são o padrão a seguir) e os
  // rejeitados mais recentes resumidos (mostram o que não repetir). O acervo
  // cresce a cada sessão de avaliação; o prompt não pode crescer junto.
  const aprovados = todos.filter(e => e.avaliacao === 'aprovado').slice(-MAX_APROVADOS)
  const rejeitados = todos.filter(e => e.avaliacao !== 'aprovado').slice(-MAX_REJEITADOS).map(e => ({ ...e, texto: String(e.texto || '').slice(0, 500), imagem: undefined }))
  const exemplos = [...aprovados, ...rejeitados]
  return { tipo: 'perfil_editorial', versao, hash: createHash('sha256').update(documento + corpus).digest('hex'), fonte: 'Knowledge/Editorial/perfil-editorial.md', diretrizes, exemplos, acervo: { total: todos.length, aprovados: todos.filter(e => e.avaliacao === 'aprovado').length } }
}
const MAX_APROVADOS = 10
const MAX_REJEITADOS = 8

function imagensDeEstilo(perfil, { knowledgeDir } = {}) {
  const raiz = path.join(knowledgeDir || process.env.LUCAS_KNOWLEDGE_DIR || path.resolve(__dirname, '../../LucasOL/Knowledge'), 'Editorial')
  // As duas capturas aprovadas mais recentes com imagem (PNG ou JPEG).
  return (perfil?.exemplos || []).filter(e => e.avaliacao === 'aprovado' && e.imagem?.arquivo).slice(-2).map(e => {
    const extensao = e.imagem.arquivo.match(/^exemplos\/[\w-]+\.(jpe?g|png)$/)?.[1]
    if (!extensao) throw new Error('Caminho de referência de estilo inválido.')
    const bytes = fs.readFileSync(path.join(raiz, e.imagem.arquivo))
    if (bytes.length > 4_000_000 || createHash('sha256').update(bytes).digest('hex') !== e.imagem.sha256) throw new Error('A captura de estilo mudou após a avaliação.')
    return { nome: `ESTILO-APENAS-${e.id}`, mimeType: extensao === 'png' ? 'image/png' : 'image/jpeg', base64: bytes.toString('base64') }
  })
}

module.exports = { carregarPerfilEditorial, imagensDeEstilo }
