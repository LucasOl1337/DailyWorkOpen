import type { Root, RootContent, Blockquote, Heading } from 'mdast'

const palavras = (texto: string) => texto.trim().split(/\s+/u).filter(Boolean).length
export const minutosLeitura = (texto: string) => Math.max(1, Math.ceil(palavras(texto) / 220))

function textoNo(no: RootContent): string {
  if ('value' in no) return no.value
  if ('children' in no) return no.children.map(filho => textoNo(filho as RootContent)).join(' ')
  return ''
}

function assunto(titulo: Heading | null, conteudo: RootContent[]): Blockquote {
  return {
    type: 'blockquote',
    data: { hName: 'details', hProperties: { className: ['auto-reading-section'] } },
    children: [
      {
        type: 'paragraph',
        data: { hName: 'summary' },
        children: [
          { type: 'strong', children: [{ type: 'text', value: titulo ? textoNo(titulo) : 'Sobre este documento' }] },
          { type: 'emphasis', children: [{ type: 'text', value: `${minutosLeitura(conteudo.map(textoNo).join(' '))} min` }] },
        ],
      },
      ...conteudo as Blockquote['children'],
    ],
  }
}

/** Group the parsed Markdown, keeping tables, fenced code and reference definitions intact. */
export function leituraPorAssunto() {
  return (arvore: Root) => {
    const nos = [...arvore.children]
    const resultado: RootContent[] = []
    // A document title remains visible; only its sections become disclosures.
    if (nos[0]?.type === 'heading' && nos[0].depth === 1) resultado.push(nos.shift()!)
    const titulos = nos.filter((no): no is Heading => no.type === 'heading')
    const nivel = Math.min(...titulos.map(no => no.depth))
    let titulo: Heading | null = null
    let conteudo: RootContent[] = []
    const concluir = () => {
      if (!titulo && !conteudo.length) return
      const tamanho = palavras(conteudo.map(textoNo).join(' '))
      if (!titulo && !titulos.length && tamanho <= 35) resultado.push(...conteudo)
      else resultado.push(assunto(titulo, conteudo))
      conteudo = []
    }
    for (const no of nos) {
      if (no.type === 'definition' || no.type === 'footnoteDefinition') {
        resultado.push(no)
      } else if (no.type === 'heading' && no.depth === nivel) {
        concluir()
        titulo = no
      } else conteudo.push(no)
    }
    concluir()
    arvore.children = resultado
  }
}

export function horarioCampanha(valor: string | undefined, hoje?: string): string {
  if (!valor) return 'Horário indisponível'
  // systemd returns e.g. "Fri 2026-09-11 09:30:00 -03".
  const systemd = valor.match(/(?:\w+\s+)?(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}):\d{2}\s+([+-]\d{2})(?::?(\d{2}))?$/)
  const data = new Date(systemd ? `${systemd[1]}T${systemd[2]}:00${systemd[3]}:${systemd[4] || '00'}` : valor)
  if (Number.isNaN(data.getTime())) return valor
  const opcoes = { timeZone: 'America/Sao_Paulo' }
  const dia = new Intl.DateTimeFormat('en-CA', opcoes).format(data)
  const hora = new Intl.DateTimeFormat('pt-BR', { ...opcoes, hour: '2-digit', minute: '2-digit' }).format(data)
  return `${dia === hoje ? 'Hoje' : new Intl.DateTimeFormat('pt-BR', { ...opcoes, day: '2-digit', month: '2-digit' }).format(data)}, às ${hora}`
}
