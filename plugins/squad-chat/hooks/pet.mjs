// The Pet room: Clawd's corner. On the desktop Clawd is a vector drawing
// (clawdsvg.mjs) that moves by CSS, standing in a little corner with what
// it shared with you today, a bond that grows as you work, and a short log
// of what it noticed. A small Clawd also walks by the pane's input box in
// every room. The terminal draws the pixel stickers in half blocks, a frame
// per redraw.
//
// Left on "auto", Clawd follows what goes on: typing while Claude works,
// cheering when a focus round ends, vibing through a break, waving at a new
// message, puzzled by failing checks, asleep after a quiet while.
//
// Plain logic and drawing: the mod feeds it (petTick, petNote) and keeps it.

import { state } from "./state.mjs";
import { theme } from "./theme.mjs";
import { card, stackCards, stretchBar, clip } from "./widgets.mjs";
import { PALETTE, STICKERS } from "./petframes.mjs";
import { clawdSvg, cornerSvg, walkSvg } from "./clawdsvg.mjs";
import { draw, chip } from "./bands.mjs";

export const PET_META = { icon: "✿", label: "Pet", color: "#D97757" };
export const MOODS = Object.keys(STICKERS);
// Where Clawd goes by the input box. Each pace follows the mood: a trot while
// Claude types, an easy walk otherwise, curled up in the corner when sleepy.
export const WALKS = [
  { id: "off", label: "Off" },
  { id: "sit", label: "Sit" },
  { id: "stroll", label: "Stroll" },
  { id: "stopgo", label: "Stop & go" },
];
export const MOOD_LABEL = {
  vibe: "Vibing", typing: "Typing", wave: "Hi!", cheer: "Yay!",
  confused: "Huh?", wink: "Wink", surprised: "Whoa!", sleepy: "Sleepy",
};
// How Clawd feels, for the corner's stats.
const FEELING = {
  vibe: "Chill", typing: "Busy", wave: "Happy", cheer: "Excited",
  confused: "Puzzled", wink: "Cheeky", surprised: "Startled", sleepy: "Sleepy",
};
const SLEEP_AFTER_MS = 10 * 60_000;
const CHEER_MS = 12_000;
const WAVE_MS = 8_000;
const LOG_KEEP = 20;
const XP_PER_LEVEL = 20;
const XP_ROUND = 3;               // a finished focus round
const XP_TOGETHER_MS = 10 * 60_000;   // and every ten minutes Claude works
const WORKED_NOTE_MS = 5 * 60_000;    // a stretch this long gets a line in the log

export function createPet() {
  return {
    mode: "auto",      // "auto", or a mood kept on
    walk: "stroll",    // Clawd by the input box (desktop): off | sit | stroll | stopgo
    lastBusyAt: 0,     // when this session last worked (Claude, a tool, an agent)
    busySince: 0,      // when the stretch of work going on now began
    waveAt: 0,         // when a message from someone else last came in
    day: "",           // the day `togetherMs` counts
    togetherMs: 0,     // Claude worked that long today, with Clawd watching
    xp: 0,             // the bond: rounds and time together
    xpMs: 0,           // time together not yet turned into xp
    log: [],           // [{ at, icon, text }], newest first
    lastMood: "",
    failing: false,    // this branch's checks were failing at the last look
  };
}

// ---------------------------------------------------------------- bond and log

