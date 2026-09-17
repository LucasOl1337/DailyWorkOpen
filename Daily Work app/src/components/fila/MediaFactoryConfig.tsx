import { useEffect, useState } from 'react'
import { configurarMidiaEditorial, type ConfiguracaoMidiaEditorial } from '../../lib/editorial'
import { erroTexto } from './comum'

export function MediaFactoryConfig({
  config,
  carregada,
  onSaved,
  onError,
}: {
  config: ConfiguracaoMidiaEditorial | null
  carregada: boolean
  onSaved: (config: ConfiguracaoMidiaEditorial) => void
  onError: (mensagem: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [autorizarGasto, setAutorizarGasto] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (config) setAutorizarGasto(config.autorizarGasto === true)
  }, [config])

  async function salvar() {
    setSalvando(true)
    try {
      const salvo = await configurarMidiaEditorial({ autorizarGasto })
      onSaved(salvo)
    } catch (erro) {
      onError(erroTexto(erro).mensagem)
    } finally {
      setSalvando(false)
    }
  }

  return <details className="fila-media-config" open={aberto} onToggle={(evento) => setAberto((evento.currentTarget as HTMLDetailsElement).open)}>
    <summary>Configurar geração de mídia</summary>
    <div className="fila-media-config-body">
      {!carregada && <p className="fila-helper">Carregando configuração persistente…</p>}
      <p className="fila-helper">A pauta decide se a história precisa de captura real, ilustração ou apenas texto. A permissão abaixo vale para imagens novas, inclusive quando a produção automática pede uma ilustração. A revisão visual usa o provedor de IA configurado.</p>
      <label className="fila-media-config-toggle"><input type="checkbox" checked={autorizarGasto} onChange={(evento) => setAutorizarGasto(evento.target.checked)} disabled={!carregada} /><span><strong>Permitir geração de imagens</strong><small>Permite gerar ilustrações pelo provedor escolhido. Capturas e imagens importadas passam pela revisão visual sem nova geração.</small></span></label>
      <div className="fila-media-config-footer"><span className={autorizarGasto ? 'fila-config-on' : 'fila-config-off'}>{autorizarGasto ? 'Geração de imagens permitida' : 'Geração bloqueada; capturas e importações continuam disponíveis'}</span><button className="fila-button fila-button--quiet" type="button" disabled={!carregada || salvando || autorizarGasto === (config?.autorizarGasto === true)} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar configuração'}</button></div>
    </div>
  </details>
}
