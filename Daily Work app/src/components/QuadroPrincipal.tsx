import { registrarCanvasAgentes } from '../lib/canvas-agentes'
import { carregarCanvasPrincipal, salvarCanvasPrincipal } from '../lib/canvas-principal'
import { useEffect, useRef, useState } from 'react'
import { Box, createShapeId, Editor, TLShape, Tldraw } from 'tldraw'
import { type Bloco, type TipoBloco } from '../lib/md'
import { TLDRAW_ASSETS } from '../lib/tldraw-assets'
import { ehDestaquePortfolio, enquadrarAreaPortfolio, PREFIXO_PAGINAS_PORTFOLIO, SESSAO_PORTFOLIO } from '../lib/portfolio'
import {
  aoMudarBlocosExternos,
  aoMudarConhecimento,
  listarBlocos,
  listarConhecimento,
  salvarBlocos,
  salvarPosicoesConhecimento,
  removerPosicaoConhecimento,
  excluirNotaConhecimento,
} from '../lib/api'
import {
  carregarBlocosNoCanvas,
  criarBlocoNativo,
  metaDoBloco,
  prepararMidiasDoCanvas,
  snapshotDoCanvas,
} from '../lib/blocos'
import {
  carregarConhecimentoNoCanvas,
  ehShapeDoSistemaPrincipal,
  metaDoConhecimento,
  shapeIdDaNota,
  OFFSET_CONHECIMENTO,
  type CatalogoConhecimento,
} from '../lib/conhecimento'
import { PainelLateral } from './PainelLateral'
import { MenuCriacao } from './MenuCriacao'
import { PrincipalNavigator } from './PrincipalNavigator'
import { PRINCIPAL_SHAPE_UTILS } from './PrincipalShapes'
import { AssistenteDia } from './AssistenteDia'
import './principal.css'

// Guarda de montagem: onMount pode disparar mais de uma vez (remount do React);
// a carga e o listener de sync só podem ser registrados uma vez por editor.
const editoresVistos = new WeakSet<Editor>()

function enquadrarPortfolio(editor: Editor, duracao: number) {
  const blocos = editor.getCurrentPageShapes().filter((shape) => metaDoBloco(shape))
  const destaques = blocos.filter((shape) =>
    ehDestaquePortfolio(metaDoBloco(shape)?.blockId || '')
  )
  const portfolio = blocos.filter((shape) => {
    const id = metaDoBloco(shape)?.blockId || ''
    return !id.startsWith('portfolio-entrevista-') && !id.startsWith('principal-stack-')
  })
  const alvo = destaques.length ? destaques : portfolio.length ? portfolio : blocos
  const bounds = alvo
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((item): item is Box => Boolean(item))
  const comum = bounds.length ? Box.Common(bounds) : null
  if (comum && alvo.some((shape) => metaDoBloco(shape)?.blockId === `${SESSAO_PORTFOLIO}-capa`)) {
    enquadrarAreaPortfolio(editor, comum, duracao)
    return
  }
  const cameraInicial = editor.getCamera()
  editor.zoomToBounds(comum || { x: 600, y: 400, w: 1980, h: 1095 }, { inset: 172 })
  const cameraAlvo = editor.getCamera()
  const alvoComBarraLivre = {
    x: cameraAlvo.x,
    y: cameraAlvo.y + 28 / cameraAlvo.z,
    z: cameraAlvo.z,
  }
  if (duracao > 0) {
    editor.setCamera(cameraInicial)
    editor.setCamera(alvoComBarraLivre, { animation: { duration: duracao } })
  } else {
    editor.setCamera(alvoComBarraLivre)
  }
}

function enquadrarEntrevista(editor: Editor, duracao: number) {
  const bounds = editor
    .getCurrentPageShapes()
    .filter((shape) => metaDoBloco(shape)?.blockId.startsWith('portfolio-entrevista-'))
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((item): item is Box => Boolean(item))
  if (!bounds.length) {
    enquadrarPortfolio(editor, duracao)
    return
  }
  const cameraInicial = editor.getCamera()
  editor.zoomToBounds(Box.Common(bounds), { inset: 172 })
  const cameraAlvo = editor.getCamera()
  const alvoComControlesLivres = {
    x: cameraAlvo.x - 82 / cameraAlvo.z,
    y: cameraAlvo.y + 40 / cameraAlvo.z,
    z: cameraAlvo.z,
  }
  if (duracao > 0) {
    editor.setCamera(cameraInicial)
    editor.setCamera(alvoComControlesLivres, { animation: { duration: duracao } })
  } else {
    editor.setCamera(alvoComControlesLivres)
  }
}

