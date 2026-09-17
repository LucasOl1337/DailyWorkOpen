import type { CadastroCampanha, CatalogoCampanhas, PesquisaEmpresa, NavegadorCampanha, ConferenciaInteracao, InteracaoAutomacao, EstadoAutomacoes, DisparoAutomacao, AlvoManualEntrada, ResultadoAlvoAutomacao, BibliotecaAutomacao, ConteudoFonteAutomacao, PedidoContextoAutomacao, ContextoAutomacao, MaterialAutomacao } from './automacoes'
export type * from './automacoes'
import type { Bloco } from './md'
import sitePublico from './site-publico.json'
import type {
  CatalogoConhecimento,
  ContextoPrincipal,
  NotaConhecimento,
} from './conhecimento'
import type {
  DestinoFechamento,
  PacoteContextoDia,
  RascunhoDia,
  ReciboFechamento,
  ReciboPropostaContexto,
  RevisaoFechamento,
  RevisaoSemana,
} from './fluxo'

// Envelope padrão das respostas (HTTP e IPC): { ok, data?, erro? }.
export interface ErroApi {
  codigo: string
  mensagem: string
}

type Resposta<T> = { ok: boolean; data?: T; erro?: ErroApi }

export interface PerfilAgente {
  id: string
  nome: string
  familia: string
  rota: string
  alias?: string
  fallback?: string | null
  catalogado: boolean | null
}

export type ProvedorAgenteId = '9router' | 'grok-cli'

export type EscopoAgente = 'dia' | 'principal' | 'global'

export interface ProvedorAgente {
  id: ProvedorAgenteId
  nome: string
  selecionado: boolean
}

export interface ConfiguracaoAgente {
  provider: ProvedorAgenteId
  conectado: boolean
  catalogoDisponivel: boolean
  perfilPadrao: string
  configuracaoPersistida: { provider: ProvedorAgenteId; perfilId: string | null } | null
  provedores: ProvedorAgente[]
  catalogos: Record<ProvedorAgenteId, PerfilAgente[]>
  capacidades: {
    texto: boolean
    imagens: boolean
    ferramentas: boolean
    reasoningDoCliente: false
  }
  perfis: PerfilAgente[]
}

export interface SecaoContextoAgente {
  id: string
  titulo: string
  quantidade: number
  detalhe: string
}

export interface InspecaoContextoAgente {
  escopo: EscopoAgente
  dia: string | null
  hoje: string | null
  prompt: string
  caracteresPrompt: number
  contextoDuravelIncluido: boolean
  ferramentas: string[]
  secoes: SecaoContextoAgente[]
}

export type SondagemProvedores = Record<
  ProvedorAgenteId,
  { conectado: boolean; modelos?: number; codigo?: string }
>

export interface MensagemAgente {
  role: 'user' | 'assistant'
  content: string
}

export interface AnexoAgente {
  nome: string
  mimeType: string
  base64: string
}

export interface ReciboAcaoAgente {
  tipo: string
  descricao: string
  blocoId: string
}

export interface ConfirmacaoAgente {
  id: string
  tipo: 'criar' | 'atualizar' | 'status' | 'arquivar' | 'publicar' | 'canvas'
  descricao: string
  detalhe: string
  blocoId?: string
  preview: {
    antes: PreviewBlocoAgente | null
    depois: PreviewBlocoAgente | null
  }
}

export interface PreviewBlocoAgente {
  tipo: string
  titulo: string
  status: string
  corpo: string
  conexoes: string[]
}

export interface RespostaAgente {
  mensagem: string
  perfil: { id: string; nome: string; rota: string }
  fallback?: FallbackModelo | null
  acoes: ReciboAcaoAgente[]
  confirmacoes: ConfirmacaoAgente[]
  ferramentasUsadas: string[]
  contexto: {
    escopo: EscopoAgente
    dia: string | null
    hoje?: string | null
    totalBlocos: number
    foco: string | null
    contextoDuravelIncluido: boolean
  }
}

export interface FallbackModelo {
  de: { id: string; nome: string; rota: string }
  para: { id: string; nome: string; rota: string }
}

export type StatusExecucaoNativa =
  | 'na_fila'
  | 'executando'
  | 'concluida'
  | 'precisa_atencao'
  | 'cancelada'
  | 'falhou'

export interface ResultadoExecucaoNativa {
  blocoId: string
  titulo?: string
  concluido: boolean
  resumo: string
  evidencias?: string[]
  arquivosAlterados?: string[]
  perfil?: { id: string; nome: string; rota: string }
  fallback?: FallbackModelo | null
  erro?: string
}

export interface ExecucaoNativa {
  id: string
  dia: string
  blocos: string[]
  status: StatusExecucaoNativa
  etapa: string
  criadoEm: string
  atualizadoEm: string
  iniciadoEm: string | null
  finalizadoEm: string | null
  blocoIdAtual: string | null
  tituloAtual: string | null
  repositorioAtual: string | null
  resultados: ResultadoExecucaoNativa[]
  erro: { codigo: string; mensagem: string } | null
}

export interface EstadoExecutorNativo {
  ativo: ExecucaoNativa | null
  historico: ExecucaoNativa[]
}

export interface RespostaConfirmacaoAgente {
  mensagem: string
  acao: ReciboAcaoAgente
}

export interface EntradaConversaAgente {
  escopo?: EscopoAgente
  dia?: string
  perfilId?: string
  mensagens: MensagemAgente[]
  anexos?: AnexoAgente[]
  usarContextoDuravel?: boolean
}

export type StatusSumario = 'not_collected' | 'empty' | 'partial' | 'complete'
export type StatusFonteSumario = 'not_found' | 'empty' | 'partial' | 'complete'

export interface EstatisticasSumario {
  conversations: number
  messages: number
  userMessages: number
  agentMessages: number
  participantMessages: number
  toolEvents: number
  omittedTechnicalEvents: number
  characters: number
  bytes: number
}

export interface CoberturaSumario {
  id: string
  label: string
  discovered: boolean
  status: StatusFonteSumario
  files: number
  records: number
  conversations: number
  messages: number
  errors: string[]
  notes: string[]
}

export interface MensagemPreviewSumario {
  id: string
  timestamp: string | null
  role: 'user' | 'assistant' | 'participant' | 'system' | 'tool'
  kind: string
  text: string
}

export interface ConversaSumario {
  id: string
  source: string
  app: string
  title: string
  cwd: string | null
  startedAt: string | null
  updatedAt: string | null
  messageCount: number
  technicalEvents?: { total: number; kept: number; omitted: number }
  preview: MensagemPreviewSumario[]
}

export interface DadosSumarioDiario {
  schemaVersion?: number
  day: string
  timezone?: string
  window?: { start: string; end: string }
  generatedAt: string | null
  completeness: StatusSumario
  scope?: { included: string; excluded: string }
  stats: EstatisticasSumario | null
  coverage: CoberturaSumario[]
  file: string
  conversations: ConversaSumario[]
}

