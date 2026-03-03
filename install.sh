#!/usr/bin/env bash
set -e

echo "=== Dashboard Rotator Installer ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Disable FullPageOS default browser ---
if systemctl cat fullpageos.service &>/dev/null; then
    echo "Disabling FullPageOS default browser..."
    sudo systemctl stop fullpageos.service 2>/dev/null || true
    sudo systemctl disable fullpageos.service 2>/dev/null || true
    echo "  FullPageOS browser disabled."
else
    echo "  FullPageOS service not found (skipping)."
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

# --- Install and enable systemd services ---
echo ""
echo "Setting up systemd services..."
sudo cp dashboard-rotator-server.service /etc/systemd/system/
sudo cp dashboard-rotator-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable dashboard-rotator-server
sudo systemctl enable dashboard-rotator-kiosk

# --- Start services ---
echo ""
echo "Starting services..."
sudo systemctl start dashboard-rotator-server
sleep 2
sudo systemctl start dashboard-rotator-kiosk

echo ""
echo "=== Installation complete ==="
echo ""
echo "Both services are running and will start automatically on boot."
echo ""
echo "Management UI:  http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status dashboard-rotator-server"
echo "  sudo systemctl status dashboard-rotator-kiosk"
echo "  sudo systemctl restart dashboard-rotator-server"
echo "  sudo systemctl restart dashboard-rotator-kiosk"
echo ""
