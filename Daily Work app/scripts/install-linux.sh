#!/usr/bin/env bash
# Instala o DailyWork neste Omarchy: build, atalho, Super+D e início oculto no login.
set -euo pipefail

SKIP_BUILD=0
SKIP_EXERCISE=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-exercise) SKIP_EXERCISE=1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ELECTRON="$PROJECT_ROOT/node_modules/electron/dist/electron"
DIST_ENTRY="$PROJECT_ROOT/dist/index.html"
WRAPPER="$HOME/.local/bin/dailywork"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/dailywork.desktop"
BINDINGS="$HOME/.config/hypr/bindings.lua"
AUTOSTART="$HOME/.config/hypr/autostart.lua"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  (cd "$PROJECT_ROOT" && npm run build)
fi

if [[ ! -x "$ELECTRON" && -f "$PROJECT_ROOT/node_modules/electron/install.js" ]]; then
  node "$PROJECT_ROOT/node_modules/electron/install.js"
fi

if [[ ! -x "$ELECTRON" ]]; then
  echo "Electron não encontrado em $ELECTRON. Execute npm install primeiro." >&2
  exit 1
fi

if [[ ! -f "$DIST_ENTRY" ]]; then
  echo "Build não encontrada em $DIST_ENTRY. Execute npm run build primeiro." >&2
  exit 1
fi

mkdir -p "$(dirname "$WRAPPER")" "$DESKTOP_DIR"

cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
ROOT=$(printf '%q' "$PROJECT_ROOT")
ELECTRON="\$ROOT/node_modules/electron/dist/electron"
INDEX="\$ROOT/dist/index.html"
if [[ ! -x "\$ELECTRON" ]]; then
  echo "Electron não encontrado em \$ELECTRON. Rode npm install em \$ROOT" >&2
  exit 1
fi
if [[ ! -f "\$INDEX" ]]; then
  echo "Build ausente. Rode npm run build em \$ROOT" >&2
  exit 1
fi
exec "\$ELECTRON" "\$ROOT" "\$@"
EOF
chmod +x "$WRAPPER"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=DailyWork
Comment=Painel diário de trabalho
Exec=$WRAPPER
TryExec=$WRAPPER
Icon=applications-office
Terminal=false
Categories=Office;ProjectManagement;
StartupNotify=true
StartupWMClass=DailyWork
Keywords=daily;work;kanban;resumo;
EOF

upsert_block() {
  local file="$1"
  local start="$2"
  local end="$3"
  local body="$4"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  local stamp
  stamp="$(date +%s)"
  cp "$file" "$file.bak.$stamp"
  python3 - "$file" "$start" "$end" "$body" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
start, end, body = sys.argv[2], sys.argv[3], sys.argv[4]
text = path.read_text(encoding='utf-8')
block = f"{start}\n{body.rstrip()}\n{end}\n"
begin = text.find(start)
finish = text.find(end)
if begin >= 0 and finish > begin:
    finish += len(end)
    while finish < len(text) and text[finish] == '\n':
        finish += 1
    text = text[:begin] + block + text[finish:]
else:
    if text and not text.endswith('\n'):
        text += '\n'
    text += '\n' + block
path.write_text(text, encoding='utf-8')
PY
}

if [[ -d "$HOME/.config/hypr" ]]; then
  upsert_block "$BINDINGS" \
    "-- DailyWork (managed by scripts/install-linux.sh)" \
    "-- End DailyWork" \
    "o.bind(\"SUPER + D\", \"DailyWork\", \"$WRAPPER --toggle\")
-- Ocupa toda a área útil do monitor, sem dividir o mosaico com outras janelas.
o.window({ title = \"^DailyWork$\" }, { maximize = true })"
  upsert_block "$AUTOSTART" \
    "-- DailyWork (managed by scripts/install-linux.sh)" \
    "-- End DailyWork" \
    "o.launch_on_start(\"$WRAPPER --background\")"
  if command -v hyprctl >/dev/null 2>&1; then
    hyprctl reload >/dev/null
    errors="$(hyprctl configerrors || true)"
    if [[ -n "${errors//[$'\n' ]/}" && "$errors" != "unknown request" ]]; then
      echo "Hyprland reportou erros de config:" >&2
      echo "$errors" >&2
      exit 1
    fi
  fi
fi

VERIFY=("$SCRIPT_DIR/verify-linux-startup.sh")
if [[ "$SKIP_EXERCISE" -eq 1 ]]; then
  VERIFY+=(--skip-exercise)
else
  VERIFY+=(--exercise)
fi
"${VERIFY[@]}"

echo "DailyWork registrado no launcher: $DESKTOP_FILE"
echo "DailyWork no PATH do usuário: $WRAPPER"
echo "DailyWork no Hyprland: Super+D para abrir/recolher em tela maximizada; início oculto no login"
