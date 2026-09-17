import { useEffect, useRef, useState } from 'react'
import { AgendaModulo } from './AgendaModulo'
import { navegarPara, type AlvoPendencia } from '../lib/destinos'
import { useEstadoGlobal } from '../lib/estado-global'

export function ResolucaoPendencias() {
  const [aberta, setAberta] = useState<{ titulo: string; alvo?: Extract<AlvoPendencia, { tipo: 'agenda' }> } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const global = useEstadoGlobal()
  useEffect(() => {
    const resolver = (e: Event) => {
      const p = (e as CustomEvent<{ titulo: string; alvo: AlvoPendencia }>).detail
      if (p?.alvo?.tipo === 'agenda') setAberta({ titulo: p.titulo.replace(/: parou$/, ''), alvo: p.alvo })
      else if (p?.alvo?.tipo === 'secao') navegarPara(p.alvo)
    }
    const agenda = () => setAberta({ titulo: 'Agenda · todos os módulos' })
    const navegar = () => setAberta(null)
    window.addEventListener('app:resolver', resolver)
    window.addEventListener('agenda:abrir', agenda)
    window.addEventListener('app:navegar', navegar)
    window.addEventListener('agenda:navegar', navegar)
    return () => {
      window.removeEventListener('app:resolver', resolver)
      window.removeEventListener('agenda:abrir', agenda)
      window.removeEventListener('app:navegar', navegar)
      window.removeEventListener('agenda:navegar', navegar)
    }
  }, [])
  useEffect(() => { if (aberta && !dialog.current?.open) dialog.current?.showModal(); else if (!aberta) dialog.current?.close() }, [aberta])
  return <dialog className="dw-resolver-dialog" ref={dialog} aria-labelledby="resolver-titulo" onCancel={() => setAberta(null)} onClose={() => { setAberta(null); void global.atualizar() }}>
    {aberta && <><header><h2 id="resolver-titulo">{aberta.titulo}</h2><button type="button" className="dw-btn" onClick={() => setAberta(null)}>Fechar</button></header>
      <AgendaModulo key={aberta.alvo?.ocorrenciaId || 'todos'} modulo={aberta.alvo?.modulo} ocorrenciaId={aberta.alvo?.ocorrenciaId} diaInicial={aberta.alvo?.dia} />
    </>}
  </dialog>
}
