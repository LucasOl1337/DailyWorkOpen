// A tag <webview> do Electron já é um elemento intrínseco nos tipos do React
// (WebViewHTMLAttributes). Este arquivo só descreve a API do elemento usada
// pelo componente ConexaoExterna: navegação, recarga e leitura da URL.
export interface WebviewElement extends HTMLElement {
  src: string
  partition: string
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getTitle(): string
  loadURL(url: string): Promise<void>
}
