import { useEffect, useState } from 'react'
import { lerMidiaEditorial, type ItemEditorial } from '../../lib/editorial'

export function MediaPreview({ item, midia }: { item: ItemEditorial; midia: ItemEditorial['midias'][number] }) {
  const [src, setSrc] = useState('')
  const [erro, setErro] = useState('')
  const [ampliada, setAmpliada] = useState(false)

  useEffect(() => {
    let ativo = true
    setSrc('')
    setErro('')
    lerMidiaEditorial(item.id, midia.id)
      .then((url) => ativo && setSrc(url))
      .catch(() => ativo && setErro('Não foi possível carregar esta mídia.'))
    return () => {
      ativo = false
    }
  }, [item.id, midia.id])

  if (erro) return <p className="fila-media-error">{erro}</p>
  if (!src) return <p className="fila-media-loading">Carregando mídia…</p>
  const ehVideo = midia.tipo === 'video' || midia.mime?.startsWith('video/')
  return <div className={`fila-media-preview-wrap ${ampliada ? 'is-expanded' : ''}`}>
    {ehVideo ? <video className="fila-media-preview" controls src={src} preload="metadata" /> : <img className="fila-media-preview" src={src} alt="Mídia anexada à publicação" />}
    <button className="fila-button fila-button--quiet fila-media-expand" type="button" aria-expanded={ampliada} onClick={() => setAmpliada((atual) => !atual)}>{ampliada ? 'Fechar prévia' : 'Ampliar prévia'}</button>
  </div>
}
