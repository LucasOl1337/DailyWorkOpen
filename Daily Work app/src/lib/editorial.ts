export type ContaEditorial = 'linkedin' | 'x' | 'github' | 'reddit'
export type IdiomaEditorial = 'pt-BR' | 'en'
export type FormatoEditorial = 'texto' | 'imagem' | 'video'
export type EstadoEditorial =
  | 'pendente'
  | 'agendado'
  | 'aguardando_executor'
  | 'publicando'
  | 'publicado'
  | 'recusado'
  | 'erro'
  | 'incerto'

export interface MidiaEditorial {
  id: string
  tipo: 'imagem' | 'video' | string
  arquivo: string
  mime?: string
}

export interface FonteEditorial {
  rotulo: string
  url?: string
}

export interface ParteOrigemEditorial {
  tipo: string
  rotulo: string
  dia?: string
  url?: string
  projeto?: string
}

export interface OrigemEditorial {
  tipo: 'dia' | 'acervo' | 'pedido' | 'manual'
  dia?: string
  projeto?: string
  loteDia?: string
  partes?: ParteOrigemEditorial[]
}

export type ModoPublicacaoEditorial = 'supervisionado' | 'automatico'
export interface PoliticaPublicacaoEditorial { modo: ModoPublicacaoEditorial; atualizadoEm: string | null }
export interface BloqueioPublicacaoEditorial { codigo: string; mensagem: string; sinais?: { padrao: string; nivel: string; trecho: string; correcao: string }[] }
export interface ProntidaoEditorial { pronta: boolean; modo: ModoPublicacaoEditorial; bloqueios: BloqueioPublicacaoEditorial[] }

export interface ItemEditorial {
  editorial?: {
    versao: string
    pauta: { titulo: string; leitor: string; situacao: string; tese: string; interesse: string; limites: string; tema?: string; problema?: string; resolucao?: string; conclusao?: string; contexto?: string; protagonista?: string; uso?: string; valorLeitor?: string; desfecho?: string; evidencias: Array<{ id: string; trecho: string; sustenta: string }>; midia: { tipo: 'nenhuma' | 'captura' | 'ilustracao'; objetivo: string; direcao?: string } }
    qualidade: { estado: 'aprovada' | 'alterada' | 'pedido_direto'; aprovado: boolean; parecer?: string; notas: Record<string, number>; problemas?: string[]; sinais?: { padrao: string; nivel?: string; trecho?: string; correcao?: string; origem?: string }[] }
    execucoes?: Array<{ etapa: string; perfilSolicitado?: string; perfilUsado?: string; modelo?: string; duracaoMs?: number }>
  }
  feedback?: { motivo: string; registradoEm: string }
  publicacao?: { jobId?: string; estado?: string; transporte?: string }
  prontidao?: ProntidaoEditorial
  id: string
  pautaId: string
  conta: ContaEditorial
  idioma: IdiomaEditorial
  formato: FormatoEditorial
  titulo: string
  texto: string
  campos: Record<string, string | number | boolean | null | undefined>
  midias: MidiaEditorial[]
  fontes: FonteEditorial[]
  origem: OrigemEditorial
  estado: EstadoEditorial
  revisao: number
  criadoEm: string
  atualizadoEm: string
  agendadoPara?: string
  recibo?: { id?: string; url?: string; publishedAt?: string; comprovante?: ComprovanteEditorial }
  erro?: { codigo?: string; mensagem?: string } | string
}

export interface ComprovanteEditorial {
  arquivo: string
  sha256: string
  capturadoEm: string
}

export interface PedidoEditorial {
  tema: string
  contexto?: string
  projeto?: string
  fontes?: FonteEditorial[]
}

export interface EntradaHistoricoEditorial {
  id: string
  conta: ContaEditorial
  idioma: IdiomaEditorial
  titulo: string
  texto: string
  publishedAt: string
  url: string | null
  midias: MidiaEditorial[]
  comprovante: ComprovanteEditorial | null
  origem: OrigemEditorial | null
  arquivado: boolean
}

export interface FiltrosEditorial {
  estado?: EstadoEditorial
  conta?: ContaEditorial
  idioma?: IdiomaEditorial
}

