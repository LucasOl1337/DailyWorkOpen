import { useEffect, useRef, useState } from 'react'
import { ErroEditorial, lerMidiaEditorial, type ContaEditorial, type EntradaHistoricoEditorial, type EstadoEditorial, type FormatoEditorial, type IdiomaEditorial, type ItemEditorial } from '../../lib/editorial'
import type { Conexao } from '../../lib/api'
import { descreverProveniencia } from '../../lib/proveniencia'

export const CONTAS: Array<{ id: ContaEditorial; nome: string }> = [
  { id: 'linkedin', nome: 'LinkedIn' },
  { id: 'x', nome: 'X' },
  { id: 'github', nome: 'GitHub' },
  { id: 'reddit', nome: 'Reddit' },
]
export const IDIOMAS: Array<{ id: IdiomaEditorial; nome: string }> = [
  { id: 'pt-BR', nome: 'Português (BR)' },
  { id: 'en', nome: 'English' },
]
export const ESTADOS: Array<{ id: EstadoEditorial; nome: string }> = [
  { id: 'pendente', nome: 'Pendente' },
  { id: 'agendado', nome: 'Agendado' },
  { id: 'aguardando_executor', nome: 'Aguardando envio' },
  { id: 'publicando', nome: 'Publicando' },
  { id: 'publicado', nome: 'Publicado' },
  { id: 'recusado', nome: 'Recusado' },
  { id: 'erro', nome: 'Com erro' },
  { id: 'incerto', nome: 'Resultado incerto' },
]
export const ESTADOS_FILA = ESTADOS.filter((estado) => estado.id !== 'publicado')
export const FORMATOS: Array<{ id: FormatoEditorial; nome: string }> = [
  { id: 'texto', nome: 'Texto' },
  { id: 'imagem', nome: 'Imagem' },
  { id: 'video', nome: 'Vídeo' },
]
export const LIMITE_TEXTO: Record<ContaEditorial, number> = { x: 280, linkedin: 3000, github: 5000, reddit: 40000 }
export const nomesConta = Object.fromEntries(CONTAS.map((conta) => [conta.id, conta.nome])) as Record<ContaEditorial, string>
export type CapacidadesMidia = Record<ContaEditorial, { imagem?: boolean; video?: boolean } | undefined>
export type AcessoConta = { configurada: boolean; online: boolean; login: string | null; visual?: boolean; perfilUrl?: string } | undefined

export function hojeLocalISO(): string {
  const data = new Date()
  return [data.getFullYear(), String(data.getMonth() + 1).padStart(2, '0'), String(data.getDate()).padStart(2, '0')].join('-')
}