export interface InputHumanoSumario {
  id: string
  sequence: number
  source: string
  app: string
  conversationId: string
  conversationTitle: string
  cwd: string | null
  timestamp: string | null
  text: string
  content?: unknown
}

export interface FonteInputsSumario {
  id: string
  label: string
  status: StatusFonteSumario
  conversations: number
  messages: number
  errorCount: number
  inputCount: number
}

export interface DadosInputsSumario {
  schemaVersion: number
  day: string
  timezone?: string
  window?: { start: string; end: string }
  generatedAt: string | null
  completeness: StatusSumario
  scope: { included: string; excluded: string }
  stats: {
    inputs: number
    characters: number
    conversations: number
    sources: number
  }
  sources: FonteInputsSumario[]
  inputs: InputHumanoSumario[]
}

export interface SiteActiveRelease {
  hash: string
  publishedAt: string
  schemaVersion: number
}

export interface SiteStatus {
  configured: boolean
  baseUrl: string
  online: boolean
  active: SiteActiveRelease | null
  error: string | null
}

export interface SitePublicationProposal {
  proposalId: string
  localHash: string
  remoteHash: string | null
  remotePublishedAt: string | null
  generatedAt: string
  schemaVersion: number
  changed: boolean
  expiresAt: string
}

export interface SiteMetrics {
  days: number
  items: Array<{
    day: string
    name: string
    surface: string
    target: string
    count: number
  }>
}

export interface ProgressoAnaliseSumario {
  stage: 'map' | 'reduce' | 'final'
  completed: number
  total: number
  reused?: number
  layer?: number
}

export interface ArtefatoAnaliseSumario {
  schemaVersion: number
  day: string
  generatedAt: string
  corpusGeneratedAt: string
  corpusFile: string
  corpusCompleteness: StatusSumario
  corpusStats: EstatisticasSumario
  profile: { id: string; nome: string; rota: string }
  pipeline: {
    promptVersion: number
    finalPromptVersion: number
    fragments: number
    reusedFragments: number
    reductionLayers: number
  }
  request: string
  summaryMarkdown: string
  studies: Array<{
    context: string
    subject: string
    markdown: string
  }>
  questions: QuestaoEstudoSumario[]
  chat: Array<{
    id: string
    role: 'user' | 'assistant'
    kind: 'corpus_attachment' | 'daily_analysis'
    content: string
    attachment?: {
      name: string
      path: string
      bytes: number
      conversations: number
      userMessages: number
      agentMessages: number
    }
  }>
}

export interface QuestaoEstudoSumario {
  id: string
  prompt: string
  options: Array<{ id: string; text: string }>
  correctOptionId: string
  explanation: string
  order: number
}

export interface RespostaEstudoSumario {
  questionId: string
  optionId: string
  correct: boolean
  answeredAt: string
}

export interface MensagemChatSumario {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  profile?: { id: string; nome: string; rota: string }
}

export interface InteracoesSumario {
  schemaVersion: number
  day: string
  analysisGeneratedAt: string | null
  updatedAt: string | null
  answers: Record<string, RespostaEstudoSumario>
  chat: MensagemChatSumario[]
}

export type EntradaInteracaoSumario =
  | { type: 'answer'; questionId: string; optionId: string }
  | { type: 'chat'; profileId: string; message: string }

export interface AnaliseSumarioDiario {
  day: string
  defaultProfileId: string
  status: 'not_collected' | 'not_analyzed' | 'outdated' | 'complete'
  generatedAt: string | null
  analysis: ArtefatoAnaliseSumario | null
  interactions: InteracoesSumario
}

export interface EstadoEscalaInterface {
  modo: 'automatico' | 'manual'
  zoom: number
}

