# Maple: a decluttering coach

A private, phone-friendly chat coach that helps someone let go of belongings with kindness, not pressure. It uses methods from CBT for hoarding and motivational interviewing, and works *with* environmental values by steering toward fast donation, recycling, and responsible disposal instead of slow resale.

Maple is a supportive coach, not a licensed therapist. It encourages real-world help (iocdf.org therapist finder, "Buried in Treasures" groups) and gives the 988 crisis line if needed.

## Features

- Streaming chat that remembers past conversations
- Photo sharing: snap a cluttered shelf and get one small place to start
- Wins tracker (the 🌱 button) that Maple sees and celebrates
- Starter prompts: 15-minute session, stuck on an item, plan a donation run, feeling overwhelmed
- Optional passcode so only the intended person can open it

## Setup (about 10 minutes)

1. Install Node.js 20 or newer on a computer that stays on at home.
2. Get an API key at https://console.anthropic.com and add a few dollars of credit.
3. In this folder:
   ```bash
   cp .env.example .env      # then paste your key, and pick a passcode
   npm install
   npm start
   ```
4. Find the computer's local IP (Mac: System Settings > Wi-Fi > Details; Windows: `ipconfig`).
5. On the phone, on the same Wi-Fi, open `http://<that-ip>:3456`. In Safari, tap Share > Add to Home Screen so it opens like an app.

## Privacy

Conversations are saved in `data/` on the host computer, which is not committed to git. Anyone with access to that computer can read them. Treat that folder as private: the chat only works if the person using it trusts that it's theirs.

## Tuning

Edit `prompt.js` to change Maple's name, tone, local donation spots, or the selling rule.
