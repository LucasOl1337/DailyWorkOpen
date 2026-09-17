import type { FonteInputsSumario, StatusFonteSumario } from '../lib/api'

const ROTULOS: Record<StatusFonteSumario, string> = {
  not_found: 'Não conectada',
  empty: 'Sem atividade',
  partial: 'Leitura parcial',
  complete: 'Leitura completa',
}

export function CoberturaInputsSumario({ fontes }: { fontes: FonteInputsSumario[] }) {
  const comInputs = fontes.filter((fonte) => fonte.inputCount > 0).length
  const semInputs = fontes.length - comInputs

  return (
    <details className="sumario-input-sources" data-testid="cobertura-inputs">
      <summary>
        <span className="sumario-input-sources__heading">
          <strong>Fontes consultadas</strong>
          <small>
            {quantidade(comInputs, 'fonte com suas mensagens', 'fontes com suas mensagens')} · {quantidade(semInputs, 'fonte sem mensagens suas', 'fontes sem mensagens suas')}
          </small>
        </span>
        <span className="sumario-input-sources__total">{quantidade(fontes.length, 'fonte', 'fontes')}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
        </svg>
      </summary>
      <ul>
        {fontes.map((fonte) => {
          const status = apresentacaoDoStatus(fonte)
          return (
            <li key={fonte.id}>
              <span className={`sumario-input-source__dot is-${status.className}`} aria-hidden="true" />
              <span className="sumario-input-source__copy">
                <strong>{fonte.label}</strong>
                <small>{detalheDaFonte(fonte)}</small>
              </span>
              <span className={`sumario-input-source__status is-${status.className}`}>
                {status.label}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function apresentacaoDoStatus(fonte: FonteInputsSumario) {
  if (fonte.status === 'complete' && fonte.inputCount === 0 && fonte.messages > 0) {
    return { className: 'context', label: 'Só contexto' }
  }
  return { className: fonte.status, label: ROTULOS[fonte.status] }
}

function numero(valor: number) {
  return new Intl.NumberFormat('pt-BR').format(valor)
}

function quantidade(valor: number, singular: string, plural: string) {
  return valor === 1 ? `1 ${singular}` : `${numero(valor)} ${plural}`
}

function detalheDaFonte(fonte: FonteInputsSumario) {
  if (fonte.status === 'not_found') return 'Nenhum dado local foi encontrado.'
  if (fonte.status === 'empty') return 'Fonte encontrada, sem atividade neste dia.'
  if (fonte.status === 'partial') {
    return `${quantidade(fonte.inputCount, 'mensagem sua', 'mensagens suas')} · ${quantidade(fonte.errorCount, 'falha de leitura', 'falhas de leitura')}`
  }
  if (fonte.inputCount > 0) {
    return `${quantidade(fonte.inputCount, 'mensagem sua', 'mensagens suas')} · ${quantidade(fonte.conversations, 'conversa', 'conversas')}`
  }
  return `${quantidade(fonte.messages, 'registro de contexto', 'registros de contexto')} · nenhuma mensagem sua`
}
