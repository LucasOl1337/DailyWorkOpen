import type { Bloco } from './md'

export interface ProjetoContexto {
  id: string
  name: string
  aliases?: string[]
  status?: string
  packet?: string
  repositories?: string[]
  updatedAt?: string
  packetSummary: string | null
}

export interface ReferenciaContexto {
  kind: 'project_registry' | 'project_packet' | 'knowledge' | 'skill' | 'work_signals' | 'daily_summary'
  source: 'workspace' | 'knowledge' | 'skills' | 'work-signals' | 'daily-summary'
  ref: string
  status: 'available' | 'unavailable' | 'fresh' | 'stale'
}

export interface ConhecimentoContexto {
  caminho: string
  titulo: string
  resumo: string
  sourceRef: string
}

export interface SkillContexto {
  id: string
  descricao: string
  caminho: string
  sourceRef: string
}

export interface SinalContexto {
  id: string
  source: string
  projectId?: string
  kind: string
  title: string
  occurredAt: string
  evidence?: string
}

export interface PropostaContexto {
  id: string
  kind: 'carryover' | 'project_next_action' | 'sumario_proximo_passo'
  reason: string
  bloco: Partial<Bloco>
}

export interface AnaliseRecenteContexto {
  dia: string
  summaryMarkdown: string
}

export interface FrenteRascunhoDia {
  titulo: string
  objetivo: string
  acoes: string[]
  pronto: string
  projeto: string | null
  baseadoEm: string
}

export interface RascunhoDia {
  schemaVersion: 1
  rascunhoId: string
  packId: string
  dia: string
  direcao: string
  frentes: FrenteRascunhoDia[]
  perfil: { id: string; nome: string; rota: string }
  fallback: unknown
}

export interface PacoteContextoDia {
  schemaVersion: 1
  packId: string
  generatedAt: string
  dia: string
  projeto: ProjetoContexto | null
  projetosDisponiveis: Array<Pick<ProjetoContexto, 'id' | 'name' | 'aliases' | 'status'>>
  carryovers: Bloco[]
  conhecimento: ConhecimentoContexto[]
  skills: SkillContexto[]
  sinais: SinalContexto[]
  riscos: { code: string; message: string }[]
  propostas: PropostaContexto[]
  analiseRecente: AnaliseRecenteContexto | null
  fontes: ReferenciaContexto[]
}

export interface ReciboPropostaContexto {
  propostaId: string
  blocoId: string
  bloco: Bloco
}

export type DestinoFechamento =
  | 'daily'
  | 'workspace'
  | 'knowledgeCandidates'
  | 'portfolioCandidates'

export interface RevisaoFechamento {
  schemaVersion: 1
  reviewId: string
  generatedAt: string
  dia: string
  resumo: { total: number; concluidas: number; abertas: number; semEvidencia: number }
  alertas: string[]
  handoffs: Array<{
    blocoId: string
    projectId: string | null
    titulo: string
    objetivo: string
    estado: string
    evidencias: string[]
    proximaAcao: string
    pronto: string | null
  }>
  destinos: {
    daily: { title: string; content: string }
    workspace: Array<{ projectId: string; projectName: string; path: string; content: string }>
    knowledgeCandidates: Array<{
      id: string
      title: string
      content: string
      projectId: string | null
      sourceRefs: string[]
    }>
    portfolioCandidates: Array<{
      id: string
      title: string
      content: string
      projectId: string | null
      evidenceRefs: string[]
    }>
  }
}

export interface ReciboFechamento {
  destino: DestinoFechamento
  ref: string
}

export interface RevisaoSemana {
  schemaVersion: 1
  weekId: string
  generatedAt: string
  periodo: { de: string; ate: string }
  resumo: {
    diasComTrabalho: number
    frentesRegistradas: number
    concluidasComEvidencia: number
    concluidasSemEvidencia: number
    aindaAbertas: number
  }
  frentesRecorrentes: Array<{
    titulo: string
    projectId: string | null
    dias: number
    periodo: string[]
    estados: string[]
  }>
  conhecimento: { linksLocaisQuebrados: number }
}
