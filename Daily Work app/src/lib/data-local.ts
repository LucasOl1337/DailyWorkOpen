export type ModoData = 'dia' | 'sumario'

export function hojeLocal(agora = new Date()): string {
  return [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, '0'),
    String(agora.getDate()).padStart(2, '0'),
  ].join('-')
}

export function limitarViewSumarioAoHoje(view: string, hoje = hojeLocal()): string {
  if (!view.startsWith('sumario:')) return view
  const data = view.slice(8)
  return data > hoje ? `sumario:${hoje}` : view
}

export function podeAvancarData(modo: ModoData, data: string, hoje = hojeLocal()): boolean {
  return modo !== 'sumario' || data < hoje
}
