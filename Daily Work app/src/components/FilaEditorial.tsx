import {ultimasOcorrencias} from '../lib/agenda'
import {useDestinoPagina,destacarSecao,resolverPendencia} from '../lib/destinos'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  aoAtualizarJobMidia,
  excluirEditoriais,
  listarCapacidadesEditorial,
  listarEditorial,
  listarHistoricoEditorial,
  listarMidiaJobs,
  obterConfiguracaoMidiaEditorial,
  obterEstadoEditorial,
  publicarEditorial,
  gerarEditorial,
  type ConfiguracaoMidiaEditorial,
  type ContaEditorial,
  type EntradaHistoricoEditorial,
  type EstadoFilaEditorial,
  type ItemEditorial,
  type JobMidiaEditorial,
} from '../lib/editorial'
import { listarConexoes, type Conexao } from '../lib/api'
import { contarSituacoes, filtrarFila, filtrosFilaAtivos, projetoDaPeca, SITUACOES_FILA, type FiltrosListaFila, type SituacaoFila } from '../lib/fila-filtros'
import { nomeProjeto } from '../lib/proveniencia'
import { AgendaModulo } from './AgendaModulo'
import { LinhaPeca } from './fila/LinhaPeca'
import { Bloco, Botao, Chip, Faixa, Kpi, Pagina } from './ui/ui'
import { ColunaDia } from './ui/ColunaDia'
import { useEstadoGlobal } from '../lib/estado-global'
import { Compositor, type ModoCompositor } from './fila/Compositor'
import { Historico } from './fila/Historico'
import { ItemCard } from './fila/ItemCard'
import { ProducaoPanel } from './fila/ProducaoPanel'
import {
  CONTAS,
  FORMATOS,
  IDIOMAS,
  acessoDaConta,
  ehConflito,
  ehProntaParaPublicar,
  ehProntaParaRevisao,
  erroTexto,
  exclusaoBloqueadaNaFila,
  itemDoHistorico,
  nomesConta,
  type CapacidadesMidia,
} from './fila/comum'
import './fila-editorial.css'

type VisaoFila = 'fila' | 'publicados'