function enquadrarStack(editor: Editor, duracao: number) {
  const bounds = editor
    .getCurrentPageShapes()
    .filter((shape) => {
      const bloco = metaDoBloco(shape)
      return bloco?.blockId.startsWith('principal-stack-')
    })
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((item): item is Box => Boolean(item))
  if (!bounds.length) {
    enquadrarPortfolio(editor, duracao)
    return
  }
  enquadrarComMargens(editor, Box.Common(bounds), duracao)
}

function enquadrarConhecimento(editor: Editor, duracao: number, somentePainel = false) {
  const bounds = editor
    .getCurrentPageShapes()
    .filter((shape) => {
      const conhecimento = metaDoConhecimento(shape)
      if (somentePainel) return conhecimento?.caminho.startsWith('Painel Essencial/')
      return Boolean(conhecimento)
    })
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((item): item is Box => Boolean(item))
  if (!bounds.length) return

  enquadrarComMargens(editor, Box.Common(bounds), duracao)
}

function enquadrarComMargens(editor: Editor, bounds: Box, duracao: number) {
  const viewport = editor.getViewportScreenBounds()
  const margemEsquerda = 16
  const margemDireita = 176
  const margemSuperior = 122
  const margemInferior = 78
  const larguraUtil = Math.max(200, viewport.width - margemEsquerda - margemDireita)
  const alturaUtil = Math.max(200, viewport.height - margemSuperior - margemInferior)
  const zoom = Math.max(
    0.05,
    Math.min(larguraUtil / Math.max(bounds.w, 1), alturaUtil / Math.max(bounds.h, 1), 1)
  )
  const esquerda = margemEsquerda + (larguraUtil - bounds.w * zoom) / 2
  const topo = margemSuperior + (alturaUtil - bounds.h * zoom) / 2
  const cameraInicial = editor.getCamera()
  const alvoComControlesLivres = {
    // Mantém livres a navegação, a paleta nativa e a barra inferior sem
    // alterar as posições persistidas dos cards.
    x: -bounds.x + esquerda / zoom,
    y: -bounds.y + topo / zoom,
    z: zoom,
  }
  if (duracao > 0) {
    editor.setCamera(cameraInicial)
    editor.setCamera(alvoComControlesLivres, { animation: { duration: duracao } })
  } else {
    editor.setCamera(alvoComControlesLivres)
  }
}

