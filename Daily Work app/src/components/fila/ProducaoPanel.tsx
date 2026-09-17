import { useEffect, useState } from 'react'
import {
  cancelarProducaoEditorial, configurarMidiaEditorial, configurarProducaoEditorial,
  configurarPublicacaoEditorial, gerarEditorial, politicaPublicacaoEditorial,
  type ConfiguracaoMidiaEditorial, type ContaEditorial, type EstadoFilaEditorial,
  type IdiomaEditorial, type PoliticaPublicacaoEditorial,
} from '../../lib/editorial'
import type { Conexao } from '../../lib/api'
import { agenda } from '../../lib/agenda'
import { abrirAgenda, navegarPara } from '../../lib/destinos'
import { useEstadoGlobal } from '../../lib/estado-global'
import { CONTAS, IDIOMAS, erroTexto, hojeLocalISO } from './comum'

export function ProducaoPanel({ estado, configMidia, configMidiaCarregada = true, onConfigMidiaSaved, onChanged, onError }: {
  estado: EstadoFilaEditorial | null
  conexoes: Partial<Record<ContaEditorial, Conexao>>
  configMidia?: ConfiguracaoMidiaEditorial | null
  configMidiaCarregada?: boolean
  onConfigMidiaSaved?: (config: ConfiguracaoMidiaEditorial) => void
  onChanged: () => void
  onError: (mensagem: string) => void
}) {
  const global = useEstadoGlobal()
  const rotina = global.agenda?.rotinas.find(r => r.id === 'producao')
  const producao = estado?.producao
  const [dia, setDia] = useState(hojeLocalISO())
  const [quantidade, setQuantidade] = useState(3)
  const [estoqueAlvo, setEstoqueAlvo] = useState(12)
  const [contas, setContas] = useState<ContaEditorial[]>(['linkedin', 'x'])
  const [idiomas, setIdiomas] = useState<IdiomaEditorial[]>(['pt-BR', 'en'])
  const [briefing, setBriefing] = useState('')
  const [alterado, setAlterado] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [aviso, setAviso] = useState('')
  useEffect(() => { setAviso('') }, [producao?.id, producao?.status])
  const [politica, setPolitica] = useState<PoliticaPublicacaoEditorial | null>(null)
  useEffect(() => {
    if (!estado?.config || alterado) return
    setQuantidade(estado.config.quantidade)
    setEstoqueAlvo(estado.config.estoqueAlvo)
    setContas(estado.config.contas)
    setIdiomas(estado.config.idiomas)
  }, [estado?.config, alterado])
  useEffect(() => { politicaPublicacaoEditorial().then(setPolitica).catch(() => setPolitica(null)) }, [])

  const executando = producao?.status === 'executando'
  const automatico = (rotina?.ativa ?? estado?.config?.ativa) && !rotina?.pausada
  const etapa = ocupado === 'gerar' ? 'Iniciando produção…' : executando ? producao?.etapa || 'Preparando conteúdo…' : ''
  const falhas = producao?.erros || []
  const criadas = Array.isArray(producao?.criados) ? producao.criados.length : 0
  const bloqueadas = producao?.descartadas || []
  const rotulo = executando ? 'Produzindo' : producao?.status === 'erro' ? 'Produção interrompida' : producao?.status === 'sem_pauta' ? 'Aguardando novas fontes' : producao?.status === 'concluida' ? `${criadas} peça${criadas === 1 ? '' : 's'} criada${criadas === 1 ? '' : 's'}` : producao?.status === 'cancelada' ? 'Produção cancelada' : 'Pronta para começar'

  async function agir(nome: string, acao: () => Promise<void>) {
    if (ocupado) return
    setOcupado(nome); setAviso('')
    try { await acao(); onChanged(); void global.atualizar() }
    catch (erro) { onError(erroTexto(erro).mensagem) }
    finally { setOcupado('') }
  }
  async function gerar(reavaliar = false) {
    if (!contas.length || !idiomas.length) throw new Error('Escolha pelo menos uma rede e um idioma nas preferências.')
    await gerarEditorial({ dia, quantidade, contas, idiomas, briefing: briefing.trim() || undefined, reavaliar })
    setAviso('Produção iniciada. As peças aparecem abaixo conforme ficam prontas.')
  }
  async function parar() {
    const id = producao?.agenda?.id
    if (id) await agenda('controlar', { id, acao: 'cancelar' })
    else await cancelarProducaoEditorial()
    setAviso('Cancelamento solicitado. As peças já criadas foram preservadas.')
  }
  async function alternarAutomatico() {
    await configurarProducaoEditorial({ ativa: !automatico })
    if (!automatico) await gerar()
    setAviso(automatico ? 'Produção automática pausada. Você pode gerar um lote manualmente.' : 'Produção automática ativada e primeiro lote iniciado.')
  }
  async function salvar() {
    if (!contas.length || !idiomas.length) throw new Error('Escolha pelo menos uma rede e um idioma.')
    await configurarProducaoEditorial({ quantidade, contas, idiomas, estoqueAlvo })
    setAlterado(false); setAviso('Preferências salvas para os próximos lotes automáticos.')
  }
  const mudar = (fn: () => void) => { setAlterado(true); fn() }
  return <section className="fila-producao" aria-labelledby="fila-producao-titulo" aria-busy={Boolean(ocupado) || executando}>
    <div className="fila-producao-heading">
      <div><h2 id="fila-producao-titulo">Produzir conteúdo</h2><p>O agente busca histórias nos projetos e no trabalho recente, escreve e prepara a mídia. Você revisa as peças na fila. <button className="fila-button fila-button--quiet" type="button" onClick={() => navegarPara({ view: 'logica' })}>Editar lógica dos posts</button></p></div>
      <span className={`fila-producao-status fila-producao-status--${producao?.status || 'ociosa'}`}><span className="fila-status-dot" />{rotulo}</span>
    </div>
    <div className="fila-producao-comandos">
      <div className="fila-action-row">
        <button className="fila-button fila-button--accent" disabled={Boolean(ocupado) || executando || !estado} onClick={() => void agir('gerar', () => gerar())}>{ocupado === 'gerar' ? 'Iniciando…' : executando ? 'Produzindo…' : 'Gerar agora'}</button>
        {executando ? <button className="fila-button" disabled={Boolean(ocupado)} onClick={() => void agir('cancelar', parar)}>Cancelar lote</button> : <button className="fila-button" disabled={Boolean(ocupado) || !estado} title="Reavaliar as fontes, preservando peças existentes e publicações" onClick={() => void agir('gerar', () => gerar(true))}>Recomeçar produção</button>}
        <button className="fila-button" disabled={Boolean(ocupado) || !estado} onClick={() => void agir('automatico', alternarAutomatico)}>{ocupado === 'automatico' ? 'Atualizando…' : automatico ? 'Pausar automático' : 'Ativar automático'}</button>
      </div>
      <div className="fila-rotina-resumo"><strong>{automatico ? 'Produção automática ligada' : 'Produção automática pausada'}</strong><span>{rotina?.horarios?.length ? `Às ${rotina.horarios.join(' e ')} · estoque de até ${estoqueAlvo} peças` : 'A programação é controlada pela Agenda'}</span><button className="fila-button fila-button--quiet" onClick={abrirAgenda}>Horários</button></div>
    </div>
    {etapa && <p className="fila-producao-progresso" role="status">{etapa}{executando && producao?.pautaAtual ? ` · ${producao.pautaAtual}` : ''}{executando && criadas ? ` · ${criadas} peças prontas` : ''}</p>}
    {aviso && <p className="fila-helper" role="status">{aviso}</p>}
    {!executando && (falhas.length > 0 || bloqueadas.length > 0 || producao?.status === 'erro' || producao?.status === 'sem_pauta') && <details className="fila-producao-diagnostico">
      <summary>{falhas.length || bloqueadas.length ? `${bloqueadas.length} pautas bloqueadas · ${falhas.length} falhas na execução` : 'Por que a produção parou'}</summary>
      <p>{producao?.mensagem}</p>
      {bloqueadas.length > 0 && <ul>{bloqueadas.map(p => <li key={p.pautaId}><strong>{p.titulo}</strong><p>{p.motivo}</p></li>)}</ul>}{falhas.length > 0 && <ul>{falhas.map((f, i) => <li key={i}>{f.conta ? `${f.conta} · ` : ''}{f.mensagem}</li>)}</ul>}
      <p>As outras fontes continuam elegíveis. Uma pauta bloqueada volta quando sua fonte muda ou quando você escolhe Recomeçar produção.</p>
    </details>}
    <details className="fila-configuracao">
      <summary>Preferências de conteúdo · {quantidade} histórias por lote · {contas.length} redes · {idiomas.length} idiomas</summary>
      <div className="fila-producao-form">
        <label>Dia do contexto<input type="date" value={dia} onChange={e => setDia(e.target.value)} /></label>
        <label>Histórias por lote<input type="number" min={1} max={20} value={quantidade} onChange={e => mudar(() => setQuantidade(Math.min(20, Math.max(1, Number(e.target.value) || 1))))} /></label>
        <label>Estoque desejado<input type="number" min={1} max={200} value={estoqueAlvo} onChange={e => mudar(() => setEstoqueAlvo(Math.max(1, Number(e.target.value) || 1)))} /></label>
        <div className="fila-fieldset"><span>Redes</span><div className="fila-checks">{CONTAS.map(c => <label key={c.id}><input type="checkbox" checked={contas.includes(c.id)} onChange={() => mudar(() => setContas(v => v.includes(c.id) ? v.filter(x => x !== c.id) : [...v, c.id]))} />{c.nome}</label>)}</div></div>
        <div className="fila-fieldset"><span>Idiomas</span><div className="fila-checks">{IDIOMAS.map(i => <label key={i.id}><input type="checkbox" checked={idiomas.includes(i.id)} onChange={() => mudar(() => setIdiomas(v => v.includes(i.id) ? v.filter(x => x !== i.id) : [...v, i.id]))} />{i.nome}</label>)}</div></div>
        <label>Formato da mídia<select value={estado?.config?.formatoMidia || 'imagem'} disabled={Boolean(ocupado)} onChange={e => { const formatoMidia = e.target.value as 'imagem' | 'video'; void agir('midia', async () => { await configurarProducaoEditorial({ formatoMidia, midiaAutomatica: true }) }) }}><option value="imagem">Imagem</option><option value="video">Vídeo curto com imagens</option></select><small>Vídeo monta as imagens revisadas em cenas, sem narração.</small></label>
        <div className="fila-fieldset fila-fieldset--span2"><span>Mídia</span><div className="fila-checks">
          <label><input type="checkbox" data-testid="fila-midia-automatica" disabled={Boolean(ocupado)} checked={estado?.config?.midiaAutomatica !== false} onChange={e => { const checked = e.target.checked; void agir('midia', async () => { await configurarProducaoEditorial({ midiaAutomatica: checked }) }) }} />Preparar mídia para as peças</label>
          <label><input type="checkbox" data-testid="fila-autorizar-gasto-midia" disabled={Boolean(ocupado) || !configMidiaCarregada} checked={configMidia?.autorizarGasto === true} onChange={e => { const checked = e.target.checked; void agir('midia', async () => { onConfigMidiaSaved?.(await configurarMidiaEditorial({ autorizarGasto: checked })) }) }} />Permitir ilustrações por IA</label>
        </div><p className="fila-helper">Capturas verificadas dos projetos são usadas quando mostram a história. Ilustrações exigem a permissão acima.</p></div>
        <label className="fila-briefing">Orientação para este lote<textarea value={briefing} onChange={e => setBriefing(e.target.value)} placeholder="Opcional: assunto ou projeto que você quer priorizar" rows={2} /></label>
      </div>
      <div className="fila-producao-footer"><span>Até {quantidade * contas.length * idiomas.length} versões por lote.</span><button className="fila-button" disabled={Boolean(ocupado) || !alterado} onClick={() => void agir('salvar', salvar)}>{ocupado === 'salvar' ? 'Salvando…' : 'Salvar preferências'}</button></div>
    </details>
    <details className="fila-configuracao"><summary>Publicação · {politica?.modo === 'automatico' ? 'automática autorizada' : 'sob sua aprovação'}</summary>
      <p>Gerar conteúdo adiciona peças à fila. A publicação nas redes segue esta permissão.</p>
      <label className="fila-opcao"><input type="checkbox" data-testid="fila-publicacao-automatica" checked={politica?.modo === 'automatico'} disabled={!politica || Boolean(ocupado)} onChange={e => { const checked = e.target.checked; void agir('publicacao', async () => { setPolitica(await configurarPublicacaoEditorial(checked ? 'automatico' : 'supervisionado')) }) }} />Autorizar publicação automática das peças aprovadas</label>
    </details>
  </section>
}
