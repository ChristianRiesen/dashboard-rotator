#!/usr/bin/env bash
# Dashboard Rotator installer for Raspberry Pi OS (Debian 13 "trixie") with the
# desktop installed. Run it once as the user the kiosk should run as:
#
#   bash install.sh
#
# It installs the dependencies, turns the desktop session into a Chromium kiosk
# driven by the rotator, and starts the management server. Re-running it is safe.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUN_USER="$(id -un)"
RUN_HOME="$HOME"
CURSOR_THEME="dashboard-blank"
SESSION_NAME="dashboard-rotator"
SESSION_FILE="/usr/share/wayland-sessions/${SESSION_NAME}.desktop"
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"
SERVICE_NAME="dashboard-rotator-server"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33mWarning:\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mError:\033[0m %s\n\n' "$*" >&2; exit 1; }

say "=== Dashboard Rotator Installer ==="

# --- Preflight ---------------------------------------------------------------

[ "$(id -u)" -ne 0 ] || die "Run this as your normal user (not with sudo). It asks for sudo when it needs it."
command -v systemctl >/dev/null || die "systemd is required."
command -v sudo >/dev/null || die "sudo is required."

if [ -r /etc/os-release ]; then
    . /etc/os-release
    info "System: ${PRETTY_NAME:-unknown}"
fi
info "User:   $RUN_USER"
info "Folder: $SCRIPT_DIR"

say "Asking for sudo up front (the rest runs unattended)..."
sudo -v

# --- System packages ---------------------------------------------------------

say "Installing system packages..."

# chromium    the kiosk browser
# labwc       the Wayland compositor the kiosk session runs on
# wlr-randr   applies screen rotation inside that session
# lightdm     display manager that auto-logs in and starts the session
# nodejs/npm  the rotator server (Debian trixie ships Node.js 20)
PACKAGES=(chromium labwc wlr-randr lightdm nodejs npm)
MISSING=()
for pkg in "${PACKAGES[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "ok installed"; then
        MISSING+=("$pkg")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    info "Missing: ${MISSING[*]}"
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${MISSING[@]}"
else
    info "All required packages are already installed."
fi

# --- Node.js -----------------------------------------------------------------

command -v node >/dev/null || die "Node.js was not installed. Install it manually and re-run."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
    say "Node.js $(node --version) is too old, installing the current LTS..."
    # NodeSource's nodejs bundles npm and conflicts with Debian's npm package.
    sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y npm || true
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

info "Node.js $(node --version), npm $(npm --version)"

say "Installing npm dependencies..."
npm install --omit=dev --no-audit --no-fund

# --- Kiosk settings file -----------------------------------------------------

say "Preparing kiosk settings..."

if [ ! -f "$SCRIPT_DIR/kiosk.conf" ]; then
    cp "$SCRIPT_DIR/kiosk.conf.example" "$SCRIPT_DIR/kiosk.conf"

    # Carry the keyboard layout over from the desktop session so typing into a
    # dashboard on an attached keyboard keeps working.
    LAYOUT=""
    for envfile in "$RUN_HOME/.config/labwc/environment" /etc/xdg/labwc/environment; do
        if [ -z "$LAYOUT" ] && [ -f "$envfile" ]; then
            LAYOUT="$(sed -n 's/^XKB_DEFAULT_LAYOUT=//p' "$envfile" | tail -1)"
        fi
    done
    if [ -n "$LAYOUT" ]; then
        sed -i "s/^KEYBOARD_LAYOUT=.*/KEYBOARD_LAYOUT=$LAYOUT/" "$SCRIPT_DIR/kiosk.conf"
        info "Created kiosk.conf (keyboard layout: $LAYOUT)"
    else
        info "Created kiosk.conf"
    fi
else
    info "kiosk.conf already exists, leaving it alone."
fi

chmod +x "$SCRIPT_DIR"/start-kiosk.sh "$SCRIPT_DIR"/kiosk-session.sh "$SCRIPT_DIR"/start-server.sh

# --- Transparent cursor theme ------------------------------------------------

# There is no unclutter equivalent under Wayland, so the pointer is hidden by
# pointing the session at a cursor theme whose every cursor is a single
# transparent pixel. Disable it with HIDE_CURSOR=no in kiosk.conf.
say "Generating the blank cursor theme..."

if command -v python3 >/dev/null 2>&1; then
    python3 - "$RUN_HOME/.local/share/icons/$CURSOR_THEME" "$CURSOR_THEME" <<'PYEOF'
import os, struct, sys

theme_dir, theme_name = sys.argv[1], sys.argv[2]
cursor_dir = os.path.join(theme_dir, "cursors")
os.makedirs(cursor_dir, exist_ok=True)

with open(os.path.join(theme_dir, "index.theme"), "w") as fh:
    fh.write("[Icon Theme]\nName=%s\nComment=Fully transparent cursors for kiosk use\n" % theme_name)

# Xcursor file: 16 byte header, one table entry and one image chunk per size.
IMAGE_TYPE = 0xFFFD0002
sizes = [16, 24, 32, 48, 64]
blob = struct.pack("<4sIII", b"Xcur", 16, 0x00010000, len(sizes))
chunks, offset = b"", 16 + 12 * len(sizes)
for size in sizes:
    blob += struct.pack("<III", IMAGE_TYPE, size, offset)
    # header, type, subtype(size), version, width, height, xhot, yhot, delay
    chunk = struct.pack("<9I", 36, IMAGE_TYPE, size, 1, 1, 1, 0, 0, 0)
    chunk += b"\x00\x00\x00\x00"  # one fully transparent ARGB pixel
    chunks += chunk
    offset += len(chunk)

default_cursor = os.path.join(cursor_dir, "default")
with open(default_cursor, "wb") as fh:
    fh.write(blob + chunks)

names = """left_ptr pointer arrow top_left_arrow text xterm ibeam hand hand1 hand2
pointing_hand watch wait progress left_ptr_watch crosshair cross grab grabbing move
all-scroll not-allowed no-drop help question_arrow context-menu cell copy alias
vertical-text zoom-in zoom-out dnd-move dnd-copy dnd-none fleur X_cursor
n-resize s-resize e-resize w-resize ne-resize nw-resize se-resize sw-resize
ew-resize ns-resize nesw-resize nwse-resize col-resize row-resize
sb_h_double_arrow sb_v_double_arrow""".split()

for name in names:
    link = os.path.join(cursor_dir, name)
    if os.path.lexists(link):
        os.remove(link)
    os.symlink("default", link)

print("  Cursor theme written to %s" % theme_dir)
PYEOF
else
    warn "python3 not found, skipping the blank cursor theme (the pointer will stay visible)."
fi

# --- Chromium policies -------------------------------------------------------

# Several kiosk annoyances have no command line switch: the save-password
# bubble, the Privacy Sandbox prompt, print preview, download prompts and the
# permission dialogs. Those are managed policies, which Chromium reads from
# /etc/chromium/policies/managed. They apply to every Chromium on this machine.
say "Installing the Chromium kiosk policies..."

sudo mkdir -p /etc/chromium/policies/managed
sudo cp "$SCRIPT_DIR/kiosk/chromium-policies.json" \
    /etc/chromium/policies/managed/dashboard-rotator.json
info "Policies: /etc/chromium/policies/managed/dashboard-rotator.json"
info "Check them on the kiosk itself at chrome://policy"

# --- Kiosk session -----------------------------------------------------------

say "Registering the kiosk session with LightDM..."

sudo mkdir -p "$(dirname "$SESSION_FILE")"
sudo tee "$SESSION_FILE" > /dev/null <<EOF
[Desktop Entry]
Name=Dashboard Rotator
Comment=Full screen rotating dashboard kiosk
Exec=$SCRIPT_DIR/start-kiosk.sh
Type=Application
DesktopNames=labwc;wlroots
EOF
info "Session file: $SESSION_FILE"

# Set key=value inside a given section of lightdm.conf, replacing the existing
# (or commented out) line if there is one and adding the section if there is not.
conf_set() {
    local section="$1" key="$2" value="$3"
    local escaped
    escaped="$(printf '%s' "$section" | sed 's/[][\\.*^$/]/\\&/g')"

    if sudo awk -v s="$section" -v k="$key" '
            /^\[/ { in_section = ($0 == s); next }
            in_section && $0 ~ "^[#[:space:]]*" k "=" { found = 1 }
            END { exit !found }' "$LIGHTDM_CONF"; then
        sudo sed -i "/^${escaped}\$/,/^\[/{s|^[#[:space:]]*${key}=.*|${key}=${value}|}" "$LIGHTDM_CONF"
    elif sudo grep -qxF "$section" "$LIGHTDM_CONF"; then
        sudo sed -i "/^${escaped}\$/a ${key}=${value}" "$LIGHTDM_CONF"
    else
        printf '\n%s\n%s=%s\n' "$section" "$key" "$value" | sudo tee -a "$LIGHTDM_CONF" > /dev/null
    fi
}

if [ ! -f "$LIGHTDM_CONF" ]; then
    printf '[Seat:*]\n' | sudo tee "$LIGHTDM_CONF" > /dev/null
fi

# Keep one pristine copy so uninstall.sh can put the desktop back.
if [ ! -f "${LIGHTDM_CONF}.dashboard-rotator.bak" ]; then
    sudo cp "$LIGHTDM_CONF" "${LIGHTDM_CONF}.dashboard-rotator.bak"
    info "Backed up the original config to ${LIGHTDM_CONF}.dashboard-rotator.bak"
fi

conf_set '[Seat:*]' autologin-user "$RUN_USER"
conf_set '[Seat:*]' autologin-user-timeout 0
conf_set '[Seat:*]' autologin-session "$SESSION_NAME"
info "Auto-login: $RUN_USER into the $SESSION_NAME session"

# --- Keep logs off the SD card -----------------------------------------------

# A dashboard runs unattended for months, so nothing may keep writing to the
# card. Everything worth keeping goes to the journal, which lives in RAM.
say "Moving logging into RAM..."

# The zz- prefix matters: journald applies its drop-ins in filename order, and
# Raspberry Pi OS ships /usr/lib/systemd/journald.conf.d/syslog.conf, which
# would otherwise be applied after ours and turn syslog forwarding back on.
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/zz-dashboard-rotator.conf > /dev/null <<'EOF'
# Installed by dashboard-rotator: keep the journal in RAM (/run/log/journal) so
# the SD card is never written to, and cap it so it cannot eat all the memory.
[Journal]
Storage=volatile
RuntimeMaxUse=32M
RuntimeMaxFileSize=8M
ForwardToSyslog=no
ForwardToWall=no
EOF
sudo systemctl restart systemd-journald
info "Journal: volatile, capped at 32M (journalctl still works, it just resets on reboot)"

# Any journal already written to the card is dead weight now.
if [ -d /var/log/journal ] && [ -n "$(sudo ls -A /var/log/journal 2>/dev/null)" ]; then
    sudo find /var/log/journal -mindepth 1 -delete
    info "Cleared the old on-disk journal in /var/log/journal"
fi

# A syslog daemon would copy the journal straight back onto the card.
for unit in rsyslog syslog-ng; do
    if systemctl list-unit-files "${unit}.service" 2>/dev/null | grep -q "${unit}.service"; then
        sudo systemctl disable --now "$unit" 2>/dev/null || true
        info "Disabled $unit (it would write the journal back to the card)"
    fi
done

# LightDM writes a log per session start; point those at RAM too.
sudo tee /etc/tmpfiles.d/dashboard-rotator.conf > /dev/null <<'EOF'
# Installed by dashboard-rotator: RAM-backed log directory for LightDM.
d /run/lightdm 0755 root root -
EOF
sudo systemd-tmpfiles --create /etc/tmpfiles.d/dashboard-rotator.conf
conf_set '[LightDM]' log-directory /run/lightdm
info "LightDM logs: /run/lightdm"

# --- Server service ----------------------------------------------------------

say "Installing the server service..."

sed -e "s|__USER__|$RUN_USER|g" -e "s|__DIR__|$SCRIPT_DIR|g" \
    "$SCRIPT_DIR/dashboard-rotator-server.service.in" \
    | sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null
sudo systemctl restart "$SERVICE_NAME"
sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
    info "$SERVICE_NAME is running."
else
    warn "$SERVICE_NAME did not start. Check: journalctl -u $SERVICE_NAME -n 50"
fi

# --- Done --------------------------------------------------------------------

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

say "=== Installation complete ==="
cat <<EOF

Reboot to hand the screen over to the kiosk:

  sudo reboot

After the reboot the Pi shows an empty browser window until you add dashboards.
Manage them from any device on the network:

  http://${IP:-<pi-ip>}:3000

Useful commands:

  sudo systemctl status $SERVICE_NAME    # server status
  journalctl -u $SERVICE_NAME -f         # server log
  sudo systemctl restart lightdm         # restart the kiosk display
  bash uninstall.sh                      # put the normal desktop back

Kiosk settings (screen rotation, cursor, keyboard) live in:

  $SCRIPT_DIR/kiosk.conf

EOF
