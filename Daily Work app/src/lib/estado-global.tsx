import type { AlvoPendencia } from './destinos'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { agenda, type EstadoAgenda, type OcorrenciaAgenda } from './agenda'
import { candidaturas as candidaturasApi, type EstadoCandidaturas } from './candidaturas'
import { listarEditorial, type ItemEditorial } from './editorial'

// Uma leitura só, compartilhada por sidebar, Hoje e a coluna do dia de cada tela:
// o que precisa de você, o que está rodando e o que aconteceu hoje nos três módulos.
export type Tom = 'ok' | 'atencao' | 'erro' | 'info' | 'neutro' | 'ativo'
export type Modulo = 'candidaturas' | 'campanhas' | 'fila' | 'sistema'
export interface Pendencia { id: string; modulo: Modulo; titulo: string; acao: string; tone: Tom; n?: number; view: string; alvo: AlvoPendencia; automatica: boolean }
export interface EventoDia { em: number; modulo: Modulo; titulo: string; sub: string; tone: Tom }
export interface EstadoGlobal {
  carregado: boolean
  erro: string
  agenda: EstadoAgenda | null
  candidaturas: EstadoCandidaturas | null
  fila: ItemEditorial[]
  pendencias: Pendencia[]
  eventos: EventoDia[]
  badges: Record<string, { n: number; atencao: boolean }>
  atualizar: () => Promise<void>
}

const VAZIO: EstadoGlobal = { carregado: false, erro: '', agenda: null, candidaturas: null, fila: [], pendencias: [], eventos: [], badges: {}, atualizar: async () => {} }
const Contexto = createContext<EstadoGlobal>(VAZIO)

const NOMES_OCORRENCIA: Record<string, string> = { agendada: 'agendada', executando: 'rodando', aguardando: 'nova tentativa', bloqueada: 'precisa de você', concluida: 'concluída', sem_trabalho: 'nada a fazer', pausada: 'pausada', cancelada: 'cancelada', expirada: 'horário encerrado' }
function moduloDaOcorrencia(o: OcorrenciaAgenda): Modulo {
  if (o.modulo === 'candidaturas') return 'candidaturas'
  if (o.modulo.startsWith('campanha:')) return 'campanhas'
  if (o.modulo === 'editorial') return 'fila'
  return 'sistema'
}
const VIEW_DO_MODULO: Record<Modulo, string> = { candidaturas: 'candidaturas', campanhas: 'automacoes', fila: 'fila', sistema: 'agente' }
function tomDaOcorrencia(o: OcorrenciaAgenda): Tom {
  if (o.estado === 'bloqueada') return 'atencao'
  if (o.estado === 'executando') return 'ativo'
  if (o.estado === 'concluida') return 'ok'
  return 'neutro'
}
function resumoHumano(o: OcorrenciaAgenda): string {
  const m = (o.mensagem || '').replace(/\s+/g, ' ').trim()
  if (!m) return ''
  // Log técnico (CDP, caminhos, códigos) fica atrás do detalhe; aqui só a primeira frase legível.
  const frase = m.split(/(?<=[.!?])\s|\s-\s|Call log:/)[0].trim()
  return frase.length > 140 ? frase.slice(0, 137) + '…' : frase
}

