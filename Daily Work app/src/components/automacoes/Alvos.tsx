import { useEffect, useState } from 'react'
import { adicionarAlvoAutomacao, obterPesquisaEmpresa } from '../../lib/api'
import type { AlvoManual, EstadoAutomacoes, FonteEmpresa, InteracaoAutomacao, PessoaEmpresa } from '../../lib/automacoes'
import type { Tom } from '../../lib/estado-global'
import { Bloco, Botao, Chip, Icone, Tabela, type Coluna } from '../ui/ui'
import { ConferirResultado, nomeStatus } from './Operacao'
import { TextoFonte } from './Contexto'

// Alvos da campanha como tabela: pessoa, canal, estado e próximo passo em uma linha, com o
// disparo por linha. Substitui a lista sem estado nem ação do painel antigo.
type Linha = {
  chave: string; nome: string; url: string; cargo: string; canal: string; estado: string; tone: Tom; proximo: string; quando: string
  item?: AlvoManual; pessoa?: PessoaEmpresa; fonte?: FonteEmpresa; interacao?: InteracaoAutomacao
}
function mesmoAlvo(url: string, candidato: string) {
  try {
    const a = new URL(url), b = new URL(candidato)
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '')
  } catch { return false }
}
function pessoaDoAlvo(url: string, pessoas: PessoaEmpresa[]) {
  const direto = pessoas.find(p => p.url && mesmoAlvo(url, p.url))
  if (direto) return direto
  let handle = ''
  try { handle = new URL(url).pathname.split('/').filter(Boolean)[0] || '' } catch { return undefined }
  const chave = handle.toLowerCase()
  return pessoas.find(p => p.url.toLowerCase().includes(chave) || p.nome.toLowerCase().replace(/\s+/g, '').includes(chave.replace(/[^a-z0-9]/g, '')))
}
const canalDaUrl = (url: string) => { try { const h = new URL(url).hostname; return h.includes('linkedin') ? 'LinkedIn' : /(^|\.)x\.com$|twitter/.test(h) ? 'X' : h.includes('reddit') ? 'Reddit' : h.replace(/^www\./, '') } catch { return '' } }
const quando = (v?: string) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const TOM: Record<string, Tom> = { confirmado: 'ok', enviando: 'info', incerto: 'info', nao_enviado: 'atencao', na_fila: 'neutro', feito: 'ok' }

