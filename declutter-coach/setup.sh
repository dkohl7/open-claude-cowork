#!/bin/bash
# Maple setup for a Mac. Run it from Terminal with:  bash setup.sh
# Safe to run again any time, for example to change the API key or passcode.
set -e
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
LABEL="com.maple.coach"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/maple.log"
PORT=3456

step() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# 1. Node.js
step "1/5  Checking for Node.js"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js is not installed. Opening nodejs.org now."
  echo "Download the LTS installer, run it, then run:  bash setup.sh"
  open "https://nodejs.org/en/download" 2>/dev/null || true
  exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $NODE_MAJOR is too old. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
echo "Found Node.js $("$NODE" -v)"

# 2. Settings (.env). Written for you so you never need to open the hidden file.
step "2/5  Settings"
KEEP="n"
if [ -f .env ]; then
  read -r -p "Settings already exist. Keep the current API key and passcode? [Y/n] " KEEP
  KEEP="${KEEP:-y}"
fi
if [ "$KEEP" != "y" ] && [ "$KEEP" != "Y" ]; then
  while true; do
    echo "Paste your Anthropic API key (from console.anthropic.com). It stays hidden as you paste."
    read -r -s -p "API key: " API_KEY; echo
    case "$API_KEY" in sk-ant-*) break ;; *) echo "That does not look like a key. It should start with sk-ant-" ;; esac
  done
  while true; do
    read -r -p "Choose a passcode for Jessica (at least 8 characters, she types it once): " PASSCODE
    [ "${#PASSCODE}" -ge 8 ] && break
    echo "Please use at least 8 characters."
  done
  ( umask 077
    printf 'ANTHROPIC_API_KEY=%s\nAPP_PASSCODE=%s\nPORT=%s\n' "$API_KEY" "$PASSCODE" "$PORT" > .env )
  echo "Saved. Only your Mac user account can read the settings file."
fi
PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-3456}"

# 3. Install
step "3/5  Installing (about a minute)"
npm install --omit=dev --no-audit --no-fund

# 4. Start now and after every restart (launchd, built into macOS)
step "4/5  Setting Maple to start automatically"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

UP=""
for i in $(seq 1 20); do
  if curl -fsS "http://localhost:$PORT/healthz" >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
if [ -z "$UP" ]; then
  echo "Maple did not start. The last lines of the log say:"
  tail -n 20 "$LOG"
  exit 1
fi
echo "Maple is running."

# 5. Addresses for Jessica's phone
step "5/5  How to open Maple on Jessica's phone"
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [ -x "$TS" ] && "$TS" status >/dev/null 2>&1; then
  "$TS" serve --bg "$PORT" >/dev/null 2>&1 || echo "(Tailscale HTTPS is off. Turn on HTTPS in the Tailscale admin page, DNS tab, then run this again.)"
  TS_NAME="$("$TS" status --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
  echo "Anywhere (Tailscale on her phone):  https://$TS_NAME"
else
  echo "Anywhere: install Tailscale (see README) and run this script again."
fi
echo "At home on Wi-Fi only:              http://$(scutil --get LocalHostName).local:$PORT"
echo
echo "Reminder: in System Settings > Energy, turn on 'Prevent automatic sleeping when the display is off'"
echo "and 'Start up automatically after a power failure', so Maple is there when she needs it."
