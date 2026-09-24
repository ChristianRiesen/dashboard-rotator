#!/usr/bin/env bash
# Browser half of the kiosk session, started by start-kiosk.sh via `labwc -S`.
#
# Applies the configured screen rotation, then keeps Chromium running in kiosk
# mode with the DevTools protocol open. The rotator server connects to that port
# and does all tab management, so Chromium is started on about:blank: with no
# dashboards configured the screen simply stays a blank browser window.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# --- Settings (see kiosk.conf.example) ---
ROTATION=normal
SERVER_PORT=3000
CDP_PORT=9222
PROFILE_DIR="$HOME/.chromium-kiosk"
CACHE_IN_RAM=yes
CHROMIUM_EXTRA_FLAGS=""
[ -f "$SCRIPT_DIR/kiosk.conf" ] && . "$SCRIPT_DIR/kiosk.conf"

# --- Screen rotation ---
if [ "$ROTATION" != "normal" ] && command -v wlr-randr >/dev/null 2>&1; then
    for output in $(wlr-randr | awk '/^[^[:space:]]/ {print $1}'); do
        wlr-randr --output "$output" --transform "$ROTATION" || true
    done
fi

# --- Locate Chromium ---
CHROMIUM=""
for candidate in chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
        CHROMIUM="$(command -v "$candidate")"
        break
    fi
done
if [ -z "$CHROMIUM" ]; then
    echo "kiosk-session: no chromium binary found, install the 'chromium' package" >&2
    sleep 30
    exit 1
fi

# Run as a native Wayland client when we have a compositor, so the window is
# crisp and hardware accelerated.
PLATFORM_FLAGS=()
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    PLATFORM_FLAGS=(--ozone-platform=wayland)
fi

# Chromium rewrites its browser cache constantly. Keeping it in RAM spares the
# SD card; the cost is a cold cache after every reboot.
CACHE_FLAGS=(--disk-cache-size=524288000)
if [ "$CACHE_IN_RAM" = "yes" ]; then
    CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/chromium-kiosk-cache"
    mkdir -p "$CACHE_DIR"
    CACHE_FLAGS=(--disk-cache-dir="$CACHE_DIR" --disk-cache-size=67108864)
fi

# Anything that can put a bubble, banner or dialog on the screen is switched
# off here. What cannot be reached from the command line is handled by the
# managed policy file install.sh drops in /etc/chromium/policies/managed/ —
# the save-password bubble, the Privacy Sandbox prompt, print preview and
# permission prompts among them.
FLAGS=(
    --kiosk
    --remote-debugging-port="$CDP_PORT"
    --remote-allow-origins="http://localhost:$SERVER_PORT"
    --user-data-dir="$PROFILE_DIR"
    --noerrdialogs
    --no-first-run
    --no-default-browser-check
    --disable-default-apps
    # No banners, bubbles or one-off screens over the dashboards.
    --disable-infobars
    --disable-session-crashed-bubble
    --hide-crash-restore-bubble
    --disable-prompt-on-repost
    --disable-search-engine-choice-screen
    --disable-features=Translate
    --disable-notifications
    --deny-permission-prompts
    --disable-sync
    --password-store=basic
    --disable-component-update
    --check-for-update-interval=31536000
    # Page behaviour: let dashboards play media, and ignore stray touch input.
    --autoplay-policy=no-user-gesture-required
    --overscroll-history-navigation=0
    --disable-pinch
    # Keep the dashboards that are not currently on screen fully alive, so the
    # rotation never switches to a stale or half-painted tab.
    --disable-backgrounding-occluded-windows
    --disable-renderer-backgrounding
    --disable-background-timer-throttling
    --disable-ipc-flooding-protection
    # Nothing may write log or crash files to the SD card.
    --log-level=3
    --disable-breakpad
    --disable-background-networking
    --disable-domain-reliability
)

# Kill the browser when the session ends so it cannot outlive the compositor.
CHROMIUM_PID=""
trap '[ -n "$CHROMIUM_PID" ] && kill "$CHROMIUM_PID" 2>/dev/null; exit 0' TERM INT EXIT

while true; do
    mkdir -p "$PROFILE_DIR"
    # Clear stale single-instance locks and the "Chromium didn't shut down
    # correctly" restore prompt left behind by a hard power cut.
    rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" \
          "$PROFILE_DIR/SingletonSocket"
    if [ -f "$PROFILE_DIR/Default/Preferences" ]; then
        sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
            "$PROFILE_DIR/Default/Preferences"
    fi

    "$CHROMIUM" "${PLATFORM_FLAGS[@]}" "${FLAGS[@]}" "${CACHE_FLAGS[@]}" \
        $CHROMIUM_EXTRA_FLAGS about:blank &
    CHROMIUM_PID=$!
    wait "$CHROMIUM_PID"
    CHROMIUM_PID=""

    # Chromium exited (crash, or someone closed the window): restart it.
    sleep 2
done
