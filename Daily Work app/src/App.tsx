import {navegarPara} from './lib/destinos'
import { ResolucaoPendencias } from './components/ResolucaoPendencias'
import { atualizarViewAgentes, conectarControleAgentes } from './lib/canvas-agentes'
import { lazy, Suspense, useEffect, useState } from 'react'
import 'tldraw/tldraw.css'
import { Sidebar } from './components/Sidebar'
import { Hoje } from './components/Hoje'
import { ProvedorEstadoGlobal } from './lib/estado-global'
import './components/ui/ui.css'
import { QuadroDia } from './components/QuadroDia'
import { SiteLucasOL } from './components/SiteLucasOL'
import { ConexaoExterna } from './components/ConexaoExterna'
import { SumarioDiario } from './components/SumarioDiario'
import { FilaEditorial } from './components/FilaEditorial'
import { CentralAgente } from './components/CentralAgente'
import { Automacoes } from './components/Automacoes'
import { Skills } from './components/Skills'
import { LogicaEditorial } from './components/LogicaEditorial'
import { hojeLocal, limitarViewSumarioAoHoje } from './lib/data-local'

// Os canvases trazem o tldraw (a maior parte do bundle): só carregam ao abrir.
const QuadroPrincipal = lazy(() => import('./components/QuadroPrincipal').then(m => ({ default: m.QuadroPrincipal })))
const SessaoLivre = lazy(() => import('./components/SessaoLivre').then(m => ({ default: m.SessaoLivre })))

// view = principal | site | fila | logica | agente | automacoes | skills | conexao:<id> | dia:AAAA-MM-DD | sumario:AAAA-MM-DD | sessao:<id>.
// O trabalho abre sempre no dia local atual; Principal é conteúdo geral.
export default function App() {
  const [view, setView] = useState<string>(() => {
    const solicitada = new URLSearchParams(window.location.search).get('view')
    if (
      solicitada === 'principal' ||
      solicitada === 'site' ||
      solicitada === 'fila' ||
      solicitada === 'agente' ||
      solicitada === 'automacoes' ||
      solicitada === 'candidaturas' ||
      solicitada === 'hoje' ||
      solicitada === 'skills' ||
      solicitada === 'logica' ||
      solicitada?.startsWith('conexao:') ||
      solicitada?.startsWith('dia:') ||
      solicitada?.startsWith('sumario:') ||
      solicitada?.startsWith('sessao:')
    ) {
      // Compatibilidade: a antiga aba de candidaturas dentro de Automações virou uma view própria.
      if (solicitada === 'automacoes' && new URLSearchParams(window.location.search).get('moduloAutomacoes') === 'candidaturas') return 'candidaturas'
      return limitarViewSumarioAoHoje(solicitada)
    }
    // Sem view pedida, abre em Hoje: o que precisa de você antes de qualquer módulo.
    return 'hoje'
  })
  atualizarViewAgentes(view, setView)
  useEffect(() => conectarControleAgentes(), [])
  useEffect(() => {
    function aoNavegar(e: Event) {
      const proxima = (e as CustomEvent)?.detail?.view
      if (typeof proxima === 'string' && proxima) {
        const destino = (e as CustomEvent).detail
        const url = new URL(location.href)
        url.searchParams.set('view', proxima)
        if (destino.campanhaId) url.searchParams.set('campanha', destino.campanhaId)
        if (destino.secao) url.searchParams.set('secao', destino.secao)
        else url.searchParams.delete('secao')
        history.replaceState(null, '', url)
        setView(limitarViewSumarioAoHoje(proxima))
        window.dispatchEvent(new CustomEvent('app:destino'))
      }
    }
    window.addEventListener('app:navegar', aoNavegar)
    window.addEventListener('agenda:navegar', aoNavegar)
    return () => {
      window.removeEventListener('app:navegar', aoNavegar)
      window.removeEventListener('agenda:navegar', aoNavegar)
    }
  }, [])
  const dia = view.startsWith('dia:') ? view.slice(4) : undefined
  const sumario = view.startsWith('sumario:') ? view.slice(8) : undefined
  const sessao = view.startsWith('sessao:') ? view.slice(7) : undefined
  const conexao = view.startsWith('conexao:') ? view.slice(8) : undefined

  useEffect(() => {
    if (!window.dailyworkApi?.alterarEscala) return
    function noScroll(evento: WheelEvent) {
      if (!evento.ctrlKey && !evento.metaKey) return
      const alvo = evento.target
      if (alvo instanceof Element && alvo.closest('.tl-container, .tl-canvas')) return
      evento.preventDefault()
      void window.dailyworkApi?.alterarEscala(evento.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('wheel', noScroll, { passive: false })
    return () => window.removeEventListener('wheel', noScroll)
  }, [])

  return (
    <ProvedorEstadoGlobal>
      <ResolucaoPendencias />
      <div className="dw-shell">
        <Sidebar view={view} onMudar={(proximaView) => navegarPara({view:limitarViewSumarioAoHoje(proximaView)})} />
        <div className="dw-main">
          <Suspense fallback={null}>
          {view === 'hoje' && <Hoje />}
          {view === 'principal' && (
            <QuadroPrincipal key={view} onAbrirSessao={(id) => setView(`sessao:${id}`)} />
          )}
          {view === 'site' && <SiteLucasOL />}
          {view === 'fila' && <FilaEditorial onNavegar={(proximaView) => setView(limitarViewSumarioAoHoje(proximaView))} />}
          {view === 'agente' && <CentralAgente />}
          {(view === 'automacoes' || view === 'candidaturas') && <Automacoes modulo={view === 'candidaturas' ? 'candidaturas' : 'campanhas'} />}
          {view === 'skills' && <Skills />}
          {view === 'logica' && <LogicaEditorial />}
          {conexao && <ConexaoExterna key={conexao} id={conexao} />}
          {dia && <QuadroDia key={dia} dia={dia} />}
          {sumario && <SumarioDiario key={sumario} dia={sumario} />}
          {sessao && <SessaoLivre key={view} sessaoId={sessao} />}
          </Suspense>
        </div>
      </div>
    </ProvedorEstadoGlobal>
  )
}
