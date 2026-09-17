import { useState } from 'react'
import { cancelarMidiaJob, iniciarMidiaJob, configurarMidiaEditorial, type ItemEditorial, type JobMidiaEditorial } from '../../lib/editorial'
import { ehConflito, erroTexto, type CapacidadesMidia } from './comum'

export function MediaJobControls({
  item,
  jobs,
  capacidades,
  capacidadesCarregadas,
  autorizarGasto,
  onChanged,
  onError,
}: {
  item: ItemEditorial
  jobs: JobMidiaEditorial[]
  capacidades: CapacidadesMidia
  capacidadesCarregadas: boolean
  autorizarGasto: boolean
  onChanged: () => void
  onError: (mensagem: string) => void
}) {
  const [aberto, setAberto] = useState(item.midias.length > 0)
  const [tipo, setTipo] = useState<'imagem' | 'video' | null>(null)
  const [briefing, setBriefing] = useState('')
  const [provedores, setProvedores] = useState<'grok' | 'codex'>('codex')
  const [busy, setBusy] = useState(false)
  const itemJobs = jobs.filter((job) => job.itemId === item.id).sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')))
  const ativo = itemJobs.find((job) => job.status === 'planned' || job.status === 'producing')
  const suporteImagem = capacidades[item.conta]?.imagem === true
  const suporteVideo = capacidades[item.conta]?.video === true
  const suporteConhecido = capacidadesCarregadas && Boolean(capacidades[item.conta])
  const tipoDisponivel = tipo === 'imagem' ? suporteImagem : tipo === 'video' ? suporteVideo : false
  const podeIniciar = !busy && !ativo && tipoDisponivel && (tipo === 'imagem' ? autorizarGasto && Boolean((briefing || item.texto).trim()) : item.midias.some(m => m.tipo === 'imagem'))

  async function iniciar() {
    if (!tipo || !podeIniciar) return
    setBusy(true)
    try {
      await iniciarMidiaJob({
        itemId: item.id,
        revisao: item.revisao,
        pautaId: item.pautaId,
        tipo,
        briefing: briefing.trim() || undefined,
        ...(tipo === 'imagem' ? { estrategia: 'editorial', provedores } : { automatico: true }),
      })
      onChanged()
    } catch (erro) {
      if (ehConflito(erro)) {
        onChanged()
        onError('A revisão deste item mudou enquanto o job era iniciado. A fila foi recarregada; confira a revisão antes de tentar novamente.')
      } else onError(erroTexto(erro).mensagem)
    } finally {
      setBusy(false)
    }
  }

  async function cancelar(jobId: string) {
    setBusy(true)
    try {
      await cancelarMidiaJob(jobId)
      onChanged()
    } catch (erro) {
      if (ehConflito(erro)) {
        onChanged()
        onError('A revisão deste item mudou enquanto o job era cancelado. A fila foi recarregada; confira a revisão antes de tentar novamente.')
      } else onError(erroTexto(erro).mensagem)
    } finally {
      setBusy(false)
    }
  }
  async function importarImagem(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(arquivo.type)) { onError('Escolha uma imagem PNG ou JPEG com até 4 MB.'); return }
    setBusy(true)
    try {
      const imagemBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.readAsDataURL(arquivo)
      })
      await iniciarMidiaJob({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', imagemBase64, briefing: briefing.trim() || undefined })
      onChanged()
    } catch (erro) { onError(erroTexto(erro).mensagem) } finally { setBusy(false) }
  }


  return (
    <details className="fila-media-jobs" open={aberto} onToggle={(evento) => setAberto((evento.currentTarget as HTMLDetailsElement).open)}>
      <summary>Criação de mídia {itemJobs.length > 0 && <span className="fila-job-count">{itemJobs.length} job{itemJobs.length === 1 ? '' : 's'}</span>}</summary>
      <div className="fila-media-jobs-body">
        {!capacidadesCarregadas && <p className="fila-helper">Verificando quais formatos esta conta aceita…</p>}
        {capacidadesCarregadas && !suporteConhecido && <p className="fila-card-warning">Não foi possível confirmar a capacidade de mídia desta conta; os controles ficam bloqueados até o conector informar o suporte.</p>}
        {capacidadesCarregadas && suporteConhecido && !suporteImagem && !suporteVideo && <p className="fila-helper">Esta rede não oferece upload de imagem ou vídeo nesta versão.</p>}
        {tipo === 'imagem' && !autorizarGasto && (
          <div className="fila-card-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <span>Geração de imagem por IA está desativada nas configurações. Você pode importar uma imagem pronta ou habilitar a geração.</span>
            <button
              type="button"
              className="fila-button fila-button--quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await configurarMidiaEditorial({ autorizarGasto: true })
                  onChanged()
                } catch (e) {
                  onError(erroTexto(e).mensagem)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Habilitar geração por IA
            </button>
          </div>
        )}
        {itemJobs.map((job) => {
          const vencedor = job.revisaoVisual?.vereditos?.find((veredito) => veredito.provedor === job.revisaoVisual?.vencedor)
          return <div className="fila-job-row" key={job.id}><span className={`fila-job-status fila-job-status--${job.status}`}>{job.status === 'producing' ? 'Produzindo' : job.status === 'planned' ? 'Na fila' : job.status === 'ready' ? 'Pronto' : job.status === 'cancelled' ? 'Cancelado' : 'Falhou'}</span><span>{job.tipo === 'imagem' ? 'Imagem' : 'Mini-vitrine'}</span>{job.status === 'producing' && <button className="fila-button fila-button--quiet" type="button" disabled={busy} onClick={() => void cancelar(job.id)}>Cancelar</button>}{job.status === 'failed' && job.erro && <small>{typeof job.erro === 'string' ? job.erro : job.erro.mensagem}</small>}{job.revisaoVisual && <small className={job.revisaoVisual.degradada ? 'fila-job-review fila-job-review--degradada' : 'fila-job-review'}>{job.revisaoVisual.degradada ? `Revisão visual ausente (registro anterior) (${job.revisaoVisual.vencedor})` : `Revisão visual: ${job.revisaoVisual.vencedor ? 'aprovada' : 'reprovada'} (${job.revisaoVisual.vencedor || 'veja os motivos'}${job.revisaoVisual.tentativas > 1 ? `, ${job.revisaoVisual.tentativas}ª tentativa` : ''})${vencedor?.notes ? ` — ${vencedor.notes}` : ''}`}</small>}</div>
        })}
        {ativo && <p className="fila-helper" role="status">{ativo.etapa || (ativo.status === 'planned' ? 'Preparando a produção da mídia…' : 'Produzindo e revisando a mídia…')}</p>}
        {!ativo && suporteConhecido && (suporteImagem || suporteVideo) && <div className="fila-media-job-choice">
          <label className="fila-importar-imagem"><strong>Usar imagem pronta</strong><span className="fila-importar-botao">{busy ? 'Enviando para revisão…' : 'Selecionar imagem'}</span><input aria-label="Selecionar imagem pronta para revisão" data-testid="fila-importar-imagem" type="file" accept="image/png,image/jpeg" disabled={busy || !suporteImagem} onChange={(evento) => { void importarImagem(evento.target.files?.[0]); evento.target.value = '' }} /><small>Inclui imagens criadas diretamente no Codex. PNG ou JPEG, até 4 MB; a Fila verifica a adequação ao post.</small></label><div className="fila-media-job-tabs"><button className={`fila-button ${tipo === 'imagem' ? 'fila-button--accent' : ''}`} type="button" disabled={!suporteImagem} onClick={() => setTipo('imagem')}>Gerar imagem</button><button className={`fila-button ${tipo === 'video' ? 'fila-button--accent' : ''}`} type="button" disabled={!suporteVideo} onClick={() => setTipo('video')}>Criar vídeo</button></div>
          {tipo === 'imagem' && <div className="fila-media-job-form"><p className="fila-helper">A história e suas evidências orientam a imagem. Use o briefing para dizer o que precisa aparecer ou quais limites visuais respeitar.</p><label className="fila-media-job-briefing">Briefing opcional<textarea rows={2} value={briefing} onChange={(evento) => setBriefing(evento.target.value)} placeholder="Restrições ou contexto visual" /></label><label>Provedor<select value={provedores} onChange={(evento) => setProvedores(evento.target.value as 'grok' | 'codex')}><option value="grok">Grok</option><option value="codex">Codex · imagem</option></select></label><button className="fila-button fila-button--accent" type="button" disabled={!podeIniciar} onClick={() => void iniciar()}>{busy ? 'Iniciando…' : 'Gerar imagem'}</button></div>}
          {tipo === 'video' && <div className="fila-media-job-form"><p className="fila-helper">Monta um vídeo curto, sem narração, com as imagens desta peça. Cada cena passa pela revisão visual antes de entrar na fila.</p>{!item.midias.some(m => m.tipo === 'imagem') && <p className="fila-card-warning">Prepare ou importe uma imagem acima para começar.</p>}<button className="fila-button fila-button--accent" type="button" disabled={!podeIniciar} onClick={() => void iniciar()}>{busy ? 'Iniciando…' : 'Criar vídeo com estas imagens'}</button></div>}
        </div>}
      </div>
    </details>
  )
}