declare global {
  interface Window {
    // Exposto pelo preload do Electron (electron/preload.cjs). Ausente no browser.
    dailyworkApi?: {
      listar: (dia?: string) => Promise<Resposta<Bloco[]>>
      obter: (id: string, dia?: string) => Promise<Resposta<Bloco>>
      criar: (bloco: Partial<Bloco>, dia?: string) => Promise<Resposta<Bloco>>
      atualizar: (id: string, patch: Partial<Bloco>, dia?: string) => Promise<Resposta<Bloco>>
      excluir: (id: string, dia?: string) => Promise<Resposta<{ excluido: boolean }>>
      salvar: (
        blocos: Bloco[],
        opts?: { dry?: boolean; dia?: string }
      ) => Promise<Resposta<{ total?: number; dry?: boolean; ignorado?: boolean; diff: DiffSnapshot }>>
      listarDias: () => Promise<Resposta<string[]>>
      listarSessoes: () => Promise<Resposta<string[]>>
      criarSessao: (id: string) => Promise<Resposta<unknown>>
      carregarSessao: (id: string) => Promise<Resposta<unknown | null>>
      salvarSessao: (id: string, snapshot: unknown) => Promise<Resposta<unknown>>
      excluirSessao: (id: string) => Promise<Resposta<unknown>>
      carregarFoto: () => Promise<Resposta<string | null>>
      salvarMidiaPortfolio: (entrada: {
        nome: string
        mimeType: string
        base64: string
      }) => Promise<Resposta<MidiaPortfolio>>
      carregarMidiaPortfolio: (caminho: string) => Promise<Resposta<string | null>>
      listarConhecimento: () => Promise<Resposta<CatalogoConhecimento>>
      obterNotaConhecimento: (caminho: string) => Promise<Resposta<NotaConhecimento>>
      salvarNotaConhecimento: (
        caminho: string,
        conteudo: string,
        etag: string
      ) => Promise<Resposta<NotaConhecimento>>
      salvarPosicoesConhecimento: (
        posicoes: Record<string, { x: number; y: number }>
      ) => Promise<Resposta<{ ok: boolean; positions?: Record<string, { x: number; y: number }> }>>
      removerPosicaoConhecimento: (caminho: string) => Promise<Resposta<{ ok: boolean }>>
      excluirNotaConhecimento: (caminho: string) => Promise<Resposta<boolean>>
      contextoPrincipal: () => Promise<Resposta<ContextoPrincipal>>
      prepararDia: (entrada: { dia: string; projetoId?: string }) => Promise<Resposta<PacoteContextoDia>>
      confirmarPropostas: (entrada: {
        dia: string
        packId: string
        propostaIds: string[]
        projetoId?: string
      }) => Promise<Resposta<ReciboPropostaContexto[]>>
      revisarFechamento: (entrada: { dia: string }) => Promise<Resposta<RevisaoFechamento>>
      confirmarFechamento: (entrada: {
        dia: string
        reviewId: string
        destinos: DestinoFechamento[]
      }) => Promise<Resposta<ReciboFechamento[]>>
      revisarSemana: (entrada: { ate: string }) => Promise<Resposta<RevisaoSemana>>
      rascunharDia: (entrada: { dia: string; perfilId?: string }) => Promise<Resposta<RascunhoDia>>
      configurarAgente: () => Promise<Resposta<ConfiguracaoAgente>>
      salvarConfiguracaoAgente: (entrada: {
        provider: ProvedorAgenteId
        perfilId: string
      }) => Promise<Resposta<ConfiguracaoAgente>>
      sondarProvedoresAgente: () => Promise<Resposta<SondagemProvedores>>
      inspecionarContextoAgente: (entrada: {
        escopo?: EscopoAgente
        dia?: string
        usarContextoDuravel?: boolean
      }) => Promise<Resposta<InspecaoContextoAgente>>
      conversarComAgente: (
        entrada: EntradaConversaAgente
      ) => Promise<Resposta<RespostaAgente>>
      confirmarAcaoAgente: (entrada: {
        escopo?: EscopoAgente
        dia?: string
        acaoId: string
      }) => Promise<Resposta<RespostaConfirmacaoAgente>>
      iniciarExecutorNativo: (entrada: { dia: string; blocoId?: string }) => Promise<Resposta<ExecucaoNativa>>
      obterEstadoExecutorNativo: (dia: string) => Promise<Resposta<EstadoExecutorNativo>>
      cancelarExecutorNativo: (entrada: { execucaoId: string }) => Promise<Resposta<ExecucaoNativa>>
      obterSumario: (dia: string) => Promise<Resposta<DadosSumarioDiario>>
      obterInputsSumario: (dia: string) => Promise<Resposta<DadosInputsSumario>>
      coletarSumario: (dia: string) => Promise<Resposta<DadosSumarioDiario>>
      obterAnaliseSumario: (dia: string) => Promise<Resposta<AnaliseSumarioDiario>>
      analisarSumario: (dia: string, perfilId?: string) => Promise<Resposta<AnaliseSumarioDiario>>
      interagirSumario: (
        dia: string,
        entrada: EntradaInteracaoSumario
      ) => Promise<Resposta<AnaliseSumarioDiario>>
      obterStatusSite: () => Promise<Resposta<SiteStatus>>
      configurarSite: (entrada: { token: string }) => Promise<Resposta<{ configured: boolean; baseUrl: string }>>
      obterMetricasSite: () => Promise<Resposta<SiteMetrics>>
      prepararPublicacaoSite: () => Promise<Resposta<SitePublicationProposal>>
      confirmarPublicacaoSite: (entrada: { proposalId: string }) => Promise<Resposta<SiteActiveRelease>>
      listarConexoes: () => Promise<Resposta<Conexao[]>>
      obterStatusConexao: (id: string) => Promise<Resposta<Conexao>>
      sessaoVisual?: (acao: string, entrada?: Record<string, unknown>) => Promise<Resposta<unknown>>
      configurarConexao: (id: string, entrada: Record<string, string | boolean>) => Promise<Resposta<Conexao>>
      desconectarConexao: (id: string) => Promise<Resposta<Conexao>>
      autorizarConexao: (id: string) => Promise<Resposta<{ url: string; estado: string }>>
      obterPerfilConexao: (id: string) => Promise<Resposta<PerfilConexao>>
      obterSinaisConexao: (id: string, dia: string, opcoes?: { forcar?: boolean }) => Promise<Resposta<SinaisConexao>>
      prepararPublicacaoConexao: (id: string, entrada: Record<string, string | boolean>) => Promise<Resposta<PropostaPublicacao>>
      confirmarPublicacaoConexao: (entrada: { proposalId: string }) => Promise<Resposta<ReciboPublicacao>>
      cancelarPublicacaoConexao: (entrada: { proposalId: string }) => Promise<Resposta<{ cancelada: boolean }>>
      rascunharPublicacaoConexao: (entrada: { conta: string; dia: string; briefing?: string; perfilId?: string }) => Promise<Resposta<RascunhoPublicacao>>
      limparSessaoConexao: (id: string) => Promise<Resposta<{ limpa: boolean; partition: string }>>
      prepararSessaoConexao: (id: string, opcoes?: { forcar?: boolean }) => Promise<Resposta<SessaoViewer>>
      onBlocosExternos: (cb: () => void) => () => void
      onConhecimentoExterno: (cb: () => void) => () => void
      onSumarioAtualizado: (cb: (payload: { dia: string }) => void) => () => void
      onAnaliseSumarioProgresso: (
        cb: (payload: { dia: string; progresso: ProgressoAnaliseSumario }) => void
      ) => () => void
      onAnaliseSumarioAtualizada: (cb: (payload: { dia: string }) => void) => () => void
      onExecutorAtualizado: (cb: (payload: ExecucaoNativa) => void) => () => void
      obterEscala: () => Promise<Resposta<EstadoEscalaInterface>>
      alterarEscala: (direcao: number) => Promise<Resposta<EstadoEscalaInterface>>
      resetarEscala: () => Promise<Resposta<EstadoEscalaInterface>>
      onEscala: (cb: (payload: EstadoEscalaInterface) => void) => () => void
      bibliotecaAutomacoes: (campanhaId?: string) => Promise<Resposta<BibliotecaAutomacao>>
      fonteAutomacao: (id: string, campanhaId?: string) => Promise<Resposta<ConteudoFonteAutomacao>>
      selecaoAutomacoes: (entrada: { fontes: string[]; revisao: string }, campanhaId?: string) => Promise<Resposta<BibliotecaAutomacao>>
      prepararContextoAutomacao: (entrada: PedidoContextoAutomacao, campanhaId?: string) => Promise<Resposta<ContextoAutomacao>>
      contextoAutomacao: (id: string, campanhaId?: string) => Promise<Resposta<ContextoAutomacao>>
      gerarMaterialAutomacao: (entrada: { contextoId: string }, campanhaId?: string) => Promise<Resposta<MaterialAutomacao>>
      conferirInteracaoAutomacao: (entrada: ConferenciaInteracao, campanhaId?: string) => Promise<Resposta<InteracaoAutomacao>>
      materialAutomacao: (id: string, campanhaId?: string) => Promise<Resposta<MaterialAutomacao>>
      estadoAutomacoes: (campanhaId?: string) => Promise<Resposta<EstadoAutomacoes>>
      executarAutomacao: (campanhaId?: string) => Promise<Resposta<DisparoAutomacao>>
      abrirPerfilAutomacao: (campanhaId?: string) => Promise<Resposta<NavegadorCampanha>>
      evidenciaAutomacao: (arquivo: string, campanhaId?: string) => Promise<Resposta<string>>
      alvoAutomacao: (entrada: AlvoManualEntrada, campanhaId?: string) => Promise<Resposta<ResultadoAlvoAutomacao>>
      campanhaOperacao: (acao: string, entrada?: unknown, campanhaId?: string) => Promise<Resposta<unknown>>
    }
  }
}

