import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });

const PORT = process.env.PORT || 3456;
const PASSCODE = process.env.APP_PASSCODE || '';
const MODEL = 'claude-opus-5-5';
const HISTORY_TURNS = 40; // most recent messages sent to the model each turn

// Without a passcode, anyone who finds the URL can read the chats and spend the API key
if (!PASSCODE) {
  console.error('Set APP_PASSCODE in .env before starting. The chat is private.');
  process.exit(1);
}

const DATA_DIR = path.join(here, 'data');
const CONVO_FILE = path.join(DATA_DIR, 'conversation.json');
const WINS_FILE = path.join(DATA_DIR, 'wins.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const client = new Anthropic();
const app = express();
app.use(express.json({ limit: '15mb' }));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// Simple passcode gate so only Jessica can open the app on the home network
app.use('/api', (req, res, next) => {
  if (PASSCODE && req.get('x-passcode') !== PASSCODE) {
    return res.status(401).json({ error: 'Passcode required' });
  }
  next();
});

app.use(express.static(path.join(here, 'public')));

app.get('/api/state', (req, res) => {
  res.json({
    messages: readJson(CONVO_FILE, []),
    wins: readJson(WINS_FILE, []),
    needsPasscode: Boolean(PASSCODE)
  });
});

app.post('/api/wins', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Win text is required' });
  const wins = readJson(WINS_FILE, []);
  wins.push({ text, at: new Date().toISOString() });
  writeJson(WINS_FILE, wins);
  res.json({ wins });
});

// Starts a fresh conversation; wins are kept
app.post('/api/reset', (req, res) => {
  writeJson(CONVO_FILE, []);
  res.json({ ok: true });
});

// Turns stored history into API messages: text only, starting on a user turn
function toApiMessages(history) {
  let recent = history.slice(-HISTORY_TURNS);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  return recent.map((m) => ({
    role: m.role,
    content: m.hadPhoto ? `[shared a photo]\n${m.text}` : m.text
  }));
}

function contextBlock(wins) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const recent = wins.slice(-10).map((w) => `- ${w.at.slice(0, 10)}: ${w.text}`).join('\n');
  return `Today is ${today}.\n\nJessica has logged ${wins.length} win(s) so far.` +
    (recent ? ` Most recent:\n${recent}\nCelebrate progress when it fits.` : '');
}

app.post('/api/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const image = req.body?.image; // { media_type, data } base64, optional
  if (!text && !image) return res.status(400).json({ error: 'Message is required' });

  const history = readJson(CONVO_FILE, []);
  const wins = readJson(WINS_FILE, []);
  const userText = text || 'Here is a photo.';

  const messages = toApiMessages(history);
  const userContent = [];
  if (image?.data && image?.media_type) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: image.media_type, data: image.data }
    });
  }
  userContent.push({ type: 'text', text: userText });
  messages.push({ role: 'user', content: userContent });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  let reply = '';
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: contextBlock(wins) }
      ],
      messages
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        reply += event.delta.text;
        send({ type: 'text', text: event.delta.text });
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      reply = "I'm sorry, I couldn't respond to that one. Could you try saying it another way?";
      send({ type: 'replace', text: reply });
    }

    history.push(
      { role: 'user', text: userText, hadPhoto: Boolean(image?.data), at: new Date().toISOString() },
      { role: 'assistant', text: reply, at: new Date().toISOString() }
    );
    writeJson(CONVO_FILE, history);
    send({ type: 'done' });
  } catch (error) {
    console.error('[CHAT] Error:', error);
    let message = 'Something went wrong. Please try again in a moment.';
    if (!process.env.ANTHROPIC_API_KEY || error instanceof Anthropic.AuthenticationError) {
      message = 'The app is not set up with a valid API key yet.';
    } else if (error instanceof Anthropic.RateLimitError) {
      message = 'Too many messages at once. Give it a minute and try again.';
    }
    send({ type: 'error', text: message });
  }
  res.end();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Declutter coach running on port ${PORT}`);
});
