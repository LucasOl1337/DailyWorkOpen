export interface SkillResumo {
  inventario: number
  usadas: number
  usosPeriodo: number
  usosConhecidos: number
  harnesses: number
  origens: number
}

export interface SkillVolume {
  nome: string
  usos: number
}

export interface SkillItem {
  id: string
  nome: string
  proposito: string
  origem: string
  origemRotulo: string
  caminho: string | null
  catalogada: boolean
  usosPeriodo: number
  usosConhecidos: number
  diasAtivos: number
  ultimoUso: string | null
  harnesses: SkillVolume[]
  agentes: SkillVolume[]
}

export interface SkillDiaSerie {
  dia: string
  total: number
  porHarness: Record<string, number>
}

export interface SkillHarness {
  nome: string
  usosPeriodo: number
  usosConhecidos: number
  skills: number
  agentes: string[]
  ultimoUso: string | null
  cobertura: string
}

export interface SkillCruzamento {
  skillId: string | null
  skill: string | null
  harness: string
  agente: string
  usos: number
  ultimoUso: string | null
  cobertura: 'evento' | 'agregado'
}

export interface SkillFonte {
  harness: string
  status: 'ok' | 'parcial' | 'indisponivel'
  detalhe: string
}

export interface DashboardSkills {
  geradoEm: string
  periodo: { dias: number; inicio: string; fim: string }
  resumo: SkillResumo
  skills: SkillItem[]
  serieDiaria: SkillDiaSerie[]
  harnesses: SkillHarness[]
  cruzamentos: SkillCruzamento[]
  fontes: SkillFonte[]
  alertas: string[]
}

declare global {
  interface Window {
    dailyworkSkills?: {
      dashboard: (entrada?: {
        dias?: number
      }) => Promise<{ ok: boolean; data?: DashboardSkills; erro?: { mensagem: string } }>
    }
  }
}

function desembrulhar(resposta: { ok: boolean; data?: DashboardSkills; erro?: { mensagem: string } }): DashboardSkills {
  if (!resposta || typeof resposta !== 'object' || resposta.ok !== true || !resposta.data) {
    throw new Error(resposta?.erro?.mensagem || 'Não foi possível carregar o dashboard de skills.')
  }
  return resposta.data
}

export async function obterDashboardSkills(dias = 30): Promise<DashboardSkills> {
  if (window.dailyworkSkills?.dashboard) {
    return desembrulhar(await window.dailyworkSkills.dashboard({ dias }))
  }
  const r = await fetch(`/api/skills/dashboard?dias=${encodeURIComponent(dias)}`)
  const corpo = (await r.json()) as { ok: boolean; data?: DashboardSkills; erro?: { mensagem: string } }
  return desembrulhar(corpo)
}
