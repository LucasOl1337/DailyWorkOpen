export interface NoLayoutConhecimento {
  chave: string
  x: number
  y: number
  w: number
  h: number
  peso?: number
  ancora?: boolean
}

export interface PosicaoLayoutConhecimento {
  x: number
  y: number
}

interface NoInterno extends NoLayoutConhecimento {
  originalX: number
  originalY: number
  pesoResolvido: number
}

const MAXIMO_DE_PASSADAS = 1200
const TOLERANCIA = 0.01
const PASSO_HORIZONTAL_PAINEL = 304
const PASSO_VERTICAL_PAINEL = 142

function compararChaves(a: { chave: string }, b: { chave: string }) {
  return a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0
}

// O JSON canônico coloca os filhos de Acertos e Erros na mesma linha. A
// projeção usa clusters explícitos: verde à esquerda, vermelho ao centro e
// alertas isolados à direita. A ordem interna continua vindo do mapa do vault.
export function organizarPainelEssencial(
  entrada: Array<{ chave: string; x: number; y: number }>,
  forcar = false
): Map<string, PosicaoLayoutConhecimento> {
  const posicoes = new Map(
    entrada.map((no) => [no.chave, { x: no.x, y: no.y }] as const)
  )
  const porChave = new Map(entrada.map((no) => [no.chave, no]))

  const configurarGrupo = (
    hub: string,
    centroX: number,
    colunas: number
  ) => {
    const prefixo = hub.replace(/\.md$/i, '/')
    const filhos = entrada
      .filter((no) => no.chave.startsWith(prefixo))
      .sort((a, b) => a.x - b.x || compararChaves(a, b))

    const precisaOrganizar = forcar || (filhos.length > 0 && filhos.every((f) => f.y === -1350))
    if (!precisaOrganizar) return

    if (porChave.has(hub)) posicoes.set(hub, { x: centroX, y: -1050 })

    filhos.forEach((filho, indice) => {
      const linha = Math.floor(indice / colunas)
      const inicioDaLinha = linha * colunas
      const totalNaLinha = Math.min(colunas, filhos.length - inicioDaLinha)
      const coluna = indice - inicioDaLinha
      posicoes.set(filho.chave, {
        x: centroX + (coluna - (totalNaLinha - 1) / 2) * PASSO_HORIZONTAL_PAINEL,
        y: -1368 - linha * PASSO_VERTICAL_PAINEL,
      })
    })
  }

  configurarGrupo('Painel Essencial/Acertos e Práticas Consolidadas.md', -1800, 6)
  configurarGrupo('Painel Essencial/Erros e Lições Aprendidas.md', 300, 5)

  if (forcar || porChave.get('Painel Essencial/Alertas Atuais.md')?.y === -900) {
    if (porChave.has('Painel Essencial/Alertas Atuais.md')) {
      posicoes.set('Painel Essencial/Alertas Atuais.md', { x: 1400, y: -1050 })
    }
  }
  if (forcar || porChave.get('Painel Essencial/Painel Essencial.md')?.y === -630) {
    if (porChave.has('Painel Essencial/Painel Essencial.md')) {
      posicoes.set('Painel Essencial/Painel Essencial.md', { x: 0, y: -700 })
    }
  }

  return posicoes
}

// O plugin do vault posiciona pontos, enquanto o DailyWork projeta cards muito
// maiores. Esta etapa mantém a topologia original e afasta apenas retângulos
// que se interceptariam, sem escrever de volta no mapa canônico.
export function organizarLayoutConhecimento(
  entrada: NoLayoutConhecimento[],
  espacamento = 32
): Map<string, PosicaoLayoutConhecimento> {
  const nos: NoInterno[] = entrada
    .map((no) => ({
      ...no,
      originalX: no.x,
      originalY: no.y,
      pesoResolvido: Math.max(1, no.peso || 1),
    }))
    .sort(compararChaves)

  for (let passada = 0; passada < MAXIMO_DE_PASSADAS; passada += 1) {
    let maiorIntersecao = 0

    for (let i = 0; i < nos.length; i += 1) {
      for (let j = i + 1; j < nos.length; j += 1) {
        const a = nos[i]
        const b = nos[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const intersecaoX = (a.w + b.w) / 2 + espacamento - Math.abs(dx)
        const intersecaoY = (a.h + b.h) / 2 + espacamento - Math.abs(dy)
        if (intersecaoX <= 0 || intersecaoY <= 0) continue

        // Linhas e colunas explícitas do mapa continuam linhas e colunas. Nos
        // demais casos, o menor deslocamento resolve a colisão com menos ruído.
        const mesmaLinha = Math.abs(a.originalY - b.originalY) < TOLERANCIA
        const mesmaColuna = Math.abs(a.originalX - b.originalX) < TOLERANCIA
        const eixo = mesmaLinha ? 'x' : mesmaColuna ? 'y' : intersecaoX <= intersecaoY ? 'x' : 'y'
        const pesoTotal = a.pesoResolvido + b.pesoResolvido

        if (eixo === 'x') {
          const direcao = dx !== 0 ? Math.sign(dx) : a.chave < b.chave ? 1 : -1
          a.x -= direcao * intersecaoX * (b.pesoResolvido / pesoTotal)
          b.x += direcao * intersecaoX * (a.pesoResolvido / pesoTotal)
          maiorIntersecao = Math.max(maiorIntersecao, intersecaoX)
        } else {
          const direcao = dy !== 0 ? Math.sign(dy) : a.chave < b.chave ? 1 : -1
          a.y -= direcao * intersecaoY * (b.pesoResolvido / pesoTotal)
          b.y += direcao * intersecaoY * (a.pesoResolvido / pesoTotal)
          maiorIntersecao = Math.max(maiorIntersecao, intersecaoY)
        }
      }
    }

    if (maiorIntersecao <= TOLERANCIA) break
  }

  // Conserva a nota-raiz no ponto canônico, mantendo o território de
  // conhecimento estável em relação ao cabeçalho e ao portfólio.
  const ancora = nos.find((no) => no.ancora)
  const ajusteX = ancora ? ancora.originalX - ancora.x : 0
  const ajusteY = ancora ? ancora.originalY - ancora.y : 0

  return new Map(
    nos.map((no) => [
      no.chave,
      { x: no.x + ajusteX, y: no.y + ajusteY },
    ])
  )
}
