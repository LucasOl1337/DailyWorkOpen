import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Box, Editor } from 'tldraw'
import {
  obterNotaConhecimento,
  salvarNotaConhecimento,
  salvarPosicoesConhecimento,
  removerPosicaoConhecimento,
  excluirNotaConhecimento,
} from '../lib/api'
import {
  type CatalogoConhecimento,
  type NotaConhecimento,
  type NotaConhecimentoResumo,
  metaDoConhecimento,
  shapeIdDaNota,
  OFFSET_CONHECIMENTO,
  dimensoesDaNota,
} from '../lib/conhecimento'
import {
  organizarPainelEssencial,
  organizarLayoutConhecimento,
} from '../lib/layout-conhecimento'
import { metaDoBloco } from '../lib/blocos'
import { ehDestaquePortfolio, enquadrarAreaPortfolio, PREFIXO_PAGINAS_PORTFOLIO, SESSAO_PORTFOLIO } from '../lib/portfolio'

type Territorio = 'portfolio' | 'portfolio-paginas' | 'entrevista' | 'stack' | 'conhecimento' | 'tudo'

function normalizar(valor: string) {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function markdownComWikiLinks(texto: string) {
  return texto.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (_match, alvo, rotulo) => `[${String(rotulo || alvo).trim()}](dailywork-wiki:${encodeURIComponent(String(alvo).trim())})`
  )
}

function notaPorAlvo(catalogo: CatalogoConhecimento, alvo: string) {
  const chave = normalizar(alvo.replace(/\\/g, '/').replace(/\.md$/i, ''))
  return catalogo.notas.find((nota) => {
    const caminho = normalizar(nota.caminho.replace(/\.md$/i, ''))
    const nome = normalizar(nota.caminho.split('/').at(-1)?.replace(/\.md$/i, '') || '')
    return caminho === chave || nome === normalizar(alvo.split('/').at(-1) || alvo)
  })
}

function formatarData(data: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(new Date(data))
      .replace('.', '')
  } catch {
    return data
  }
}