export function FilaEditorial({ onNavegar }: { onNavegar?: (view: string) => void }) {
  const [items, setItems] = useState<ItemEditorial[]>([])
  const [jobs, setJobs] = useState<JobMidiaEditorial[]>([])
  const [capacidades, setCapacidades] = useState<CapacidadesMidia>({} as CapacidadesMidia)
  const [capacidadesCarregadas, setCapacidadesCarregadas] = useState(false)
  const [configMidia, setConfigMidia] = useState<ConfiguracaoMidiaEditorial | null>(null)
  const [configMidiaCarregada, setConfigMidiaCarregada] = useState(false)
  const [conexoes, setConexoes] = useState<Partial<Record<ContaEditorial, Conexao>>>({})
  const [estado, setEstado] = useState<EstadoFilaEditorial | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [filtros, setFiltros] = useState<FiltrosListaFila>({ ordem: 'recente' })
  const [busca, setBusca] = useState('')
  const [pautaSelecionada, setPautaSelecionada] = useState('')
  const [busyId, setBusyId] = useState('')
  const [modoSelecao, setModoSelecao] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set())
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [confirmandoApagarId, setConfirmandoApagarId] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [reiniciandoFila, setReiniciandoFila] = useState(false)
  const [visao, setVisao] = useState<VisaoFila>('fila')
  useDestinoPagina('fila', d => {
    if (d.secao === 'fila-revisao') {
      setVisao('fila')
      setFiltros({ ordem: 'recente', situacao: 'prontas' })
      setBusca('')
      setPautaSelecionada('')
    }
    if(d.secao)destacarSecao(d.secao)
  }, !carregando)
  const [modoCompositor, setModoCompositor] = useState<ModoCompositor>(null)
  const [aguardandoPedido, setAguardandoPedido] = useState(false)
  const [idsPedidoAntes, setIdsPedidoAntes] = useState<Set<string>>(() => new Set())
  const [destacarId, setDestacarId] = useState('')
  const [publicados, setPublicados] = useState(0)
  const [arquivoAberto, setArquivoAberto] = useState<ItemEditorial | null>(null)
  const [selecionadoId, setSelecionadoId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('item') || ''
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ? id : ''
  })

  async function carregar(opcoes: { silencioso?: boolean } = {}) {
    if (!opcoes.silencioso) setCarregando(true)
    try {
      const [novosItens, novoEstado, novosJobs, capacidadesBrutas, novaConfigMidia, novasConexoes, historico] = await Promise.all([
        listarEditorial(),
        obterEstadoEditorial(),
        listarMidiaJobs().catch(() => [] as JobMidiaEditorial[]),
        listarCapacidadesEditorial().catch(() => []),
        obterConfiguracaoMidiaEditorial().catch(() => ({ autorizarGasto: false })),
        listarConexoes().catch(() => [] as Conexao[]),
        listarHistoricoEditorial().catch(() => []),
      ])
      setItems(novosItens)
      setJobs(novosJobs)
      setConfigMidia(novaConfigMidia)
      setConfigMidiaCarregada(true)
      setConexoes(Object.fromEntries((novasConexoes || []).map((conexao) => [conexao.id, conexao])))
      const capacidadesNovas = {} as CapacidadesMidia
      const registros = Array.isArray(capacidadesBrutas)
        ? capacidadesBrutas
        : Object.entries((capacidadesBrutas && typeof capacidadesBrutas === 'object' ? capacidadesBrutas : {}) as Record<string, unknown>).map(([id, valor]) => ({ id, ...(valor && typeof valor === 'object' ? valor : {}) }))
      for (const registro of registros as Array<{ id?: string; capacidades?: { midia?: { imagem?: boolean; video?: boolean } }; midia?: { imagem?: boolean; video?: boolean } }>) {
        const midia = registro.capacidades?.midia || registro.midia
        if (registro.id && midia) {
          capacidadesNovas[registro.id as ContaEditorial] = midia
        }
      }
      setCapacidades(capacidadesNovas)
      setCapacidadesCarregadas(true)
      setEstado(novoEstado)
      setPublicados(historico.length)
      setErro('')
    } catch (falha) {
      setErro(erroTexto(falha).mensagem)
    } finally {
      if (!opcoes.silencioso) setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
  }, [])

  useEffect(() => {
    let ativo = true
    const bridge = window.dailyworkEditorial
    const recebeuItem = bridge?.onAtualizado?.((item) => {
      if (!ativo) return
      setItems((atuais) => atuais.some((atual) => atual.id === item.id)
        ? atuais.map((atual) => atual.id === item.id ? item : atual)
        : [item, ...atuais])
    })
    const recebeuProducao = bridge?.onProducaoAtualizada?.((novoEstado) => {
      if (ativo) setEstado(novoEstado)
    })
    const recebeuJob = aoAtualizarJobMidia((job) => {
      if (!ativo) return
      setJobs((atuais) => atuais.some((atual) => atual.id === job.id)
        ? atuais.map((atual) => atual.id === job.id ? job : atual)
        : [job, ...atuais])
      if (job.status === 'ready') void carregar({ silencioso: true })
    })
    const timer = window.setInterval(() => {
      Promise.all([listarEditorial(), listarMidiaJobs().catch(() => [] as JobMidiaEditorial[]), obterEstadoEditorial()])
        .then(([novosItens, novosJobs, novoEstado]) => {
          if (!ativo) return
          setItems(novosItens)
          setJobs(novosJobs)
          setEstado(novoEstado)
        })
        .catch((falha) => ativo && setErro(erroTexto(falha).mensagem))
    }, 10000)
    return () => {
      ativo = false
      recebeuItem?.()
      recebeuProducao?.()
      recebeuJob()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (estado?.producao.status !== 'executando') return
    let ativo = true
    let consultando = false
    const timer = window.setInterval(() => {
      if (consultando) return
      consultando = true
      obterEstadoEditorial()
        .then((novoEstado) => {
          if (!ativo) return
          const terminou = estado.producao.status === 'executando' && novoEstado.producao.status !== 'executando'
          setEstado(novoEstado)
          if (terminou) void carregar({ silencioso: true })
        })
        .catch((falha) => ativo && setErro(erroTexto(falha).mensagem))
        .finally(() => { consultando = false })
    }, 1800)
    return () => {
      ativo = false
      window.clearInterval(timer)
    }
  }, [estado?.producao.status])

  useEffect(() => {
    if (!aguardandoPedido) return
    const novo = items.find((item) => item.origem?.tipo === 'pedido' && !idsPedidoAntes.has(item.id))
    if (novo) {
      setAguardandoPedido(false)
      setModoCompositor(null)
      setVisao('fila')
      setDestacarId(novo.id)
      setSelecionadoId(novo.id)
      setArquivoAberto(null)
      return
    }
    if (estado?.producao.status === 'erro' || estado?.producao.status === 'cancelada') {
      setAguardandoPedido(false)
    }
  }, [aguardandoPedido, idsPedidoAntes, estado?.producao.status, items])

  useEffect(() => {
    if (!destacarId) return
    document.querySelector(`[data-testid="fila-card-${destacarId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [destacarId, items])

  const visiveis = useMemo(
    () => filtrarFila(items, { ...filtros, busca, pautaId: pautaSelecionada || undefined }),
    [items, filtros, busca, pautaSelecionada],
  )

  function alternarSelecao(id: string, marcado: boolean) {
    setSelecionados((atuais) => {
      const novos = new Set(atuais)
      if (marcado) novos.add(id)
      else novos.delete(id)
      return novos
    })
    setConfirmandoExclusao(false)
  }

  function encerrarSelecao() {
    setModoSelecao(false)
    setSelecionados(new Set())
    setConfirmandoExclusao(false)
  }

  async function arquivarPecas(ids: Iterable<string>) {
    const alvo = new Set(ids)
    if (alvo.size === 0 || excluindo) return
    setExcluindo(true)
    setErro('')
    try {
      const pedidos = items.filter((item) => alvo.has(item.id)).map(({ id, revisao }) => ({ id, revisao }))
      const resultado = await excluirEditoriais(pedidos)
      const idsExcluidos = new Set(resultado.excluidos)
      setItems((atuais) => atuais.filter((item) => !idsExcluidos.has(item.id)))
      setSelecionados(new Set(resultado.falhas.map((falha) => falha.id)))
      setConfirmandoExclusao(false)
      setConfirmandoApagarId('')
      if (idsExcluidos.has(selecionadoId)) {
        setSelecionadoId('')
        setArquivoAberto(null)
      }
      if (resultado.excluidos.length === 1) setAviso('Versão arquivada. Saiu da fila.')
      else if (resultado.excluidos.length > 1) setAviso(`${resultado.excluidos.length} versões arquivadas. Saíram da fila.`)
      if (resultado.falhas.length > 0) setErro(resultado.falhas.map((falha) => `${falha.id}: ${falha.mensagem}`).join(' '))
      if (resultado.falhas.length === 0) setModoSelecao(false)
    } catch (falha) {
      setErro(erroTexto(falha).mensagem)
    } finally {
      setExcluindo(false)
    }
  }

  async function excluirSelecionados() {
    await arquivarPecas(selecionados)
  }

  function pedirExclusao(item: ItemEditorial) {
    if (exclusaoBloqueadaNaFila(item) || excluindo || busyId === item.id) return
    if (confirmandoApagarId !== item.id) {
      setConfirmandoApagarId(item.id)
      return
    }
    void arquivarPecas([item.id])
  }

  async function reiniciarFila() {
    setExcluindo(true)
    try {
      const itens = items.filter(i => ['pendente', 'erro', 'recusado'].includes(i.estado))
      if (itens.length) {
        const resultado = await excluirEditoriais(itens.map(({ id, revisao }) => ({ id, revisao })))
        if (resultado.falhas.length) throw new Error('Algumas peças mudaram durante o arquivamento. Confira a fila antes de recomeçar.')
      }
      await gerarEditorial({ dia: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date()), reavaliar: true })
      setReiniciandoFila(false)
      setAviso('Rascunhos arquivados. Nova produção iniciada; publicações e envios em andamento foram preservados.')
      await carregar({ silencioso: true })
    } catch (e) {
      await carregar({ silencioso: true })
      setErro(erroTexto(e).mensagem)
    } finally { setExcluindo(false) }
  }

  function executarAcao(id: string, acao: 'publicar' | 'recusar' | 'reabrir' | 'agendar' | 'editar', callback?: () => Promise<ItemEditorial>) {
    if (busyId === id || !callback) return
    setBusyId(id)
    setErro('')
    setAviso('')
    callback()
      .then((item) => {
        setItems((atuais) => atuais.map((atual) => atual.id === item.id ? item : atual))
        if (acao === 'publicar') {
          setAviso(item.estado === 'publicado' ? `Publicado agora em ${nomesConta[item.conta] || item.conta}.` : `Publicação aprovada para ${nomesConta[item.conta] || item.conta}; o envio já começou.`)
          if (item.estado === 'publicado') {
            setPublicados((atual) => atual + 1)
            setVisao('publicados')
          }
        }
      })
      .catch(async (falha) => {
        if (ehConflito(falha)) {
          await carregar({ silencioso: true })
          setErro('Este item mudou enquanto você decidia. A fila foi recarregada; confira a revisão atual antes de agir novamente.')
        } else {
          const detalhe = erroTexto(falha)
          setErro(`${detalhe.codigo}: ${detalhe.mensagem}`)
        }
      })
      .finally(() => setBusyId(''))
  }

  const filaAtiva = items.filter((item) => item.estado !== 'publicado')
  const contagemPendente = items.filter((item) => item.estado === 'pendente').length
  const grupos = new Set(visiveis.map((item) => item.pautaId)).size
  const situacaoAtual: SituacaoFila = filtros.situacao || 'todas'
  const contagemSituacao = useMemo(() => contarSituacoes(items), [items])
  const temFiltros = filtrosFilaAtivos(filtros, busca, pautaSelecionada)
  const contasNaFila = useMemo(() => {
    const ids = new Set(items.filter((item) => item.estado !== 'publicado').map((item) => item.conta))
    if (filtros.conta) ids.add(filtros.conta)
    const presentes = CONTAS.filter((conta) => ids.has(conta.id))
    return presentes.length ? presentes : CONTAS
  }, [items, filtros.conta])
  const idiomasNaFila = useMemo(() => {
    const ids = new Set(items.filter((item) => item.estado !== 'publicado').map((item) => item.idioma))
    if (filtros.idioma) ids.add(filtros.idioma)
    const presentes = IDIOMAS.filter((idioma) => ids.has(idioma.id))
    return presentes.length ? presentes : IDIOMAS
  }, [items, filtros.idioma])
  const formatosNaFila = useMemo(() => {
    const ids = new Set(items.filter((item) => item.estado !== 'publicado').map((item) => item.formato))
    if (filtros.formato) ids.add(filtros.formato)
    const presentes = FORMATOS.filter((formato) => ids.has(formato.id))
    return presentes.length ? presentes : FORMATOS
  }, [items, filtros.formato])
  const projetosNaFila = useMemo(() => {
    const slugs = new Set(items.filter((item) => item.estado !== 'publicado').map(projetoDaPeca).filter(Boolean))
    if (filtros.projeto) slugs.add(filtros.projeto)
    return [...slugs].sort((a, b) => nomeProjeto(a).localeCompare(nomeProjeto(b), 'pt-BR'))
  }, [items, filtros.projeto])
  function limparFiltros() {
    setFiltros({ ordem: 'recente' })
    setBusca('')
    setPautaSelecionada('')
  }
  const versoesPorPautaLista = useMemo(() => items.reduce<Record<string, ItemEditorial[]>>((gruposVersoes, item) => {
    ;(gruposVersoes[item.pautaId] ||= []).push(item)
    return gruposVersoes
  }, {}), [items])
  const contagemProntas = items.filter(ehProntaParaRevisao).length

  useEffect(() => {
    const fn = (evento: Event) => {
      const id = (evento as CustomEvent).detail?.referencia?.itens?.[0]
      if (id) {
        setSelecionadoId(id)
        setArquivoAberto(null)
        setVisao('fila')
      }
    }
    window.addEventListener('agenda:historico', fn)
    return () => window.removeEventListener('agenda:historico', fn)
  }, [])

  useEffect(() => {
    const abrirProducao = () => {
      setTimeout(() => {
        destacarSecao('fila-producao')
      }, 50)
    }
    const rolarLista = () => {
      setVisao('fila');destacarSecao('fila-revisao')
    }
    window.addEventListener('fila:abrir-producao', abrirProducao)
    window.addEventListener('fila:rolar-lista', rolarLista)
    return () => {
      window.removeEventListener('fila:abrir-producao', abrirProducao)
      window.removeEventListener('fila:rolar-lista', rolarLista)
    }
  }, [])

  const selecionado = selecionadoId
    ? items.find((item) => item.id === selecionadoId) || (arquivoAberto?.id === selecionadoId ? arquivoAberto : null)
    : null
  const modalRef = useCallback((elemento: HTMLDivElement | null) => {
    elemento?.focus()
  }, [selecionadoId])

  useEffect(() => {
    if (!selecionadoId) return
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        setSelecionadoId('')
        setArquivoAberto(null)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [selecionadoId])

  function abrirDoHistorico(entrada: EntradaHistoricoEditorial) {
    const vivo = items.find((item) => item.id === entrada.id)
    setArquivoAberto(vivo ? null : itemDoHistorico(entrada))
    setSelecionadoId(entrada.id)
  }

  function aoCriar(id: string, publicado: boolean) {
    setModoCompositor(null)
    setDestacarId(id)
    setSelecionadoId(id)
    setArquivoAberto(null)
    void carregar({ silencioso: true })
    if (publicado) {
      setVisao('publicados')
      setPublicados((atual) => atual + 1)
      setAviso('Publicado agora.')
    } else {
      setVisao('fila')
      setAviso('Peça salva na fila.')
    }
  }

  const global = useEstadoGlobal()
  const editorialOcs = (global.agenda?.ocorrencias || []).filter((o) => o.modulo === 'editorial')
  const editorialBloq = ultimasOcorrencias(editorialOcs).find((o) => o.estado === 'bloqueada')
  const editorialRodando = editorialOcs.find((o) => o.estado === 'executando')
  const proximaPublicacao = editorialOcs.filter((o) => o.tipo === 'publicacao' && o.estado === 'agendada' && o.prevista > Date.now()).sort((a, b) => a.prevista - b.prevista)[0]
  const proximaProducao = editorialOcs.filter((o) => o.tipo === 'producao' && o.estado === 'agendada' && o.prevista > Date.now()).sort((a, b) => a.prevista - b.prevista)[0]
  const hora = (v: number | string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const hojeStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const publicadasHoje = items.filter((item) => item.estado === 'publicado' && new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(item.recibo?.publishedAt || item.atualizadoEm)) === hojeStr).length
  const produzindo = estado?.producao.status === 'executando'
  const prontasVisiveis = visiveis.filter(ehProntaParaRevisao)
  const [agendaAberta, setAgendaAberta] = useState(false)
  const acoes = <>
    <Botao disabled={produzindo || excluindo} onClick={() => setReiniciandoFila(true)}>Recomeçar fila</Botao>
    <Botao data-testid="fila-pedir" aria-pressed={modoCompositor === 'pedir'} onClick={() => setModoCompositor((atual) => atual === 'pedir' ? null : 'pedir')}>Pedir post sobre…</Botao>
    <Botao kind="primary" data-testid="fila-escrever" aria-pressed={modoCompositor === 'escrever'} onClick={() => setModoCompositor((atual) => atual === 'escrever' ? null : 'escrever')}>Escrever post</Botao>
  </>
  const chips = <div className="fila-visao" role="tablist" aria-label="Visão da fila">
    <button type="button" role="tab" aria-selected={visao === 'fila'} className={visao === 'fila' ? 'is-active' : ''} onClick={() => setVisao('fila')}>Fila ({contagemPendente})</button>
    <button type="button" role="tab" aria-selected={visao === 'publicados'} className={visao === 'publicados' ? 'is-active' : ''} onClick={() => setVisao('publicados')}>Publicados ({publicados})</button>
  </div>
  return (
    <main className={`fila-editorial fila-editorial--pagina ${selecionado ? 'has-modal' : ''}`} data-dailywork-ready={!carregando ? 'true' : 'false'}>
      <Pagina titulo="Fila" eyebrow="Distribuição editorial" chips={chips} acoes={acoes}>
        {modoCompositor && (
          <Compositor
            modo={modoCompositor}
            conexoes={conexoes}
            estado={estado}
            onFechar={() => setModoCompositor(null)}
            onCriado={aoCriar}
            onPedido={() => {
              setIdsPedidoAntes(new Set(items.filter((item) => item.origem?.tipo === 'pedido').map((item) => item.id)))
              setAguardandoPedido(true)
              setAviso('O redator está montando o post.')
            }}
            onError={(mensagem) => setErro(mensagem)}
          />
        )}
        {erro && <Faixa tone="erro" acoes={<Botao kind="ghost" onClick={() => setErro('')}>Fechar</Botao>}>{erro}</Faixa>}
        {aviso && <Faixa tone="ok" acoes={<Botao kind="ghost" onClick={() => setAviso('')}>Fechar</Botao>}>{aviso}</Faixa>}
        {reiniciandoFila && <Faixa tone="atencao" acoes={<><Botao disabled={excluindo} onClick={() => setReiniciandoFila(false)}>Voltar</Botao><Botao kind="danger" disabled={excluindo || produzindo} onClick={() => void reiniciarFila()}>{excluindo ? 'Recomeçando…' : 'Arquivar rascunhos e gerar'}</Botao></>}>Arquivar {items.filter(i => ['pendente', 'erro', 'recusado'].includes(i.estado)).length} rascunho(s) e começar uma produção nova? Publicados, agendados e envios pendentes permanecem como estão.</Faixa>}
        {editorialBloq
          ? <Faixa tone={/9ROUTER|LIMITE|TIMEOUT/i.test(editorialBloq.codigo || '') ? 'erro' : 'atencao'} detalhe={`${editorialBloq.codigo || ''} · ${editorialBloq.mensagem || ''}`} acoes={<>{/9ROUTER|LIMITE|TIMEOUT|PROVEDOR/i.test(editorialBloq.codigo || '') && <Botao onClick={() => window.dispatchEvent(new CustomEvent('app:navegar', { detail: { view: 'agente' } }))}>Conferir provedor</Botao>}<Botao kind="primary" onClick={() => resolverPendencia({titulo:editorialBloq.nome,alvo:{tipo:'agenda',modulo:editorialBloq.modulo,ocorrenciaId:editorialBloq.id,dia:editorialBloq.dia}})}>Ver impedimento</Botao></>}><strong>{editorialBloq.nome} falhou às {hora(editorialBloq.atualizadaEm)}.</strong> {/9ROUTER|LIMITE|TIMEOUT|PROVEDOR/i.test(editorialBloq.codigo || '') ? `O provedor de IA não respondeu. As ${contagemProntas} peças prontas continuam disponíveis para revisão.` : (editorialBloq.mensagem || '').split(/(?<=[.!?])\s/)[0].slice(0, 160)}</Faixa>
          : produzindo || editorialRodando ? <Faixa tone="info">{produzindo ? (estado?.producao.etapa || estado?.producao.mensagem || 'Produzindo conteúdo…') : `${editorialRodando?.nome} rodando.`}</Faixa>
          : contagemProntas ? <Faixa tone="ok" acoes={proximaPublicacao ? <Chip tone="info">publica às {hora(proximaPublicacao.prevista)}</Chip> : undefined}><strong>{contagemProntas === 1 ? '1 peça pronta' : `${contagemProntas} peças prontas`} para publicar.</strong> Revise as peças abaixo e escolha quando publicar.</Faixa>
          : null}
          <Bloco id="fila-producao" titulo={undefined}>
            <div className="fila-producao-wrap"><ProducaoPanel
              estado={estado}
              conexoes={conexoes}
              configMidia={configMidia}
              configMidiaCarregada={configMidiaCarregada}
              onConfigMidiaSaved={(novaConfig) => {
                setConfigMidia(novaConfig)
                setAviso('Configuração de geração de mídia salva.')
              }}
              onChanged={() => void carregar({ silencioso: true })}
              onError={(mensagem) => setErro(mensagem)}
            /></div>
          </Bloco>
        <div className="dw-kpis">
          <Kpi valor={contagemProntas} rotulo="prontas para publicar" tone="ok" />
          <Kpi valor={grupos} rotulo="pautas na fila" />
          <Kpi valor={publicadasHoje} rotulo="publicadas hoje" />
          <Kpi valor={proximaPublicacao ? hora(proximaPublicacao.prevista) : '—'} rotulo="próxima publicação" />
          <Kpi valor={proximaProducao ? hora(proximaProducao.prevista) : '—'} rotulo="próxima produção" tone={editorialBloq ? 'atencao' : undefined} />
        </div>
        <div className="dw-grade fila-grade">
          {visao === 'publicados' ? (
            <Bloco scroll titulo="Publicados"><div className="fila-historico-wrap"><Historico onAbrir={abrirDoHistorico} onError={(mensagem) => setErro(mensagem)} /></div></Bloco>
          ) : (
            <Bloco id="fila-revisao" scroll titulo={<>Peças e versões <span className="cand-contagem">{visiveis.length}</span></>} aside={<>
              {modoSelecao ? <Botao kind="ghost" onClick={encerrarSelecao}>Cancelar seleção</Botao> : <Botao kind="ghost" disabled={visiveis.length === 0} onClick={() => setModoSelecao(true)}>Selecionar</Botao>}
              <Botao kind="ghost" onClick={() => void carregar()}>Atualizar</Botao>
            </>}>
              <div className="fila-filtros-lista" data-testid="fila-filtros">
                <div className="fila-filtros-chips" role="group" aria-label="Situação">
                  {SITUACOES_FILA.filter((situacao) => situacao.id === 'todas' || situacao.id === 'prontas' || contagemSituacao[situacao.id] > 0 || situacaoAtual === situacao.id).map((situacao) => (
                    <button
                      key={situacao.id}
                      type="button"
                      className={`fila-filtro ${situacaoAtual === situacao.id ? 'is-on' : ''}`}
                      aria-pressed={situacaoAtual === situacao.id}
                      onClick={() => setFiltros((atuais) => ({ ...atuais, situacao: situacao.id === 'todas' ? undefined : situacao.id }))}
                    >
                      {situacao.nome}
                      <span>{contagemSituacao[situacao.id]}</span>
                    </button>
                  ))}
                </div>
                <input className="fila-busca-lista" aria-label="Buscar" value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Título, texto, projeto…" />
                <select aria-label="Rede" value={filtros.conta || ''} onChange={(evento) => setFiltros((atuais) => ({ ...atuais, conta: (evento.target.value || undefined) as ContaEditorial | undefined }))}>
                  <option value="">Todas as redes</option>
                  {contasNaFila.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome}</option>)}
                </select>
                <select aria-label="Idioma" value={filtros.idioma || ''} onChange={(evento) => setFiltros((atuais) => ({ ...atuais, idioma: (evento.target.value || undefined) as FiltrosListaFila['idioma'] }))}>
                  <option value="">Todos os idiomas</option>
                  {idiomasNaFila.map((idioma) => <option key={idioma.id} value={idioma.id}>{idioma.nome}</option>)}
                </select>
                <select aria-label="Formato" value={filtros.formato || ''} onChange={(evento) => setFiltros((atuais) => ({ ...atuais, formato: (evento.target.value || undefined) as FiltrosListaFila['formato'] }))}>
                  <option value="">Todos os formatos</option>
                  {formatosNaFila.map((formato) => <option key={formato.id} value={formato.id}>{formato.nome}</option>)}
                </select>
                {projetosNaFila.length > 0 && (
                  <select aria-label="Projeto" value={filtros.projeto || ''} onChange={(evento) => setFiltros((atuais) => ({ ...atuais, projeto: evento.target.value || undefined }))}>
                    <option value="">Todos os projetos</option>
                    {projetosNaFila.map((projeto) => <option key={projeto} value={projeto}>{nomeProjeto(projeto)}</option>)}
                  </select>
                )}
                <select aria-label="Ordem" data-testid="fila-ordem" value={filtros.ordem || 'recente'} onChange={(evento) => setFiltros((atuais) => ({ ...atuais, ordem: evento.target.value as FiltrosListaFila['ordem'] }))}>
                  <option value="recente">Mais recentes</option>
                  <option value="antiga">Mais antigas</option>
                </select>
                {pautaSelecionada && <Botao kind="ghost" onClick={() => setPautaSelecionada('')}>Todas as pautas</Botao>}
                {temFiltros && <Botao kind="ghost" onClick={limparFiltros}>Limpar filtros</Botao>}
              </div>
              {modoSelecao && <div className="fila-bulk-bar" role="region" aria-label="Ações em massa">
                <span>{selecionados.size} {selecionados.size === 1 ? 'item selecionado' : 'itens selecionados'}</span>
                <button type="button" className="fila-button fila-button--quiet" onClick={() => { const todosSelecionaveis = visiveis.filter((item) => !['aguardando_executor', 'publicando'].includes(item.estado)); setSelecionados(new Set(todosSelecionaveis.map((item) => item.id))) }}>Selecionar todos</button>
                <button type="button" className="fila-button fila-button--quiet" onClick={() => setSelecionados(new Set())}>Limpar</button>
                {confirmandoExclusao ? <><span>Os itens irão para o arquivo e poderão ser recuperados manualmente.</span><button type="button" className="fila-button fila-button--danger" disabled={excluindo || selecionados.size === 0} onClick={() => void excluirSelecionados()}>{excluindo ? 'Excluindo…' : 'Confirmar exclusão'}</button><button type="button" className="fila-button fila-button--quiet" onClick={() => setConfirmandoExclusao(false)}>Voltar</button></> : <button type="button" className="fila-button fila-button--danger" disabled={selecionados.size === 0} onClick={() => setConfirmandoExclusao(true)}>Excluir selecionados</button>}
              </div>}
              {carregando ? <p className="dw-vazio">Carregando a fila…</p> : visiveis.length === 0 ? <p className="dw-vazio">{filaAtiva.length ? 'Nenhum item corresponde a estes filtros.' : 'A fila está vazia. Escreva um post, peça um assunto ao redator ou gere um lote.'}</p> : <div className="fila-linhas">{visiveis.map((item) => (
                <LinhaPeca
                  key={item.id}
                  item={item}
                  jobAtivo={jobs.some((job) => job.itemId === item.id && (job.status === 'planned' || job.status === 'producing'))}
                  pronta={ehProntaParaRevisao(item)}
                  podePublicar={ehProntaParaPublicar(item, capacidades, capacidadesCarregadas, acessoDaConta(conexoes, item.conta))}
                  busy={busyId === item.id || excluindo}
                  destacado={destacarId === item.id}
                  onAbrir={() => { setConfirmandoApagarId(''); setSelecionadoId(item.id); setArquivoAberto(null) }}
                  onPublicar={() => { setConfirmandoApagarId(''); executarAcao(item.id, 'publicar', async () => publicarEditorial(item.id, item.revisao, acessoDaConta(conexoes, item.conta)?.perfilUrl)) }}
                  onApagar={() => pedirExclusao(item)}
                  confirmandoApagar={confirmandoApagarId === item.id}
                  modoSelecao={modoSelecao}
                  selecionado={selecionados.has(item.id)}
                  onSelecionar={(marcado) => alternarSelecao(item.id, marcado)}
                />
              ))}</div>}
            </Bloco>
          )}
          <ColunaDia modulo="fila" agora={<div className="fila-agora">
            <div className="fila-agora-titulo"><span className={`fila-agora-ponto ${produzindo || editorialRodando ? 'is-on' : editorialBloq ? 'is-off' : ''}`} /><strong>{produzindo ? 'Produzindo conteúdo' : editorialRodando ? editorialRodando.nome : editorialBloq ? 'Parada · aguardando você' : proximaPublicacao ? `Em espera · publicação prevista às ${hora(proximaPublicacao.prevista)}` : 'Em espera'}</strong></div>
            <p>{produzindo ? (estado?.producao.etapa || estado?.producao.mensagem || '') : editorialBloq ? `${editorialBloq.nome} não concluiu.` : `${contagemProntas} peça(s) disponível(is) para revisão.${proximaProducao ? ` Próxima produção às ${hora(proximaProducao.prevista)}.` : ''}`}</p>
            <div className="fila-agora-acoes">{prontasVisiveis.length > 1 && <Botao kind="primary" disabled={Boolean(busyId)} onClick={() => { setSelecionadoId(prontasVisiveis[0].id);setArquivoAberto(null);setDestacarId(prontasVisiveis[0].id) }}>Revisar {prontasVisiveis.length} peças</Botao>}<Botao onClick={() => destacarSecao('fila-producao')}>Ver produção</Botao></div>
          </div>} />
        </div>
        <details className="cand-schedule" open={agendaAberta} onToggle={(e) => setAgendaAberta((e.target as HTMLDetailsElement).open)}><summary>Agenda, orientações e horários</summary>{agendaAberta && <AgendaModulo modulo="editorial" />}</details>
      </Pagina>
      {selecionado && (
        <div className="fila-modal-backdrop" role="presentation" onClick={() => { setSelecionadoId(''); setArquivoAberto(null) }}>
          <div className="fila-modal" role="dialog" aria-modal="true" aria-label={`Revisão de ${selecionado.titulo || 'peça sem título'}`} ref={modalRef} tabIndex={-1} onClick={(evento) => evento.stopPropagation()}>
            <ItemCard
              key={selecionado.id}
              item={selecionado}
              versoesDaPauta={versoesPorPautaLista[selecionado.pautaId] || [selecionado]}
              onPautaClick={(pautaId) => { setPautaSelecionada(pautaId); setSelecionadoId(''); setArquivoAberto(null); setVisao('fila') }}
              busy={busyId === selecionado.id || excluindo}
              onAction={executarAcao}
              onError={(mensagem) => setErro(mensagem)}
              onEspelhado={(mensagem) => { setAviso(mensagem); void carregar({ silencioso: true }) }}
              jobs={jobs}
              capacidades={capacidades}
              capacidadesCarregadas={capacidadesCarregadas}
              autorizarGasto={configMidia?.autorizarGasto === true}
              onMediaChanged={() => void carregar({ silencioso: true })}
              acesso={acessoDaConta(conexoes, selecionado.conta)}
              onConectar={(conta) => onNavegar?.(`conexao:${conta}`)}
              onNavegar={onNavegar}
              onFechar={() => { setSelecionadoId(''); setArquivoAberto(null); setConfirmandoApagarId('') }}
              somenteLeitura={selecionado.estado === 'publicado'}
              onApagar={() => pedirExclusao(selecionado)}
              confirmandoApagar={confirmandoApagarId === selecionado.id}
              onAtualizado={(item) => {
                setItems((atuais) => atuais.some((atual) => atual.id === item.id) ? atuais.map((atual) => atual.id === item.id ? item : atual) : atuais)
                setArquivoAberto((atual) => atual?.id === item.id ? item : atual)
              }}
            />
          </div>
        </div>
      )}
    </main>
  )
}
