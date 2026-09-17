import { abrirAgenda, resolverPendencia } from '../../lib/destinos'
import type { ReactNode } from 'react'
import { useEstadoGlobal, type Modulo } from '../../lib/estado-global'
import { Bloco, Botao, Chip, Feed } from './ui'

const ROTULO: Record<Modulo, string> = { candidaturas: 'Candidaturas', campanhas: 'Campanhas', fila: 'Fila', sistema: 'Agenda' }

// Coluna fixa da direita em toda tela operacional: o que roda agora, o que precisa de você
// em qualquer módulo e o feed do dia dos três módulos. Uma implementação só.
export function ColunaDia({ agora, modulo, limiteFeed = 30 }: { agora?: ReactNode; modulo?: Modulo; limiteFeed?: number }) {
  const g = useEstadoGlobal()
  const humanas = g.pendencias.filter(p => !p.automatica)
  return <aside className="dw-coluna" aria-label="Dia">
    {agora && <Bloco titulo="Agora">{agora}</Bloco>}
    <Bloco titulo="Precisa de você" aside={humanas.length ? <Chip tone="atencao">{humanas.length}</Chip> : <Chip tone="ok">nada</Chip>}>
      {humanas.length ? <ul className="dw-pendencias">{humanas.map(p => <li key={p.id} className={p.modulo === modulo ? 'is-aqui' : ''}>
        <div><strong>{p.titulo}</strong><small>{p.modulo !== modulo ? ROTULO[p.modulo] + ' · ' : ''}{p.acao}</small></div>
        <Botao kind="ghost" onClick={() => resolverPendencia(p)}>Resolver</Botao>
      </li>)}</ul> : <p className="dw-vazio">Tudo o que está parado é automático ou já foi tratado.</p>}
    </Bloco>
    <Bloco titulo="Dia · todos os módulos" scroll aside={<Botao kind="ghost" onClick={abrirAgenda}>Rotinas</Botao>}>
      <Feed itens={g.eventos.slice(0, limiteFeed).map(e => ({ em: e.em, rotulo: ROTULO[e.modulo], titulo: e.titulo, sub: e.sub, tone: e.tone }))} vazio={g.carregado ? 'Nenhuma atividade registrada hoje.' : 'Carregando o dia…'} />
    </Bloco>
  </aside>
}