export function PrincipalNavigator({
  editor,
  catalogo,
  onRecarregar,
  temApresentacao,
  onAbrirSessao,
}: {
  editor: Editor
  catalogo: CatalogoConhecimento
  onRecarregar: () => Promise<void>
  temApresentacao: boolean
  onAbrirSessao: (id: string) => void
}) {
  const territorioSolicitado = new URLSearchParams(window.location.search).get('mode')
  const territorioInicial: Territorio =
    territorioSolicitado === 'portfolio-paginas'
      ? 'portfolio-paginas'
      : territorioSolicitado === 'entrevista'
        ? 'entrevista'
        : territorioSolicitado === 'stack'
          ? 'stack'
          : territorioSolicitado === 'conhecimento' || territorioSolicitado === 'painel-essencial'
            ? 'conhecimento'
            : 'portfolio'
  const [territorio, setTerritorio] = useState<Territorio>(territorioInicial)
  const [busca, setBusca] = useState('')
  const [nota, setNota] = useState<NotaConhecimento | null>(null)
  const [carregandoNota, setCarregandoNota] = useState(false)
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const resultados = useMemo(() => {
    const termo = normalizar(busca.trim())
    if (!termo) return []
    return catalogo.notas
      .filter((item) => normalizar(`${item.titulo} ${item.caminho} ${item.resumo}`).includes(termo))
      .slice(0, 8)
  }, [busca, catalogo])

  function shapesDoTerritorio(alvo: Territorio) {
    return editor.getCurrentPageShapes().filter((shape) => {
      const bloco = metaDoBloco(shape)
      const portfolio = Boolean(bloco)
      const conhecimento = Boolean(metaDoConhecimento(shape))
      if (alvo === 'portfolio') {
        return ehDestaquePortfolio(bloco?.blockId || '')
      }
      if (alvo === 'portfolio-paginas') {
        return bloco?.blockId.startsWith(PREFIXO_PAGINAS_PORTFOLIO)
      }
      if (alvo === 'entrevista') {
        return Boolean(bloco?.blockId.startsWith('portfolio-entrevista-'))
      }
      if (alvo === 'stack') {
        return bloco?.blockId.startsWith('principal-stack-')
      }
      if (alvo === 'conhecimento') {
        return conhecimento
      }
      return portfolio || conhecimento
    })
  }

  function enquadrar(alvo: Territorio) {
    setTerritorio(alvo)
    const bounds = shapesDoTerritorio(alvo)
      .map((shape) => editor.getShapePageBounds(shape))
      .filter((item): item is Box => Boolean(item))
    const comum = bounds.length ? Box.Common(bounds) : null
    if (!comum) return
    if (temApresentacao && (alvo === 'portfolio' || alvo === 'portfolio-paginas')) {
      enquadrarAreaPortfolio(editor, comum, 280)
      return
    }
    const ehVitrine = alvo === 'portfolio' || alvo === 'entrevista'
    if (!ehVitrine) {
      const viewport = editor.getViewportScreenBounds()
      const margemEsquerda = 16
      const margemDireita = 176
      const margemSuperior = 122
      const margemInferior = 78
      const larguraUtil = Math.max(200, viewport.width - margemEsquerda - margemDireita)
      const alturaUtil = Math.max(200, viewport.height - margemSuperior - margemInferior)
      const zoom = Math.max(
        0.05,
        Math.min(larguraUtil / Math.max(comum.w, 1), alturaUtil / Math.max(comum.h, 1), 1)
      )
      const esquerda = margemEsquerda + (larguraUtil - comum.w * zoom) / 2
      const topo = margemSuperior + (alturaUtil - comum.h * zoom) / 2
      const cameraInicial = editor.getCamera()
      editor.setCamera(cameraInicial)
      editor.setCamera(
        {
          x: -comum.x + esquerda / zoom,
          y: -comum.y + topo / zoom,
          z: zoom,
        },
        { animation: { duration: 280 } }
      )
      return
    }
    const inset = ehVitrine ? 172 : alvo === 'tudo' ? 150 : 130
    const respiroSuperior = alvo === 'entrevista'
      ? 40
      : ehVitrine ? 28 : 70
    const reservaDireita = alvo === 'entrevista' ? 82 : 0
    const cameraInicial = editor.getCamera()
    editor.zoomToBounds(comum, { inset })
    const cameraAlvo = editor.getCamera()
    editor.setCamera(cameraInicial)
    editor.setCamera(
      {
        x: cameraAlvo.x - reservaDireita / cameraAlvo.z,
        y: cameraAlvo.y + respiroSuperior / cameraAlvo.z,
        z: cameraAlvo.z,
      },
      { animation: { duration: 280 } }
    )
  }

  async function abrirNota(item: NotaConhecimentoResumo | string, mover = true) {
    const caminho = typeof item === 'string' ? item : item.caminho
    setCarregandoNota(true)
    setErro('')
    setEditando(false)
    try {
      const carregada = await obterNotaConhecimento(caminho)
      setNota(carregada)
      setRascunho(carregada.conteudo)
      setBusca('')
      if (mover && carregada.noMapa) {
        const shape = editor.getShape(shapeIdDaNota(caminho))
        const bounds = shape ? editor.getShapePageBounds(shape) : null
        if (bounds) {
          setTerritorio('conhecimento')
          editor.zoomToBounds(bounds.clone().expandBy(80), {
            animation: { duration: 260 },
            targetZoom: 1.15,
            inset: 120,
          })
        }
      }
    } catch (e) {
      setErro(String(e))
    } finally {
      setCarregandoNota(false)
    }
  }

  async function salvarEdicao() {
    if (!nota) return
    setSalvando(true)
    setErro('')
    try {
      const salva = await salvarNotaConhecimento(nota.caminho, rascunho, nota.etag)
      setNota(salva)
      setRascunho(salva.conteudo)
      setEditando(false)
      await onRecarregar()
    } catch (e) {
      setErro(String(e))
    } finally {
      setSalvando(false)
    }
  }

  async function removerDoMapa(caminho: string) {
    try {
      const shape = editor.getShape(shapeIdDaNota(caminho))
      if (shape) editor.deleteShapes([shape.id])
      await removerPosicaoConhecimento(caminho)
      setNota(null)
      setEditando(false)
      await onRecarregar()
    } catch (e) {
      setErro(`Erro ao remover do mapa: ${String(e)}`)
    }
  }

  async function arquivarNota(caminho: string) {
    if (
      !window.confirm(
        `Tem certeza que deseja arquivar a nota "${caminho}"? O arquivo será movido para a pasta de arquivos e removido do vault.`
      )
    ) {
      return
    }
    try {
      const shape = editor.getShape(shapeIdDaNota(caminho))
      if (shape) editor.deleteShapes([shape.id])
      await excluirNotaConhecimento(caminho)
      setNota(null)
      setEditando(false)
      await onRecarregar()
    } catch (e) {
      setErro(`Erro ao arquivar nota: ${String(e)}`)
    }
  }

  async function organizarMapa() {
    const visiveis = catalogo.notas.filter((n) => n.noMapa && n.posicao)
    if (!visiveis.length) return
    const dimensoes = new Map(
      visiveis.map((n) => {
        const dest =
          n.caminho === 'LUCAS.md'
            ? 'raiz'
            : n.links.length >= 3 || n.caminho.split('/').length === 1
              ? 'hub'
              : 'item'
        return [n.caminho, { destaque: dest, ...dimensoesDaNota(dest as any) }] as const
      })
    )
    const posPreferidas = organizarPainelEssencial(
      visiveis.map((n) => ({ chave: n.caminho, ...n.posicao! })),
      true
    )
    const posicoes = organizarLayoutConhecimento(
      visiveis.map((n) => {
        const d = dimensoes.get(n.caminho)!
        const pref = posPreferidas.get(n.caminho) || n.posicao!
        return {
          chave: n.caminho,
          x: pref.x,
          y: pref.y,
          w: d.w,
          h: d.h,
          peso: d.destaque === 'raiz' ? 12 : d.destaque === 'hub' ? 4 : 1,
          ancora: d.destaque === 'raiz',
        }
      })
    )
    const paraSalvar: Record<string, { x: number; y: number }> = {}
    for (const n of visiveis) {
      const pos = posicoes.get(n.caminho)
      if (!pos) continue
      paraSalvar[n.caminho] = pos
      const id = shapeIdDaNota(n.caminho)
      const shape = editor.getShape(id)
      if (shape) {
        const d = dimensoes.get(n.caminho)!
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          x: OFFSET_CONHECIMENTO.x + pos.x - d.w / 2,
          y: OFFSET_CONHECIMENTO.y + pos.y - d.h / 2,
        })
      }
    }
    await salvarPosicoesConhecimento(paraSalvar)
    enquadrar('conhecimento')
  }

  useEffect(() => {
    const abrir = (evento: Event) => {
      const caminho = (evento as CustomEvent<{ caminho?: string }>).detail?.caminho
      if (caminho) void abrirNota(caminho, false)
    }
    const editar = (evento: Event) => {
      const caminho = (evento as CustomEvent<{ caminho?: string }>).detail?.caminho
      if (caminho) {
        void abrirNota(caminho, true).then(() => setEditando(true))
      }
    }
    window.addEventListener('dailywork:abrir-conhecimento', abrir)
    window.addEventListener('dailywork:editar-conhecimento', editar)
    return () => {
      window.removeEventListener('dailywork:abrir-conhecimento', abrir)
      window.removeEventListener('dailywork:editar-conhecimento', editar)
    }
  })

  function abrirWiki(href: string) {
    const alvo = decodeURIComponent(href.replace(/^dailywork-wiki:/, ''))
    const encontrada = notaPorAlvo(catalogo, alvo)
    if (encontrada) void abrirNota(encontrada)
  }

  return (
    <>
      <section className="principal-navigator" data-principal-ui aria-label="Territórios do Principal">
        <div className="principal-territorios" role="group" aria-label="Enquadrar território">
          <button
            className={territorio === 'portfolio' ? 'ativo' : ''}
            onClick={() => enquadrar('portfolio')}
          >
            <span className="territorio-marca territorio-marca--portfolio" />
            Portfólio
          </button>
          <button
            className={territorio === 'entrevista' ? 'ativo' : ''}
            onClick={() => enquadrar('entrevista')}
          >
            <span className="territorio-marca territorio-marca--entrevista" />
            Entrevistas
          </button>
          <button
            className={territorio === 'stack' ? 'ativo' : ''}
            onClick={() => enquadrar('stack')}
          >
            <span className="territorio-marca territorio-marca--stack" />
            Stack
          </button>
          <button
            className={territorio === 'conhecimento' ? 'ativo' : ''}
            onClick={() => enquadrar('conhecimento')}
          >
            <span className="territorio-marca territorio-marca--conhecimento" />
            Conhecimento
            <small>{catalogo.notas.length}</small>
          </button>
          <button className={territorio === 'tudo' ? 'ativo' : ''} onClick={() => enquadrar('tudo')}>
            Tudo
          </button>
          {territorio === 'conhecimento' && (
            <button
              type="button"
              className="principal-btn-organizar"
              onClick={() => void organizarMapa()}
              title="Organizar layout dos cards no mapa automaticamente"
            >
              🪄 Organizar layout
            </button>
          )}
        </div>

        <div className="principal-busca">
          <label htmlFor="busca-conhecimento">Buscar no vault</label>
          <input
            id="busca-conhecimento"
            data-testid="busca-conhecimento"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="capacidade, decisão, aprendizado…"
          />
          {busca && (
            <div className="principal-resultados" role="listbox" aria-label="Resultados do conhecimento">
              {resultados.map((item) => (
                <button key={item.caminho} onClick={() => void abrirNota(item)} role="option">
                  <span>{item.grupo}</span>
                  <strong>{item.titulo}</strong>
                  <small>{item.caminho}</small>
                </button>
              ))}
              {resultados.length === 0 && <p>Nenhuma nota encontrada.</p>}
            </div>
          )}
        </div>
        {temApresentacao && (territorio === 'portfolio' || territorio === 'portfolio-paginas') && (
          <div className="principal-portfolio-acesso" data-testid="portfolio-apresentacao">
            <span><strong>Selected Work</strong> · 12 páginas + currículo · set/2026</span>
            <button type="button" onClick={() => enquadrar('portfolio-paginas')}>
              Ver páginas no painel
            </button>
            <button type="button" onClick={() => onAbrirSessao(SESSAO_PORTFOLIO)}>
              Ler apresentação ↗
            </button>
          </div>
        )}
      </section>

      {(nota || carregandoNota) && (
        <aside className="conhecimento-drawer" data-testid="conhecimento-drawer" data-principal-ui>
          <header className="conhecimento-drawer__header">
            <div>
              <span>{nota?.grupo || 'Knowledge do workspace'}</span>
              <h2>{carregandoNota ? 'Abrindo nota…' : nota?.titulo}</h2>
            </div>
            <button
              className="drawer-fechar"
              onClick={() => {
                setNota(null)
                setEditando(false)
                setErro('')
              }}
              aria-label="Fechar nota"
            >
              ×
            </button>
          </header>

          {nota && (
            <div className="conhecimento-drawer__meta">
              <code>{nota.caminho}</code>
              <span>Atualizada {formatarData(nota.modificadaEm)}</span>
            </div>
          )}

          {erro && <div className="conhecimento-erro">{erro}</div>}

          {nota && !editando && (
            <div className="conhecimento-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a({ href, children }) {
                    if (href?.startsWith('dailywork-wiki:')) {
                      return (
                        <button className="wiki-link" onClick={() => abrirWiki(href)}>
                          {children}
                        </button>
                      )
                    }
                    return (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    )
                  },
                }}
              >
                {markdownComWikiLinks(nota.corpo)}
              </ReactMarkdown>
            </div>
          )}

          {nota && editando && (
            <div className="conhecimento-editor">
              <p>
                Esta edição grava diretamente no Knowledge do workspace. O DailyWork cria um backup recuperável
                antes de substituir o arquivo.
              </p>
              <textarea
                data-testid="editar-conhecimento"
                value={rascunho}
                onChange={(event) => setRascunho(event.target.value)}
                spellCheck
              />
            </div>
          )}

          {nota && (
            <footer className="conhecimento-drawer__acoes">
              {nota.caminho === 'LUCAS.md' ? (
                <span className="conhecimento-raiz-protegida">Raiz protegida · somente leitura</span>
              ) : editando ? (
                <>
                  <button className="acao-secundaria" onClick={() => setEditando(false)} disabled={salvando}>
                    Cancelar
                  </button>
                  <button className="acao-primaria" onClick={() => void salvarEdicao()} disabled={salvando}>
                    {salvando ? 'Salvando…' : 'Salvar no vault'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="acao-perigosa"
                    onClick={() => void arquivarNota(nota.caminho)}
                    title="Arquivar nota no acervo e remover do mapa"
                  >
                    Arquivar nota
                  </button>
                  <button
                    className="acao-secundaria"
                    onClick={() => void removerDoMapa(nota.caminho)}
                    title="Remover apenas da visualização do mapa"
                  >
                    Remover do mapa
                  </button>
                  <button className="acao-primaria" onClick={() => setEditando(true)}>
                    Editar fonte
                  </button>
                </>
              )}
            </footer>
          )}
        </aside>
      )}
    </>
  )
}