export interface ConfiguracaoProducaoEditorial {
  ativa: boolean
  quantidade: number
  contas: ContaEditorial[]
  idiomas: IdiomaEditorial[]
  intervaloMinutos: number
  estoqueAlvo: number
  midiaAutomatica?: boolean
  formatoMidia?: 'imagem' | 'video'
  perfilId?: string
}

export interface ProducaoEditorial {
  agenda?: { id: string }
  etapa?: string
  pautaAtual?: string
  historias?: number
  descartadas?: Array<{ pautaId: string; titulo: string; motivo: string }>
  status: 'ociosa' | 'executando' | 'concluida' | 'cancelada' | 'erro' | string
  id?: string
  mensagem?: string
  criados?: string[]
  erros?: { pautaId?: string; conta?: string; idioma?: string; codigo?: string; mensagem?: string }[]
  erro?: { codigo?: string; mensagem?: string } | string
  iniciadoEm?: string
  atualizadoEm?: string
}

export interface EstadoFilaEditorial {
  producao: ProducaoEditorial
  config: ConfiguracaoProducaoEditorial
  projetos?: Array<{ id: string; nome: string; datasAtividade: string[]; temImagem: boolean }>
}

export type StatusJobMidia = 'planned' | 'producing' | 'ready' | 'failed' | 'cancelled'
export interface ConfiguracaoMidiaEditorial { autorizarGasto: boolean }

export interface PassoRoteiroEditorial {
  id: 'tema' | 'problema' | 'resolucao' | 'conclusao' | string
  rotulo: string
  papel?: string
  proposito: string
  instrucao: string
}
export interface LogicaEditorial {
  versao: number
  roteiro: PassoRoteiroEditorial[]
  voz: { tom: string; naturalidade: string; evitar: string }
  imagem: { funcao: string; cena: string; evitar: string }
  notas: string
  origem?: 'arquivo' | 'padrao'
  padrao?: boolean
  atualizadoEm?: string | null
  snapshot?: { versao: number; hash: string; roteiro: string[] }
  preview?: { pauta: string; redacao: string; revisao: string; imagem: string; resumo: string; cobertura: string }
}

export interface VereditoRevisaoVisual {
  provedor: string
  accepted: boolean
  identity_fidelity?: string
  topology?: string
  text?: string
  intent_alignment?: string
  notes?: string
}

export interface RevisaoVisualMidia {
  tentativas: number
  vencedor: string
  vereditos: VereditoRevisaoVisual[]
  degradada?: boolean
  motivo?: string
  motor?: string
}

export interface JobMidiaEditorial {
  etapa?: string
  id: string
  itemId: string
  revisao: number
  tipo: 'imagem' | 'video'
  status: StatusJobMidia
  briefing?: string
  params?: { alvo?: string; foco?: string; provedores?: string; roteiroFile?: string; [chave: string]: unknown }
  factoryWork?: string
  midias?: MidiaEditorial[]
  artefatosComplementares?: string[]
  revisaoVisual?: RevisaoVisualMidia
  erro?: { codigo?: string; mensagem?: string } | string
  criadoEm?: string
  atualizadoEm?: string
  concluidoEm?: string
}

interface Resposta<T> {
  ok: boolean
  data?: T
  erro?: { codigo?: string; mensagem?: string }
}

export class ErroEditorial extends Error {
  codigo: string

  constructor(codigo: string, mensagem: string) {
    super(mensagem)
    this.name = 'ErroEditorial'
    this.codigo = codigo
  }
}

