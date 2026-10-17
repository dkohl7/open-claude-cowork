// Jessica's progress board: areas, challenges, the in/out log, points, and levels.
// Maple updates it through tools; the app reads it to show the board and deadlines.

import crypto from 'crypto';

export const POINTS = { item: 2, win: 5, met: 30, early: 15, partial: 10, area: 100 };

const LEVELS = [
  { name: 'Seedling', at: 0 },
  { name: 'Sprout', at: 100 },
  { name: 'Sapling', at: 300 },
  { name: 'Young Maple', at: 700 },
  { name: 'Tall Maple', at: 1500 },
  { name: 'Mighty Maple', at: 3000 },
  { name: 'Forest', at: 6000 }
];

const ROUTES = ['repurposed', 'given_away', 'sold', 'donated', 'recycled', 'trashed'];
const DAY = 24 * 60 * 60 * 1000;

export const emptyProgress = () => ({ areas: [], challenges: [], log: [] });

const newId = (prefix) => `${prefix}${crypto.randomBytes(3).toString('hex')}`;
const findArea = (p, name) => p.areas.find((a) => a.name.toLowerCase() === String(name || '').trim().toLowerCase());

// "YYYY-MM-DD" means the end of that day; "YYYY-MM-DDTHH:MM" is local time
function parseDue(value) {
  const text = String(value || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T23:59`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function score(p) {
  let points = 0;
  for (const entry of p.log) {
    if (entry.kind === 'out') points += POINTS.item * entry.count;
    if (entry.kind === 'win') points += POINTS.win;
  }
  for (const c of p.challenges) {
    if (c.status === 'met') points += POINTS.met + (c.early ? POINTS.early : 0);
    if (c.status === 'partial') points += POINTS.partial;
  }
  points += POINTS.area * p.areas.filter((a) => a.status === 'done').length;
  const index = LEVELS.findLastIndex((l) => points >= l.at);
  return { points, level: LEVELS[index].name, next: LEVELS[index + 1] || null };
}

function weekStats(p, now = Date.now()) {
  const recent = p.log.filter((e) => now - new Date(e.at).getTime() < 7 * DAY);
  const out = {};
  let outTotal = 0;
  let inTotal = 0;
  for (const e of recent) {
    if (e.kind === 'out') { out[e.route] = (out[e.route] || 0) + e.count; outTotal += e.count; }
    if (e.kind === 'in') inTotal += e.count;
  }
  return { outTotal, out, inTotal };
}

function areaProgress(a) {
  if (a.status === 'done') return 100;
  const span = a.startRating - a.targetRating;
  if (span <= 0) return a.rating <= a.targetRating ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((a.startRating - a.rating) / span) * 100)));
}

// What the app shows on the progress board
export function summary(p) {
  return {
    ...score(p),
    week: weekStats(p),
    areas: p.areas.map((a) => ({ ...a, progress: areaProgress(a) })),
    challenges: [
      ...p.challenges.filter((c) => c.status === 'active'),
      ...p.challenges.filter((c) => c.status !== 'active').slice(-5).reverse()
    ],
    wins: p.log.filter((e) => e.kind === 'win').slice(-8).reverse()
  };
}

function timeLeft(iso, now) {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const span = abs < DAY ? `${Math.max(1, Math.round(abs / 3_600_000))} hours` : `${Math.round(abs / DAY)} days`;
  return ms < 0 ? `OVERDUE by ${span}` : `${span} left`;
}

const fmtDue = (iso) => new Date(iso).toLocaleString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});

// Live state Maple sees each turn (kept after the cached system prompt)
export function contextBlock(p, now = Date.now()) {
  const nowText = new Date(now).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  const s = score(p);
  const w = weekStats(p, now);
  const lines = [`Now: ${nowText}.`, ''];
  lines.push(`Score: ${s.points} points, level ${s.level}` +
    (s.next ? ` (${s.next.name} at ${s.next.at}).` : ' (top level).'));
  const routes = Object.entries(w.out).map(([r, n]) => `${r.replace('_', ' ')} ${n}`).join(', ');
  lines.push(`Last 7 days: ${w.outTotal} items out${routes ? ` (${routes})` : ''}; ${w.inTotal} items came in.`);

  const active = p.areas.filter((a) => a.status === 'active');
  lines.push('', active.length ? 'Areas in progress:' : 'No areas planned yet. Offer to plan one from a photo.');
  for (const a of active) {
    lines.push(`- ${a.name}: "${a.goal}". Clutter ${a.rating} (started ${a.startRating}, target ${a.targetRating}). ` +
      `Due ${fmtDue(a.due)}, ${timeLeft(a.due, now)}.`);
  }
  const done = p.areas.filter((a) => a.status === 'done');
  if (done.length) lines.push(`Finished areas: ${done.map((a) => a.name).join(', ')}.`);

  const open = p.challenges.filter((c) => c.status === 'active');
  lines.push('', open.length ? 'Open challenges:' : 'No open challenges. Set one before the conversation ends.');
  for (const c of open) {
    lines.push(`- [${c.id}] "${c.title}"${c.area ? ` (${c.area})` : ''}, target: ${c.target}. ` +
      `Due ${fmtDue(c.due)}, ${timeLeft(c.due, now)}.`);
  }
  const resolved = p.challenges.filter((c) => c.status !== 'active').slice(-3);
  if (resolved.length) {
    lines.push('Recently resolved: ' + resolved.map((c) => `"${c.title}" ${c.status}${c.early ? ' early' : ''}`).join('; ') + '.');
  }
  const wins = p.log.filter((e) => e.kind === 'win').slice(-3);
  if (wins.length) lines.push('Wins she logged herself: ' + wins.map((e) => e.note).join('; ') + '.');
  return lines.join('\n');
}

export const TOOLS = [
  {
    name: 'plan_area',
    description: 'Create or replace the plan for an area or zone of the house (for example "Guest bedroom 1" or "Garage bay 1"). Use once Jessica agrees to a goal, clutter scores, and due date.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short area name, reused to update it later' },
        goal: { type: 'string', description: 'What done looks like, in her words' },
        current_rating: { type: 'integer', description: 'Clutter now, 1 (clear) to 9 (packed full)' },
        target_rating: { type: 'integer', description: 'Target clutter, 1 to 9' },
        due: { type: 'string', description: 'Due date as YYYY-MM-DD' }
      },
      required: ['name', 'goal', 'current_rating', 'target_rating', 'due'],
      additionalProperties: false
    }
  },
  {
    name: 'update_area',
    description: 'Update an existing area: a new clutter score after progress, a new due date, or mark it done. Pass null for anything unchanged.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        rating: { type: ['integer', 'null'], description: 'New clutter score 1 to 9' },
        due: { type: ['string', 'null'], description: 'New due date YYYY-MM-DD' },
        done: { type: ['boolean', 'null'], description: 'true when the area meets its goal' }
      },
      required: ['name', 'rating', 'due', 'done'],
      additionalProperties: false
    }
  },
  {
    name: 'set_challenge',
    description: 'Save a challenge Jessica has agreed to, with a firm deadline.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short and punchy, e.g. "3 bags in the car"' },
        target: { type: 'string', description: 'How success is measured' },
        due: { type: 'string', description: 'Local deadline as YYYY-MM-DDTHH:MM' },
        area: { type: ['string', 'null'], description: 'Area name if it belongs to one' }
      },
      required: ['title', 'target', 'due', 'area'],
      additionalProperties: false
    }
  },
  {
    name: 'resolve_challenge',
    description: 'Mark an open challenge met, partial, or missed, using its id from the context.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        result: { type: 'string', enum: ['met', 'partial', 'missed'] },
        note: { type: 'string' }
      },
      required: ['id', 'result', 'note'],
      additionalProperties: false
    }
  },
  {
    name: 'log_items',
    description: 'Log items that left the house (out) or came in (in). Only count items that physically left, not ones sorted or listed.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['out', 'in'] },
        count: { type: 'integer', description: 'Number of items, at least 1' },
        route: { type: ['string', 'null'], enum: [...ROUTES, null], description: 'Where items went (for out); null for in' },
        area: { type: ['string', 'null'] },
        note: { type: 'string', description: 'Short description, e.g. "kids clothes to Wheeler Mission"' }
      },
      required: ['direction', 'count', 'route', 'area', 'note'],
      additionalProperties: false
    }
  }
];

const clampRating = (n) => Math.max(1, Math.min(9, Math.round(Number(n))));

// Applies one tool call. Returns { result } for Maple and an optional { action } line for the app.
export function runTool(p, name, input, now = Date.now()) {
  const at = new Date(now).toISOString();
  const before = score(p);
  let out;
  switch (name) {
    case 'plan_area': {
      const due = parseDue(input.due);
      if (!due) return { error: true, result: 'Invalid due date. Use YYYY-MM-DD.' };
      const current = clampRating(input.current_rating);
      const fields = { goal: input.goal, rating: current, targetRating: clampRating(input.target_rating), due };
      const existing = findArea(p, input.name);
      if (existing) Object.assign(existing, fields, { status: 'active' });
      else p.areas.push({ id: newId('a'), name: input.name.trim(), startRating: current, status: 'active', createdAt: at, ...fields });
      out = { result: `Saved area "${input.name}".`, action: `📍 Plan saved: ${input.name}, due ${fmtDue(due).split(',').slice(0, 2).join(',')}` };
      break;
    }
    case 'update_area': {
      const area = findArea(p, input.name);
      if (!area) return { error: true, result: `No area named "${input.name}". Existing: ${p.areas.map((a) => a.name).join(', ') || 'none'}.` };
      const changes = [];
      if (input.rating != null) { area.rating = clampRating(input.rating); changes.push(`clutter ${area.rating}`); }
      if (input.due != null) {
        const due = parseDue(input.due);
        if (!due) return { error: true, result: 'Invalid due date. Use YYYY-MM-DD.' };
        area.due = due; changes.push('new due date');
      }
      if (input.done === true && area.status !== 'done') {
        area.status = 'done'; area.doneAt = at; area.rating = Math.min(area.rating, area.targetRating);
        changes.push('finished');
      }
      out = { result: `Updated "${area.name}": ${changes.join(', ') || 'no changes'}.`,
        action: area.status === 'done' && changes.includes('finished')
          ? `🏁 Area finished: ${area.name} (+${POINTS.area})` : `📍 ${area.name}: ${changes.join(', ')}` };
      break;
    }
    case 'set_challenge': {
      const due = parseDue(input.due);
      if (!due) return { error: true, result: 'Invalid due time. Use YYYY-MM-DDTHH:MM.' };
      const challenge = { id: newId('c'), title: input.title, target: input.target, area: input.area || null, due, status: 'active', createdAt: at };
      p.challenges.push(challenge);
      out = { result: `Saved challenge ${challenge.id}.`, action: `🎯 Challenge on: ${input.title}, due ${fmtDue(due)}` };
      break;
    }
    case 'resolve_challenge': {
      const r = resolveChallenge(p, input.id, input.result, input.note, now);
      if (r.error) return r;
      out = r;
      break;
    }
    case 'log_items': {
      const count = Math.max(1, Math.min(500, Math.round(Number(input.count) || 1)));
      const route = input.direction === 'out' && ROUTES.includes(input.route) ? input.route : null;
      p.log.push({ at, kind: input.direction === 'in' ? 'in' : 'out', count, route, area: input.area || null, note: input.note });
      out = input.direction === 'in'
        ? { result: `Logged ${count} item(s) in.`, action: `📥 Logged ${count} coming in` }
        : { result: `Logged ${count} item(s) out.`, action: `📦 ${count} out the door (+${count * POINTS.item})` };
      break;
    }
    default:
      return { error: true, result: `Unknown tool ${name}.` };
  }
  const after = score(p);
  if (after.level !== before.level) out.levelUp = `🌳 Level up: ${after.level}!`;
  return out;
}

export function resolveChallenge(p, id, result, note, now = Date.now()) {
  const c = p.challenges.find((x) => x.id === id);
  if (!c) return { error: true, result: `No challenge with id ${id}.` };
  if (c.status !== 'active') return { error: true, result: `Challenge ${id} is already ${c.status}.` };
  if (!['met', 'partial', 'missed'].includes(result)) return { error: true, result: 'Result must be met, partial, or missed.' };
  c.status = result;
  c.resolvedAt = new Date(now).toISOString();
  c.note = String(note || '').slice(0, 300);
  c.early = result === 'met' && now < new Date(c.due).getTime() - 60 * 60 * 1000;
  const gained = result === 'met' ? POINTS.met + (c.early ? POINTS.early : 0) : result === 'partial' ? POINTS.partial : 0;
  const label = { met: '🏆 Challenge met', partial: '◐ Partly done', missed: '↺ Missed' }[result];
  return { result: `Challenge ${id} marked ${result}.`, action: `${label}: ${c.title}${gained ? ` (+${gained})` : ''}` };
}
