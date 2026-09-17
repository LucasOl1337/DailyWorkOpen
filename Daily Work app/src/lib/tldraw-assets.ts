import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'

// Mantém URLs nativas dos assets. Traduções precisam ser buscáveis via fetch:
// Chromium não permite fetch(file://), embora imagens/fontes aceitem file://.
const assets = getAssetUrlsByImport((url) => url)
const traducoes = import.meta.glob('/node_modules/@tldraw/assets/translations/*.json', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>
const fontes = import.meta.glob('/node_modules/@tldraw/assets/fonts/*.woff2', {
  eager: true, query: '?inline', import: 'default',
}) as Record<string, string>
const arquivoFonte: Record<keyof typeof assets.fonts, string> = {
  tldraw_mono_bold: 'IBMPlexMono-Bold.woff2',
  tldraw_mono_italic_bold: 'IBMPlexMono-BoldItalic.woff2',
  tldraw_mono: 'IBMPlexMono-Medium.woff2',
  tldraw_mono_italic: 'IBMPlexMono-MediumItalic.woff2',
  tldraw_sans_bold: 'IBMPlexSans-Bold.woff2',
  tldraw_sans_italic_bold: 'IBMPlexSans-BoldItalic.woff2',
  tldraw_sans: 'IBMPlexSans-Medium.woff2',
  tldraw_sans_italic: 'IBMPlexSans-MediumItalic.woff2',
  tldraw_serif_bold: 'IBMPlexSerif-Bold.woff2',
  tldraw_serif_italic_bold: 'IBMPlexSerif-BoldItalic.woff2',
  tldraw_serif: 'IBMPlexSerif-Medium.woff2',
  tldraw_serif_italic: 'IBMPlexSerif-MediumItalic.woff2',
  tldraw_draw_bold: 'Shantell_Sans-Informal_Bold.woff2',
  tldraw_draw_italic_bold: 'Shantell_Sans-Informal_Bold_Italic.woff2',
  tldraw_draw: 'Shantell_Sans-Informal_Regular.woff2',
  tldraw_draw_italic: 'Shantell_Sans-Informal_Regular_Italic.woff2',
}
export const TLDRAW_ASSETS = {
  ...assets,
  fonts: Object.fromEntries(Object.entries(arquivoFonte).map(([id, arquivo]) => [
    id,
    fontes[`/node_modules/@tldraw/assets/fonts/${arquivo}`] || assets.fonts[id as keyof typeof assets.fonts],
  ])) as typeof assets.fonts,
  translations: Object.fromEntries(Object.keys(assets.translations).map(locale => {
    const texto = traducoes[`/node_modules/@tldraw/assets/translations/${locale}.json`]
    return [locale, texto ? `data:application/json;charset=utf-8,${encodeURIComponent(texto)}` : assets.translations[locale as keyof typeof assets.translations]]
  })) as typeof assets.translations,
}
