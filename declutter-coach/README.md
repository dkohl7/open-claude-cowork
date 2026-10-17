# Maple: a decluttering coach

A private, phone-friendly chat coach that helps someone let go of belongings with kindness, not pressure. It uses methods from CBT for hoarding and motivational interviewing, and works *with* environmental values by steering toward fast donation, recycling, and responsible disposal instead of slow resale.

Maple is a supportive coach, not a licensed therapist. It encourages real-world help (iocdf.org therapist finder, "Buried in Treasures" groups) and gives the 988 crisis line if needed.

## Features

- Streaming chat that remembers past conversations
- Photo sharing: snap a cluttered shelf and get one small place to start
- Wins tracker (the 🌱 button) that Maple sees and celebrates
- Starter prompts: 15-minute session, stuck on an item, plan a donation run, feeling overwhelmed
- Required passcode so only the intended person can open it

## Setup

Needs Node.js 20 or newer and an API key from https://console.anthropic.com.

```bash
cp .env.example .env      # add your API key and a passcode (required)
npm install
npm start
```

Host it anywhere that runs a Node server (Render, Railway, Fly.io, a VPS, or a home computer). Set `ANTHROPIC_API_KEY` and `APP_PASSCODE` as environment variables on the host, and serve it over HTTPS. On the phone, open the URL and in Safari tap Share > Add to Home Screen so it opens like an app.

The server stores chats in `data/`. On hosts with temporary disks (most free tiers), attach a persistent volume or the history resets on each deploy.

## Privacy

Conversations are saved in `data/` on the host computer, which is not committed to git. Anyone with access to that computer can read them. Treat that folder as private: the chat only works if the person using it trusts that it's theirs.

## Tuning

Edit `prompt.js` to change Maple's name, tone, local donation spots, or the selling rule.