type BridgeEditorial = {
  listar: (filtros?: FiltrosEditorial) => Promise<Resposta<ItemEditorial[]>>
  obter: (id: string) => Promise<Resposta<ItemEditorial>>
  criar: (entrada: Partial<ItemEditorial>) => Promise<Resposta<ItemEditorial>>
  atualizar: (id: string, entrada: Record<string, unknown>) => Promise<Resposta<ItemEditorial>>
  excluirMuitos?: (entrada: { itens: Array<{ id: string; revisao: number }> }) => Promise<Resposta<ResultadoExclusaoEditorial>>
  publicar: (id: string, entrada: { revisao: number }) => Promise<Resposta<ItemEditorial>>
  agendar: (id: string, entrada: { revisao: number; agendadoPara: string }) => Promise<Resposta<ItemEditorial>>
  verificar?: (id: string) => Promise<Resposta<ProntidaoEditorial & { id: string }>>
  politicaPublicacao?: () => Promise<Resposta<PoliticaPublicacaoEditorial>>
  configurarPublicacao?: (entrada: { modo: ModoPublicacaoEditorial }) => Promise<Resposta<PoliticaPublicacaoEditorial>>
  recusar: (id: string, entrada: { revisao: number; motivo?: string }) => Promise<Resposta<ItemEditorial>>
  reabrir: (id: string, entrada: { revisao: number }) => Promise<Resposta<ItemEditorial>>
  espelhar?: (id: string, entrada: { conta?: ContaEditorial; idioma?: IdiomaEditorial; perfilId?: string }) => Promise<Resposta<ItemEditorial>>
  estado: () => Promise<Resposta<EstadoFilaEditorial>>
  gerar: (entrada: {
    dia: string
    quantidade?: number
    contas?: ContaEditorial[]
    idiomas?: IdiomaEditorial[]
    briefing?: string
    perfilId?: string
    pedido?: PedidoEditorial
  }) => Promise<Resposta<EstadoFilaEditorial>>
  cancelarProducao: () => Promise<Resposta<ProducaoEditorial>>
  configurar: (entrada: Partial<ConfiguracaoProducaoEditorial>) => Promise<Resposta<EstadoFilaEditorial | ConfiguracaoProducaoEditorial>>
  logica?: () => Promise<Resposta<LogicaEditorial>>
  salvarLogica?: (entrada: Partial<LogicaEditorial>) => Promise<Resposta<LogicaEditorial>>
  restaurarLogica?: () => Promise<Resposta<LogicaEditorial>>
  lerMidia: (itemId: string, midiaId: string) => Promise<Resposta<string>>
  historico?: (filtros?: { conta?: ContaEditorial; desde?: string; ate?: string }) => Promise<Resposta<EntradaHistoricoEditorial[]>>
  lerComprovante?: (id: string) => Promise<Resposta<string>>
  capturarComprovante?: (id: string) => Promise<Resposta<ItemEditorial>>
  onAtualizado?: (cb: (item: ItemEditorial) => void) => () => void
  onProducaoAtualizada?: (cb: (estado: EstadoFilaEditorial) => void) => () => void
  capacidades?: () => Promise<Resposta<unknown>>
  configuracaoMidia?: () => Promise<Resposta<ConfiguracaoMidiaEditorial>>
  configurarMidia?: (entrada: ConfiguracaoMidiaEditorial) => Promise<Resposta<ConfiguracaoMidiaEditorial>>
  listarJobsMidia?: (filtros?: { status?: StatusJobMidia }) => Promise<Resposta<JobMidiaEditorial[]>>
  obterJobMidia?: (id: string) => Promise<Resposta<JobMidiaEditorial | null>>
  iniciarJobMidia?: (entrada: Record<string, unknown>) => Promise<Resposta<{ job: JobMidiaEditorial }>>
  cancelarJobMidia?: (id: string) => Promise<Resposta<{ job: JobMidiaEditorial }>>
  retomarJobsMidia?: () => Promise<Resposta<{ retomados: string[] }>>
  onJobMidiaAtualizado?: (cb: (job: JobMidiaEditorial) => void) => () => void
  // Aliases aceitos durante a transição do preload, removíveis após a integração.
  listarMidiaJobs?: (filtros?: { status?: StatusJobMidia }) => Promise<Resposta<JobMidiaEditorial[]>>
  obterMidiaJob?: (id: string) => Promise<Resposta<JobMidiaEditorial | null>>
  iniciarMidiaJob?: (entrada: Record<string, unknown>) => Promise<Resposta<{ job: JobMidiaEditorial }>>
  cancelarMidiaJob?: (id: string) => Promise<Resposta<{ job: JobMidiaEditorial }>>
  retomarMidiaJobs?: () => Promise<Resposta<{ retomados: string[] }>>
  onMidiaJobAtualizado?: (cb: (job: JobMidiaEditorial) => void) => () => void
}

export interface ResultadoExclusaoEditorial {
  excluidos: string[]
  falhas: Array<{ id: string; codigo: string; mensagem: string }>
}

declare global {
  interface Window {
    dailyworkEditorial?: BridgeEditorial
  }
}

function desembrulhar<T>(resposta: Resposta<T>): T {
  if (!resposta || typeof resposta !== 'object' || !('ok' in resposta)) return resposta as T
  if (!resposta.ok) {
    const erro = resposta.erro
    throw new ErroEditorial(erro?.codigo || 'ERRO', erro?.mensagem || 'Não foi possível concluir esta ação.')
  }
  return resposta.data as T
}

