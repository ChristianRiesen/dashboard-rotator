#!/usr/bin/env bash
# Undo what install.sh changed: stop the server, remove the kiosk session and
# give the machine its normal desktop back. The project folder, your dashboards
# (data/) and uploaded images (images/) are left untouched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_NAME="dashboard-rotator"
SESSION_FILE="/usr/share/wayland-sessions/${SESSION_NAME}.desktop"
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"
SERVICE_NAME="dashboard-rotator-server"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

say "=== Dashboard Rotator Uninstaller ==="
sudo -v

say "Stopping the server service..."
sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
info "Service removed."

say "Removing the kiosk session..."
sudo rm -f "$SESSION_FILE"
info "Session file removed."

say "Restoring the logging configuration..."
sudo rm -f /etc/systemd/journald.conf.d/zz-dashboard-rotator.conf
sudo rm -f /etc/tmpfiles.d/dashboard-rotator.conf
sudo systemctl restart systemd-journald
info "System defaults restored (Raspberry Pi OS keeps the journal in RAM anyway)."

say "Restoring the LightDM configuration..."
if [ -f "${LIGHTDM_CONF}.dashboard-rotator.bak" ]; then
    sudo cp "${LIGHTDM_CONF}.dashboard-rotator.bak" "$LIGHTDM_CONF"
    info "Restored from ${LIGHTDM_CONF}.dashboard-rotator.bak"
elif [ -f "$LIGHTDM_CONF" ]; then
    # No backup: point the session back at the Raspberry Pi desktop if it exists.
    FALLBACK=rpd-labwc
    [ -f /usr/share/wayland-sessions/rpd-labwc.desktop ] || FALLBACK=labwc
    sudo sed -i -E "s|^autologin-session=${SESSION_NAME}$|autologin-session=${FALLBACK}|" "$LIGHTDM_CONF"
    sudo sed -i -E "s|^log-directory=/run/lightdm$|#log-directory=/var/log/lightdm|" "$LIGHTDM_CONF"
    info "No backup found, set autologin-session back to $FALLBACK."
fi

say "=== Done ==="
cat <<EOF

Reboot to get the desktop back:

  sudo reboot

Still on disk, remove by hand if you no longer want them:

  $SCRIPT_DIR                      the project, including data/ and images/
  \$HOME/.chromium-kiosk            the kiosk browser profile (cookies, logins)
  \$HOME/.local/share/icons/dashboard-blank   the transparent cursor theme

EOF
