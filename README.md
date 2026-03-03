# Dashboard Rotator

A rotating dashboard display for Raspberry Pi running [FullPageOS](https://github.com/guysoft/FullPageOS). Cycles through a list of URLs in full-screen Chromium, controlled via the Chrome DevTools Protocol. Includes a web-based management UI to add, reorder, and configure dashboards from any device on the network.

## Installation on FullPageOS

### 1. Flash FullPageOS

Download the latest [FullPageOS release](https://github.com/guysoft/FullPageOS/releases) and flash it to your SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/).

In Raspberry Pi Imager, click **Edit Settings** before writing and configure:

- **Hostname** — e.g. `dashboard`
- **Username / Password** — keep the default `pi` user
- **WiFi** — enter your network credentials (skip if using ethernet)
- **SSH** — enable under the Services tab

Insert the SD card into your Pi and boot it.

### 2. Copy the project to the Pi

SSH into your Pi:

```bash
ssh pi@dashboard.local
```

Clone the repository:

```bash
cd ~
git clone https://github.com/ChristianRiesen/dashboard-rotator.git
```

Or if you prefer, copy the files manually with `scp` from your computer:

```bash
scp -r /path/to/dashboard-rotator pi@dashboard.local:~/dashboard-rotator
```

### 3. Run the install script

```bash
cd ~/dashboard-rotator
bash install.sh
```

The install script handles everything:

- Replaces the FullPageOS browser session with the dashboard rotator kiosk
- Installs `unclutter` (hides the mouse cursor)
- Installs Node.js LTS if not already present
- Installs npm dependencies
- Sets up and starts the server service

Once complete, reboot to cleanly swap out the FullPageOS browser for the dashboard rotator:

```bash
sudo reboot
```

After reboot, the management UI is available at `http://<pi-ip>:3000`.

### 4. Add your dashboards

Open the management UI from any browser on your network (the install script prints the URL). Add your dashboard URLs, set rotation durations, and they will start cycling immediately.

**Logging into private dashboards:** Connect a keyboard and mouse to the Pi. The dashboards are running in real Chromium tabs, so you can log in directly. Cookies persist across reboots.

## Services

| Component | Managed by | Description |
|---|---|---|
| Server | systemd (`dashboard-rotator-server`) | Node.js backend (Express + WebSocket on port 3000) |
| Kiosk | lightdm X session | Chromium in kiosk mode with CDP on port 9222 |

Useful commands:

```bash
# Server
sudo systemctl status dashboard-rotator-server
sudo systemctl restart dashboard-rotator-server
journalctl -u dashboard-rotator-server -f

# Kiosk display
sudo systemctl restart lightdm
```

## Running locally (development)

Requires Node.js and a Chromium instance with remote debugging enabled.

Start Chromium:

```bash
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chromium-debug
```

Start the server:

```bash
npm install
npm start
```

The management UI will be available at `http://localhost:3000`.