// Quadro geral e durável do portfólio. O trabalho diário vive em QuadroDia.
export function QuadroPrincipal({ onAbrirSessao }: { onAbrirSessao: (id: string) => void }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pronto, setPronto] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [painelAberto, setPainelAberto] = useState(false)
  const [assistenteAberto, setAssistenteAberto] = useState(
    () => new URLSearchParams(window.location.search).get('assistente') === 'open'
  )
  const [blocosPrincipal, setBlocosPrincipal] = useState<Bloco[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoConhecimento>({
    disponivel: false,
    raiz: '',
    notas: [],
  })
  const [erroPrincipal, setErroPrincipal] = useState('')
  const [confirmarExclusao, setConfirmarExclusao] = useState<{
    caminho: string
    titulo: string
  } | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const salvando = useRef<number | null>(null)
  const salvandoConhecimento = useRef<number | null>(null)
  const posicoesConhecimentoPendentes = useRef<Record<string, { x: number; y: number }>>({})
  const alteracoesPendentes = useRef(false)
  const persistindo = useRef(false)
  const versaoAlteracoes = useRef(0)
  const carregando = useRef(false)
  const filaCanvas = useRef<Promise<void>>(Promise.resolve())
  const cancelarMudancasExternas = useRef<(() => void) | null>(null)
  const cancelarMudancasConhecimento = useRef<(() => void) | null>(null)

  function agendarPersistenciaConhecimento() {
    if (salvandoConhecimento.current) window.clearTimeout(salvandoConhecimento.current)
    salvandoConhecimento.current = window.setTimeout(async () => {
      salvandoConhecimento.current = null
      const posicoes = { ...posicoesConhecimentoPendentes.current }
      posicoesConhecimentoPendentes.current = {}
      if (Object.keys(posicoes).length > 0) {
        try {
          await salvarPosicoesConhecimento(posicoes)
        } catch (err) {
          console.error('Falha ao salvar posições do conhecimento:', err)
        }
      }
    }, 500)
  }

  async function executarRemoverDoMapa() {
    if (!confirmarExclusao || !editorRef.current) return
    const { caminho } = confirmarExclusao
    try {
      const shape = editorRef.current.getShape(shapeIdDaNota(caminho))
      if (shape) editorRef.current.deleteShapes([shape.id])
      await removerPosicaoConhecimento(caminho)
      setConfirmarExclusao(null)
      await recarregarConhecimento()
    } catch (err) {
      setErroPrincipal(`Erro ao remover do mapa: ${String(err)}`)
    }
  }

  async function executarArquivarNota() {
    if (!confirmarExclusao || !editorRef.current) return
    const { caminho } = confirmarExclusao
    try {
      const shape = editorRef.current.getShape(shapeIdDaNota(caminho))
      if (shape) editorRef.current.deleteShapes([shape.id])
      await excluirNotaConhecimento(caminho)
      setConfirmarExclusao(null)
      await recarregarConhecimento()
    } catch (err) {
      setErroPrincipal(`Erro ao arquivar nota: ${String(err)}`)
    }
  }

  function agendarPersistencia(ed: Editor) {
    if (salvando.current) window.clearTimeout(salvando.current)
    salvando.current = window.setTimeout(() => {
      salvando.current = null
      void persistirCanvas(ed)
    }, 600)
  }

  function enfileirarCanvas<T>(acao: () => Promise<T>): Promise<T> {
    const tarefa = filaCanvas.current.then(acao)
    filaCanvas.current = tarefa.then(
      () => undefined,
      () => undefined
    )
    return tarefa
  }

  function enfileirarCarga<T>(acao: () => Promise<T>): Promise<T> {
    return enfileirarCanvas(async () => {
      carregando.current = true
      try {
        return await acao()
      } finally {
        carregando.current = false
      }
    })
  }

  async function persistirCanvas(ed: Editor) {
    if (persistindo.current || !alteracoesPendentes.current) return
    persistindo.current = true
    let salvou = false
    try {
      await enfileirarCanvas(async () => {
        await prepararMidiasDoCanvas(ed)
        const versaoSalva = versaoAlteracoes.current
        const blocos = snapshotDoCanvas(ed)
        await salvarBlocos(blocos)
        setBlocosPrincipal(blocos)
        salvou = true
        if (versaoAlteracoes.current === versaoSalva) alteracoesPendentes.current = false
        setErroPrincipal('')
      })
    } catch (err) {
      console.error('Falha ao salvar blocos:', err)
      setErroPrincipal(`Não foi possível salvar o canvas: ${String(err)}`)
    } finally {
      persistindo.current = false
      if (salvou && alteracoesPendentes.current) agendarPersistencia(ed)
    }
  }

  // Salva na hora (botão "Salvar agora" e flush ao desmontar/trocar de aba).
  function salvarAgora() {
    const ed = editorRef.current
    if (!ed || !alteracoesPendentes.current) return
    if (salvando.current) {
      window.clearTimeout(salvando.current)
      salvando.current = null
    }
    void persistirCanvas(ed)
  }

  async function recarregarConhecimento() {
    const ed = editorRef.current
    if (!ed) return
    try {
      await enfileirarCarga(async () => {
        const proximo = await listarConhecimento()
        const pagina = ed.getCurrentPageId()
        ed.setCurrentPage(ed.getPages()[0].id)
        carregarConhecimentoNoCanvas(ed, proximo)
        ed.setCurrentPage(pagina)
        setCatalogo(proximo)
        setErroPrincipal('')
      })
    } catch (err) {
      setErroPrincipal(`Não foi possível ler o Knowledge do workspace: ${String(err)}`)
    }
  }

  async function recarregarBlocos(ed: Editor) {
    await enfileirarCarga(async () => {
      const blocos = await listarBlocos()
      const pagina = ed.getCurrentPageId()
      ed.setCurrentPage(ed.getPages()[0].id)
      const remover = ed
        .getCurrentPageShapes()
        .filter((shape) => metaDoBloco(shape) || (shape.type === 'arrow' && !shape.meta.dailyworkNative && !ehShapeDoSistemaPrincipal(shape)))
      ed.deleteShapes(remover.map((shape) => shape.id))
      await carregarBlocosNoCanvas(ed, blocos, { portfolio: true })
      ed.setCurrentPage(pagina)
      setBlocosPrincipal(blocos)
      setErroPrincipal('')
    })
  }

  // Flush de segurança se o componente desmontar com mudanças pendentes.
  useEffect(() => {
    return () => {
      cancelarMudancasExternas.current?.()
      cancelarMudancasConhecimento.current?.()
      salvarAgora()
      if (editorRef.current && !carregando.current) void salvarCanvasPrincipal(editorRef.current).catch(console.error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aoMontar(e: Editor) {
    setEditor(e)
    editorRef.current = e
    if (editoresVistos.has(e)) return
    editoresVistos.add(e)

    void enfileirarCarga(async () => {
      await carregarCanvasPrincipal(e)
      const [blocos, conhecimento] = await Promise.all([listarBlocos(), listarConhecimento()])
      if (e.isDisposed) return
      setBlocosPrincipal(blocos)
      if (blocos.length > 0) {
        await carregarBlocosNoCanvas(e, blocos, { portfolio: true })
      }
      carregarConhecimentoNoCanvas(e, conhecimento)
      setCatalogo(conhecimento)
      const cancelarAgentes = registrarCanvasAgentes(e, 'principal', async () => {
        await filaCanvas.current
        await salvarCanvasPrincipal(e)
      })
      e.once('dispose', cancelarAgentes)
      const modoPrincipal = new URLSearchParams(window.location.search).get('mode')
      if (
        modoPrincipal === 'portfolio-paginas' ||
        modoPrincipal === 'entrevista' ||
        modoPrincipal === 'stack' ||
        modoPrincipal === 'conhecimento' ||
        modoPrincipal === 'painel-essencial'
      ) {
        // O Chromium pode pausar requestAnimationFrame quando a janela de
        // captura está ocluída. Um timer curto deixa o tldraw medir o
        // viewport e mantém os deep-links determinísticos nesses casos.
        window.setTimeout(() => {
          if (modoPrincipal === 'portfolio-paginas') {
            const bounds = e.getCurrentPageShapes()
              .filter((shape) => metaDoBloco(shape)?.blockId.startsWith(PREFIXO_PAGINAS_PORTFOLIO))
              .map((shape) => e.getShapePageBounds(shape))
              .filter((item): item is Box => Boolean(item))
            if (bounds.length) enquadrarAreaPortfolio(e, Box.Common(bounds), 0)
            else enquadrarPortfolio(e, 0)
          } else if (modoPrincipal === 'entrevista') enquadrarEntrevista(e, 0)
          else if (modoPrincipal === 'stack') enquadrarStack(e, 0)
          else enquadrarConhecimento(e, 0, modoPrincipal === 'painel-essencial')
          setPronto(true)
        }, 80)
      } else {
        window.setTimeout(() => {
          enquadrarPortfolio(e, 0)
          setPronto(true)
        }, 80)
      }
    })
      .catch((err) => {
        console.error('Falha ao carregar blocos:', err)
        setErroPrincipal(`Não foi possível carregar o Principal: ${String(err)}`)
        setPronto(true)
      })

    // Agent-First: um agente escreveu em data/ fora da UI -> recarrega o
    // canvas do disco (a UI nunca sobrescreve a escrita do agente).
    cancelarMudancasExternas.current = aoMudarBlocosExternos(() => {
      void recarregarBlocos(e)
        .catch((err) => {
          console.error('Falha ao recarregar blocos:', err)
          setErroPrincipal(`Não foi possível recarregar o Principal: ${String(err)}`)
        })
    })

    cancelarMudancasConhecimento.current = aoMudarConhecimento(() => {
      void recarregarConhecimento()
    })

    const editarBloco = (evento: Event) => {
      const blockId = (evento as CustomEvent<{ blockId?: string }>).detail?.blockId
      if (!blockId) return
      const shape = e.getShape(createShapeId(blockId))
      if (!shape) return
      e.select(shape.id)
      setPainelAberto(true)
    }
    window.addEventListener('dailywork:editar-bloco', editarBloco)
    e.once('dispose', () => window.removeEventListener('dailywork:editar-bloco', editarBloco))

    const excluirConhecimento = (evento: Event) => {
      const detail = (evento as CustomEvent<{ caminho?: string; titulo?: string }>).detail
      if (detail?.caminho) {
        setConfirmarExclusao({ caminho: detail.caminho, titulo: detail.titulo || detail.caminho })
      }
    }
    window.addEventListener('dailywork:excluir-conhecimento', excluirConhecimento)
    e.once('dispose', () =>
      window.removeEventListener('dailywork:excluir-conhecimento', excluirConhecimento)
    )

    let timerNativo: ReturnType<typeof setTimeout> | undefined
    const pararNativo = e.store.listen(() => {
      if (carregando.current) return
      clearTimeout(timerNativo)
      timerNativo = setTimeout(() => { void salvarCanvasPrincipal(e).catch(console.error) }, 600)
    }, { source: 'user', scope: 'document' })
    e.once('dispose', () => { clearTimeout(timerNativo); pararNativo() })

    // Salva snapshot (debounced) a cada mudança feita pelo usuário.
    e.store.listen(
      (evento) => {
        if (carregando.current) return
        const registros = [
          ...Object.values(evento.changes.added),
          ...Object.values(evento.changes.updated).map(([, depois]) => depois),
          ...Object.values(evento.changes.removed),
        ]

        // Identifica shapes de conhecimento que foram movidos
        const movidosConhecimento = registros.filter(
          (r): r is TLShape => r.typeName === 'shape' && Boolean(metaDoConhecimento(r as TLShape))
        )
        if (movidosConhecimento.length > 0) {
          for (const s of movidosConhecimento) {
            const meta = metaDoConhecimento(s)
            if (!meta) continue
            const w = (s.props as { w?: number })?.w || 280
            const h = (s.props as { h?: number })?.h || 96
            posicoesConhecimentoPendentes.current[meta.caminho] = {
              x: Math.round(s.x + w / 2 - OFFSET_CONHECIMENTO.x),
              y: Math.round(s.y + h / 2 - OFFSET_CONHECIMENTO.y),
            }
          }
          agendarPersistenciaConhecimento()
        }

        // Identifica shapes de conhecimento que foram removidos
        const excluidosConhecimento = Object.values(evento.changes.removed).filter(
          (r): r is TLShape => r.typeName === 'shape' && Boolean(metaDoConhecimento(r as TLShape))
        )
        for (const s of excluidosConhecimento) {
          const meta = metaDoConhecimento(s)
          if (meta?.caminho) {
            delete posicoesConhecimentoPendentes.current[meta.caminho]
            void removerPosicaoConhecimento(meta.caminho).catch(console.error)
          }
        }

        const mudouConteudoPersistente = registros.some((registro) => {
          if (registro.typeName === 'binding') return true
          if (registro.typeName !== 'shape') return false
          const shape = registro as TLShape
          if (shape.meta.dailyworkNative) return false
          if (metaDoConhecimento(shape) || ehShapeDoSistemaPrincipal(shape)) return false
          return (
            Boolean(metaDoBloco(shape)) ||
            shape.type === 'geo' ||
            shape.type === 'text' ||
            shape.type === 'image' ||
            shape.type === 'arrow'
          )
        })
        if (!mudouConteudoPersistente) return
        versaoAlteracoes.current += 1
        alteracoesPendentes.current = true
        if (!persistindo.current) agendarPersistencia(e)
      },
      { source: 'user', scope: 'document' }
    )
  }

  // Botão direito no canvas -> menu de criação de blocos (estilo ComfyUI).
  function aoContextMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-principal-ui]')) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  function criarNoPonto(tipo: TipoBloco, nome: string) {
    if (!editor || !menu) return
    const ponto = editor.screenToPage({ x: menu.x, y: menu.y })
    const w = tipo === 'pessoa' ? 220 : 360
    const h = 220
    void criarBlocoNativo(editor, {
      tipo,
      titulo: nome || (tipo === 'pessoa' ? 'Eu' : 'Novo bloco'),
      x: ponto.x - w / 2,
      y: ponto.y - h / 2,
      w,
      h,
      visual: 'portfolio',
    })
    setMenu(null)
  }

  async function recarregarAposAgente() {
    const ed = editorRef.current
    if (!ed) return
    try {
      await recarregarBlocos(ed)
    } catch (err) {
      setErroPrincipal(`A ação foi concluída, mas o Principal não pôde ser recarregado: ${String(err)}`)
    }
  }

  return (
    <div
      className={`principal-root ${assistenteAberto ? 'principal-root--assistente-aberto' : ''}`}
      data-dailywork-ready={pronto ? 'true' : 'false'}
      style={{ position: 'absolute', inset: 0 }}
      onContextMenuCapture={aoContextMenu}
    >
      <Tldraw assetUrls={TLDRAW_ASSETS} onMount={aoMontar} shapeUtils={PRINCIPAL_SHAPE_UTILS} />
      {editor && painelAberto && (
        <PainelLateral editor={editor} onSalvar={salvarAgora} portfolio />
      )}
      {editor && (
        <button
          data-testid="alternar-painel"
          data-principal-ui
          onClick={() => setPainelAberto((aberto) => !aberto)}
          title={painelAberto ? 'Fechar painel de blocos' : 'Abrir painel de blocos'}
          aria-label={painelAberto ? 'Fechar painel de blocos' : 'Abrir painel de blocos'}
          aria-expanded={painelAberto}
          style={{
            position: 'absolute',
            top: 14,
            left: painelAberto ? 244 : 16,
            zIndex: 510,
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8,
            background: '#242424',
            color: '#fff',
            padding: painelAberto ? '5px 9px' : '6px 11px',
            font: '600 12px system-ui, sans-serif',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            cursor: 'pointer',
          }}
        >
          {painelAberto ? '×' : '☰ Blocos'}
        </button>
      )}
      {editor && (
        <PrincipalNavigator
          editor={editor}
          catalogo={catalogo}
          onRecarregar={recarregarConhecimento}
          temApresentacao={blocosPrincipal.some((bloco) => bloco.id === `${SESSAO_PORTFOLIO}-capa`)}
          onAbrirSessao={onAbrirSessao}
        />
      )}
      {erroPrincipal && (
        <div className="principal-erro" data-principal-ui role="alert">
          {erroPrincipal}
        </div>
      )}
      {menu && (
        <MenuCriacao x={menu.x} y={menu.y} onEscolher={criarNoPonto} onFechar={() => setMenu(null)} />
      )}
      <AssistenteDia
        escopo="principal"
        blocos={blocosPrincipal}
        aberto={assistenteAberto}
        onAbertoChange={setAssistenteAberto}
        onBlocosAlterados={recarregarAposAgente}
      />
      {confirmarExclusao && (
        <div
          className="principal-modal-backdrop"
          data-principal-ui
          onClick={() => setConfirmarExclusao(null)}
        >
          <div
            className="principal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="modal-titulo">Gerenciar nota do Acervo</h3>
            <p>
              Deseja remover <strong>{confirmarExclusao.titulo}</strong> apenas da visualização deste
              mapa ou arquivar permanentemente o arquivo <code>.md</code> do vault?
            </p>
            <div className="principal-modal-botoes">
              <button
                type="button"
                className="principal-modal-btn-remover"
                onClick={() => void executarRemoverDoMapa()}
              >
                Remover apenas da visualização do mapa
              </button>
              <button
                type="button"
                className="principal-modal-btn-arquivar"
                onClick={() => void executarArquivarNota()}
              >
                Arquivar nota (mover para pasta de arquivos)
              </button>
              <button
                type="button"
                className="principal-modal-btn-cancelar"
                onClick={() => setConfirmarExclusao(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