// ===================== Automações =====================
export async function obterEstadoAutomacoes(campanhaId = 'cognition'): Promise<EstadoAutomacoes> {
  if (window.dailyworkApi?.estadoAutomacoes) return desembrulhar(await window.dailyworkApi.estadoAutomacoes(campanhaId))
  return http(rotaCampanha('/api/automacoes', campanhaId))
}
export async function executarAutomacao(campanhaId = 'cognition'): Promise<DisparoAutomacao> {
  if (window.dailyworkApi?.executarAutomacao) return desembrulhar(await window.dailyworkApi.executarAutomacao(campanhaId))
  return http(rotaCampanha('/api/automacoes/executar', campanhaId), { method: 'POST' })
}
export async function abrirPerfilAutomacao(campanhaId = 'cognition'): Promise<NavegadorCampanha> {
  if (window.dailyworkApi?.abrirPerfilAutomacao) return desembrulhar(await window.dailyworkApi.abrirPerfilAutomacao(campanhaId))
  return http(rotaCampanha('/api/automacoes/abrir-perfil', campanhaId), { method: 'POST' })
}
export async function obterEvidenciaAutomacao(arquivo: string, campanhaId = 'cognition'): Promise<string> {
  if (window.dailyworkApi?.evidenciaAutomacao) return desembrulhar(await window.dailyworkApi.evidenciaAutomacao(arquivo, campanhaId))
  return http(rotaCampanha(`/api/automacoes/evidencia?arquivo=${encodeURIComponent(arquivo)}`, campanhaId))
}
export async function adicionarAlvoAutomacao(entrada: AlvoManualEntrada, campanhaId = 'cognition'): Promise<ResultadoAlvoAutomacao> {
  if (window.dailyworkApi?.alvoAutomacao) return desembrulhar(await window.dailyworkApi.alvoAutomacao(entrada, campanhaId))
  return http(rotaCampanha('/api/automacoes/alvo', campanhaId), { method: 'POST', body: JSON.stringify(entrada) })
}
export async function obterBibliotecaAutomacoes(campanhaId = 'cognition'): Promise<BibliotecaAutomacao> {
  if (window.dailyworkApi?.bibliotecaAutomacoes) return desembrulhar(await window.dailyworkApi.bibliotecaAutomacoes(campanhaId))
  return http(rotaCampanha('/api/automacoes/biblioteca', campanhaId))
}
export async function obterFonteAutomacao(id: string, campanhaId = 'cognition'): Promise<ConteudoFonteAutomacao> {
  if (window.dailyworkApi?.fonteAutomacao) return desembrulhar(await window.dailyworkApi.fonteAutomacao(id, campanhaId))
  return http(rotaCampanha(`/api/automacoes/fonte?id=${encodeURIComponent(id)}`, campanhaId))
}
export async function salvarSelecaoAutomacoes(entrada: { fontes: string[]; revisao: string }, campanhaId = 'cognition'): Promise<BibliotecaAutomacao> {
  if (window.dailyworkApi?.selecaoAutomacoes) return desembrulhar(await window.dailyworkApi.selecaoAutomacoes(entrada, campanhaId))
  return http(rotaCampanha('/api/automacoes/selecao', campanhaId), { method: 'POST', body: JSON.stringify(entrada) })
}
export async function prepararContextoAutomacao(entrada: PedidoContextoAutomacao, campanhaId = 'cognition'): Promise<ContextoAutomacao> {
  if (window.dailyworkApi?.prepararContextoAutomacao) return desembrulhar(await window.dailyworkApi.prepararContextoAutomacao(entrada, campanhaId))
  return http(rotaCampanha('/api/automacoes/contexto', campanhaId), { method: 'POST', body: JSON.stringify(entrada) })
}
export async function obterContextoAutomacao(id: string, campanhaId = 'cognition'): Promise<ContextoAutomacao> {
  if (window.dailyworkApi?.contextoAutomacao) return desembrulhar(await window.dailyworkApi.contextoAutomacao(id, campanhaId))
  return http(rotaCampanha(`/api/automacoes/contexto?id=${encodeURIComponent(id)}`, campanhaId))
}
export async function gerarMaterialAutomacao(entrada: { contextoId: string }, campanhaId = 'cognition'): Promise<MaterialAutomacao> {
  if (window.dailyworkApi?.gerarMaterialAutomacao) return desembrulhar(await window.dailyworkApi.gerarMaterialAutomacao(entrada, campanhaId))
  return http(rotaCampanha('/api/automacoes/material', campanhaId), { method: 'POST', body: JSON.stringify(entrada) })
}
export async function obterMaterialAutomacao(id: string, campanhaId = 'cognition'): Promise<MaterialAutomacao> {
  if (window.dailyworkApi?.materialAutomacao) return desembrulhar(await window.dailyworkApi.materialAutomacao(id, campanhaId))
  return http(rotaCampanha(`/api/automacoes/material?id=${encodeURIComponent(id)}`, campanhaId))
}

export async function conferirInteracaoAutomacao(entrada: ConferenciaInteracao, campanhaId = 'cognition'): Promise<InteracaoAutomacao> {
  if (window.dailyworkApi?.conferirInteracaoAutomacao) return desembrulhar(await window.dailyworkApi.conferirInteracaoAutomacao(entrada, campanhaId))
  return http(rotaCampanha('/api/automacoes/interacao-conferir', campanhaId), { method: 'POST', body: JSON.stringify(entrada) })
}

export interface DiffSnapshot {
  criar: string[]
  atualizar: string[]
  arquivar: string[]
}

export interface MidiaPortfolio {
  caminho: string
  mimeType: string
  bytes: number
  dataUrl: string
}

function desembrulhar<T>(r: Resposta<T>): T {
  if (!r || typeof r !== 'object' || !('ok' in r)) {
    // Resposta fora do envelope (ex: middleware antigo) — devolve como está.
    return r as T
  }
  if (!r.ok) {
    const codigo = r.erro?.codigo ?? 'ERRO'
    const mensagem = codigo === 'ERRO_INTERNO'
      ? 'Não foi possível concluir esta ação. Tente novamente.'
      : r.erro?.mensagem ?? 'Não foi possível concluir esta ação.'
    throw new Error(mensagem)
  }
  return r.data as T
}

async function http<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(caminho, init)
  const corpo = (await r.json()) as Resposta<T>
  if (!r.ok && !('ok' in (corpo as object))) {
    throw new Error('Não foi possível concluir esta ação. Tente novamente.')
  }
  return desembrulhar(corpo)
}

// ===================== Blocos =====================

