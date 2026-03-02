#!/usr/bin/env bash
set -e

echo "=== Dashboard Rotator Installer ==="

# Install Node.js (LTS) if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Install dependencies
cd "$(dirname "$0")"
npm install --production

# Make scripts executable
chmod +x start-kiosk.sh start-server.sh

# Install systemd services
sudo cp dashboard-rotator-server.service /etc/systemd/system/
sudo cp dashboard-rotator-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable our services
sudo systemctl enable dashboard-rotator-server
sudo systemctl enable dashboard-rotator-kiosk

echo ""
echo "=== Installation complete ==="
echo "Start now:    sudo systemctl start dashboard-rotator-server"
echo "              sudo systemctl start dashboard-rotator-kiosk"
echo "Management:   http://$(hostname -I | awk '{print $1}'):3000"
echo ""
