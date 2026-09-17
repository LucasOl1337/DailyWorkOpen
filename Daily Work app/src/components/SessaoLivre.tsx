import { registrarCanvasAgentes } from '../lib/canvas-agentes'
import { useEffect, useRef } from 'react'
import { Editor, getSnapshot, loadSnapshot, Tldraw } from 'tldraw'
import { carregarSessao, salvarSessao } from '../lib/api'
import { TLDRAW_ASSETS } from '../lib/tldraw-assets'

// Sessão livre: tldraw puro para anotações soltas. O canvas inteiro é salvo
// como snapshot JSON nativo em sessoes/<id>.tldr (debounced a cada mudança,
// com flush ao trocar de aba).
export function SessaoLivre({ sessaoId }: { sessaoId: string }) {
  const editorRef = useRef<Editor | null>(null)
  const salvando = useRef<number | null>(null)
  const carregando = useRef(true)

  // Flush ao desmontar (troca de aba): não perde o que estava no debounce.
  useEffect(() => {
    return () => {
      const e = editorRef.current
      if (!e || carregando.current) return
      if (salvando.current) window.clearTimeout(salvando.current)
      salvarSessao(sessaoId, getSnapshot(e.store)).catch((err) =>
        console.error(`Falha ao salvar sessão ${sessaoId}:`, err)
      )
    }
  }, [sessaoId])

  async function persistir(editor: Editor) {
    if (salvando.current) { window.clearTimeout(salvando.current); salvando.current = null }
    await salvarSessao(sessaoId, getSnapshot(editor.store))
  }

  function aoMontar(editor: Editor) {
    editorRef.current = editor
    carregando.current = true

    carregarSessao(sessaoId)
      .then((snapshot) => {
        if (snapshot) {
          loadSnapshot(editor.store, snapshot as never)
          editor.updateInstanceState({
            isReadonly: editor.getDocumentSettings().meta.apresentacao === true,
          })
          editor.zoomToFit({ animation: { duration: 0 } })
        }
      })
      .then(() => {
        if (editor.isDisposed) return
        carregando.current = false
        const cancelar = registrarCanvasAgentes(editor, `sessao:${sessaoId}`, () => persistir(editor))
        editor.once('dispose', cancelar)
      })
      .catch((err) => console.error(`Falha ao carregar sessão ${sessaoId}:`, err))

    editor.store.listen(
      () => {
        if (carregando.current) return
        if (salvando.current) window.clearTimeout(salvando.current)
        salvando.current = window.setTimeout(() => {
          salvarSessao(sessaoId, getSnapshot(editor.store)).catch((err) =>
            console.error(`Falha ao salvar sessão ${sessaoId}:`, err)
          )
        }, 600)
      },
      { source: 'user', scope: 'document' }
    )
  }

  return (
    <div style={{ position: 'absolute', inset: '62px 0 0' }}>
      <Tldraw assetUrls={TLDRAW_ASSETS} onMount={aoMontar} />
    </div>
  )
}