function queryDia(dia?: string): string {
  return dia ? `dia=${encodeURIComponent(dia)}` : ''
}

function comQuery(caminho: string, query: string): string {
  return query ? `${caminho}?${query}` : caminho
}

export async function listarBlocos(dia?: string): Promise<Bloco[]> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.listar(dia))
  return http(comQuery('/api/blocos', queryDia(dia)))
}

export async function listarDias(): Promise<string[]> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.listarDias())
  return http('/api/dias')
}

export async function obterBloco(id: string, dia?: string): Promise<Bloco> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.obter(id, dia))
  return http(comQuery(`/api/blocos/${encodeURIComponent(id)}`, queryDia(dia)))
}

export async function criarBloco(bloco: Partial<Bloco>, dia?: string): Promise<Bloco> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.criar(bloco, dia))
  return http(comQuery('/api/blocos', queryDia(dia)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bloco),
  })
}

export async function atualizarBloco(
  id: string,
  patch: Partial<Bloco>,
  dia?: string
): Promise<Bloco> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.atualizar(id, patch, dia))
  }
  return http(comQuery(`/api/blocos/${encodeURIComponent(id)}`, queryDia(dia)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// Soft-delete: o arquivo vai para o _arquivo/ do próprio escopo.
export async function excluirBloco(id: string, dia?: string): Promise<boolean> {
  if (window.dailyworkApi) {
    const r = desembrulhar(await window.dailyworkApi.excluir(id, dia))
    return r.excluido
  }
  const r = await http<{ excluido: boolean }>(
    comQuery(`/api/blocos/${encodeURIComponent(id)}`, queryDia(dia)),
    { method: 'DELETE' }
  )
  return r.excluido
}

export async function salvarBlocos(
  blocos: Bloco[],
  opts?: { dry?: boolean; dia?: string }
): Promise<{ total?: number; dry?: boolean; ignorado?: boolean; diff: DiffSnapshot }> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.salvar(blocos, opts))
  const query = [queryDia(opts?.dia), opts?.dry ? 'dry=1' : ''].filter(Boolean).join('&')
  return http(comQuery('/api/blocos', query), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blocos),
  })
}

// ===================== Sessões livres =====================

export async function listarSessoes(): Promise<string[]> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.listarSessoes())
  return http('/api/sessoes')
}

export async function criarSessao(id: string): Promise<void> {
  if (window.dailyworkApi) {
    desembrulhar(await window.dailyworkApi.criarSessao(id))
    return
  }
  await http(`/api/sessoes/${encodeURIComponent(id)}`, { method: 'POST' })
}

// Snapshot do tldraw (JSON nativo) ou null para sessão vazia/inexistente.
export async function carregarSessao(id: string): Promise<unknown | null> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.carregarSessao(id))
  return http(`/api/sessoes/${encodeURIComponent(id)}`)
}

export async function salvarSessao(id: string, snapshot: unknown): Promise<void> {
  if (window.dailyworkApi) {
    desembrulhar(await window.dailyworkApi.salvarSessao(id, snapshot))
    return
  }
  await http(`/api/sessoes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}

// Move a sessão para sessoes/_arquivo/ (recuperável).
export async function excluirSessao(id: string): Promise<void> {
  if (window.dailyworkApi) {
    desembrulhar(await window.dailyworkApi.excluirSessao(id))
    return
  }
  await http(`/api/sessoes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ===================== Foto =====================

// Foto do bloco "pessoa" (assets/eu.*) como data URL, ou null se não existir.
export async function carregarFoto(): Promise<string | null> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.carregarFoto())
  return http('/api/foto')
}

// ===================== Portfólio, Stack e conhecimento =====================

export async function salvarMidiaPortfolio(entrada: {
  nome: string
  mimeType: string
  base64: string
}): Promise<MidiaPortfolio> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.salvarMidiaPortfolio(entrada))
  }
  return http('/api/portfolio/midias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export async function carregarMidiaPortfolio(caminho: string): Promise<string | null> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.carregarMidiaPortfolio(caminho))
  }
  return http(`/api/portfolio/midias?caminho=${encodeURIComponent(caminho)}`)
}

export async function listarConhecimento(): Promise<CatalogoConhecimento> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.listarConhecimento())
  }
  return http('/api/conhecimento')
}

export async function obterNotaConhecimento(caminho: string): Promise<NotaConhecimento> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.obterNotaConhecimento(caminho))
  }
  return http(`/api/conhecimento/nota?caminho=${encodeURIComponent(caminho)}`)
}

export async function salvarNotaConhecimento(
  caminho: string,
  conteudo: string,
  etag: string
): Promise<NotaConhecimento> {
  if (window.dailyworkApi) {
    return desembrulhar(
      await window.dailyworkApi.salvarNotaConhecimento(caminho, conteudo, etag)
    )
  }
  return http('/api/conhecimento/nota', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caminho, conteudo, etag }),
  })
}

export async function salvarPosicoesConhecimento(
  posicoes: Record<string, { x: number; y: number }>
): Promise<void> {
  if (window.dailyworkApi) {
    await window.dailyworkApi.salvarPosicoesConhecimento(posicoes)
    return
  }
  await http('/api/conhecimento/posicoes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posicoes }),
  })
}

export async function removerPosicaoConhecimento(caminho: string): Promise<void> {
  if (window.dailyworkApi) {
    await window.dailyworkApi.removerPosicaoConhecimento(caminho)
    return
  }
  await http('/api/conhecimento/posicao', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caminho }),
  })
}

export async function excluirNotaConhecimento(caminho: string): Promise<boolean> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.excluirNotaConhecimento(caminho))
  }
  return http('/api/conhecimento/nota', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caminho }),
  })
}

export async function obterContextoPrincipal(): Promise<ContextoPrincipal> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.contextoPrincipal())
  }
  return http('/api/conhecimento/contexto-diario')
}

// ===================== Fluxo integrado LucasOL =====================

export async function prepararDia(dia: string, projetoId?: string): Promise<PacoteContextoDia> {
  const entrada = { dia, ...(projetoId ? { projetoId } : {}) }
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.prepararDia(entrada))
  const query = new URLSearchParams({ dia })
  if (projetoId) query.set('projeto', projetoId)
  return http(`/api/fluxo/preparar-dia?${query.toString()}`)
}

export async function confirmarPropostas(
  dia: string,
  packId: string,
  propostaIds: string[],
  projetoId?: string
): Promise<ReciboPropostaContexto[]> {
  const entrada = { dia, packId, propostaIds, ...(projetoId ? { projetoId } : {}) }
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.confirmarPropostas(entrada))
  }
  return http('/api/fluxo/confirmar-propostas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export async function revisarFechamento(dia: string): Promise<RevisaoFechamento> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.revisarFechamento({ dia }))
  }
  return http(`/api/fluxo/revisar-fechamento?dia=${encodeURIComponent(dia)}`)
}

