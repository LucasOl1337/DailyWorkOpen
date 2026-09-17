import { descreverProveniencia } from '../../lib/proveniencia'
import { ESTADOS, exclusaoBloqueadaNaFila, nomesConta, rotuloIdioma, useCapaMidia, useElementoVisivel } from './comum'
import type { ItemEditorial } from '../../lib/editorial'
import type { Tom } from '../../lib/estado-global'
import { Botao, Chip } from '../ui/ui'

const TOM: Record<string, Tom> = { pendente: 'ok', agendado: 'info', aguardando_executor: 'info', publicando: 'info', publicado: 'ok', recusado: 'atencao', erro: 'erro' }

// Peça da fila como uma linha densa: capa pequena, título, rede e idioma, estado, quando e a
// ação. Quatro versões da mesma pauta ficam empilhadas em vez de quatro cards iguais.
export function LinhaPeca({ item, jobAtivo, pronta, podePublicar, busy, onAbrir, onPublicar, onApagar, confirmandoApagar, modoSelecao, selecionado, destacado, onSelecionar }: { item: ItemEditorial; jobAtivo: boolean; pronta: boolean; podePublicar: boolean; busy: boolean; onAbrir: () => void; onPublicar: () => void; onApagar: () => void; confirmandoApagar: boolean; modoSelecao: boolean; selecionado: boolean; destacado?: boolean; onSelecionar: (selecionado: boolean) => void }) {
  const { ref, visivel } = useElementoVisivel<HTMLDivElement>()
  const { midia, src, falhou } = useCapaMidia(item, visivel)
  const ehVideo = Boolean(midia && (midia.tipo === 'video' || midia.mime?.startsWith('video/')))
  const comArte = Boolean(midia && src && !falhou)
  const prova = descreverProveniencia(item)
  const exclusaoBloqueada = exclusaoBloqueadaNaFila(item)
  const estadoNome = ESTADOS.find((estado) => estado.id === item.estado)?.nome || item.estado
  const erro = typeof item.erro === 'string' ? item.erro : item.erro?.mensagem
  return (
    <div ref={ref} className={`fila-linha ${selecionado ? 'is-selected' : ''} ${destacado ? 'is-destacado' : ''}`} data-pauta-id={item.pautaId} data-testid={`fila-card-${item.id}`}>
      {modoSelecao && <label className="fila-linha-selecao" title={exclusaoBloqueada ? 'Cancele o envio antes de excluir este item.' : 'Selecionar para exclusão'}>
        <input type="checkbox" checked={selecionado} disabled={exclusaoBloqueada} aria-label={`Selecionar ${item.titulo || 'peça sem título'}`} onChange={(evento) => onSelecionar(evento.target.checked)} />
      </label>}
      <button type="button" className="fila-linha-capa" aria-label={`Revisar ${item.titulo || 'peça sem título'}`} onClick={modoSelecao && !exclusaoBloqueada ? () => onSelecionar(!selecionado) : onAbrir}>
        {comArte ? (ehVideo ? <video src={src} muted playsInline preload="metadata" /> : <img src={src} alt="" />) : <span className="fila-linha-capa-texto">{(item.texto || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sem mídia'}</span>}
        {jobAtivo && <span className="fila-linha-capa-job" title="Mídia em produção" />}
      </button>
      <button type="button" className="fila-linha-titulo" onClick={modoSelecao && !exclusaoBloqueada ? () => onSelecionar(!selecionado) : onAbrir}>
        <strong>{item.titulo || 'Sem título'}</strong>
        <small>{prova.quando ? `Produzido ${prova.quando}` : 'Produção sem horário'}{prova.base ? ` · ${prova.base}` : ''}{erro ? ` · ${erro}` : ''}</small>
      </button>
      <span className="fila-linha-chips"><Chip>{nomesConta[item.conta] || item.conta}</Chip><Chip>{rotuloIdioma(item.idioma)}</Chip><Chip>{item.formato}</Chip></span>
      <span><Chip tone={pronta ? 'ok' : TOM[item.estado] || 'neutro'}>{pronta ? 'Pronta' : estadoNome}</Chip></span>
      <span className="fila-linha-acoes">
        {podePublicar && <Botao kind="primary" data-testid={`fila-aprovar-publicar-${item.id}`} disabled={busy} title="Seu clique aprova esta revisão e inicia a publicação imediatamente" onClick={onPublicar}>{busy ? 'Publicando…' : 'Aprovar e publicar'}</Botao>}
        <Botao kind="ghost" onClick={onAbrir}>Ver e editar</Botao>
        {!modoSelecao && <Botao kind="danger" data-testid={`fila-apagar-${item.id}`} disabled={busy || exclusaoBloqueada} title={exclusaoBloqueada ? 'Cancele o envio antes de apagar esta versão.' : confirmandoApagar ? 'Confirma: esta versão sai da fila e vai para o arquivo.' : 'Tira esta versão da fila. Dá para recuperar no arquivo.'} onClick={onApagar}>{busy && confirmandoApagar ? 'Apagando…' : confirmandoApagar ? 'Confirmar' : 'Apagar'}</Botao>}
      </span>
    </div>
  )
}
