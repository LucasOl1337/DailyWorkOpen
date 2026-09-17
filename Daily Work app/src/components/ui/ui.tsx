import type { ReactNode, ButtonHTMLAttributes } from 'react'
import type { Tom } from '../../lib/estado-global'
import './ui.css'

// Vocabulário visual único das telas operacionais: chip de estado, faixa de status, KPI,
// bloco, tabela densa e feed. Um formato por conceito, reutilizado igual em toda tela.
const ICONES: Record<string, string> = {
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
}
export function Icone({ nome, tamanho = 15 }: { nome: string; tamanho?: number }) {
  return <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONES[nome] || '' }} />
}

export function Chip({ tone = 'neutro', children, title }: { tone?: Tom; children: ReactNode; title?: string }) {
  return <span className={`dw-chip dw-chip--${tone}`} title={title}>{children}</span>
}

export function Botao({ kind = 'secondary', icone, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; icone?: string }) {
  return <button type="button" className={`dw-btn dw-btn--${kind} ${className}`} {...rest}>{icone && <Icone nome={icone} tamanho={14} />}<span>{children}</span></button>
}

export function Faixa({ tone, children, acoes, detalhe }: { tone: Exclude<Tom, 'neutro' | 'ativo'>; children: ReactNode; acoes?: ReactNode; detalhe?: string }) {
  const icone = tone === 'ok' ? 'check' : tone === 'info' ? 'refresh' : 'alert'
  return <div className={`dw-faixa dw-faixa--${tone}`} role={tone === 'ok' || tone === 'info' ? 'status' : 'alert'}>
    <Icone nome={icone} />
    <div className="dw-faixa-texto">{children}{detalhe && <details className="dw-faixa-detalhe"><summary>Detalhe técnico</summary><code>{detalhe}</code></details>}</div>
    {acoes && <div className="dw-faixa-acoes">{acoes}</div>}
  </div>
}

export function Kpi({ valor, rotulo, tone }: { valor: ReactNode; rotulo: string; tone?: 'ok' | 'atencao' }) {
  return <div className={`dw-kpi ${tone ? 'dw-kpi--' + tone : ''}`}><strong>{valor}</strong><span>{rotulo}</span></div>
}

export function Bloco({ titulo, aside, children, className = '', scroll, id }: { id?: string; titulo?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; scroll?: boolean }) {
  return <section id={id} className={`dw-bloco ${scroll ? 'dw-bloco--scroll' : ''} ${className}`}>
    {titulo !== undefined && <header className="dw-bloco-head"><div className="dw-bloco-titulo">{titulo}</div>{aside && <div className="dw-bloco-aside">{aside}</div>}</header>}
    <div className="dw-bloco-corpo">{children}</div>
  </section>
}

export interface Coluna<T> { chave: string; titulo: string; largura: string; render: (linha: T) => ReactNode; alinhar?: 'right' }
export function Tabela<T>({ colunas, linhas, chave, aoClicar, selecionada, vazio }: { colunas: Coluna<T>[]; linhas: T[]; chave: (l: T) => string; aoClicar?: (l: T) => void; selecionada?: string | null; vazio?: string }) {
  const grade = colunas.map(c => c.largura).join(' ')
  return <div className="dw-tabela" role="table">
    <div className="dw-tabela-head" role="row" style={{ gridTemplateColumns: grade }}>{colunas.map(c => <div key={c.chave} role="columnheader" className={c.alinhar === 'right' ? 'is-right' : ''}>{c.titulo}</div>)}</div>
    {linhas.length ? linhas.map(l => {
      const id = chave(l)
      return <div key={id} role="row" className={`dw-tabela-row ${selecionada === id ? 'is-selected' : ''} ${aoClicar ? 'is-clickable' : ''}`} style={{ gridTemplateColumns: grade }} onClick={aoClicar ? () => aoClicar(l) : undefined}>
        {colunas.map(c => <div key={c.chave} role="cell" className={c.alinhar === 'right' ? 'is-right' : ''}>{c.render(l)}</div>)}
      </div>
    }) : <p className="dw-vazio">{vazio || 'Nada por aqui.'}</p>}
  </div>
}

export function Feed({ itens, vazio }: { itens: { em: number | string; rotulo?: string; titulo: string; sub?: string; tone: Tom }[]; vazio?: string }) {
  const hora = (v: number | string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  if (!itens.length) return <p className="dw-vazio">{vazio || 'Nenhuma atividade ainda.'}</p>
  return <ol className="dw-feed">{itens.map((i, n) => <li key={n} className={`dw-feed-item dw-feed-item--${i.tone}`}><time>{hora(i.em)}</time><span className="dw-feed-ponto" /><div><div className="dw-feed-titulo">{i.rotulo && <span className="dw-feed-modulo">{i.rotulo} · </span>}{i.titulo}</div>{i.sub && <div className="dw-feed-sub">{i.sub}</div>}</div></li>)}</ol>
}

export function Pagina({ titulo, eyebrow, acoes, children, chips }: { titulo: ReactNode; eyebrow?: string; acoes?: ReactNode; chips?: ReactNode; children: ReactNode }) {
  return <div className="dw-pagina">
    <header className="dw-pagina-head">
      <div className="dw-pagina-titulo">{eyebrow && <span className="dw-eyebrow">{eyebrow}</span>}<h1>{titulo}</h1></div>
      {chips && <div className="dw-pagina-chips">{chips}</div>}
      {acoes && <div className="dw-pagina-acoes">{acoes}</div>}
    </header>
    <div className="dw-pagina-corpo">{children}</div>
  </div>
}