export async function confirmarFechamento(
  dia: string,
  reviewId: string,
  destinos: DestinoFechamento[]
): Promise<ReciboFechamento[]> {
  const entrada = { dia, reviewId, destinos }
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.confirmarFechamento(entrada))
  }
  return http('/api/fluxo/confirmar-fechamento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export async function revisarSemana(ate: string): Promise<RevisaoSemana> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.revisarSemana({ ate }))
  }
  return http(`/api/fluxo/revisar-semana?ate=${encodeURIComponent(ate)}`)
}

export async function rascunharDia(dia: string, perfilId?: string): Promise<RascunhoDia> {
  const entrada = { dia, ...(perfilId ? { perfilId } : {}) }
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.rascunharDia(entrada))
  return http('/api/fluxo/rascunhar-dia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

// ===================== Agente diário via Grok CLI (9Router opcional) =====================

export async function configurarAgente(): Promise<ConfiguracaoAgente> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.configurarAgente())
  }
  return http('/api/agente/config')
}

export async function salvarConfiguracaoAgente(entrada: {
  provider: ProvedorAgenteId
  perfilId: string
}): Promise<ConfiguracaoAgente> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.salvarConfiguracaoAgente(entrada))
  }
  return http('/api/agente/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export async function sondarProvedoresAgente(): Promise<SondagemProvedores> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.sondarProvedoresAgente())
  }
  return http('/api/agente/provedores')
}

export async function inspecionarContextoAgente(entrada: {
  escopo?: EscopoAgente
  dia?: string
  usarContextoDuravel?: boolean
}): Promise<InspecaoContextoAgente> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.inspecionarContextoAgente(entrada))
  }
  const params = new URLSearchParams()
  if (entrada.escopo) params.set('escopo', entrada.escopo)
  if (entrada.dia) params.set('dia', entrada.dia)
  if (entrada.usarContextoDuravel) params.set('contextoDuravel', '1')
  return http(`/api/agente/contexto?${params.toString()}`)
}

export async function conversarComAgente(
  entrada: EntradaConversaAgente
): Promise<RespostaAgente> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.conversarComAgente(entrada))
  }
  return http('/api/agente/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export async function confirmarAcaoAgente(
  escopo: EscopoAgente,
  dia: string | undefined,
  acaoId: string
): Promise<RespostaConfirmacaoAgente> {
  const entrada = { escopo, ...(dia ? { dia } : {}), acaoId }
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.confirmarAcaoAgente(entrada))
  }
  return http('/api/agente/confirmar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

// ===================== Executor nativo =====================

export async function iniciarExecutorNativo(
  dia: string,
  blocoId?: string
): Promise<ExecucaoNativa> {
  const entrada = { dia, ...(blocoId ? { blocoId } : {}) }
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.iniciarExecutorNativo(entrada))
  }
  return http('/api/executor/iniciar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export async function obterEstadoExecutorNativo(dia: string): Promise<EstadoExecutorNativo> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.obterEstadoExecutorNativo(dia))
  }
  return http(`/api/executor/estado?dia=${encodeURIComponent(dia)}`)
}

export async function cancelarExecutorNativo(execucaoId: string): Promise<ExecucaoNativa> {
  const entrada = { execucaoId }
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.cancelarExecutorNativo(entrada))
  }
  return http('/api/executor/cancelar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
  })
}

export function aoAtualizarExecutorNativo(
  dia: string,
  cb: (execucao: ExecucaoNativa) => void
): () => void {
  if (window.dailyworkApi?.onExecutorAtualizado) {
    return window.dailyworkApi.onExecutorAtualizado((execucao) => {
      if (execucao?.dia === dia) cb(execucao)
    })
  }
  return () => {}
}

// ===================== Sumário Diário =====================

export async function obterSumarioDiario(dia: string): Promise<DadosSumarioDiario> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.obterSumario(dia))
  }
  return http(`/api/sumario?dia=${encodeURIComponent(dia)}`)
}

export async function obterInputsSumarioDiario(dia: string): Promise<DadosInputsSumario> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.obterInputsSumario(dia))
  }
  return http(`/api/sumario/inputs?dia=${encodeURIComponent(dia)}`)
}

export async function coletarSumarioDiario(dia: string): Promise<DadosSumarioDiario> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.coletarSumario(dia))
  }
  return http('/api/sumario/coletar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dia }),
  })
}

export async function obterAnaliseSumarioDiario(dia: string): Promise<AnaliseSumarioDiario> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.obterAnaliseSumario(dia))
  }
  return http(`/api/sumario/analise?dia=${encodeURIComponent(dia)}`)
}

export async function gerarAnaliseSumarioDiario(
  dia: string,
  perfilId = 'grok-4-6'
): Promise<AnaliseSumarioDiario> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.analisarSumario(dia, perfilId))
  }
  return http('/api/sumario/analisar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dia, perfilId }),
  })
}

export async function interagirComSumarioDiario(
  dia: string,
  entrada: EntradaInteracaoSumario
): Promise<AnaliseSumarioDiario> {
  if (window.dailyworkApi) {
    return desembrulhar(await window.dailyworkApi.interagirSumario(dia, entrada))
  }
  return http('/api/sumario/interagir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dia, ...entrada }),
  })
}

// ===================== site público =====================

function exigirIntegracaoSite() {
  if (!window.dailyworkApi) throw new Error(`A integração com ${sitePublico.host} está disponível somente no app desktop.`)
  return window.dailyworkApi
}

export async function obterStatusSite(): Promise<SiteStatus> {
  return desembrulhar(await exigirIntegracaoSite().obterStatusSite())
}

export async function configurarSite(token: string): Promise<{ configured: boolean; baseUrl: string }> {
  return desembrulhar(await exigirIntegracaoSite().configurarSite({ token }))
}

export async function obterMetricasSite(): Promise<SiteMetrics> {
  return desembrulhar(await exigirIntegracaoSite().obterMetricasSite())
}

export async function prepararPublicacaoSite(): Promise<SitePublicationProposal> {
  return desembrulhar(await exigirIntegracaoSite().prepararPublicacaoSite())
}

export async function confirmarPublicacaoSite(proposalId: string): Promise<SiteActiveRelease> {
  return desembrulhar(await exigirIntegracaoSite().confirmarPublicacaoSite({ proposalId }))
}

// ===================== Conexões externas =====================

export interface CampoConexao {
  campo: string
  rotulo: string
  tipo: 'text' | 'password' | 'textarea' | 'select' | 'boolean'
  opcional?: boolean
  ajuda?: string
  max?: number
  padrao?: string
  opcoes?: Array<{ valor: string; rotulo: string }>
}

export interface ContaConexao {
  login: string
  nome: string
  url: string
  avatar: string | null
}

