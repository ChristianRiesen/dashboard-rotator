#!/usr/bin/env bash
# Dashboard Rotator kiosk session.
#
# LightDM runs this as the Wayland session for the auto-login user. See
# /usr/share/wayland-sessions/dashboard-rotator.desktop, written by install.sh.
#
# It starts a bare labwc compositor whose only client is the Chromium kiosk
# window (launched by kiosk-session.sh), so none of the Raspberry Pi desktop
# (panel, file manager, wallpaper) comes along.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# LightDM pipes everything a session prints into ~/.xsession-errors, a file on
# the SD card that grows for as long as the kiosk runs. Send it to the journal
# instead, which install.sh keeps in RAM.
if command -v systemd-cat >/dev/null 2>&1; then
    exec > >(systemd-cat -t dashboard-rotator-kiosk) 2>&1
else
    exec > /dev/null 2>&1
fi

# --- Settings (see kiosk.conf.example) ---
HIDE_CURSOR=yes
CURSOR_THEME=dashboard-blank
KEYBOARD_LAYOUT=
[ -f "$SCRIPT_DIR/kiosk.conf" ] && . "$SCRIPT_DIR/kiosk.conf"

if [ -n "$KEYBOARD_LAYOUT" ]; then
    export XKB_DEFAULT_LAYOUT="$KEYBOARD_LAYOUT"
fi

# Hide the mouse pointer with a fully transparent cursor theme that install.sh
# generates. unclutter is X11 only and does nothing under Wayland.
if [ "$HIDE_CURSOR" = "yes" ] && [ -d "$HOME/.local/share/icons/$CURSOR_THEME" ]; then
    export XCURSOR_THEME="$CURSOR_THEME"
    export XCURSOR_SIZE=24
    # Spelled out because Chromium's Wayland cursor loader does not look in
    # ~/.local/share/icons on its own, unlike labwc.
    export XCURSOR_PATH="$HOME/.local/share/icons:$HOME/.icons:/usr/share/icons:/usr/share/pixmaps"
fi

# Raspberry Pi renderer tweaks, mirroring /usr/bin/labwc-pi.
if command -v raspi-config >/dev/null 2>&1 && raspi-config nonint is_pi 2>/dev/null; then
    export WLR_DRM_FORCE_LIBLIFTOFF=1
    if ! raspi-config nonint gpu_has_mmu 2>/dev/null; then
        export WLR_RENDERER=pixman
    fi
fi

# -C makes labwc read its config from the kiosk directory only, which keeps the
# system autostart (desktop panel, file manager) out of this session.
# -S runs the browser loop and shuts the compositor down if that loop ever ends,
# which makes LightDM start the session over.
LAUNCH=(labwc -C "$SCRIPT_DIR/kiosk/labwc" -S "$SCRIPT_DIR/kiosk-session.sh")

if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-run-session >/dev/null 2>&1; then
    exec dbus-run-session -- "${LAUNCH[@]}"
fi

exec "${LAUNCH[@]}"
