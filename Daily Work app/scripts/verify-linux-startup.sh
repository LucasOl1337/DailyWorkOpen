#!/usr/bin/env bash
# Confere atalho, wrapper, Hyprland e instância única do DailyWork no Linux.
set -euo pipefail

EXERCISE=0
for arg in "$@"; do
  case "$arg" in
    --exercise) EXERCISE=1 ;;
    --skip-exercise) EXERCISE=0 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ELECTRON="$PROJECT_ROOT/node_modules/electron/dist/electron"
WRAPPER="$HOME/.local/bin/dailywork"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/dailywork.desktop"
BINDINGS="$HOME/.config/hypr/bindings.lua"
AUTOSTART="$HOME/.config/hypr/autostart.lua"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -x "$ELECTRON" ]] || fail "Electron não encontrado em $ELECTRON"
[[ -f "$PROJECT_ROOT/dist/index.html" ]] || fail "Build ausente em $PROJECT_ROOT/dist/index.html"
[[ -x "$WRAPPER" ]] || fail "Wrapper não encontrado em $WRAPPER"
[[ -f "$DESKTOP_FILE" ]] || fail "Atalho desktop não encontrado em $DESKTOP_FILE"
grep -q "Exec=$WRAPPER" "$DESKTOP_FILE" || fail "O atalho não aponta para $WRAPPER"
grep -q "StartupWMClass=DailyWork" "$DESKTOP_FILE" || fail "StartupWMClass do atalho está incorreto"

if [[ -d "$HOME/.config/hypr" ]]; then
  [[ -f "$BINDINGS" ]] || fail "bindings.lua ausente"
  [[ -f "$AUTOSTART" ]] || fail "autostart.lua ausente"
  grep -q 'o.bind("SUPER + D", "DailyWork"' "$BINDINGS" || fail "Super+D não está em bindings.lua"
  grep -Fq "$WRAPPER --toggle" "$BINDINGS" || fail "O bind Super+D não chama o wrapper com --toggle"
  grep -Fq 'o.window({ title = "^DailyWork$" }, { maximize = true })' "$BINDINGS" || fail "DailyWork não está configurado para ocupar toda a área útil"
  (grep -Fq "$WRAPPER --background" "$AUTOSTART" || grep -Fq "systemctl --user start dailywork.service" "$AUTOSTART") || fail "O autostart não inicia o DailyWork oculto"
fi

if [[ "$EXERCISE" -eq 0 ]]; then
  echo "PASS: instalação Linux do DailyWork configurada."
  exit 0
fi

pgrep_dailywork() {
  ps -eo pid=,args= | grep -F "$ELECTRON $PROJECT_ROOT" | grep -v -- '--type=' | awk '{print $1}' || true
}

pids="$(pgrep_dailywork)"
if [[ -z "$pids" ]]; then
  if [[ ! -x "$ELECTRON" && -f "$PROJECT_ROOT/node_modules/electron/install.js" ]]; then
    node "$PROJECT_ROOT/node_modules/electron/install.js"
  fi
  nohup "$WRAPPER" --background >/tmp/dailywork-install.log 2>&1 &
  disown || true
  deadline=$((SECONDS + 20))
  while [[ -z "$(pgrep_dailywork)" && $SECONDS -lt $deadline ]]; do
    sleep 0.25
  done
  pids="$(pgrep_dailywork)"
  [[ -n "$pids" ]] || fail "O DailyWork não iniciou em segundo plano. Veja /tmp/dailywork-install.log"
fi

count="$(printf '%s\n' "$pids" | grep -c .)"
if [[ "$count" -ne 1 ]]; then
  fail "Esperava 1 instância do DailyWork, encontrei $count (PIDs: $pids)"
fi

echo "PASS: DailyWork ativo em segundo plano. PID=$pids"