export function derivar(estadoAgenda: EstadoAgenda | null, cand: EstadoCandidaturas | null, fila: ItemEditorial[]) {
  const pendencias: Pendencia[] = []
  const eventos: EventoDia[] = []
  const badges: Record<string, { n: number; atencao: boolean }> = {}
  const marcar = (modulo: string, n: number, atencao: boolean) => { const b = badges[modulo] || { n: 0, atencao: false }; badges[modulo] = { n: b.n + n, atencao: b.atencao || atencao } }

  if (estadoAgenda) {
    // Rotinas de intervalo (coleta a cada 15 min, conferência a cada minuto) só entram uma vez:
    // a última execução. Senão o feed vira um relógio.
    const intervalo = new Set(estadoAgenda.rotinas.filter(r => r.intervalo).map(r => r.id))
    const ultimaPorRotina = new Map<string, OcorrenciaAgenda>()
    for (const o of estadoAgenda.ocorrencias) if (intervalo.has(o.rotina) && o.estado !== 'agendada') { const u = ultimaPorRotina.get(o.rotina); if (!u || (o.atualizadaEm || o.prevista) > (u.atualizadaEm || u.prevista)) ultimaPorRotina.set(o.rotina, o) }
    for (const o of estadoAgenda.ocorrencias) {
      if (intervalo.has(o.rotina) && (o.estado === 'agendada' || ultimaPorRotina.get(o.rotina)?.id !== o.id) && o.estado !== 'bloqueada') continue
      const modulo = moduloDaOcorrencia(o)
      const em = o.estado === 'agendada' ? o.prevista : (o.atualizadaEm || o.iniciadaEm || o.prevista)
      eventos.push({ em, modulo, titulo: `${o.nome} · ${NOMES_OCORRENCIA[o.estado] || o.estado}`, sub: ['bloqueada', 'aguardando', 'executando'].includes(o.estado) ? resumoHumano(o) : '', tone: tomDaOcorrencia(o) })
    }
    // Uma pendência por rotina: vale só a ocorrência mais recente. Três Retomar que falharam
    // são um problema, não três; e uma rodada posterior que concluiu apaga o "parou" antigo.
    const ultima = new Map<string, OcorrenciaAgenda>()
    for (const o of estadoAgenda.ocorrencias) if (o.estado !== 'agendada') { const u = ultima.get(o.rotina); if (!u || (o.atualizadaEm || o.prevista) > (u.atualizadaEm || u.prevista)) ultima.set(o.rotina, o) }
    for (const o of ultima.values()) {
      const modulo = moduloDaOcorrencia(o)
      if (o.estado !== 'bloqueada' || modulo === 'candidaturas') continue
      const cdp = /connectOverCDP|Timeout .*exceeded|CHROMIUM_|NAVEGADOR_INDISPONIVEL|BANCADA_INDISPONIVEL/i.test(`${o.codigo || ''} ${o.mensagem || ''}`)
      pendencias.push({ id: `agenda:${o.rotina}`, modulo, titulo: `${o.nome}: parou`, acao: cdp ? 'Confira a conexão e retome a atividade. Formulários pendentes serão preservados.' : resumoHumano(o) || 'Abra o módulo e clique Retomar.', tone: 'atencao', view: VIEW_DO_MODULO[modulo], alvo: { tipo: 'agenda', modulo: o.modulo, ocorrenciaId: o.id, dia: o.dia }, automatica: false })
      marcar(modulo, 1, true)
    }
  }
  if (cand) {
    const ativa = cand.missoes.find(m => ['iniciando', 'executando'].includes(m.estado)) || cand.missoes[0]
    const atencao = ativa?.atencao
    // A página da missão já expõe o bloqueio de acesso concreto; a pendência
    // agrupada logo abaixo é o destino correto e evita dois avisos idênticos.
    if (atencao && !atencao.automatica && atencao.codigo !== 'ACESSO') {
      pendencias.push({ id: 'cand:missao', modulo: 'candidaturas', titulo: atencao.titulo, acao: atencao.acao, tone: 'atencao', view: 'candidaturas', alvo: { tipo: 'secao', view: 'candidaturas', secao: 'cand-missao' }, automatica: false })
      marcar('candidaturas', 1, true)
    }
    const perguntas = cand.pendencias?.perguntas.filter(p => p.respondivel) || []
    if (perguntas.length) {
      const vagas = new Set(perguntas.flatMap(p => p.candidaturas.map(c => c.id))).size
      pendencias.push({ id: 'cand:perguntas', modulo: 'candidaturas', titulo: `${perguntas.length} pergunta${perguntas.length > 1 ? 's' : ''} sem fonte`, acao: `Responda uma vez e ${vagas} vaga${vagas > 1 ? 's voltam' : ' volta'} pra fila.`, tone: 'atencao', n: perguntas.length, view: 'candidaturas', alvo: { tipo: 'secao', view: 'candidaturas', secao: 'cand-responder' }, automatica: false })
      marcar('candidaturas', 1, true)
    }
    for (const a of cand.pendencias?.acessos || []) {
      if (a.automatica) continue
      pendencias.push({ id: `cand:acesso:${a.codigo}`, modulo: 'candidaturas', titulo: `${a.titulo} · ${a.candidaturas.length} vaga${a.candidaturas.length > 1 ? 's' : ''}`, acao: a.acao, tone: 'atencao', n: a.candidaturas.length, view: 'candidaturas', alvo: { tipo: 'secao', view: 'candidaturas', secao: 'cand-acessos' }, automatica: false })
      marcar('candidaturas', 1, true)
    }
  }
  const pendentes = fila.filter(i => i.estado === 'pendente')
  const prontas = pendentes.filter(i => i.prontidao?.pronta)
  const revisar = pendentes.filter(i => !i.prontidao?.pronta)
  for (const [id, itens, titulo, acao] of [
    ['fila:prontas', prontas, 'pronta(s) para publicar', 'Confira as peças e publique na Fila.'],
    ['fila:revisao', revisar, 'para revisar', 'Confira texto, mídia e os impedimentos de cada peça.'],
  ] as const) {
    if (!itens.length) continue
    pendencias.push({ id, modulo: 'fila', titulo: `${itens.length} peça${itens.length > 1 ? 's' : ''} ${titulo.replace('pronta(s)', itens.length > 1 ? 'prontas' : 'pronta')}`, acao, tone: id === 'fila:prontas' ? 'ok' : 'atencao', n: itens.length, view: 'fila', alvo: { tipo: 'secao', view: 'fila', secao: 'fila-revisao' }, automatica: false })
    marcar('fila', itens.length, id !== 'fila:prontas')
  }
  // Passado em ordem inversa; o que ainda vai acontecer fica no fim, em ordem de horário.
  const agora = Date.now()
  eventos.sort((a, b) => (a.em > agora) !== (b.em > agora) ? (a.em > agora ? 1 : -1) : a.em > agora ? a.em - b.em : b.em - a.em)
  return { pendencias, eventos, badges }
}