async function http<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(caminho, init)
  let corpo: Resposta<T>
  try {
    corpo = (await resposta.json()) as Resposta<T>
  } catch {
    throw new ErroEditorial('RESPOSTA_INVALIDA', 'O serviço editorial devolveu uma resposta inválida.')
  }
  if (!resposta.ok && !('ok' in (corpo as object))) {
    throw new ErroEditorial('HTTP_' + resposta.status, 'O serviço editorial não respondeu corretamente.')
  }
  return desembrulhar(corpo)
}

function jsonInit(corpo: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
}

export async function listarEditorial(filtros: FiltrosEditorial = {}): Promise<ItemEditorial[]> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.listar(filtros))
  const query = new URLSearchParams()
  if (filtros.estado) query.set('estado', filtros.estado)
  if (filtros.conta) query.set('conta', filtros.conta)
  if (filtros.idioma) query.set('idioma', filtros.idioma)
  return http(`/api/editorial/itens${query.size ? `?${query.toString()}` : ''}`)
}

export async function obterEditorial(id: string): Promise<ItemEditorial> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.obter(id))
  return http(`/api/editorial/itens/${encodeURIComponent(id)}`)
}

export async function criarEditorial(entrada: Partial<ItemEditorial>): Promise<ItemEditorial> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.criar(entrada))
  return http('/api/editorial/itens', jsonInit(entrada))
}

export async function atualizarEditorial(id: string, entrada: Record<string, unknown>): Promise<ItemEditorial> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.atualizar(id, entrada))
  return http(`/api/editorial/itens/${encodeURIComponent(id)}`, { ...jsonInit(entrada), method: 'PATCH' })
}

export async function excluirEditoriais(itens: Array<{ id: string; revisao: number }>): Promise<ResultadoExclusaoEditorial> {
  const entrada = { itens }
  if (window.dailyworkEditorial?.excluirMuitos) {
    try {
      return desembrulhar(await window.dailyworkEditorial.excluirMuitos(entrada))
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      const processoPrincipalDesatualizado = /No handler registered for ['\"]editorial:excluir-muitos['\"]/i.test(mensagem)
      if (!processoPrincipalDesatualizado) throw erro
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return http('/api/editorial/itens', { ...jsonInit(entrada), method: 'DELETE' })
      }
      throw new ErroEditorial(
        'APP_DESATUALIZADO',
        'O DailyWork foi atualizado enquanto estava aberto. Feche e abra o app para ativar a exclusão em massa.'
      )
    }
  }
  if (window.dailyworkEditorial) {
    throw new ErroEditorial(
      'APP_DESATUALIZADO',
      'O DailyWork foi atualizado enquanto estava aberto. Feche e abra o app para ativar a exclusão em massa.'
    )
  }
  return http('/api/editorial/itens', { ...jsonInit(entrada), method: 'DELETE' })
}

async function acaoEditorial(id: string, acao: string, entrada: Record<string, unknown>): Promise<ItemEditorial> {
  if (window.dailyworkEditorial) {
    const metodo = window.dailyworkEditorial[acao as keyof BridgeEditorial] as unknown as (
      id: string,
      entrada: Record<string, unknown>
    ) => Promise<Resposta<ItemEditorial>>
    return desembrulhar(await metodo(id, entrada))
  }
  return http(`/api/editorial/itens/${encodeURIComponent(id)}/${acao}`, jsonInit(entrada))
}

export function publicarEditorial(id: string, revisao: number, perfilUrl?: string) {
  return acaoEditorial(id, 'publicar', { revisao, perfilUrl })
}

export function agendarEditorial(id: string, revisao: number, agendadoPara: string, perfilUrl?: string) {
  return acaoEditorial(id, 'agendar', { revisao, agendadoPara, perfilUrl })
}

export async function politicaPublicacaoEditorial(): Promise<PoliticaPublicacaoEditorial> {
  if (window.dailyworkEditorial?.politicaPublicacao) return desembrulhar(await window.dailyworkEditorial.politicaPublicacao())
  return http('/api/editorial/publicacao')
}

