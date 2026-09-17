import type { StatusBloco, TipoBloco } from './md'

export interface TipoInfo {
  rotulo: string
  hex: string // amostra de cor na UI (menu/painel)
  fundo: string // fundo claro na UI
  corTldraw: string // cor nativa do geo shape do tldraw
}

export const TIPOS_INFO: Record<TipoBloco, TipoInfo> = {
  nota: { rotulo: 'Nota', hex: '#8b8b52', fundo: '#fdfbe8', corTldraw: 'yellow' },
  tarefa: { rotulo: 'Tarefa', hex: '#4a6fa5', fundo: '#eef4fc', corTldraw: 'blue' },
  projeto: { rotulo: 'Projeto', hex: '#7a4a9e', fundo: '#f6effc', corTldraw: 'violet' },
  link: { rotulo: 'Link', hex: '#3e8e6e', fundo: '#ecf8f2', corTldraw: 'green' },
  pessoa: { rotulo: 'Pessoa', hex: '#b3543f', fundo: '#fdeee8', corTldraw: 'red' },
  imagem: { rotulo: 'Imagem', hex: '#b2673d', fundo: '#fbf1e8', corTldraw: 'orange' },
}

export const ROTULO_STATUS: Record<StatusBloco, string> = {
  pendente: 'Pendente',
  fazendo: 'Fazendo',
  feito: 'Feito',
}