export function ProvedorEstadoGlobal({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoGlobal>(VAZIO)
  const lendo = useRef(false)
  const atualizar = useCallback(async () => {
    if (lendo.current) return
    lendo.current = true
    try {
      const [a, c, f] = await Promise.allSettled([agenda<EstadoAgenda>('estado', {}), candidaturasApi<EstadoCandidaturas>('estado'), listarEditorial()])
      const estadoAgenda = a.status === 'fulfilled' ? a.value : null
      const cand = c.status === 'fulfilled' ? c.value : null
      const fila = f.status === 'fulfilled' ? f.value : []
      const erro = [a, c, f].flatMap(r => r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : 'Falha ao ler o estado.'] : []).join(' ')
      setEstado(atual => ({ ...atual, carregado: true, erro, agenda: estadoAgenda, candidaturas: cand, fila, ...derivar(estadoAgenda, cand, fila) }))
    } finally { lendo.current = false }
  }, [])
  useEffect(() => {
    void atualizar()
    const timer = setInterval(() => void atualizar(), 15_000)
    const aoMudar = () => void atualizar()
    window.addEventListener('dailywork:estado', aoMudar)
    return () => { clearInterval(timer); window.removeEventListener('dailywork:estado', aoMudar) }
  }, [atualizar])
  return <Contexto.Provider value={{ ...estado, atualizar }}>{children}</Contexto.Provider>
}
export function useEstadoGlobal() { return useContext(Contexto) }
