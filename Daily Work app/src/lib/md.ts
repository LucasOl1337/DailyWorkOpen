// Serialização/parsing de blocos em arquivos .md com frontmatter.
// Formato YAML-lite proposital: só chaves escalares e uma lista simples (conexoes).
// Compartilhado entre o middleware do Vite (Node) e o cliente (browser) — sem deps.

export type TipoBloco = 'nota' | 'tarefa' | 'projeto' | 'link' | 'pessoa' | 'imagem'
export type StatusBloco = 'pendente' | 'fazendo' | 'feito'
export type PapelBloco = 'direction' | 'plan' | 'front' | 'checkpoint' | 'decision' | 'closure'
export type FaseTrabalho = 'discover' | 'design' | 'build' | 'validate' | 'release' | 'operate'
export type OrigemBloco = 'human' | 'agent' | 'signal' | 'context-pack'

export interface Bloco {
  id: string
  tipo: TipoBloco
  titulo: string
  status: StatusBloco
  x: number
  y: number
  w: number
  h: number
  midia?: string // caminho relativo em assets/portfolio/ para imagens persistentes
  conexoes: string[] // ids de blocos para os quais este bloco aponta
  papel?: PapelBloco
  projeto?: string
  fase?: FaseTrabalho
  origem?: OrigemBloco
  responsavel?: string
  repositorio?: string
  branch?: string
  worktree?: string
  carryoverDe?: string
  concluidoEm?: string
  fontes?: string[]
  evidencias?: string[]
  bloqueadoPor?: string[]
  corpo: string // markdown livre (conteúdo após o frontmatter)
}

const TIPOS: TipoBloco[] = ['nota', 'tarefa', 'projeto', 'link', 'pessoa', 'imagem']
const STATUS: StatusBloco[] = ['pendente', 'fazendo', 'feito']
const PAPEIS: PapelBloco[] = ['direction', 'plan', 'front', 'checkpoint', 'decision', 'closure']
const FASES: FaseTrabalho[] = ['discover', 'design', 'build', 'validate', 'release', 'operate']
const ORIGENS: OrigemBloco[] = ['human', 'agent', 'signal', 'context-pack']
const CAMPOS_SEMANTICOS = [
  'projeto',
  'responsavel',
  'repositorio',
  'branch',
  'worktree',
  'carryoverDe',
  'concluidoEm',
] as const
const LISTAS_SEMANTICAS = ['fontes', 'evidencias', 'bloqueadoPor'] as const

export function novoBlocoId(): string {
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

function escalar(v: unknown): string {
  const s = String(v ?? '')
  return s.replace(/\r?\n/g, ' ').trim()
}

function listaParaMd(nome: string, valores: string[] | undefined): string[] {
  if (!valores?.length) return []
  return [`${nome}:`, ...valores.map((valor) => `  - ${escalar(valor)}`)]
}

export function blocoParaMd(b: Bloco): string {
  const linhas = [
    '---',
    `id: ${escalar(b.id)}`,
    `tipo: ${escalar(b.tipo)}`,
    `titulo: ${escalar(b.titulo)}`,
    `status: ${escalar(b.status)}`,
    `x: ${Math.round(b.x)}`,
    `y: ${Math.round(b.y)}`,
    `w: ${Math.round(b.w)}`,
    `h: ${Math.round(b.h)}`,
    ...(b.midia ? [`midia: ${escalar(b.midia)}`] : []),
    ...(b.papel ? [`papel: ${escalar(b.papel)}`] : []),
    ...(b.fase ? [`fase: ${escalar(b.fase)}`] : []),
    ...(b.origem ? [`origem: ${escalar(b.origem)}`] : []),
    ...CAMPOS_SEMANTICOS.flatMap((campo) => b[campo] ? [`${campo}: ${escalar(b[campo])}`] : []),
    'conexoes:',
    ...b.conexoes.map((c) => `  - ${escalar(c)}`),
    ...LISTAS_SEMANTICAS.flatMap((campo) => listaParaMd(campo, b[campo])),
    '---',
    '',
  ]
  return linhas.join('\n') + (b.corpo ?? '').trim() + '\n'
}

export function mdParaBloco(nomeArquivo: string, texto: string): Bloco | null {
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return null
  const [, fm, corpo] = m

  const campos: Record<string, string> = {}
  const listas: Record<string, string[]> = Object.fromEntries(
    ['conexoes', ...LISTAS_SEMANTICAS].map((nome) => [nome, []])
  )
  let listaAtual: string | null = null
  for (const linha of fm.split(/\r?\n/)) {
    const item = linha.match(/^\s+-\s+(.+)$/)
    if (listaAtual && item) {
      listas[listaAtual].push(item[1].trim())
      continue
    }
    const kv = linha.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (kv) {
      listaAtual = Object.hasOwn(listas, kv[1]) && !kv[2].trim() ? kv[1] : null
      if (!listaAtual) campos[kv[1]] = kv[2].trim()
    }
  }

  const num = (v: string | undefined, def: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : def
  }

  const tipo = TIPOS.includes(campos.tipo as TipoBloco) ? (campos.tipo as TipoBloco) : 'nota'
  const status = STATUS.includes(campos.status as StatusBloco)
    ? (campos.status as StatusBloco)
    : 'pendente'

  const bloco: Bloco = {
    id: campos.id || nomeArquivo.replace(/\.md$/, ''),
    tipo,
    titulo: campos.titulo || '(sem título)',
    status,
    x: num(campos.x, 0),
    y: num(campos.y, 0),
    w: num(campos.w, 260),
    h: num(campos.h, 140),
    conexoes: listas.conexoes,
    corpo: corpo.replace(/^\r?\n/, '').replace(/\s+$/, ''),
  }
  if (campos.midia) bloco.midia = campos.midia
  if (PAPEIS.includes(campos.papel as PapelBloco)) bloco.papel = campos.papel as PapelBloco
  if (FASES.includes(campos.fase as FaseTrabalho)) bloco.fase = campos.fase as FaseTrabalho
  if (ORIGENS.includes(campos.origem as OrigemBloco)) bloco.origem = campos.origem as OrigemBloco
  for (const campo of CAMPOS_SEMANTICOS) {
    if (campos[campo]) bloco[campo] = campos[campo]
  }
  for (const campo of LISTAS_SEMANTICAS) {
    if (listas[campo].length) bloco[campo] = listas[campo]
  }
  return bloco
}