// Só a interface do app muda a política; o HTTP de desenvolvimento responde SOMENTE_DESKTOP.
export async function configurarPublicacaoEditorial(modo: ModoPublicacaoEditorial): Promise<PoliticaPublicacaoEditorial> {
  if (window.dailyworkEditorial?.configurarPublicacao) return desembrulhar(await window.dailyworkEditorial.configurarPublicacao({ modo }))
  return http('/api/editorial/publicacao', jsonInit({ modo }))
}

export function recusarEditorial(id: string, revisao: number, motivo?: string) {
  return acaoEditorial(id, 'recusar', { revisao, motivo })
}

export function reabrirEditorial(id: string, revisao: number) {
  return acaoEditorial(id, 'reabrir', { revisao })
}

export function espelharEditorial(
  id: string,
  entrada: { conta?: ContaEditorial; idioma?: IdiomaEditorial; perfilId?: string } = {}
) {
  return acaoEditorial(id, 'espelhar', entrada)
}

export async function obterEstadoEditorial(): Promise<EstadoFilaEditorial> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.estado())
  return http('/api/editorial/estado')
}

export async function gerarEditorial(entrada: {
  dia: string
  reavaliar?: boolean
  quantidade?: number
  contas?: ContaEditorial[]
  idiomas?: IdiomaEditorial[]
  briefing?: string
  perfilId?: string
  perfilEditor?: string
  perfilVisao?: string
  projetos?: string[]
  desde?: string
  ate?: string
  exigirMidia?: boolean
  pedido?: PedidoEditorial
}): Promise<EstadoFilaEditorial> {
  const resposta = window.dailyworkEditorial ? desembrulhar(await window.dailyworkEditorial.gerar(entrada)) : await http<EstadoFilaEditorial>('/api/editorial/gerar', jsonInit(entrada))
  if (resposta.producao.status === 'erro') throw new Error(resposta.producao.mensagem || 'A produção não iniciou.')
  return resposta
}

export async function cancelarProducaoEditorial(): Promise<ProducaoEditorial> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.cancelarProducao())
  return http('/api/editorial/cancelar-producao', jsonInit({}))
}

export async function configurarProducaoEditorial(
  entrada: Partial<ConfiguracaoProducaoEditorial>
): Promise<EstadoFilaEditorial | ConfiguracaoProducaoEditorial> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.configurar(entrada))
  return http('/api/editorial/config', jsonInit(entrada))
}

export async function obterLogicaEditorial(): Promise<LogicaEditorial> {
  if (window.dailyworkEditorial?.logica) return desembrulhar(await window.dailyworkEditorial.logica())
  return http('/api/editorial/logica')
}

export async function salvarLogicaEditorial(entrada: Partial<LogicaEditorial>): Promise<LogicaEditorial> {
  if (window.dailyworkEditorial?.salvarLogica) return desembrulhar(await window.dailyworkEditorial.salvarLogica(entrada))
  return http('/api/editorial/logica', jsonInit(entrada))
}

export async function restaurarLogicaEditorial(): Promise<LogicaEditorial> {
  if (window.dailyworkEditorial?.restaurarLogica) return desembrulhar(await window.dailyworkEditorial.restaurarLogica())
  return http('/api/editorial/logica/restaurar', jsonInit({}))
}

export async function lerMidiaEditorial(itemId: string, midiaId: string): Promise<string> {
  if (window.dailyworkEditorial) return desembrulhar(await window.dailyworkEditorial.lerMidia(itemId, midiaId))
  return `/api/editorial/midias/${encodeURIComponent(itemId)}/${encodeURIComponent(midiaId)}`
}

export async function listarHistoricoEditorial(filtros: { conta?: ContaEditorial; desde?: string; ate?: string } = {}): Promise<EntradaHistoricoEditorial[]> {
  if (window.dailyworkEditorial?.historico) return desembrulhar(await window.dailyworkEditorial.historico(filtros))
  const query = new URLSearchParams()
  if (filtros.conta) query.set('conta', filtros.conta)
  if (filtros.desde) query.set('desde', filtros.desde)
  if (filtros.ate) query.set('ate', filtros.ate)
  return http(`/api/editorial/historico${query.size ? `?${query.toString()}` : ''}`)
}

export async function lerComprovanteEditorial(id: string): Promise<string> {
  if (window.dailyworkEditorial?.lerComprovante) return desembrulhar(await window.dailyworkEditorial.lerComprovante(id))
  return http(`/api/editorial/itens/${encodeURIComponent(id)}/comprovante`)
}

