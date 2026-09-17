import { useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ContextoAutomacao } from '../../lib/automacoes'
import { leituraPorAssunto, minutosLeitura } from '../../lib/leitura-documento'

export function TextoFonte({ texto, organizada = false }: { texto: string; organizada?: boolean }) {
  const [completo, setCompleto] = useState(false)
  const id = useId()
  const longa = organizada && texto.length > 1400
  return <div className="auto-reading">
    {longa && <div className="auto-reading-toolbar">
      <div><strong>Neste documento</strong><span>Cerca de {minutosLeitura(texto)} min no total</span></div>
      <div className="auto-segmented" role="group" aria-label="Modo de leitura">
        <button type="button" aria-pressed={!completo} aria-controls={id} onClick={() => setCompleto(false)}>Por assunto</button>
        <button type="button" aria-pressed={completo} aria-controls={id} onClick={() => setCompleto(true)}>Texto completo</button>
      </div>
    </div>}
    <div id={id} className="auto-markdown"><ReactMarkdown key={String(completo)} remarkPlugins={longa && !completo ? [remarkGfm, leituraPorAssunto] : [remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{texto}</ReactMarkdown></div>
  </div>
}

export function ContextoDialog({ contexto, fechar }: { contexto: ContextoAutomacao; fechar: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return (
    <dialog ref={dialog} className="auto-dialog" onCancel={fechar} onClick={e => { if (e.target === e.currentTarget) fechar() }} aria-labelledby="auto-contexto-titulo">
      <header className="auto-dialog-header">
        <div><span className="auto-eyebrow">Rastreabilidade</span><h2 id="auto-contexto-titulo">Contexto preservado</h2></div>
        <button className="auto-button" onClick={fechar} autoFocus>Fechar</button>
      </header>
      <div className="auto-dialog-body">
        <p>{contexto.fontes.length} fontes · {contexto.caracteres.toLocaleString('pt-BR')} caracteres · {new Date(contexto.criadoEm).toLocaleString('pt-BR')}</p>
        <p className="auto-muted">{contexto.tipo === 'ciclo' ? 'Esta é a base inicial do ciclo. Páginas consultadas depois aparecem no registro de cada interação. O Codex também carrega as instruções do ambiente.' : 'Esta cópia é a base enviada ao modelo. Edições posteriores da biblioteca não alteram este contexto.'}</p>
        {contexto.fontes.map(f => <details className="auto-source-snapshot" key={f.id}>
          <summary>{f.titulo}<span>{f.formato.toUpperCase()} · versão {f.hash.slice(0, 10)}</span></summary>
          <p className="auto-file-path">{f.caminho}</p><TextoFonte texto={f.conteudo} organizada />
        </details>)}
        <details className="auto-source-snapshot"><summary>Instruções e pedido completos<span>Hash {contexto.hash.slice(0, 12)}</span></summary>
          {contexto.mensagens.map((m, i) => <section key={i}><h3>{m.role === 'system' ? 'Instruções' : 'Pedido e dados'}</h3><pre className="auto-code">{m.content}</pre></section>)}
        </details>
      </div>
    </dialog>
  )
}
