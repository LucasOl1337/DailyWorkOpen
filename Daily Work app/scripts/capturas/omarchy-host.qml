import QtQuick
import Quickshell
import Quickshell.Io

ShellRoot {
  id: shell
  FloatingWindow {
    visible: true
    implicitWidth: 600
    implicitHeight: 60
    color: "#111111"
    Loader { id: loader; source: "Native/AgentsPanel.qml"; width: 36; height: 32; x: 10; y: 10 }
  }
  function card() {
    if (!loader.item) return null
    for (const child of loader.item.data)
      if (child && child.editorialCaptureItem !== undefined) return child.editorialCaptureItem
    return null
  }
  IpcHandler {
    target: "capture"
    function ready(): string { return loader.item && loader.item.providers.length > 1 ? "ready" : "waiting" }
    function select(tab: string, period: string): string {
      loader.item.open()
      loader.item.selectTab(tab)
      loader.item.period = period
      return "ok"
    }
    function state(): string {
      const c = shell.card()
      return JSON.stringify({ aba: loader.item.activeTab, periodo: loader.item.period, modelos: loader.item.models.length, limites: loader.item.limits.length, largura: c ? c.width : 0, altura: c ? c.height : 0 })
    }
    function shot(file: string): string {
      const c = shell.card()
      if (!c) return "missing-card"
      c.grabToImage(function(result) { result.saveToFile(file) }, Qt.size(c.width * 2, c.height * 2))
      return "capturing"
    }
  }
}