export interface StatusConexao {
  id: string
  configured: boolean
  origemCredencial: string | null
  online: boolean
  conta: ContaConexao | null
  error: string | null
  expiraEm?: string | null
  autorizacao?: { estado: 'ociosa' | 'aguardando' | 'concluida' | 'falhou'; erro: string | null; url: string | null }
}

export interface Conexao {
  visual?: EstadoSessaoVisual | null
  id: string
  nome: string
  dominio: string
  dominiosSessao: string[]
  urlInicial: string
  partition: string
  capacidades: { ler: boolean; publicar: boolean; sinais: boolean; oauth: boolean }
  esquemaConfiguracao: CampoConexao[]
  esquemaPublicacao: CampoConexao[]
  orientacaoRedacao: string
  status: StatusConexao | null
}

export interface PerfilConexao {
  login: string
  nome: string
  bio?: string
  url: string
  avatar: string | null
  [extra: string]: unknown
}

export interface SinalConexao {
  id: string
  timestamp: string | null
  tipo: string
  titulo: string
  texto: string
  url: string | null
  [extra: string]: unknown
}

export interface SinaisConexao {
  conta: string
  nome: string
  dia: string
  itens: SinalConexao[]
  erros: string[]
  indisponivel?: string
  coletadoEm: string
}

export interface PropostaPublicacao {
  proposalId: string
  conta: string
  tipo: string
  resumo: string
  preview: { titulo: string; corpo: string; destino: string }
  hash: string
  expiresAt: string
}

export interface ReciboPublicacao {
  transporte?: 'sessao_visual'
  jobId?: string
  estado?: string
  erro?: string | null
  recibo?: { id?: string; url?: string } | null
  conta: string
  nome: string
  tipo: string
  resumo: string
  id: string | null
  url: string | null
  hash: string
  publishedAt: string
}

export interface EstadoSessaoVisual {
  transporte: 'api' | 'sessao_visual'
  sessao: string
  executor: string
  disponivel: boolean
  contaEsperada: { perfilUrl: string; nome: string } | null
  contaVerificada: { perfilUrl: string; nome: string } | null
  verificadaEm: string | null
}

export async function operarSessaoVisual<T = EstadoSessaoVisual>(acao: string, entrada: Record<string, unknown> = {}): Promise<T> {
  if (window.dailyworkApi?.sessaoVisual) return desembrulhar(await window.dailyworkApi.sessaoVisual(acao, entrada)) as T
  const leitura = ['estado','jobs','job'].includes(acao)
  const parametros = new URLSearchParams()
  if (entrada.conta) parametros.set('conta', String(entrada.conta))
  if (entrada.jobId) parametros.set('jobId', String(entrada.jobId))
  const query = parametros.size ? `?${parametros}` : ''
  return http(`/api/integracoes/sessao-visual/${encodeURIComponent(acao)}${query}`, leitura ? undefined : jsonInit(entrada))
}

export interface RascunhoPublicacao {
  conta: string
  dia: string | null
  rascunho: Record<string, string | boolean>
  contextoUsado: boolean
}

function jsonInit(corpo: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
}

export function conexoesDisponiveisNoDesktop(): boolean {
  return Boolean(window.dailyworkApi)
}

export function escalaDisponivelNoDesktop(): boolean {
  return Boolean(window.dailyworkApi?.obterEscala)
}

export async function obterEscalaInterface(): Promise<EstadoEscalaInterface> {
  if (!window.dailyworkApi?.obterEscala) return { modo: 'automatico', zoom: 1 }
  return desembrulhar(await window.dailyworkApi.obterEscala())
}

export async function alterarEscalaInterface(direcao: number): Promise<EstadoEscalaInterface> {
  if (!window.dailyworkApi?.alterarEscala) return { modo: 'automatico', zoom: 1 }
  return desembrulhar(await window.dailyworkApi.alterarEscala(direcao))
}

export async function resetarEscalaInterface(): Promise<EstadoEscalaInterface> {
  if (!window.dailyworkApi?.resetarEscala) return { modo: 'automatico', zoom: 1 }
  return desembrulhar(await window.dailyworkApi.resetarEscala())
}

export function aoMudarEscalaInterface(cb: (estado: EstadoEscalaInterface) => void): () => void {
  if (window.dailyworkApi?.onEscala) return window.dailyworkApi.onEscala(cb)
  return () => {}
}

export async function listarConexoes(): Promise<Conexao[]> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.listarConexoes())
  return http('/api/integracoes')
}

export async function obterStatusConexao(id: string): Promise<Conexao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.obterStatusConexao(id))
  return http(`/api/integracoes/${encodeURIComponent(id)}/status`)
}

export async function configurarConexao(id: string, entrada: Record<string, string | boolean>): Promise<Conexao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.configurarConexao(id, entrada))
  return http(`/api/integracoes/${encodeURIComponent(id)}/configurar`, jsonInit(entrada))
}

export async function desconectarConexao(id: string): Promise<Conexao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.desconectarConexao(id))
  return http(`/api/integracoes/${encodeURIComponent(id)}/desconectar`, jsonInit({}))
}

export async function autorizarConexao(id: string): Promise<{ url: string; estado: string }> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.autorizarConexao(id))
  return http(`/api/integracoes/${encodeURIComponent(id)}/autorizar`, jsonInit({}))
}

export async function obterPerfilConexao(id: string): Promise<PerfilConexao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.obterPerfilConexao(id))
  return http(`/api/integracoes/${encodeURIComponent(id)}/perfil`)
}

export async function obterSinaisConexao(id: string, dia: string, forcar = false): Promise<SinaisConexao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.obterSinaisConexao(id, dia, { forcar }))
  return http(`/api/integracoes/${encodeURIComponent(id)}/sinais?dia=${encodeURIComponent(dia)}${forcar ? '&forcar=1' : ''}`)
}

export async function prepararPublicacaoConexao(id: string, entrada: Record<string, string | boolean>): Promise<PropostaPublicacao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.prepararPublicacaoConexao(id, entrada))
  return http(`/api/integracoes/${encodeURIComponent(id)}/preparar-publicacao`, jsonInit(entrada))
}

export async function confirmarPublicacaoConexao(proposalId: string): Promise<ReciboPublicacao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.confirmarPublicacaoConexao({ proposalId }))
  return http('/api/integracoes/confirmar-publicacao', jsonInit({ proposalId }))
}

export async function cancelarPublicacaoConexao(proposalId: string): Promise<{ cancelada: boolean }> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.cancelarPublicacaoConexao({ proposalId }))
  return http('/api/integracoes/cancelar-publicacao', jsonInit({ proposalId }))
}

export async function rascunharPublicacaoConexao(entrada: {
  conta: string
  dia: string
  briefing?: string
  perfilId?: string
}): Promise<RascunhoPublicacao> {
  if (window.dailyworkApi) return desembrulhar(await window.dailyworkApi.rascunharPublicacaoConexao(entrada))
  return http(`/api/integracoes/${encodeURIComponent(entrada.conta)}/rascunhar`, jsonInit(entrada))
}

