#!/usr/bin/env bash
# Dashboard rotator kiosk — runs as the lightdm X session

# Disable screen blanking / power management
xset s off
xset -dpms
xset s noblank

# Rotate screen if needed, see 'xrandr -q' for outputs and 'xrandr -h' for options.
# Set to 'normal' to disable rotation.
DISPLAY_ORIENTATION=left

if [[ "${DISPLAY_ORIENTATION}" != 'normal' ]]; then
    DISPLAY=:0 xrandr --orientation "${DISPLAY_ORIENTATION}"
fi

# Window manager (needed for Chromium to display)
matchbox-window-manager &

# Hide the mouse cursor
if command -v unclutter &>/dev/null; then
    unclutter -idle 0.1 -root &
fi

# Ensure no stale Chromium lock
rm -f /home/pi/.chromium-kiosk/SingletonLock 2>/dev/null

# Launch Chromium in kiosk mode with remote debugging enabled
# The --remote-debugging-port flag enables CDP access for the server
# Start with about:blank — the server will manage all tabs via CDP
while true; do
    chromium-browser \
        --kiosk \
        --remote-debugging-port=9222 \
        --remote-allow-origins=http://localhost:3000 \
        --noerrdialogs \
        --no-first-run \
        --disable-infobars \
        --disable-session-crashed-bubble \
        --disable-component-update \
        --autoplay-policy=no-user-gesture-required \
        --disable-features=TranslateUI \
        --overscroll-history-navigation=0 \
        --disk-cache-size=524288000 \
        --user-data-dir=/home/pi/.chromium-kiosk \
        "about:blank"

    # If Chromium exits, wait briefly then restart
    sleep 2
done