export function proximaHoraLocal(): string {
  const data = new Date(Date.now() + 60 * 60 * 1000)
  data.setMinutes(0, 0, 0)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}T${String(data.getHours()).padStart(2, '0')}:00`
}

export function paraISO(valor: string): string {
  return new Date(valor).toISOString()
}

export function formatarDataHora(valor?: string): string {
  if (!valor) return ''
  const data = new Date(valor)
  if (Number.isNaN(data.valueOf())) return valor
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data)
}

export function formatarQuando(valor?: string): string {
  if (!valor) return ''
  const data = new Date(valor)
  if (Number.isNaN(data.valueOf())) return valor
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(data)
}

export function erroTexto(erro: unknown): { codigo: string; mensagem: string } {
  if (erro instanceof ErroEditorial) return { codigo: erro.codigo, mensagem: erro.message }
  if (erro instanceof Error) return { codigo: 'ERRO', mensagem: erro.message }
  return { codigo: 'ERRO', mensagem: 'Não foi possível concluir esta ação.' }
}

export function ehConflito(erro: unknown): boolean {
  const { codigo } = erroTexto(erro)
  return /REVISAO|CONFLITO|OBSOLETO|ATUALIZ/i.test(codigo)
}

export function valorCampo(item: ItemEditorial, chave: string): string {
  const valor = item.campos?.[chave]
  return valor === null || valor === undefined ? '' : String(valor)
}

export function labelCampo(chave: string): string {
  return chave
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letra) => letra.toUpperCase())
}

export function acessoDaConta(conexoes: Partial<Record<ContaEditorial, Conexao>>, conta: ContaEditorial): AcessoConta {
  const status = conexoes[conta]?.status
  const visual = conexoes[conta]?.visual
  if (visual?.transporte === 'sessao_visual') return { configurada: !!visual.contaEsperada, online: visual.disponivel && visual.executor !== 'offline', login: visual.contaEsperada?.nome || null, visual: true, perfilUrl: visual.contaEsperada?.perfilUrl }
  if (!status) return undefined
  return { configurada: status.configured === true, online: status.online === true, login: status.conta?.login || null }
}

export function rotuloIdioma(idioma: IdiomaEditorial): string {
  return idioma === 'pt-BR' ? 'PT' : 'EN'
}

export function formatoPublicavelDoItem(item: ItemEditorial, capacidades: CapacidadesMidia, capacidadesCarregadas: boolean): boolean {
  const tipoMidia = item.midias.find((midia) => midia.tipo === 'video' || midia.mime?.startsWith('video/'))?.tipo === 'video' ? 'video' : 'imagem'
  return item.formato === 'texto' && item.midias.length === 0
    ? true
    : item.midias.length > 0 && capacidadesCarregadas && capacidades[item.conta]?.[tipoMidia] === true
}

export function ehProntaParaPublicar(item: ItemEditorial, capacidades: CapacidadesMidia, capacidadesCarregadas: boolean, acesso: AcessoConta): boolean {
  if (!ehProntaParaRevisao(item)) return false
  const contaAcessivel = acesso ? acesso.configurada : true
  return formatoPublicavelDoItem(item, capacidades, capacidadesCarregadas) && contaAcessivel
}

// Prontidão editorial e disponibilidade do transporte são estados diferentes.
// Uma peça continua pronta para revisão mesmo quando a bancada ou a credencial
// da rede está offline; só a ação de publicar deve depender desse acesso.
export function ehProntaParaRevisao(item: ItemEditorial): boolean {
  return item.estado === 'pendente' && item.prontidao?.pronta === true
}

export function exclusaoBloqueadaNaFila(item: Pick<ItemEditorial, 'estado'>): boolean {
  return ['aguardando_executor', 'publicando'].includes(item.estado)
}

const capaCache = new Map<string, string>()

export function useElementoVisivel<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [visivel, setVisivel] = useState(false)
  useEffect(() => {
    const elemento = ref.current
    if (!elemento || visivel) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisivel(true)
      return
    }
    const observer = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) {
        setVisivel(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(elemento)
    return () => observer.disconnect()
  }, [visivel])
  return { ref, visivel }
}

export function useCapaMidia(item: ItemEditorial, visivel: boolean) {
  const midia = item.midias[0]
  const midiaId = midia?.id || ''
  const chave = midiaId ? `${item.id}:${midiaId}` : ''
  const [capa, setCapa] = useState<{ chave: string; src: string }>(() => ({ chave, src: chave ? capaCache.get(chave) || '' : '' }))
  const [falha, setFalha] = useState('')
  const src = capa.chave === chave ? capa.src : ''
  const falhou = Boolean(chave) && falha === chave

  useEffect(() => {
    if (!midiaId || !visivel || src || falhou) return
    let ativo = true
    lerMidiaEditorial(item.id, midiaId)
      .then((url) => {
        capaCache.set(chave, url)
        if (ativo) setCapa({ chave, src: url })
      })
      .catch(() => {
        if (ativo) setFalha(chave)
      })
    return () => {
      ativo = false
    }
  }, [item.id, midiaId, chave, visivel, src, falhou])

  return { midia, src, falhou }
}

export function diaHistorico(valor?: string): string {
  const data = valor ? new Date(valor) : null
  if (!data || Number.isNaN(data.valueOf())) return 'Sem data'
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(data)
}

export function itemDoHistorico(entrada: EntradaHistoricoEditorial): ItemEditorial {
  const formato = entrada.midias.some((midia) => midia.tipo === 'video' || midia.mime?.startsWith('video/'))
    ? 'video'
    : entrada.midias.length
      ? 'imagem'
      : 'texto'
  return {
    id: entrada.id,
    pautaId: `historico-${entrada.id}`,
    conta: entrada.conta,
    idioma: entrada.idioma,
    formato,
    titulo: entrada.titulo,
    texto: entrada.texto,
    campos: {},
    midias: entrada.midias,
    fontes: [],
    origem: entrada.origem || { tipo: 'dia' },
    estado: 'publicado',
    revisao: 0,
    criadoEm: entrada.publishedAt,
    atualizadoEm: entrada.publishedAt,
    recibo: {
      url: entrada.url || undefined,
      publishedAt: entrada.publishedAt,
      comprovante: entrada.comprovante || undefined,
    },
  }
}

export { descreverProveniencia }