export function level(p) {
  return 1 + Math.floor(p.xp / XP_PER_LEVEL);
}
export function bondPct(p) {
  return ((p.xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;
}

// A line in Clawd's log: "🎉 Finished a focus round".
export function petNote(p, icon, text, at = Date.now()) {
  p.log.unshift({ at, icon, text: String(text).slice(0, 80) });
  if (p.log.length > LOG_KEEP) p.log.length = LOG_KEEP;
}

export function petRound(p, at = Date.now()) {
  p.xp += XP_ROUND;
  petNote(p, "🎉", "Finished a focus round", at);
}

const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Once a second: time together, a stretch of work ending, checks turning
// red, dozing off. `busy` is whether this session works now. True when
// something worth keeping changed.
export function petTick(p, { busy, failing, now = Date.now(), step = 1000 }) {
  let changed = false;
  const day = dayOf(now);
  if (p.day !== day) { p.day = day; p.togetherMs = 0; changed = true; }
  if (busy) {
    p.lastBusyAt = now;
    if (!p.busySince) p.busySince = now;
    p.togetherMs += step;
    p.xpMs += step;
    if (p.xpMs >= XP_TOGETHER_MS) { p.xpMs -= XP_TOGETHER_MS; p.xp += 1; changed = true; }
  } else if (p.busySince) {
    const worked = now - p.busySince;
    if (worked >= WORKED_NOTE_MS) { petNote(p, "⌨️", `Worked with Claude for ${span(worked)}`, now); changed = true; }
    p.busySince = 0;
  }
  if (failing && !p.failing) { petNote(p, "😵", "Checks failed on this branch", now); changed = true; }
  p.failing = !!failing;
  const mood = petMood(now);
  if (mood !== p.lastMood) {
    if (mood === "sleepy" && p.mode === "auto" && p.lastMood) { petNote(p, "💤", "Dozed off", now); changed = true; }
    p.lastMood = mood;
  }
  return changed;
}

// What's kept in $.store: the choices, the bond, today's time and the log.
export function petSaved(p) {
  return { mode: p.mode, walk: p.walk, xp: p.xp, xpMs: p.xpMs, day: p.day, togetherMs: p.togetherMs, log: p.log };
}
export function restorePet(p, saved) {
  if (!saved || typeof saved !== "object") return;
  if (saved.mode === "auto" || MOODS.includes(saved.mode)) p.mode = saved.mode;
  if (WALKS.some((w) => w.id === saved.walk)) p.walk = saved.walk;
  else if (saved.walk === "edge") p.walk = "stroll";   // the top edge is gone
  else if (saved.beside === false) p.walk = "off";   // kept before Clawd walked
  if (Number.isFinite(saved.xp)) p.xp = Math.max(0, saved.xp | 0);
  if (Number.isFinite(saved.xpMs)) p.xpMs = Math.max(0, saved.xpMs);
  if (typeof saved.day === "string") { p.day = saved.day; p.togetherMs = Math.max(0, Number(saved.togetherMs) || 0); }
  if (Array.isArray(saved.log)) {
    p.log = saved.log.filter((x) => x && Number.isFinite(x.at) && typeof x.text === "string").slice(0, LOG_KEEP)
      .map((x) => ({ at: x.at, icon: String(x.icon ?? "").slice(0, 4), text: x.text.slice(0, 80) }));
  }
}

function span(ms) {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// ---------------------------------------------------------------- pixel frames (the terminal)

const grids = new Map();
function frameGrid(mood, i) {
  const k = `${mood}:${i}`;
  if (!grids.has(k)) {
    const rows = STICKERS[mood].frames[i].split("/").map((r) => r.replace(/(\d+)(.)/g, (_, n, ch) => ch.repeat(Number(n))));
    while (rows.length < 32) rows.push(".".repeat(32));
    grids.set(k, rows);
  }
  return grids.get(k);
}

const boxes = new Map();
function stickerBox(mood) {
  if (!boxes.has(mood)) {
    let x0 = 32, y0 = 32, x1 = -1, y1 = -1;
    STICKERS[mood].frames.forEach((_, i) => frameGrid(mood, i).forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === ".") continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }));
    boxes.set(mood, { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return boxes.get(mood);
}

// Two pixel rows a cell, "▀" in the upper color on the lower. Runs of one
// look are one Text.
export function stickerCells(els, mood, now = Date.now()) {
  const { Box, Text } = els;
  const s = STICKERS[mood];
  const grid = frameGrid(mood, Math.floor(now / s.ms) % s.frames.length);
  const b = stickerBox(mood);
  const rows = [];
  for (let y = b.y0 - (b.y0 % 2); y <= b.y0 + b.h - 1; y += 2) {
    const runs = [];
    for (let x = b.x0; x < b.x0 + b.w; x++) {
      const top = grid[y]?.[x] ?? ".", bot = grid[y + 1]?.[x] ?? ".";
      const look = top === "." && bot === "." ? { ch: " " }
        : top === "." ? { ch: "▄", color: PALETTE[bot] }
          : { ch: "▀", color: PALETTE[top], bg: bot === "." ? undefined : PALETTE[bot] };
      const last = runs.at(-1);
      if (last && last.color === look.color && last.bg === look.bg && last.ch[0] === look.ch) last.ch += look.ch;
      else runs.push({ ...look });
    }
    rows.push(Box({ key: `r${y}`, flexDirection: "row", children: runs.map((r, i) => Text({ key: `c${i}`, color: r.color, ...(r.bg ? { backgroundColor: r.bg } : {}), children: r.ch })) }));
  }
  return rows;
}

// ---------------------------------------------------------------- mood

// What Clawd does now: the mood kept on, or one that fits the moment.
export function petMood(now = Date.now()) {
  const p = state.pet;
  if (p.mode !== "auto" && STICKERS[p.mode]) return p.mode;
  const u = state.usage;
  const f = state.focus;
  if (f?.cheerAt && now - f.cheerAt < CHEER_MS) return "cheer";
  if (u.activity?.state && u.activity.state !== "idle") return "typing";
  if (state.git?.pr?.checks?.fail) return "confused";
  if (p.waveAt && now - p.waveAt < WAVE_MS) return "wave";
  if (f?.phase === "break" && !f.paused) return "vibe";
  if (f?.phase === "focus" && !f.paused) return "typing";
  if (now - (p.lastBusyAt || now) > SLEEP_AFTER_MS) return "sleepy";
  return "vibe";
}

// ---------------------------------------------------------------- drawing

function stat(els, key, label, value) {
  const { Box, Text } = els;
  return Box({ key, flexDirection: "column", alignItems: "center", flexGrow: 1, children: [
    Text({ key: "l", color: theme.muted, children: label }),
    Text({ key: "v", bold: true, children: value }),
  ] });
}

function cornerCard(els, now) {
  const { Box, Text } = els;
  const p = state.pet;
  const mood = petMood(now);
  const art = els.Svg
    ? Box({ key: "art", flexDirection: "row", justifyContent: "center", children: [els.Svg({ key: "corner", source: cornerSvg(mood), alt: `Clawd: ${MOOD_LABEL[mood]}`, width: 320, height: 180 })] })
    : Box({ key: "art", flexDirection: "column", alignItems: "center", children: stickerCells(els, mood, now) });
  const rounds = state.focus?.done ?? 0;
  const rows = [
    art,
    Box({ key: "stats", flexDirection: "row", marginTop: 1, children: [
      stat(els, "together", "Together", span(p.togetherMs)),
      stat(els, "focus", "Focus today", `${rounds} 🍅`),
      stat(els, "mood", "Mood", FEELING[mood]),
    ] }),
  ];
  if (els.Svg) rows.push(Box({ key: "bond", flexDirection: "row", marginTop: 1, children: [stretchBar(els, "bar", bondPct(p), "#E58FA8", { thick: true })] }));
  rows.push(Text({ key: "bond-l", color: theme.muted, children: `Bond ${Math.round(bondPct(p))}% to Lv ${level(p) + 1}` }));
  const artRows = els.Svg ? 9 : Math.ceil((stickerBox(mood).h + 1) / 2);
  return { name: "Corner", node: card(els, { key: "pet", title: "CLAWD'S CORNER", color: PET_META.color, meta: `Lv ${level(p)}`, rows }), height: 3 + artRows + 2 + 2 + (els.Svg ? 2 : 0) };
}

// When, as "10:42", or a weekday for an older line.
function when(at, now) {
  const d = new Date(at);
  if (now - at > 20 * 3_600_000) return d.toLocaleDateString("en-US", { weekday: "short" });
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// What Clawd noticed lately: small and dim, so the corner stays the point.
function logCard(els, w, now, max) {
  const { Text } = els;
  const p = state.pet;
  const items = p.log.slice(0, max);
  let rows;
  if (!items.length) rows = [Text({ key: "empty", color: theme.muted, children: "Nothing yet. Clawd notes what happens while you work." })];
  else if (els.Svg) {
    // Drawn, so the lines can be set smaller than the pane's text.
    const lh = 17, H = items.length * lh;
    const esc = (t) => t.replace(/[<&>]/g, "");
    const lines = items.map((x, i) => `<text x="0" y="${i * lh + 12}" font-size="11.5" fill="#9A968F">${when(x.at, now)}</text>`
      + `<text x="40" y="${i * lh + 12}" font-size="11.5" fill="#BDB8B0">${esc(`${x.icon} ${clip(x.text, 56)}`)}</text>`).join("");
    rows = [els.Svg({ key: "log", source: `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="${H}" viewBox="0 0 420 ${H}" font-family="-apple-system, system-ui, sans-serif">${lines}</svg>`, alt: items.map((x) => x.text).join(" · "), width: 420, height: H })];
  } else {
    rows = items.map((x, i) => Text({ key: `l${i}`, color: theme.muted, wrap: "truncate-end", children: `${when(x.at, now)}  ${x.icon} ${x.text}` }));
  }
  return { name: "Lately", node: card(els, { key: "log", title: "LATELY", color: theme.muted, rows }), height: 3 + rows.length };
}

function moodCard(els, handlers) {
  const { Box, Button, Text } = els;
  const p = state.pet;
  const choice = (key, label, on, press) => Button({ key, plain: true, dimColor: !on, label: on ? `● ${label}` : `○ ${label}`, onPress: press });
  const rows = [
    Box({ key: "moods", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
      choice("pet-auto", "Auto", p.mode === "auto", () => handlers.onPetMode?.("auto")),
      ...MOODS.map((m) => choice(`pet-${m}`, MOOD_LABEL[m], p.mode === m, () => handlers.onPetMode?.(m))),
    ] }),
  ];
  if (els.Svg) {
    rows.push(Box({ key: "walk", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
      Text({ key: "l", color: theme.muted, children: "By the input box" }),
      ...WALKS.map((w) => choice(`walk-${w.id}`, w.label, p.walk === w.id, () => handlers.onPetWalk?.(w.id))),
    ] }));
  }
  return { name: "Mood", node: card(els, { key: "moods", title: "MOOD", color: PET_META.color, meta: p.mode === "auto" ? "follows along" : "kept on", rows }), height: 3 + 3 + rows.length };
}

export function petDock(els, w, capacity, handlers, now) {
  return stackCards(els, [cornerCard(els, now), logCard(els, w, now, 4), moodCard(els, handlers)], capacity, handlers.scroll);
}

export function petInline(els, w, handlers, now) {
  const mood = petMood(now);
  const { Box, Text } = els;
  return [
    Box({ key: "head", flexDirection: "row", columnGap: 1, children: [
      Text({ key: "n", bold: true, color: PET_META.color, children: `${PET_META.icon} Clawd` }),
      Text({ key: "m", children: MOOD_LABEL[mood] }),
      Text({ key: "lv", color: theme.muted, children: `Lv ${level(state.pet)}` }),
    ] }),
    ...(els.Svg ? [els.Svg({ key: "pet", source: clawdSvg(mood, 72), alt: `Clawd: ${MOOD_LABEL[mood]}`, width: 72, height: 72 })] : stickerCells(els, mood, now)),
  ];
}

export function petBandPieces() {
  const mood = petMood();
  const last = state.pet.log[0];
  return [
    { text: "Clawd ", color: PET_META.color, bold: true },
    { text: MOOD_LABEL[mood] },
    { text: ` · Lv ${level(state.pet)}`, color: theme.muted },
    last ? { text: ` · ${last.icon} ${last.text}`, color: theme.muted } : null,
  ].filter(Boolean);
}

// Clawd by the input box, as the walk asks (desktop only, with a Pet tab):
// `row` takes the room after the field's buttons (sitting at its end, or a
// track it walks along), null when not in use. A track is one drawing as wide as its slot, Clawd
// moved inside it by SVG animation, so nothing redraws while it walks.
// The desktop sets a fixed-size drawing at the width it's given, held to its
// slot. A track has no width of its own, so it's given more than the pane
// could have (from its columns) and the slot holds it to the room there is.
const PX_PER_COLUMN = 10;
export function petBeside(els, { columns = 0, now = Date.now() } = {}) {
  const p = state.pet;
  const wide = Math.max(600, Math.round((columns || 80) * PX_PER_COLUMN));
  const none = { row: null, fills: false };   // fills: the row takes the room itself
  if (!els.Svg || p.walk === "off" || !state.sysRooms.includes("pet")) return none;
  const mood = petMood(now);
  const alt = `Clawd: ${MOOD_LABEL[mood]}`;
  if (p.walk === "sit") return { ...none, row: els.Svg({ key: `beside-${mood}`, source: clawdSvg(mood, 40, { crop: true }), alt, width: 40, height: 40 }) };
  // From nothing (width 0), growing into the room left: the drawing inside is
  // wider than any pane, and must not push the field narrower.
  return { ...none, fills: true, row: els.Box({ key: "clawd-walk", flexGrow: 1, width: 0, minWidth: 1, overflow: "hidden", children: [
    els.Svg({ key: "track", source: walkSvg(mood, p.walk, 40), alt, width: wide, height: 40 }),
  ] }) };
}

// While the terminal shows the room, it redraws as fast as the frames go.
export function petFrameMs(now = Date.now()) {
  return STICKERS[petMood(now)].ms;
}

// What Clawd says when nothing new happened: its mood, in words.
const SAYS = {
  vibe: "Just vibing", typing: "Working with Claude", wave: "Hi there!", cheer: "We did it!",
  confused: "Huh, the checks?", wink: "Looking good", surprised: "Whoa!", sleepy: "Zzz…",
};
const NEWS_MS = 15 * 60_000;

// The desktop's band: Clawd, small and moving, saying the latest thing it
// noticed (in the last quarter hour), or else how it feels.
export function petBandDesk(now = Date.now()) {
  const p = state.pet;
  const mood = petMood(now);
  const news = p.log[0] && now - p.log[0].at < NEWS_MS ? p.log[0] : null;
  const says = news ? `${news.icon} ${news.text}` : SAYS[mood];
  return { color: PET_META.color, sections: [
    { key: "clawd", color: PET_META.color, parts: [
      draw({ source: clawdSvg(mood, 24, { crop: true }), width: 24, height: 24 }, `Clawd: ${MOOD_LABEL[mood]}`),
      chip(clip(says, 48), "#3A3836", "#ECE7E1"),
    ], tip: [`Clawd · ${MOOD_LABEL[mood]} · Lv ${level(p)}`, ...p.log.slice(news ? 1 : 0, 3).map((x) => `${x.icon} ${x.text}`)] },
  ] };
}
