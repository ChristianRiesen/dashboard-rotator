# Dashboard Rotator

A rotating dashboard display for the Raspberry Pi. It cycles through a list of
URLs and images in full-screen Chromium, driven over the Chrome DevTools
Protocol, and ships a web management UI so you can add, reorder and configure
dashboards from any device on the network.

It runs on a standard **Raspberry Pi OS (Debian 13 "trixie") with desktop**
image. One install script turns that desktop into a kiosk: the Pi boots
straight into the rotation, and with no dashboards configured it shows an empty
browser window until you add some.

## Installation

### 1. Flash Raspberry Pi OS

Flash **Raspberry Pi OS (64-bit) with desktop** — the image *with* the desktop,
not Lite — using [Raspberry Pi Imager](https://www.raspberrypi.com/software/).

In Raspberry Pi Imager, click **Edit Settings** before writing and configure:

- **Hostname** — e.g. `dashboard`
- **Username / Password** — any user; the kiosk runs as whoever installs it
- **WiFi** — your network credentials (skip if using ethernet)
- **SSH** — enable it under the Services tab

Insert the card, boot the Pi and let it finish its first-boot setup.

### 2. Copy the project to the Pi

SSH in and clone the repository:

```bash
ssh <user>@dashboard.local
cd ~
git clone https://github.com/ChristianRiesen/dashboard-rotator.git
```

Or copy it from your computer with `scp`:

```bash
scp -r /path/to/dashboard-rotator <user>@dashboard.local:~/dashboard-rotator
```

### 3. Run the install script

Run it as your normal user — **not** with `sudo`. It asks for the sudo password
once and then runs unattended.

```bash
cd ~/dashboard-rotator
bash install.sh
```

The script does everything in one go:

- installs the packages it needs (Chromium, labwc, wlr-randr, LightDM, Node.js)
- installs the npm dependencies
- registers a kiosk session and points LightDM's auto-login at it
- creates `kiosk.conf` from the example, carrying over your keyboard layout
- generates a transparent cursor theme so no mouse pointer sits on the screen
- moves logging into RAM so the SD card is left alone (see below)
- installs and starts the management server as a systemd service

Then reboot:

```bash
sudo reboot
```

The Pi comes back up in the kiosk. Re-running `install.sh` later is safe.

### 4. Add your dashboards

Open the management UI from any browser on your network (the install script
prints the address):

```
http://<pi-ip>:3000
```

Add your dashboard URLs, set per-entry durations and zoom levels, and the
rotation starts immediately. With a single entry enabled the rotation stops and
just keeps that page on screen.

**Logging into private dashboards:** plug a keyboard and mouse into the Pi. The
dashboards are real Chromium tabs, so you can log in directly and the cookies
survive reboots. The mouse pointer is invisible by default — set
`HIDE_CURSOR=no` in `kiosk.conf` and restart the display while you do this.

## Kiosk settings

Display-side settings live in `kiosk.conf` in the project folder, created from
`kiosk.conf.example` on first install and never overwritten afterwards (it is
git-ignored). Apply changes with `sudo systemctl restart lightdm`.

| Setting | Default | What it does |
|---|---|---|
| `ROTATION` | `normal` | Screen rotation: `normal`, `90`, `180`, `270`, `flipped*`. Applied with `wlr-randr` |
| `HIDE_CURSOR` | `yes` | Hides the mouse pointer using a fully transparent cursor theme |
| `KEYBOARD_LAYOUT` | from the desktop | XKB layout for typing into dashboards, e.g. `us`, `gb`, `de`, `ch` |
| `SERVER_PORT` | `3000` | Port the management UI listens on |
| `CDP_PORT` | `9222` | DevTools port the server drives Chromium through |
| `PROFILE_DIR` | `$HOME/.chromium-kiosk` | Browser profile — cookies and logins live here |
| `CACHE_IN_RAM` | `yes` | Keeps Chromium's cache in a tmpfs instead of on the card |
| `CHROMIUM_EXTRA_FLAGS` | empty | Extra Chromium command line flags |

## Nothing writes to the SD card

A dashboard runs unattended for months, and a card that is logged to all day
eventually wears out or fills up. The installer keeps writes off it:

- the systemd journal is set to `Storage=volatile`, so it lives in
  `/run/log/journal` (RAM) and is capped at 32 MB — `journalctl` still works
  exactly as usual, the log just starts empty after each boot
- syslog forwarding is off, and `rsyslog`/`syslog-ng` are disabled if present
- the kiosk session's own output goes to the journal instead of
  `~/.xsession-errors`
- LightDM's logs are redirected to `/run/lightdm`
- Chromium runs with crash reporting, verbose logging and background networking
  off, and with its cache in RAM (`CACHE_IN_RAM`)

What still gets written, because it has to: your dashboard list in `data/`
(a few KB, only when you change something) and uploaded images in `images/`.
Chromium also keeps cookies and local storage in `PROFILE_DIR` so your logins
survive a reboot.

Raspberry Pi OS itself already swaps to zram rather than to the card, so swap
costs the card nothing either.

## How it fits together

| Component | Managed by | Description |
|---|---|---|
| Server | systemd (`dashboard-rotator-server`) | Node.js backend: Express + WebSocket on port 3000 |
| Kiosk session | LightDM auto-login | `start-kiosk.sh` runs a bare labwc compositor |
| Browser | the kiosk session | `kiosk-session.sh` keeps Chromium alive with CDP on port 9222 |

The server owns every tab: it opens one Chromium tab per enabled dashboard,
brings the current one to the front, reloads it if configured, and applies the
per-tab zoom. Chromium itself is started on `about:blank`, which is why an empty
dashboard list simply shows a blank window.

Files worth knowing about:

| File | Purpose |
|---|---|
| `install.sh` / `uninstall.sh` | Set the kiosk up, or hand the machine back to the normal desktop |
| `start-kiosk.sh` | The LightDM session: environment, then labwc |
| `kiosk-session.sh` | Screen rotation and the Chromium supervision loop |
| `kiosk/labwc/` | labwc config for the kiosk session, deliberately minimal |
| `kiosk.conf.example` | Template for the display-side settings above |
| `server.js`, `tab-manager.js`, `storage.js` | The backend and its CDP tab management |

Useful commands:

```bash
# Server
sudo systemctl status dashboard-rotator-server
sudo systemctl restart dashboard-rotator-server
journalctl -u dashboard-rotator-server -f

# Kiosk display
sudo systemctl restart lightdm
journalctl -t dashboard-rotator-kiosk -f
```

## Updating

After pulling new code on the Pi:

```bash
cd ~/dashboard-rotator
git pull
npm install --omit=dev
sudo systemctl restart dashboard-rotator-server
```

Chromium stays running — the server reconnects over CDP by itself, so no reboot
is needed. Run `bash install.sh` again instead if the update touches the install
script or the kiosk scripts.

## Removing it

```bash
cd ~/dashboard-rotator
bash uninstall.sh
sudo reboot
```

That stops and removes the service, removes the kiosk session and restores the
LightDM configuration from the backup the installer made, giving you the normal
Raspberry Pi desktop back. Your dashboards in `data/` and images in `images/`
are left alone.

## Running locally (development)

Requires Node.js and a Chromium with remote debugging enabled.

Start Chromium:

```bash
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chromium-debug
```

Start the server:

```bash
npm install
npm start
```

The management UI is then at `http://localhost:3000`.
