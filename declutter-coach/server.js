import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt.js';
import { TOOLS, contextBlock, emptyProgress, resolveChallenge, runTool, score, summary } from './progress.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });

const PORT = process.env.PORT || 3456;
const PASSCODE = process.env.APP_PASSCODE || '';
const MODEL = 'claude-opus-5-5';
const HISTORY_TURNS = 40; // most recent messages sent to the model each turn
const MAX_TOOL_ROUNDS = 6; // tool calls Maple can chain in one reply
const MAX_PHOTOS = 4;

// Without a passcode, anyone who finds the URL can read the chats and spend the API key
if (PASSCODE.length < 8) {
  console.error('Set APP_PASSCODE (8+ characters) in .env before starting. The chat is private.');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const CONVO_FILE = path.join(DATA_DIR, 'conversation.json');
const WINS_FILE = path.join(DATA_DIR, 'wins.json'); // older installs; folded into progress.json
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const client = new Anthropic();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  next();
});
app.get('/healthz', (req, res) => res.send('ok'));

function readJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
  return JSON.parse(raw); // a corrupt file fails loudly instead of being overwritten with []
}

// Write to a temp file and rename, so a crash mid-write never leaves half a file
function writeJson(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

// Progress board, created on first use. Wins from older installs carry over.
function readProgress() {
  const progress = readJson(PROGRESS_FILE, null);
  if (progress) return progress;
  const fresh = emptyProgress();
  for (const w of readJson(WINS_FILE, [])) fresh.log.push({ at: w.at, kind: 'win', count: 1, route: null, area: null, note: w.text });
  return fresh;
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const PASSCODE_DIGEST = digest(PASSCODE);
const failures = new Map(); // ip -> { count, until }

// Passcode gate: constant-time compare, and 10 wrong tries locks that address out for 15 minutes
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const entry = failures.get(req.ip);
  if (entry && entry.until > now) {
    return res.status(429).json({ error: 'Too many tries for now. Please wait 15 minutes and try again.' });
  }
  if (!crypto.timingSafeEqual(digest(req.get('x-passcode') || ''), PASSCODE_DIGEST)) {
    const count = (entry?.count || 0) + 1;
    failures.set(req.ip, { count: count >= 10 ? 0 : count, until: count >= 10 ? now + 15 * 60_000 : 0 });
    return res.status(401).json({ error: 'Passcode required' });
  }
  failures.delete(req.ip);
  next();
});

// Parse bodies only after the passcode check; a resized phone photo is well under 1 MB
app.use(express.json({ limit: '8mb' }));

app.use(express.static(path.join(here, 'public')));

app.get('/api/state', (req, res) => {
  res.json({
    messages: readJson(CONVO_FILE, []),
    progress: summary(readProgress()),
    needsPasscode: Boolean(PASSCODE)
  });
});

app.post('/api/wins', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Win text is required' });
  const progress = readProgress();
  const before = score(progress).level;
  progress.log.push({ at: new Date().toISOString(), kind: 'win', count: 1, route: null, area: null, note: text });
  writeJson(PROGRESS_FILE, progress);
  const after = score(progress).level;
  res.json({ progress: summary(progress), levelUp: after !== before ? `🌳 Level up: ${after}!` : null });
});

// Jessica can mark a challenge met, partial, or missed from her progress board
app.post('/api/challenges/:id', (req, res) => {
  const progress = readProgress();
  const before = score(progress).level;
  const outcome = resolveChallenge(progress, req.params.id, req.body?.result, 'Marked in the app');
  if (outcome.error) return res.status(400).json({ error: "That challenge couldn't be updated." });
  writeJson(PROGRESS_FILE, progress);
  const after = score(progress).level;
  res.json({ progress: summary(progress), action: outcome.action, levelUp: after !== before ? `🌳 Level up: ${after}!` : null });
});

// Starts a fresh conversation; wins are kept and the old chat is archived, never deleted
app.post('/api/reset', (req, res) => {
  const history = readJson(CONVO_FILE, []);
  if (history.length) {
    const archiveDir = path.join(DATA_DIR, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeJson(path.join(archiveDir, `conversation-${stamp}.json`), history);
  }
  writeJson(CONVO_FILE, []);
  res.json({ ok: true });
});

// Turns stored history into API messages: text only, starting on a user turn.
// The window start moves in steps of 10 so the cached prefix survives several turns.
function toApiMessages(history) {
  const start = Math.floor(Math.max(0, history.length - HISTORY_TURNS) / 10) * 10;
  let recent = history.slice(start).filter((m) => m.text);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  const messages = recent.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.hadPhoto ? `[shared ${m.photos > 1 ? `${m.photos} photos` : 'a photo'}]\n${m.text}` : m.text }]
  }));
  // Cache the conversation so far; only the new turn is billed at full price
  if (messages.length) messages.at(-1).content[0].cache_control = { type: 'ephemeral' };
  return messages;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
