import { useEffect, useMemo, useState } from 'react'
import {
  capturarComprovanteEditorial,
  listarHistoricoEditorial,
  type ContaEditorial,
  type EntradaHistoricoEditorial,
  type IdiomaEditorial,
} from '../../lib/editorial'
import { CONTAS, diaHistorico, erroTexto, formatarDataHora, nomesConta, rotuloIdioma } from './comum'
import { ComprovantePreview } from './ComprovantePreview'

export function Historico({
  onAbrir,
  onError,
}: {
  onAbrir: (entrada: EntradaHistoricoEditorial) => void
  onError: (mensagem: string) => void
}) {
  const [itens, setItens] = useState<EntradaHistoricoEditorial[]>([])
  const [conta, setConta] = useState<ContaEditorial | ''>('')
  const [desde, setDesde] = useState('')
  const [ate, setAte] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [capturando, setCapturando] = useState('')
  const [lightbox, setLightbox] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      setItens(await listarHistoricoEditorial({
        ...(conta ? { conta } : {}),
        ...(desde ? { desde } : {}),
        ...(ate ? { ate } : {}),
      }))
    } catch (erro) {
      onError(erroTexto(erro).mensagem)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { void carregar() }, [conta, desde, ate])

  const grupos = useMemo(() => {
    const mapa = new Map<string, EntradaHistoricoEditorial[]>()
    for (const item of itens) {
      const chave = diaHistorico(item.publishedAt)
      const lista = mapa.get(chave) || []
      lista.push(item)
      mapa.set(chave, lista)
    }
    return [...mapa.entries()]
  }, [itens])

  async function capturar(id: string) {
    setCapturando(id)
    try {
      await capturarComprovanteEditorial(id)
      await carregar()
    } catch (erro) {
      onError(erroTexto(erro).mensagem)
    } finally {
      setCapturando('')
    }
  }

  return (
    <section className="fila-historico" aria-labelledby="fila-historico-titulo">
      <div className="fila-lista-heading">
        <div>
          <p className="fila-eyebrow">Evidência de publicação</p>
          <h2 id="fila-historico-titulo">Publicados</h2>
        </div>
      </div>
      <div className="fila-filtros fila-filtros--historico">
        <label>Rede<select value={conta} onChange={(evento) => setConta(evento.target.value as ContaEditorial | '')}><option value="">Todas</option>{CONTAS.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label>Desde<input type="date" value={desde} onChange={(evento) => setDesde(evento.target.value)} /></label>
        <label>Até<input type="date" value={ate} onChange={(evento) => setAte(evento.target.value)} /></label>
        <button className="fila-button fila-button--quiet" type="button" onClick={() => void carregar()}>Atualizar</button>
      </div>
      {carregando ? <div className="fila-empty"><strong>Carregando o histórico…</strong></div> : grupos.length === 0 ? <div className="fila-empty"><strong>Ainda não há publicações neste recorte.</strong><span>Quando um post sair, o comprovante aparece aqui.</span></div> : grupos.map(([dia, lista]) => (
        <section className="fila-historico-dia" key={dia}>
          <h3>{dia}</h3>
          <ol className="fila-historico-lista">
            {lista.map((item) => (
              <li key={item.id} className="fila-historico-item">
                <div className="fila-historico-capa">
                  {item.comprovante
                    ? <ComprovantePreview id={item.id} compacto onAmpliar={setLightbox} />
                    : item.midias[0]
                      ? <span className="fila-historico-sem-prova">Com imagem enviada · sem screenshot</span>
                      : <span className="fila-historico-sem-prova">{item.texto.slice(0, 140) || item.titulo}</span>}
                </div>
                <div className="fila-historico-corpo">
                  <p className="fila-historico-meta">
                    <span className="fila-capa-chip">{nomesConta[item.conta] || item.conta}</span>
                    <span className="fila-capa-chip">{rotuloIdioma(item.idioma as IdiomaEditorial)}</span>
                    <time>{formatarDataHora(item.publishedAt)}</time>
                    {item.arquivado && <span className="fila-capa-chip">arquivo</span>}
                  </p>
                  <button type="button" className="fila-historico-titulo" onClick={() => onAbrir(item)}>{item.titulo || 'Sem título'}</button>
                  <p>{item.texto.replace(/\s+/g, ' ').slice(0, 180)}</p>
                  <div className="fila-action-row">
                    {item.url && <a className="fila-button" href={item.url} target="_blank" rel="noreferrer">Abrir post</a>}
                    {item.comprovante && <button className="fila-button fila-button--quiet" type="button" onClick={() => onAbrir(item)}>Ver peça</button>}
                    {!item.comprovante && <button className="fila-button fila-button--accent" type="button" disabled={capturando === item.id} onClick={() => void capturar(item.id)}>{capturando === item.id ? 'Capturando…' : 'Capturar comprovante'}</button>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {lightbox && (
        <div className="fila-lightbox" role="dialog" aria-label="Comprovante ampliado" onClick={() => setLightbox('')}>
          <img src={lightbox} alt="Comprovante da publicação" />
        </div>
      )}
    </section>
  )
}