export async function capturarComprovanteEditorial(id: string): Promise<ItemEditorial> {
  if (window.dailyworkEditorial?.capturarComprovante) return desembrulhar(await window.dailyworkEditorial.capturarComprovante(id))
  return http(`/api/editorial/itens/${encodeURIComponent(id)}/capturar-comprovante`, jsonInit({}))
}

export async function listarMidiaJobs(filtros: { status?: StatusJobMidia } = {}): Promise<JobMidiaEditorial[]> {
  const bridge = window.dailyworkEditorial
  if (bridge?.listarJobsMidia) return desembrulhar(await bridge.listarJobsMidia(filtros))
  if (bridge?.listarMidiaJobs) return desembrulhar(await bridge.listarMidiaJobs(filtros))
  const query = filtros.status ? `?status=${encodeURIComponent(filtros.status)}` : ''
  return http(`/api/editorial/midia/jobs${query}`)
}

export async function obterConfiguracaoMidiaEditorial(): Promise<ConfiguracaoMidiaEditorial> {
  if (window.dailyworkEditorial?.configuracaoMidia) return desembrulhar(await window.dailyworkEditorial.configuracaoMidia())
  return http('/api/editorial/midia/config')
}

export async function configurarMidiaEditorial(entrada: ConfiguracaoMidiaEditorial): Promise<ConfiguracaoMidiaEditorial> {
  if (window.dailyworkEditorial?.configurarMidia) return desembrulhar(await window.dailyworkEditorial.configurarMidia(entrada))
  return http('/api/editorial/midia/config', jsonInit(entrada))
}

export async function obterMidiaJob(id: string): Promise<JobMidiaEditorial | null> {
  const bridge = window.dailyworkEditorial
  if (bridge?.obterJobMidia) return desembrulhar(await bridge.obterJobMidia(id))
  if (bridge?.obterMidiaJob) return desembrulhar(await bridge.obterMidiaJob(id))
  return http(`/api/editorial/midia/jobs/${encodeURIComponent(id)}`)
}

export async function iniciarMidiaJob(entrada: {
  estrategia?: 'editorial' | 'referencia-real' | 'importacao'
  imagemBase64?: string
  itemId: string
  revisao: number
  tipo: 'imagem' | 'video'
  briefing?: string
  alvo?: string
  foco?: string
  provedores?: 'grok' | 'codex' | 'both'
  roteiroFile?: string
  pautaId?: string
}): Promise<{ job: JobMidiaEditorial }> {
  const bridge = window.dailyworkEditorial
  if (bridge?.iniciarJobMidia) return desembrulhar(await bridge.iniciarJobMidia(entrada))
  if (bridge?.iniciarMidiaJob) return desembrulhar(await bridge.iniciarMidiaJob(entrada))
  return http('/api/editorial/midia/jobs', jsonInit(entrada))
}

export async function cancelarMidiaJob(id: string): Promise<{ job: JobMidiaEditorial }> {
  const bridge = window.dailyworkEditorial
  if (bridge?.cancelarJobMidia) return desembrulhar(await bridge.cancelarJobMidia(id))
  if (bridge?.cancelarMidiaJob) return desembrulhar(await bridge.cancelarMidiaJob(id))
  return http(`/api/editorial/midia/jobs/${encodeURIComponent(id)}/cancelar`, jsonInit({}))
}

export async function retomarMidiaJobs(): Promise<{ retomados: string[] }> {
  const bridge = window.dailyworkEditorial
  if (bridge?.retomarJobsMidia) return desembrulhar(await bridge.retomarJobsMidia())
  if (bridge?.retomarMidiaJobs) return desembrulhar(await bridge.retomarMidiaJobs())
  return http('/api/editorial/midia/jobs/retomar', jsonInit({}))
}

export function aoAtualizarJobMidia(cb: (job: JobMidiaEditorial) => void): () => void {
  const bridge = window.dailyworkEditorial
  return bridge?.onJobMidiaAtualizado?.(cb) || bridge?.onMidiaJobAtualizado?.(cb) || (() => {})
}

export async function listarCapacidadesEditorial(): Promise<unknown> {
  if (window.dailyworkEditorial?.capacidades) return desembrulhar(await window.dailyworkEditorial.capacidades())
  return http('/api/editorial/capacidades')
}