export function Alvos({ campanhaId, estado, atualizar, abrirContexto, irOperacao, bloqueado }: {
  campanhaId: string; estado: EstadoAutomacoes | null; atualizar: () => void; abrirContexto: (id: string) => void; irOperacao: () => void; bloqueado: boolean
}) {
  const [url, setUrl] = useState('')
  const [pessoas, setPessoas] = useState<PessoaEmpresa[]>([])
  const [fontes, setFontes] = useState<FonteEmpresa[]>([])
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    obterPesquisaEmpresa(campanhaId).then(p => { if (vivo) { setPessoas(p.pessoas); setFontes(p.fontes) } }).catch(e => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [campanhaId, estado?.execucoes[0]?.id, estado?.execucoes[0]?.status])
  const fila = (estado?.filaManual || []).filter(m => m.status === 'na_fila')
  const interacoes = estado?.interacoes || []
  const ultimaInteracao = (nome: string, alvoUrl: string) => interacoes.find(i => i.alvo === nome || (alvoUrl && i.alvo && mesmoAlvo(alvoUrl, i.alvo)))
  const linhas: Linha[] = [
    ...fila.map(m => { const p = pessoaDoAlvo(m.url, pessoas); return { chave: `fila:${m.id}`, nome: p?.nome || m.alvo || m.url, url: m.url, cargo: p?.cargo || '', canal: `${canalDaUrl(m.url)}${m.tipo === 'post' ? ' · post' : ''}`, estado: 'Na fila', tone: 'neutro' as Tom, proximo: 'O agente redige na hora, com o gancho da campanha', quando: quando(m.adicionado_em), item: m, pessoa: p, fonte: fontes.find(f => mesmoAlvo(m.url, f.url)) } }),
    ...pessoas.filter(p => p.url && !fila.some(m => mesmoAlvo(m.url, p.url))).map(p => {
      const i = ultimaInteracao(p.nome, p.url)
      return { chave: `pessoa:${p.url}`, nome: p.nome, url: p.url, cargo: p.cargo || '', canal: canalDaUrl(p.url), estado: i ? nomeStatus(i.status) : p.status === 'contatado' ? 'Contatado' : p.prioridade === 'alta' ? 'Prioridade alta' : 'Mapeada', tone: i ? TOM[i.status] || 'neutro' : p.prioridade === 'alta' ? 'atencao' : 'neutro' as Tom, proximo: i ? (i.status === 'confirmado' ? 'Aguardar resposta' : ['enviando', 'incerto'].includes(i.status) ? 'Conferir se saiu' : i.nota || '') : p.motivo || '', quando: quando(i?.criadoEm), pessoa: p, fonte: fontes.find(f => mesmoAlvo(p.url, f.url)), interacao: i }
    }),
  ]
  const ativa = estado?.execucoes.find(e => ['preparando', 'executando'].includes(e.status))
  const pendentes = interacoes.filter(i => ['enviando', 'incerto'].includes(i.status))
  const argumento = estado?.filaArgumentos[0]
  async function disparar(destino = url) {
    setOcupado(true); setErro(''); setAviso('')
    try {
      const r = await adicionarAlvoAutomacao({ url: destino, agora: true }, campanhaId)
      setUrl('')
      if (r.disparo?.iniciado) setAviso(`Disparo iniciado para ${r.item.alvo || r.item.url}. A prova aparece abaixo quando sair.`)
      else setErro(r.disparo?.erro || 'O alvo entrou na fila, mas o disparo não iniciou.')
      atualizar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível disparar.') }
    finally { setOcupado(false) }
  }
  const desabilitado = bloqueado || ocupado || !estado
  const colunas: Coluna<Linha>[] = [
    { chave: 'pessoa', titulo: 'Pessoa', largura: 'minmax(0, 1.4fr)', render: l => <><strong title={l.nome}>{l.nome}</strong><small>{l.cargo || l.url}</small></> },
    { chave: 'canal', titulo: 'Canal', largura: '100px', render: l => l.canal },
    { chave: 'estado', titulo: 'Estado', largura: '124px', render: l => <Chip tone={l.tone}>{l.estado}</Chip> },
    { chave: 'proximo', titulo: 'Próximo passo', largura: 'minmax(0, 1.5fr)', render: l => <span title={l.proximo}>{l.proximo}</span> },
    { chave: 'quando', titulo: 'Quando', largura: '84px', render: l => l.quando },
    { chave: 'acoes', titulo: '', largura: '150px', alinhar: 'right', render: l => <div className="dw-tabela-acoes" onClick={e => e.stopPropagation()}>
      {l.interacao && ['enviando', 'incerto'].includes(l.interacao.status) ? <Botao kind="ghost" onClick={irOperacao}>Conferir</Botao> : !l.interacao || l.interacao.status === 'nao_enviado' ? <Botao disabled={desabilitado} onClick={() => void disparar(l.url)}>Disparar</Botao> : null}
      <a className="dw-btn dw-btn--ghost" href={l.url} target="_blank" rel="noreferrer" title="Abrir alvo">Abrir</a>
    </div> },
  ]
  const detalhe = linhas.find(l => l.chave === aberta)
  return <div className="camp-alvos">
    <Bloco scroll titulo={<>Alvos <span className="cand-contagem">{linhas.length}</span></>} aside={<form className="camp-disparo" onSubmit={e => { e.preventDefault(); void disparar() }}>
      <span className="camp-disparo-campo"><Icone nome="link" tamanho={13} /><input value={url} onChange={e => setUrl(e.target.value)} type="text" inputMode="url" autoComplete="url" spellCheck={false} maxLength={2000} placeholder="Link do LinkedIn ou X" disabled={desabilitado} aria-label="Link do alvo" /></span>
      <Botao kind="primary" icone="send" type="submit" disabled={desabilitado || !url}>{ocupado ? 'Disparando…' : 'Disparar agora'}</Botao>
    </form>}>
      {erro && <p className="dw-vazio camp-erro" role="alert">{erro}</p>}{aviso && <p className="dw-vazio camp-aviso" role="status">{aviso}</p>}
      <Tabela colunas={colunas} linhas={linhas} chave={l => l.chave} aoClicar={l => setAberta(a => a === l.chave ? null : l.chave)} selecionada={aberta} vazio="Nenhum alvo ainda. Pesquise a empresa para mapear pessoas ou cole um link acima." />
      {detalhe && <div className="camp-alvo-detalhe">
        <div className="camp-alvo-detalhe-head"><strong>{detalhe.nome}</strong><Botao kind="ghost" onClick={() => setAberta(null)}>Fechar</Botao></div>
        {detalhe.item?.tipo === 'post' && detalhe.item.post && <p><strong>Gancho:</strong> responder o post <a href={detalhe.item.post} target="_blank" rel="noreferrer">{detalhe.item.post}</a></p>}
        {detalhe.pessoa?.motivo && <p><strong>Por que esta pessoa:</strong> {detalhe.pessoa.motivo}</p>}
        {detalhe.fonte?.trecho && <p><strong>Fonte:</strong> {detalhe.fonte.titulo}: {detalhe.fonte.trecho}</p>}
        {argumento && !detalhe.interacao && <p><strong>Argumento da rotação:</strong> {argumento}. Não há texto gravado: o agente escreve no envio.</p>}
        {detalhe.interacao && <details open={['enviando', 'incerto'].includes(detalhe.interacao.status)}><summary>Mensagem enviada · {nomeStatus(detalhe.interacao.status)} · {quando(detalhe.interacao.criadoEm)}</summary><TextoFonte texto={detalhe.interacao.texto} />{detalhe.interacao.nota && <p>{detalhe.interacao.nota}</p>}{detalhe.interacao.evidencia && <p className="auto-file-path">Evidência: {detalhe.interacao.evidencia}</p>}{detalhe.interacao.contextoId && <Botao onClick={() => abrirContexto(detalhe.interacao!.contextoId)}>Inspecionar base</Botao>}{['enviando', 'incerto'].includes(detalhe.interacao.status) && estado && <ConferirResultado campanhaId={estado.campanha} id={detalhe.interacao.id} executando={Boolean(ativa)} atualizar={atualizar} />}</details>}
      </div>}
    </Bloco>
    {pendentes.length > 0 && <Bloco titulo={<>Envios sem recibo <Chip tone="atencao">{pendentes.length}</Chip></>} aside={<Botao kind="ghost" onClick={irOperacao}>Ver tudo em Operação</Botao>}>
      {pendentes.map(i => <details className="auto-interaction camp-prova" key={i.id} open><summary><strong>{i.alvo}</strong><span>{i.tipo} · {nomeStatus(i.status)} · {quando(i.criadoEm)}</span></summary><TextoFonte texto={i.texto} />{i.nota && <p>{i.nota}</p>}{estado && <ConferirResultado campanhaId={estado.campanha} id={i.id} executando={Boolean(ativa)} atualizar={atualizar} />}</details>)}
    </Bloco>}
  </div>
}