let chatInFlight = false;

const validImage = (image) => image && IMAGE_TYPES.includes(image.media_type) && typeof image.data === 'string' &&
  image.data.length <= 6_000_000 && /^[A-Za-z0-9+/]+=*$/.test(image.data);

app.post('/api/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  // Up to 4 photos as [{ media_type, data }] base64; a single "image" from older pages still works
  const images = Array.isArray(req.body?.images) ? req.body.images : req.body?.image ? [req.body.image] : [];
  if (!text && !images.length) return res.status(400).json({ error: 'Message is required' });
  if (text.length > 8000) return res.status(400).json({ error: 'Message is too long' });
  if (images.length > MAX_PHOTOS) return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos at a time, please.` });
  if (!images.every(validImage)) return res.status(400).json({ error: 'That photo could not be used. Try another one.' });
  // One reply at a time: protects conversation.json and caps spend
  if (chatInFlight) return res.status(429).json({ error: 'Maple is still answering. One moment.' });
  chatInFlight = true;

  const history = readJson(CONVO_FILE, []);
  const progress = readProgress();
  const userText = text || (images.length > 1 ? 'Here are some photos.' : 'Here is a photo.');

  const messages = toApiMessages(history);
  // Live board state rides on the new message, not the system prompt, so the cached prefix holds
  const userContent = [{ type: 'text', text: `<app_context>\n${contextBlock(progress)}\n</app_context>` }];
  userContent.push(...images.map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.media_type, data: image.data }
  })));
  userContent.push({ type: 'text', text: userText });
  messages.push({ role: 'user', content: userContent });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const ping = setInterval(() => res.write(': ping\n\n'), 15000); // keeps proxies from closing during thinking
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  let reply = '';
  const actions = [];
  try {
    const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }];
    let progressChanged = false;

    // Maple may save progress with tools, then keep talking; each round streams to the phone
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        tools: TOOLS,
        system,
        messages
      });

      let roundStarted = false;
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          let piece = event.delta.text;
          if (!roundStarted && reply && !reply.endsWith('\n')) piece = `\n\n${piece.trimStart()}`;
          roundStarted = true;
          reply += piece;
          send({ type: 'text', text: piece });
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') { reply = ''; break; }
      if (final.stop_reason !== 'tool_use') break;

      const results = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        const outcome = runTool(progress, block.name, block.input || {});
        results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.result, is_error: Boolean(outcome.error) });
        if (outcome.error) continue;
        progressChanged = true;
        for (const line of [outcome.action, outcome.levelUp].filter(Boolean)) {
          actions.push(line);
          send({ type: 'action', text: line });
        }
      }
      messages.push({ role: 'assistant', content: final.content }, { role: 'user', content: results });
    }

    if (progressChanged) {
      writeJson(PROGRESS_FILE, progress);
      send({ type: 'progress', progress: summary(progress) });
    }

    if (!reply) {
      // Not saved: a declined turn left in history would be resent and declined again
      send({ type: 'replace', text: "I'm sorry, I couldn't respond to that one. Could you try saying it another way?" });
      send({ type: 'done' });
      return;
    }

    history.push(
      { role: 'user', text: userText, hadPhoto: images.length > 0, photos: images.length, at: new Date().toISOString() },
      { role: 'assistant', text: reply, actions, at: new Date().toISOString() }
    );
    writeJson(CONVO_FILE, history);
    send({ type: 'done' });
  } catch (error) {
    console.error('[CHAT] Error:', error);
    let message = 'Something got interrupted on my end. Please try again in a moment.';
    if (!process.env.ANTHROPIC_API_KEY || error instanceof Anthropic.AuthenticationError) {
      message = "Maple can't reply right now because of a setup problem on the computer. It's nothing you did.";
    } else if (error instanceof Anthropic.RateLimitError) {
      message = 'Maple needs a short break. Try again in a minute.';
    }
    send({ type: 'error', text: message });
  } finally {
    clearInterval(ping);
    chatInFlight = false;
    res.end();
  }
});

// JSON errors (e.g. 413) without stack traces or file paths
app.use((error, req, res, next) => {
  console.error('[HTTP]', error.message);
  res.status(error.status || 500).json({ error: error.status === 413 ? 'That photo is too large.' : 'Something went wrong.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Declutter coach running on port ${PORT}`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
