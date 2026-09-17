import { useEffect, useMemo, useRef, useState } from 'react'
import { obterFonteAutomacao, salvarSelecaoAutomacoes } from '../../lib/api'
import type { BibliotecaAutomacao, ConteudoFonteAutomacao } from '../../lib/automacoes'
import { TextoFonte } from './Contexto'

export function Biblioteca({ campanhaId, biblioteca, atualizar, alterada }: { campanhaId: string; biblioteca: BibliotecaAutomacao; atualizar: (b: BibliotecaAutomacao) => void; alterada: (valor: boolean) => void }) {
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('Todas')
  const [somenteBase, setSomenteBase] = useState(false)
  const [mostrarFontes, setMostrarFontes] = useState(() => window.matchMedia('(min-width: 1001px)').matches)
  const leitor = useRef<HTMLElement>(null)
  const [selecionadas, setSelecionadas] = useState(biblioteca.config.fontes)
  const [selecaoSalva, setSelecaoSalva] = useState(biblioteca.config)
  const [fonteId, setFonteId] = useState(biblioteca.config.fontes[0] || biblioteca.fontes[0]?.id || '')
  const [fonte, setFonte] = useState<ConteudoFonteAutomacao | null>(null)
  const [erroFonte, setErroFonte] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const modificada = JSON.stringify([...selecionadas].sort()) !== JSON.stringify([...selecaoSalva.fontes].sort())
  const conflito = biblioteca.config.revisao !== selecaoSalva.revisao
  useEffect(() => { alterada(modificada) }, [modificada, alterada])
  useEffect(() => {
    if (!modificada) { setSelecionadas(biblioteca.config.fontes); setSelecaoSalva(biblioteca.config) }
  }, [biblioteca.config.revisao, modificada])
  const versaoFonte = biblioteca.fontes.find(f => f.id === fonteId)?.hash
  useEffect(() => {
    let viva = true
    setFonte(null); setErroFonte('')
    if (fonteId) obterFonteAutomacao(fonteId, campanhaId).then(f => { if (viva) setFonte(f) }).catch(e => { if (viva) setErroFonte(e.message) })
    return () => { viva = false }
  }, [fonteId, versaoFonte])
  const filtradas = useMemo(() => biblioteca.fontes.filter(f => (!somenteBase || selecionadas.includes(f.id)) && (categoria === 'Todas' || f.categoria === categoria) && `${f.titulo} ${f.caminho}`.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))), [biblioteca.fontes, categoria, busca, somenteBase, selecionadas])
  function ler(id: string) {
    setFonteId(id)
    if (window.matchMedia('(max-width: 1000px)').matches) setMostrarFontes(false)
    requestAnimationFrame(() => {
      leitor.current?.scrollIntoView({ block: 'start' })
      leitor.current?.focus({ preventScroll: true })
    })
  }
  async function salvar() {
    setSalvando(true); setErro(''); setAviso('')
    try {
      const nova = await salvarSelecaoAutomacoes({ fontes: selecionadas, revisao: selecaoSalva.revisao }, campanhaId)
      setSelecionadas(nova.config.fontes); setSelecaoSalva(nova.config); atualizar(nova)
      setAviso('Seleção salva. As próximas gerações e ciclos usarão esta base.')
    }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }
  return <div className={`auto-library ${mostrarFontes ? 'has-index' : 'is-reading'}`} data-testid="automacoes-biblioteca">
    <div className="auto-library-toolbar"><button type="button" className="auto-button" aria-expanded={mostrarFontes} aria-controls="auto-library-index" onClick={() => setMostrarFontes(atual => !atual)}>{mostrarFontes ? 'Ocultar fontes' : `Escolher fonte · ${biblioteca.fontes.length}`}</button><span>{selecionadas.length} fontes na base{modificada ? ' · alterações pendentes' : ''}</span>{!mostrarFontes && modificada && <button className="auto-button auto-button--primary" disabled={salvando || conflito || !selecionadas.length} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar seleção'}</button>}</div>
    <aside id="auto-library-index" className="auto-library-index" aria-label="Fontes disponíveis" hidden={!mostrarFontes}>
      <div className="auto-index-header"><h2>Sua biblioteca</h2><p>Abra para ler. Marque para usar na campanha.</p></div>
      <div className="auto-segmented auto-source-scope" role="group" aria-label="Filtrar fontes"><button type="button" aria-pressed={!somenteBase} onClick={() => setSomenteBase(false)}>Todas · {biblioteca.fontes.length}</button><button type="button" aria-pressed={somenteBase} onClick={() => setSomenteBase(true)}>Na base · {selecionadas.length}</button></div>
      <div className="auto-library-filters"><label className="auto-field">Buscar<input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar fontes…" /></label>
      <label className="auto-field">Categoria<select value={categoria} onChange={e => setCategoria(e.target.value)}><option>Todas</option>{[...new Set(biblioteca.fontes.map(f => f.categoria))].map(c => <option key={c}>{c}</option>)}</select></label></div>
      <ul className="auto-source-list">
        {filtradas.map(f => <li className={fonteId === f.id ? 'is-selected' : ''} key={f.id}>
          <input type="checkbox" checked={selecionadas.includes(f.id)} disabled={salvando} aria-label={`Incluir ${f.titulo} no contexto`} onChange={e => setSelecionadas(atual => e.target.checked ? [...atual, f.id] : atual.filter(id => id !== f.id))} />
          <button type="button" onClick={() => ler(f.id)} aria-pressed={fonteId === f.id}><strong>{f.titulo}</strong><span className="auto-source-category">{f.categoria} · {f.formato.toUpperCase()}</span></button>
        </li>)}
      </ul>
      {!filtradas.length && <p className="auto-empty">Nenhuma fonte corresponde à busca.</p>}
      {biblioteca.ausentes.length > 0 && <div className="auto-notice auto-notice--error" role="alert"><strong>Fontes removidas do disco</strong>{biblioteca.ausentes.map(id => <label key={id}><input type="checkbox" checked={selecionadas.includes(id)} onChange={() => setSelecionadas(atual => atual.filter(f => f !== id))} />{id}</label>)}<p>Retire as fontes ausentes da seleção para continuar.</p></div>}
      {conflito && modificada && <p className="auto-notice" role="status">A seleção mudou em outra janela. Suas marcações foram mantidas. <button className="auto-text-button" onClick={() => { setSelecionadas(biblioteca.config.fontes); setSelecaoSalva(biblioteca.config); setErro('') }}>Descartar marcações e carregar seleção atual</button></p>}
      <div className="auto-selection-footer"><strong>{modificada ? 'Alterações pendentes' : 'Seleção salva'}</strong>{modificada && <button className="auto-button auto-button--primary" disabled={salvando || conflito || !selecionadas.length} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar seleção'}</button>}</div>
      {erro && <p className="auto-notice auto-notice--error" role="alert">{erro}</p>}{aviso && <p className="auto-notice" role="status">{aviso}</p>}
    </aside>
    {!mostrarFontes && (erro || aviso || conflito && modificada) && <div className="auto-library-feedback">{erro && <p className="auto-notice auto-notice--error" role="alert">{erro}</p>}{aviso && <p className="auto-notice" role="status">{aviso}</p>}{conflito && modificada && <p className="auto-notice">A seleção mudou em outra janela. Abra as fontes para conferir suas marcações.</p>}</div>}
    <article ref={leitor} tabIndex={-1} className="auto-source-reader" aria-label="Leitura da fonte" aria-busy={Boolean(fonteId && !fonte && !erroFonte)}>
      {erroFonte ? <p className="auto-notice auto-notice--error" role="alert">{erroFonte}</p> : fonte ? <>
        <header><div className="auto-reader-meta"><span>{fonte.categoria}</span><span>{selecionadas.includes(fonte.id) ? '✓ Na base da campanha' : 'Fora da base'}</span></div><h2>{fonte.titulo}</h2><p className="auto-muted">Atualizada em {new Date(fonte.atualizadoEm).toLocaleDateString('pt-BR')}{fonte.formato === 'pdf' ? ' · texto extraído do PDF' : ''}</p></header>
        <TextoFonte key={`${fonte.id}:${fonte.hash}`} texto={fonte.conteudo.replace(/^# [^\n]+\n/, '')} organizada />
        <details key={fonte.id} className="auto-source-snapshot"><summary>Detalhes do arquivo e original</summary><p className="auto-file-path">{fonte.caminho}</p><p className="auto-muted">{fonte.caracteres.toLocaleString('pt-BR')} caracteres</p><p className="auto-file-path">SHA-256: {fonte.hash}</p><pre className="auto-code">{fonte.conteudo}</pre></details>
      </> : <div className="auto-empty">{fonteId ? 'Lendo a fonte…' : 'Selecione uma fonte para começar.'}</div>}
    </article>
  </div>
}
