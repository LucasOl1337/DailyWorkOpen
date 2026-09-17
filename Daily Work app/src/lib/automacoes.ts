export interface FonteAutomacao {
  id: string
  caminho: string
  titulo: string
  categoria: string
  formato: string
  bytes: number
  atualizadoEm: string
  hash: string
  padrao: boolean
}
export interface ConteudoFonteAutomacao extends FonteAutomacao { conteudo: string; caracteres: number }
export interface BibliotecaAutomacao {
  fontes: FonteAutomacao[]
  config: { fontes: string[]; revisao: string; atualizadoEm: string | null }
  ausentes: string[]
}
export type TipoMaterialAutomacao = 'mensagem' | 'candidatura' | 'curriculo'
export interface PedidoContextoAutomacao { tipo: TipoMaterialAutomacao | 'ciclo' | 'pesquisa'; briefing?: string; idioma?: 'pt-BR' | 'en'; alvoUrl?: string }
export interface ContextoAutomacao extends PedidoContextoAutomacao {
  id: string
  criadoEm: string
  fontes: ConteudoFonteAutomacao[]
  mensagens: { role: string; content: string }[]
  hash: string
  caracteres: number
  selecaoRevisao: string
}
export interface MaterialAutomacao {
  id: string
  contextoId: string
  tipo: TipoMaterialAutomacao
  titulo: string
  texto?: string
  status: 'gerando' | 'pronto' | 'falhou' | 'interrompido'
  criadoEm: string
  concluidoEm?: string
  idioma: string
  alvoUrl: string
  fontesUsadas: string[]
  lacunas: string[]
  estilo?: { catalogo: string; reescrito: boolean; sinais: { padrao: string; nivel: string; trecho: string; correcao: string }[] }
  modelo?: { id: string; nome: string; rota: string }
  fallback?: boolean
  erro?: string
}
export interface ExecucaoAutomacao {
  tipo?: string
  executor?: string
  id: string
  contextoId?: string
  resultado?: {tipo: 'pesquisa'; pesquisaRevisao: string; pessoas: number; fontes: number}
  criadoEm: string
  concluidoEm?: string
  status: string
  erro?: string
  resumo?: string
}
export interface EventoAutomacao { tipo: string; status: string; alvo?: string; texto?: string; url?: string; evidencia?: string; motivo?: string }
export interface AlvoManual { id: string; url: string; canal: string; tipo: string; alvo?: string; post?: string; adicionado_em: string; status: string }
export interface AlvoManualEntrada { url: string; agora?: boolean }
export interface DisparoAutomacao { iniciado: boolean; id?: string; pid?: number; erro?: string }
export interface InteracaoAutomacao {
  id: string; contextoId: string; tipo: string; alvo: string; texto: string; status: string
  criadoEm: string; evidencia?: string; nota?: string; fontesUsadas: string[]
  fontesExternas: { url: string; trecho: string }[]
}
export interface ConferenciaInteracao { id: string; status: 'confirmado' | 'nao_enviado'; evidencia?: string; nota?: string }
export interface ResultadoAlvoAutomacao { adicionado: boolean; item: AlvoManual; disparo?: DisparoAutomacao }
export interface EstadoAutomacoes {
  cadastro: CadastroCampanha
  navegador: NavegadorCampanha
  campanha: string
  objetivo: string
  inicio: string
  hoje: string
  toqueHoje: { slot: number; eventos: EventoAutomacao[] } | null
  filaArgumentos: string[]
  filaManual: AlvoManual[]
  candidaturas: { id: string; status: string; data?: string; url?: string; evidencia?: string; note?: string }[]
  bloqueios: { data?: string; code?: string; note?: string }[]
  timer: { ativo: boolean; proxima?: string; ultima?: string; erro?: string }
  pendenciasInteracoes: number
  atividade?: { execucaoId: string | null; acao: string; aba: string | null; url: string; alvo: string | null; em: string } | null
  chromeCDP: boolean
  cdpPort: number | null
  diario: string[]
  evidencias: { arquivo: string; mtime: string; bytes: number }[]
  execucoes: ExecucaoAutomacao[]
  materiais: MaterialAutomacao[]
  interacoes: InteracaoAutomacao[]
}

export interface IdentidadeCampanha {
  produto: string
  resumo: string
  fundo: string
  tinta: string
  clara?: boolean
  logo: string
  banner: string
  fatos: { rotulo: string; texto: string }[]
}
export interface CadastroCampanha { id: string; nome: string; site: string; objetivo: string; executor: string; revisao: string; identidade?: IdentidadeCampanha }
export interface NavegadorCampanha { nome: string; conectado: boolean; porta?: number | null; workspace: number | null; controle: string; sessao: { importadaEm: string; verificacao: string } | null }
export interface CatalogoCampanhas { campanhas: CadastroCampanha[]; executores: { id: string; nome: string; instalado: boolean; autenticacao: string }[]; navegador: NavegadorCampanha }
export interface PessoaEmpresa { nome: string; cargo: string; url: string; motivo: string; prioridade: 'alta' | 'media' | 'baixa'; status: 'a_verificar' | 'verificado' | 'contatado'; fonteUrl: string }
export interface FonteEmpresa { titulo: string; url: string; trecho: string; verificadoEm: string }
export interface PesquisaEmpresa { notas: string; pessoas: PessoaEmpresa[]; fontes: FonteEmpresa[]; atualizadoEm: string | null; revisao: string }
