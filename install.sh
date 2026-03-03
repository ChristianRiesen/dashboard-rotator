#!/usr/bin/env bash
set -e

echo "=== Dashboard Rotator Installer ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Replace the FullPageOS X session with our kiosk ---
# FullPageOS uses lightdm to auto-login and run its own browser session.
# We register our kiosk as a lightdm session and set it as the default.
echo "Configuring kiosk display session..."

# Create a lightdm session that runs our kiosk script
sudo tee /usr/share/xsessions/dashboard-rotator.desktop > /dev/null <<EOF
[Desktop Entry]
Name=Dashboard Rotator
Exec=$SCRIPT_DIR/start-kiosk.sh
Type=Application
EOF
echo "  Created lightdm session: dashboard-rotator"

# Set it as the auto-login session
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"
if [ -f "$LIGHTDM_CONF" ]; then
    # Replace any existing autologin-session line, or add one
    if grep -q "^autologin-session=" "$LIGHTDM_CONF"; then
        sudo sed -i 's/^autologin-session=.*/autologin-session=dashboard-rotator/' "$LIGHTDM_CONF"
    elif grep -q "^\[Seat:\*\]" "$LIGHTDM_CONF"; then
        sudo sed -i '/^\[Seat:\*\]/a autologin-session=dashboard-rotator' "$LIGHTDM_CONF"
    else
        printf '\n[Seat:*]\nautologin-session=dashboard-rotator\n' | sudo tee -a "$LIGHTDM_CONF" > /dev/null
    fi
    echo "  Set lightdm auto-login session to dashboard-rotator"
else
    echo "  Warning: $LIGHTDM_CONF not found, lightdm session may need manual setup"
fi

# --- Install system packages ---
echo ""
echo "Installing system packages..."
sudo apt-get update -qq

# unclutter hides the mouse cursor in kiosk mode
if ! command -v unclutter &>/dev/null; then
    sudo apt-get install -y unclutter
    echo "  unclutter installed."
else
    echo "  unclutter already installed."
fi

# --- Install Node.js (LTS) if not present ---
if ! command -v node &>/dev/null; then
    echo ""
    echo "Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo ""
echo "Node.js version: $(node --version)"
echo "npm version:     $(npm --version)"

# --- Install npm dependencies ---
echo ""
echo "Installing npm dependencies..."
npm install --production

# --- Make scripts executable ---
chmod +x start-kiosk.sh start-server.sh

# --- Install and enable server service ---
echo ""
echo "Setting up server service..."
sudo cp dashboard-rotator-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable dashboard-rotator-server
sudo systemctl start dashboard-rotator-server

echo ""
echo "=== Installation complete ==="
echo ""
echo "Reboot to start the kiosk display:"
echo "  sudo reboot"
echo ""
echo "Management UI:  http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status dashboard-rotator-server   # server status"
echo "  sudo systemctl restart dashboard-rotator-server   # restart server"
echo "  sudo systemctl restart lightdm                    # restart kiosk display"
echo ""
