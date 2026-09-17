// Fontes públicas verificadas por projeto. O Git comprova atividade no
// período; os trechos e capturas sustentam o assunto, sem expor sessões privadas.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { montarOrigem } = require('./lib-proveniencia-editorial.cjs')
const hash = valor => createHash('sha256').update(valor).digest('hex')
const falha = mensagem => Object.assign(new Error(mensagem), { codigo: 'FONTE_PROJETO_INVALIDA' })
const referenciaProdutoReal = referencia => referencia?.ambiente === 'produto-real' && referencia?.dados === 'reais'
function linkRepositorioPublico(fontes) {
  const fonte = (Array.isArray(fontes) ? fontes : []).find(item => /^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/i.test(item?.url || ''))
  return fonte ? fonte.url.replace(/\/$/, '') : null
}

function listarProjetosEditoriais(dataDir) {
  const dir = path.join(dataDir, 'editorial', 'fontes-projetos')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(n => /^[a-z0-9-]+\.json$/.test(n)).flatMap(nome => {
    try {
      const f = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8'))
      return [{ id: f.id, nome: f.nome, datasAtividade: [...new Set((f.atividade || []).map(a => a.data?.slice(0, 10)).filter(Boolean))], temImagem: Boolean(f.captura?.ambiente === 'produto-real' || f.capturas?.some(referenciaProdutoReal)) }]
    } catch { return [] }
  })
}

function candidatosProjetos({ dataDir, projetos, desde, ate, dia }) {
  if (!Array.isArray(projetos) || !projetos.length || projetos.length > 60 || projetos.some(id => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) throw falha('Informe os IDs dos projetos (até 60).')
  if (![desde, ate].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(new Date(d).valueOf()) && new Date(d).toISOString().slice(0, 10) === d) || desde > ate) throw falha('Informe um período válido para a atividade dos projetos.')
  return [...new Set(projetos)].map(id => {
    const arquivo = path.join(dataDir, 'editorial', 'fontes-projetos', `${id}.json`)
    let fonte
    try { fonte = JSON.parse(fs.readFileSync(arquivo, 'utf8')) } catch { throw falha(`Falta a fonte pública verificada de ${id}.`) }
    if (fonte.id !== id || !fonte.nome || !fonte.registro?.trim() || fonte.registro.length > 16000 || !fonte.fontes?.length) throw falha(`Fonte incompleta: ${id}.`)
    const atividade = (fonte.atividade || []).filter(a => /^[a-f0-9]{7,40}$/.test(a.hash || '') && a.data?.slice(0, 10) >= desde && a.data.slice(0, 10) <= ate)
    if (!atividade.length) throw falha(`Não há atividade comprovada de ${id} entre ${desde} e ${ate}.`)
    if (fonte.captura && fonte.captura.ambiente !== 'produto-real') throw falha(`A receita de captura de ${id} não aponta para o produto real.`)
    const captura = fonte.captura || null
    const refs = (captura ? [] : (fonte.capturas || []).filter(referenciaProdutoReal)).map(ref => {
      if (!/^midias\/refs\/[a-zA-Z0-9._-]+\.(png|jpe?g)$/.test(ref.arquivo || '') || !ref.descricao) throw falha(`Captura inválida: ${id}.`)
      const bytes = fs.readFileSync(path.join(dataDir, 'editorial', ref.arquivo))
      if (hash(bytes) !== ref.sha256) throw falha(`A captura de ${id} mudou desde a inspeção.`)
      return ref
    })
    // Uma receita permite produzir a evidência que falta antes da escrita.
    if (!refs.length && !captura) throw falha(`Falta uma captura do produto real, com dados reais, para ${id}.`)
    const linkPublico = linkRepositorioPublico(fonte.fontes)
    const briefing = `${fonte.registro}\n\n${captura ? `Capacidade a mostrar: ${captura.capacidade}. As capturas do produto real serão produzidas antes da escrita.` : `Imagem real inspecionada: ${refs.map(r => r.descricao).join('\n')}`}\n\n${linkPublico ? `Repositório público: ${linkPublico}. Inclua este link no texto final.` : ''}\n\nLimite temporal: houve trabalho neste projeto entre ${desde} e ${ate}. Isso não significa que todas as funções descritas tenham sido criadas nesse período.`
    return {
      titulo: fonte.nome,
      pautaId: `pauta-mes-${hash(`${id}:${desde}:${ate}`).slice(0, 20)}`,
      score: 10,
      briefing,
      referenciasVisuais: refs,
      ...(captura ? { captura, repositorios: fonte.repositorios || [] } : {}),
      fontes: fonte.fontes,
      ...(linkPublico ? { linkPublico } : {}),
      origem: montarOrigem({ tipo: 'acervo', projeto: id, titulo: fonte.nome, loteDia: dia, partePrincipal: 'projeto-no-periodo' }),
      atividade: { desde, ate, commits: atividade.map(a => a.hash), fonteHash: hash(JSON.stringify(fonte)) },
    }
  })
}

function candidatosAutomaticos({ dataDir, dia }) {
  const inicio = new Date(`${dia}T12:00:00Z`)
  inicio.setUTCDate(inicio.getUTCDate() - 30)
  const desde = inicio.toISOString().slice(0, 10)
  const pautas = [], impedimentos = []
  for (const projeto of listarProjetosEditoriais(dataDir)) {
    if (!projeto.temImagem || !projeto.datasAtividade.some(d => d >= desde && d <= dia)) continue
    try {
      const [pauta] = candidatosProjetos({ dataDir, projetos: [projeto.id], desde, ate: dia, dia })
      // A janela de busca muda diariamente; a identidade muda quando a fonte muda.
      pauta.pautaId = `pauta-fonte-${hash(`${projeto.id}:${pauta.atividade.fonteHash}`).slice(0, 20)}`
      pauta.score = 14
      pautas.push(pauta)
    } catch (erro) {
      impedimentos.push({ pautaId: projeto.id, titulo: projeto.nome, codigo: erro.codigo || 'FONTE_PROJETO_INVALIDA', motivo: erro.message })
    }
  }
  return { pautas, impedimentos }
}

module.exports = { candidatosProjetos, candidatosAutomaticos, listarProjetosEditoriais, referenciaProdutoReal, linkRepositorioPublico }
