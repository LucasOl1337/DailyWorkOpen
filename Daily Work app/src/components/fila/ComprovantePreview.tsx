import { useEffect, useState } from 'react'
import { lerComprovanteEditorial } from '../../lib/editorial'

export function ComprovantePreview({ id, compacto = false, onAmpliar }: { id: string; compacto?: boolean; onAmpliar?: (src: string) => void }) {
  const [src, setSrc] = useState('')
  const [erro, setErro] = useState('')
  const [ampliado, setAmpliado] = useState(false)
  useEffect(() => {
    let ativo = true
    setSrc('')
    setErro('')
    lerComprovanteEditorial(id)
      .then((url) => ativo && setSrc(url))
      .catch(() => ativo && setErro('Não foi possível carregar o comprovante.'))
    return () => { ativo = false }
  }, [id])
  if (erro) return <p className="fila-media-error">{erro}</p>
  if (!src) return <p className="fila-media-loading">Carregando comprovante…</p>
  return (
    <>
      <button type="button" className={`fila-comprovante ${compacto ? 'fila-comprovante--mini' : ''}`} onClick={() => onAmpliar ? onAmpliar(src) : setAmpliado(true)}>
        <img src={src} alt="Comprovante da publicação" />
        {!compacto && <span>Ampliar comprovante</span>}
      </button>
      {ampliado && (
        <div className="fila-lightbox" role="dialog" aria-label="Comprovante ampliado" onClick={() => setAmpliado(false)}>
          <img src={src} alt="Comprovante da publicação" />
        </div>
      )}
    </>
  )
}