export async function limparSessaoConexao(id: string): Promise<{ limpa: boolean; partition: string }> {
  if (!window.dailyworkApi) throw new Error('A sessão do viewer só existe no app desktop.')
  return desembrulhar(await window.dailyworkApi.limparSessaoConexao(id))
}

export type SessaoViewer = {
  origem: 'viewer' | 'chromium' | 'nenhuma'
  navegador: string | null
  perfil?: string | null
  importados: number
  removidos?: number
  sessaoDoDominio?: boolean
  motivo?: string | null
  erros?: string[]
  em?: string
}

// Traz a sessão do Chromium instalado para o viewer da conexão. Sem `forcar`,
// só importa na primeira abertura; com `forcar`, substitui os domínios em que
// o navegador tem sessão.
export async function prepararSessaoConexao(id: string, opcoes: { forcar?: boolean } = {}): Promise<SessaoViewer> {
  if (!window.dailyworkApi) throw new Error('A sessão do viewer só existe no app desktop.')
  return desembrulhar(await window.dailyworkApi.prepararSessaoConexao(id, opcoes))
}

// ===================== Mudanças externas =====================

// Assinatura: chamada quando um agente escreve em data/ fora da UI.
// No Electron vem do fs.watch (main.cjs); no dev Vite vem do websocket.
// Retorna função de cancelamento.
export function aoMudarBlocosExternos(cb: () => void): () => void {
  if (window.dailyworkApi?.onBlocosExternos) return window.dailyworkApi.onBlocosExternos(cb)
  if (import.meta.hot) {
    import.meta.hot.on('dailywork:blocos-externos', cb)
    return () => import.meta.hot?.off('dailywork:blocos-externos', cb)
  }
  return () => {}
}

export function aoMudarConhecimento(cb: () => void): () => void {
  if (window.dailyworkApi?.onConhecimentoExterno) {
    return window.dailyworkApi.onConhecimentoExterno(cb)
  }
  if (import.meta.hot) {
    import.meta.hot.on('dailywork:conhecimento-externo', cb)
    return () => import.meta.hot?.off('dailywork:conhecimento-externo', cb)
  }
  return () => {}
}

export function aoAtualizarSumario(dia: string, cb: () => void): () => void {
  if (window.dailyworkApi?.onSumarioAtualizado) {
    return window.dailyworkApi.onSumarioAtualizado((payload) => {
      if (payload?.dia === dia) cb()
    })
  }
  if (import.meta.hot) {
    const listener = (payload: { dia?: string }) => {
      if (payload?.dia === dia) cb()
    }
    import.meta.hot.on('dailywork:sumario-atualizado', listener)
    return () => import.meta.hot?.off('dailywork:sumario-atualizado', listener)
  }
  return () => {}
}

export function aoProgressoAnaliseSumario(
  dia: string,
  cb: (progresso: ProgressoAnaliseSumario) => void
): () => void {
  if (window.dailyworkApi?.onAnaliseSumarioProgresso) {
    return window.dailyworkApi.onAnaliseSumarioProgresso((payload) => {
      if (payload?.dia === dia) cb(payload.progresso)
    })
  }
  if (import.meta.hot) {
    const listener = (payload: { dia?: string; progresso?: ProgressoAnaliseSumario }) => {
      if (payload?.dia === dia && payload.progresso) cb(payload.progresso)
    }
    import.meta.hot.on('dailywork:sumario-analise-progresso', listener)
    return () => import.meta.hot?.off('dailywork:sumario-analise-progresso', listener)
  }
  return () => {}
}

export function aoAtualizarAnaliseSumario(dia: string, cb: () => void): () => void {
  if (window.dailyworkApi?.onAnaliseSumarioAtualizada) {
    return window.dailyworkApi.onAnaliseSumarioAtualizada((payload) => {
      if (payload?.dia === dia) cb()
    })
  }
  if (import.meta.hot) {
    const listener = (payload: { dia?: string }) => {
      if (payload?.dia === dia) cb()
    }
    import.meta.hot.on('dailywork:sumario-analise-atualizada', listener)
    return () => import.meta.hot?.off('dailywork:sumario-analise-atualizada', listener)
  }
  return () => {}
}

function rotaCampanha(rota: string, campanhaId: string) { return `${rota}${rota.includes('?') ? '&' : '?'}campanha=${encodeURIComponent(campanhaId)}` }
async function campanhaOperacao<T>(acao: string, rota: string, entrada?: unknown, campanhaId = 'cognition', post = false): Promise<T> {
  if (window.dailyworkApi?.campanhaOperacao) return desembrulhar(await window.dailyworkApi.campanhaOperacao(acao, entrada, campanhaId)) as T
  return http(rotaCampanha('/api/automacoes/' + rota, campanhaId), post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entrada ?? {}) } : undefined)
}
export const obterCatalogoCampanhas = () => campanhaOperacao<CatalogoCampanhas>('catalogo', 'campanhas')
export const criarCampanha = (entrada: { nome: string; site?: string; objetivo?: string }) => campanhaOperacao<CadastroCampanha>('campanha-criar', 'campanhas', entrada, 'cognition', true)
export const configurarCampanha = (entrada: { revisao: string; executor: string }, campanhaId: string) => campanhaOperacao<CadastroCampanha>('campanha-configurar', 'campanha-configurar', entrada, campanhaId, true)
export const obterPesquisaEmpresa = (id: string) => campanhaOperacao<PesquisaEmpresa>('pesquisa', 'pesquisa', undefined, id)
export const salvarPesquisaEmpresa = (entrada: PesquisaEmpresa, id: string) => campanhaOperacao<PesquisaEmpresa>('pesquisa-salvar', 'pesquisa', entrada, id, true)
export const pesquisarEmpresa = (id: string) => campanhaOperacao<DisparoAutomacao>('pesquisar', 'pesquisar', undefined, id, true)
export const cancelarCampanha = (id: string, campanhaId: string) => campanhaOperacao<{ encerrado: boolean }>('cancelar', 'cancelar', { id }, campanhaId, true)
export const importarSessaoCampanha = (campanhaId = 'cognition') => campanhaOperacao<NavegadorCampanha>('navegador-importar', 'navegador-importar', undefined, campanhaId, true)
export const mostrarNavegadorCampanha = (campanhaId = 'cognition') => campanhaOperacao<unknown>('navegador-mostrar', 'navegador-mostrar', undefined, campanhaId, true)

export const abrirPaginaCampanha = (url: string, campanhaId = 'cognition') => campanhaOperacao<NavegadorCampanha>('navegador-abrir', 'navegador-abrir', { url }, campanhaId, true)
