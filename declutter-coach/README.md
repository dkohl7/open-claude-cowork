# Maple

Maple is a private chat coach on Jessica's phone. It helps her let go of things at her own pace, with kindness and no pressure. It runs on the Mac mini at home. Her chats are saved only on that Mac.

Maple is a supportive coach, not a therapist. It points to real help (iocdf.org, "Buried in Treasures" groups) and to the 988 crisis line if ever needed.

## What it costs

- Anthropic API: pay as you go, so the cost depends on how much she chats. Check the Usage page after the first week, and set a monthly limit at console.anthropic.com under Billing so there are no surprises.
- Tailscale: free.
- The Mac mini uses a little electricity. Nothing else to pay for.

## Set it up (about 15 minutes, one time)

**1. Get an API key.** Go to console.anthropic.com, sign in, add a payment method, then Settings > API Keys > Create Key. Copy it. It starts with `sk-ant-`.

**2. Run the setup script.** Open Terminal (press Command + Space, type Terminal, press Return). Type `cd ` (with a space), drag the `declutter-coach` folder from Finder into the Terminal window, press Return. Then type:

```
bash setup.sh
```

It checks for Node.js (and opens the download page if you need it), asks for your API key and a passcode, installs everything, and sets Maple to start by itself whenever the Mac restarts. You never need to open the hidden `.env` file. To change the key or passcode later, just run `bash setup.sh` again.

**3. Keep the Mac awake.** System Settings > Energy: turn on "Prevent automatic sleeping when the display is off" and "Start up automatically after a power failure". If FileVault is on, someone must log in after a restart before Maple starts.

**4. Reach Maple from her phone with Tailscale (free, private).** Tailscale links your devices privately. Maple is never on the open internet.

1. On the Mac: install Tailscale from tailscale.com/download and sign in.
2. In the Tailscale admin page (login.tailscale.com), open the DNS tab and turn on MagicDNS and HTTPS Certificates.
3. On Jessica's iPhone: install Tailscale from the App Store, sign in to the same account, and leave it on.
4. Run `bash setup.sh` again. It prints her address, something like `https://mac-mini.tail1234.ts.net`.

Just want to try it at home first? The script also prints a Wi-Fi address like `http://Darrens-Mac-mini.local:3456`. It works only on your home Wi-Fi.

**5. Put Maple on her Home Screen.** On her iPhone, open the address in Safari, enter the passcode, then tap Share > Add to Home Screen. Open Maple from the new icon and enter the passcode once more (the Home Screen app keeps its own memory).

## Everyday commands

Paste these in Terminal if you need them:

| To do this | Type |
| --- | --- |
| Restart Maple | `launchctl kickstart -k gui/$(id -u)/com.maple.coach` |
| See if it is running | `curl localhost:3456/healthz` |
| Read the log | `tail -n 50 ~/Library/Logs/maple.log` |
| Turn Maple off for good | `launchctl bootout gui/$(id -u)/com.maple.coach` |
| Update after new code | `git pull` then `bash setup.sh` (keep your settings) |

## Privacy

Chats and wins are saved in the `data` folder on the Mac. Old chats from "Fresh start" go to `data/archive`, never deleted. Photos are not saved. Messages are sent to Anthropic to get Maple's replies.

Maple only helps if Jessica trusts it is hers. Please agree not to read the `data` folder, and tell her that. To back it up, copy the `data` folder somewhere safe.

## Changing how Maple talks

Right-click `prompt.js` in Finder, choose Open With > TextEdit, and edit the words. Then restart Maple with the command above.
