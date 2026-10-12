// The Focus room: a Pomodoro timer. Focus for a while, then a break, each
// ending with a chime (the mod plays it). A focus round that runs out starts
// its break at once; a break that runs out waits for ▶. The lengths and the
// day's count are kept in $.store, a running timer per session, so a reload
// carries on where it was.
//
// Plain logic and drawing: the mod owns the clock, the sound and the store.

import { state } from "./state.mjs";
import { theme } from "./theme.mjs";
import { line, card, stackCards, meter } from "./widgets.mjs";
import * as K from "./bandkit.mjs";
import { draw, value, sub } from "./bands.mjs";

export const FOCUS_META = { icon: "◷", label: "Focus", color: "#E58FA8" };
const BREAK_COLOR = theme.online;

export const WORK = { min: 5, max: 120, step: 5 };
export const REST = { min: 1, max: 60, step: 1 };

export function createFocus() {
  return {
    work: 25,          // minutes of focus
    rest: 5,           // minutes of break
    phase: "idle",     // idle | focus | break
    endsAt: 0,         // while running: when the phase ends (ms)
    left: 0,           // while paused: what was left (ms)
    span: 0,           // while running: the phase's length when it began (ms)
    paused: false,
    day: "",           // the local day `done` and `focusedMs` count
    done: 0,           // focus rounds finished today
    focusedMs: 0,      // focused today, finished rounds only
    cheerAt: 0,        // when the last focus round ended (the pet cheers)
    history: {},       // "2026-10-12" → focus rounds finished that day, the last year
  };
}

// "2026-10-12" in local time: the day the count belongs to.
export function dayOf(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_DAYS = 371;   // 53 weeks

// The day `n` days before `now`'s (noon, so a DST change can't skip one).
function daysBefore(now, n) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return dayOf(d.getTime());
}

// The day after "2026-10-12" (noon again, for DST).
function dayAfter(day) {
  const [y, m, d] = day.split("-").map(Number);
  return dayOf(new Date(y, m - 1, d + 1, 12).getTime());
}

// Days in a row with a finished round, up to today (or yesterday, when
// today has none yet), and the longest run kept. Walks only the days that
// had a round, as the band asks for it every second.
export function streaks(f, now) {
  const oldest = daysBefore(now, KEEP_DAYS);
  const days = Object.keys(f.history).filter((day) => day >= oldest && f.history[day] > 0).sort();
  const had = new Set(days);
  const has = (n) => had.has(daysBefore(now, n));
  let current = 0;
  for (let n = has(0) ? 0 : 1; has(n); n++) current++;
  let best = 0, run = 0, prev = "";
  for (const day of days) {
    run = prev && dayAfter(prev) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best };
}

function rollDay(f, now) {
  const day = dayOf(now);
  if (f.day !== day) { f.day = day; f.done = 0; f.focusedMs = 0; }
}

const phaseMs = (f, phase = f.phase) => (phase === "break" ? f.rest : f.work) * 60_000;
// The running phase's own length: −/+ meanwhile is for the next one.
const spanMs = (f) => f.span || phaseMs(f);

export function isRunning(f) {
  return f.phase !== "idle" && !f.paused;
}

// What's left of the phase, in ms (the whole focus length while idle).
export function remaining(f, now) {
  if (f.phase === "idle") return phaseMs(f, "focus");
  if (f.paused) return f.left;
  return Math.max(0, f.endsAt - now);
}

// How far through the phase, 0 to 1.
export function progress(f, now) {
  if (f.phase === "idle") return 0;
  return Math.min(1, Math.max(0, 1 - remaining(f, now) / spanMs(f)));
}

// "18:42", or "1:05:00" past an hour.
export function clock(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm.padStart(2, "0")}:${ss}`;
}

// ▶: start a focus round, or carry on after a pause.
export function start(f, now) {
  rollDay(f, now);
  if (f.paused) { f.paused = false; f.endsAt = now + f.left; f.left = 0; return; }
  if (f.phase === "idle") { f.phase = "focus"; f.span = phaseMs(f); f.endsAt = now + f.span; }
}

export function pause(f, now) {
  if (!isRunning(f)) return;
  f.left = Math.max(0, f.endsAt - now);
  f.paused = true;
}

// ↺: back to idle, the round not counted.
export function reset(f) {
  f.phase = "idle";
  f.paused = false;
  f.endsAt = 0;
  f.left = 0;
  f.span = 0;
}

// The phase is over: a focus round counts and its break starts; a break
// goes back to idle. Returns what ended ("focus" or "break").
function finish(f, now, { counted }) {
  const ended = f.phase;
  if (ended === "focus") {
    rollDay(f, now);
    if (counted) {
      f.done += 1;
      f.focusedMs += spanMs(f);
      f.cheerAt = now;
      f.history[f.day] = (f.history[f.day] ?? 0) + 1;
      const oldest = daysBefore(now, KEEP_DAYS);
      for (const day of Object.keys(f.history)) if (day < oldest) delete f.history[day];
    }
    f.phase = "break";
    f.paused = false;
    f.span = phaseMs(f, "break");
    f.endsAt = now + f.span;
    f.left = 0;
  } else reset(f);
  return ended;
}

// ⏭: end the phase now. A focus round skipped doesn't count.
export function skip(f, now) {
  if (f.phase === "idle") return null;
  return finish(f, now, { counted: false });
}

// Once a second: the phase that ran out, or null.
export function tickFocus(f, now) {
  if (!isRunning(f) || now < f.endsAt) return null;
  return finish(f, now, { counted: true });
}

// −/+ on a length. A running phase keeps its end; the new length is for the next.
export function adjust(f, which, dir) {
  const r = which === "rest" ? REST : WORK;
  const v = Math.min(r.max, Math.max(r.min, f[which] + dir * r.step));
  f[which] = v;
}

// "50 10", "50/10" or "50": the lengths, typed. True when it was that.
export function setLengths(f, text) {
  const m = /^(\d{1,3})(?:\s*[\s/]\s*(\d{1,3}))?$/.exec(String(text ?? "").trim());
  if (!m) return false;
  f.work = Math.min(WORK.max, Math.max(WORK.min, Number(m[1])));
  if (m[2]) f.rest = Math.min(REST.max, Math.max(REST.min, Number(m[2])));
  return true;
}

// What's kept in $.store: the lengths and today's count (shared by every
// session), and the running timer (this session's).
export function focusSettings(f) {
  return { work: f.work, rest: f.rest, day: f.day, done: f.done, focusedMs: f.focusedMs, history: f.history };
}
export function focusTimer(f) {
  return { phase: f.phase, endsAt: f.endsAt, left: f.left, paused: f.paused, span: f.span };
}

// A running phase whose end passed this long ago ran out while no session
// was there to see it: it isn't counted or chimed for, only let go.
const STALE_MS = 60_000;
export function restoreFocus(f, settings, timer, now) {
  if (settings && typeof settings === "object") {
    if (Number.isFinite(settings.work)) f.work = Math.min(WORK.max, Math.max(WORK.min, settings.work));
    if (Number.isFinite(settings.rest)) f.rest = Math.min(REST.max, Math.max(REST.min, settings.rest));
    if (typeof settings.day === "string") { f.day = settings.day; f.done = settings.done | 0; f.focusedMs = settings.focusedMs | 0; }
    if (settings.history && typeof settings.history === "object") {
      f.history = Object.fromEntries(Object.entries(settings.history).filter(([day, n]) => DAY.test(day) && Number.isInteger(n) && n > 0));
    }
  }
  if (timer && ["focus", "break"].includes(timer.phase)) {
    const paused = timer.paused === true;
    const endsAt = Number(timer.endsAt) || 0;
    if (paused || now - endsAt < STALE_MS) {
      f.phase = timer.phase;
      f.paused = paused;
      f.endsAt = endsAt;
      f.left = Number(timer.left) || 0;
      f.span = Number(timer.span) || 0;
    }
  }
  rollDay(f, now);
}

// ---------------------------------------------------------------- drawing

const phaseWord = (f) => (f.phase === "break" ? "break" : f.phase === "focus" ? "focus" : "ready");
const phaseColor = (f) => (f.phase === "break" ? BREAK_COLOR : FOCUS_META.color);
export const spent = (ms) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

// The ring, drawn: the track, the arc gone so far, the time and the phase.
function ring(els, f, now) {
  const size = 132, r = 54, c = 2 * Math.PI * r;
  const color = phaseColor(f);
  const left = c * (1 - progress(f, now));
  const sub = f.phase === "idle" ? `${f.work} / ${f.rest} min` : `${phaseWord(f)}${f.paused ? " · paused" : ""}`;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" font-family="-apple-system, system-ui, sans-serif">`
    + `<circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(127,127,127,0.25)" stroke-width="9"/>`
    + (f.phase === "idle" ? "" : `<circle cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${left.toFixed(1)}" transform="rotate(-90 66 66)"/>`)
    + `<text x="66" y="70" text-anchor="middle" font-size="28" font-weight="600" fill="${f.paused ? "#9A968F" : "#ECE7E1"}">${clock(remaining(f, now))}</text>`
    + `<text x="66" y="92" text-anchor="middle" font-size="12" fill="#9A968F">${sub}</text></svg>`;
  return els.Svg({ key: "ring", source, alt: `${clock(remaining(f, now))} ${sub}`, width: size, height: size });
}

function controls(els, f, handlers) {
  const { Box, Button } = els;
  const main = f.phase === "idle" ? { label: "▶ Start", fn: "onFocusStart" }
    : f.paused ? { label: "▶ Resume", fn: "onFocusStart" }
      : { label: "⏸ Pause", fn: "onFocusPause" };
  return Box({ key: "controls", flexDirection: "row", justifyContent: "center", columnGap: 1, children: [
    Button({ key: "focus-main", label: main.label, variant: "primary", onPress: () => handlers[main.fn]?.() }),
    f.phase === "idle" ? null : Button({ key: "focus-skip", label: f.phase === "focus" ? "⏭ Break" : "⏭ Skip", onPress: () => handlers.onFocusSkip?.() }),
    f.phase === "idle" ? null : Button({ key: "focus-reset", label: "↺", onPress: () => handlers.onFocusReset?.() }),
  ].filter(Boolean) });
}

function timerCard(els, f, w, handlers, now) {
  const { Box, Text } = els;
  const color = phaseColor(f);
  const rows = [];
  if (els.Svg) {
    rows.push(Box({ key: "ring-row", flexDirection: "row", justifyContent: "center", children: [ring(els, f, now)] }));
  } else {
    rows.push(line(els, "time", [
      { text: clock(remaining(f, now)), bold: true, color: f.paused ? theme.muted : color },
      { text: `  ${phaseWord(f)}${f.paused ? " · paused" : ""}`, color: theme.muted, grow: true },
    ]));
    rows.push(meter(els, { key: "bar", label: f.phase === "break" ? "Break" : "Focus", pct: progress(f, now) * 100, width: w, color, right: `${Math.round(spanMs(f) / 60_000)} min` }));
  }
  rows.push(controls(els, f, handlers));
  const meta = f.done ? `${f.done} done today` : "none done today";
  return { name: "Timer", node: card(els, { key: "timer", title: f.phase === "break" ? "BREAK" : "FOCUS", color, meta, rows }), height: 3 + (els.Svg ? 7 : rows.length) };
}

function lengthRow(els, key, label, value, handlers) {
  const { Box, Text, Button } = els;
  return Box({ key, flexDirection: "row", alignItems: "center", children: [
    Box({ key: "l", flexGrow: 1, children: [Text({ key: "t", children: label })] }),
    // The value in a box of its own width, so −, the value and + line up
    // from one row to the next whatever the number.
    Box({ key: "ctl", flexDirection: "row", alignItems: "center", columnGap: 1, flexShrink: 0, children: [
      Button({ key: `${key}-less`, label: "−", onPress: () => handlers.onFocusAdjust?.(key, -1) }),
      Box({ key: "v", width: 8, flexShrink: 0, justifyContent: "center", children: [Text({ key: "t", bold: true, children: `${value} min` })] }),
      Button({ key: `${key}-more`, label: "+", onPress: () => handlers.onFocusAdjust?.(key, 1) }),
    ] }),
  ] });
}

function settingsCard(els, f, handlers) {
  const rows = [lengthRow(els, "work", "Focus", f.work, handlers), lengthRow(els, "rest", "Break", f.rest, handlers)];
  const meta = f.focusedMs ? `${spent(f.focusedMs)} focused today` : "";
  return { name: "Settings", node: card(els, { key: "settings", title: "SETTINGS", color: FOCUS_META.color, meta, rows }), height: 3 + rows.length };
}

// The streak, as GitHub draws contributions: a column a week, Sunday at
// the top, today last, each day's square darker the more rounds it had.
const LEVELS = [0.18, 0.4, 0.62, 0.84, 1];
function level(n) {
  return n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
}
function streakGrid(f, now, weeks) {
  const today = new Date(now).getDay();   // 0 Sunday
  const cols = [];
  for (let wk = weeks - 1; wk >= 0; wk--) {
    const col = [];
    for (let dow = 0; dow < 7; dow++) {
      const back = wk * 7 + (today - dow);
      col.push(back < 0 ? null : f.history[daysBefore(now, back)] ?? 0);
    }
    cols.push(col);
  }
  return cols;
}

// A month's short name over the week it starts in, as GitHub sets them; one
// too close to the last (the first column's, mostly) is left out.
function monthLabels(now, weeks, step) {
  const today = new Date(now).getDay();
  let out = "", lastMonth = -1, lastX = -99;
  for (let wk = weeks - 1, x = 0; wk >= 0; wk--, x++) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (wk * 7 + today));   // the week's Sunday
    const m = d.getMonth();
    if (m !== lastMonth && x * step - lastX >= 30) {
      out += `<text x="${x * step}" y="10" font-size="10" fill="#9A968F">${d.toLocaleDateString("en-US", { month: "short" })}</text>`;
      lastX = x * step;
    }
    lastMonth = m;
  }
  return out;
}

function streakCard(els, f, w, now) {
  const { Box, Text } = els;
  const { current, best } = streaks(f, now);
  const meta = current ? `🔥 ${current} day${current === 1 ? "" : "s"} · best ${best}` : best ? `best ${best} days` : "";
  const rose = FOCUS_META.color;
  let rows;
  if (els.Svg) {
    // GitHub's: the months along the top, the squares, then the total and a
    // Less-to-More legend under them.
    const weeks = Math.max(12, Math.min(26, Math.floor((w * 8) / 14)));
    const cell = 11, gap = 3, step = cell + gap, top = 15;
    const grid = streakGrid(f, now, weeks);
    const squares = grid.flatMap((col, x) => col.map((n, y) => (n == null ? "" : `<rect x="${x * step}" y="${top + y * step}" width="${cell}" height="${cell}" rx="2.5" fill="${n ? rose : "#8F8D87"}" fill-opacity="${LEVELS[level(n ?? 0)]}"/>`))).join("");
    const W = weeks * step - gap, H = top + 7 * step - gap;
    const total = grid.flat().reduce((a, n) => a + (n ?? 0), 0);
    const legend = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="14" viewBox="0 0 112 14" font-family="-apple-system, system-ui, sans-serif">`
      + `<text x="0" y="11" font-size="11" fill="#9A968F">Less</text>`
      + LEVELS.map((o, i) => `<rect x="${28 + i * 12}" y="2" width="10" height="10" rx="2" fill="${i ? rose : "#8F8D87"}" fill-opacity="${o}"/>`).join("")
      + `<text x="${28 + 5 * 12 + 2}" y="11" font-size="11" fill="#9A968F">More</text></svg>`;
    rows = [
      els.Svg({ key: "streak", source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, system-ui, sans-serif">${monthLabels(now, weeks, step)}${squares}</svg>`, alt: `${total} focus rounds in the last ${weeks} weeks`, width: W, height: H }),
      Box({ key: "foot", flexDirection: "row", alignItems: "center", children: [
        Box({ key: "sum", flexGrow: 1, children: [Text({ key: "t", color: theme.muted, children: `${total} round${total === 1 ? "" : "s"} in ${weeks} weeks` })] }),
        els.Svg({ key: "legend", source: legend, alt: "Less to more rounds", width: 112, height: 14 }),
      ] }),
    ];
  } else {
    // A square and a space a day: as many weeks as the card holds.
    const weeks = Math.max(4, Math.min(26, Math.floor((w - 1) / 2)));
    const grid = streakGrid(f, now, weeks);
    rows = Array.from({ length: 7 }, (_, dow) => Box({ key: `d${dow}`, flexDirection: "row", children: grid.map((col, x) => {
      const n = col[dow];
      return Text({ key: `c${x}`, color: n ? rose : theme.muted, dimColor: !n || level(n) < 2, children: n == null ? "  " : n ? "■ " : "· " });
    }) }));
  }
  return { name: "Streak", node: card(els, { key: "streak", title: "STREAK", color: FOCUS_META.color, meta, rows }), height: 3 + (els.Svg ? 8 : 7) };
}

export function focusDock(els, w, capacity, handlers, now) {
  const f = state.focus;
  return stackCards(els, [timerCard(els, f, w, handlers, now), settingsCard(els, f, handlers), streakCard(els, f, w, now)], capacity, handlers.scroll);
}

export function focusInline(els, w, handlers, now) {
  const f = state.focus;
  const { Box, Button } = els;
  return [
    line(els, "head", [
      { text: `${FOCUS_META.icon} ${FOCUS_META.label}`, bold: true, color: FOCUS_META.color },
      { text: `  ${clock(remaining(f, now))}`, bold: true, color: phaseColor(f) },
      { text: `  ${phaseWord(f)}${f.paused ? " · paused" : ""}`, color: theme.muted, grow: true },
      { text: `${f.done} today`, color: theme.muted },
    ]),
    meter(els, { key: "bar", label: `${f.work}/${f.rest} min`, pct: progress(f, now) * 100, width: w, color: phaseColor(f) }),
    controls(els, f, handlers),
  ];
}

const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const phaseLabel = (f) => (f.phase === "break" ? "☕ Break" : f.phase === "focus" ? "🍅 Focus" : "Ready");
// What comes after the phase on show.
function nextText(f, now) {
  if (f.phase === "break") return `next: round ${f.done + 1} · ${f.work} min`;
  if (f.phase === "focus") return f.paused ? `${f.rest} min break after` : `ends ${hhmm(now + remaining(f, now))}`;
  return `${f.work} / ${f.rest} min`;
}

// The terminal's band: "☕ Break 03:12 · 🔥 5 days · next: round 4 · 25 min".
export function focusBandPieces() {
  const f = state.focus;
  const now = Date.now();
  const { current } = streaks(f, now);
  const sep = { text: " · ", color: theme.muted };
  return [
    { text: phaseLabel(f), color: phaseColor(f), bold: true },
    f.phase === "idle" ? null : { text: ` ${clock(remaining(f, now))}${f.paused ? " ⏸" : ""}`, color: phaseColor(f), bold: true },
    current ? sep : null,
    current ? { text: `🔥 ${current} day${current === 1 ? "" : "s"}`, color: theme.amber, bold: true } : null,
    sep,
    { text: nextText(f, now), color: theme.muted },
  ].filter(Boolean);
}

// The desktop's band, as sections for the capsule: the phase and its time,
// ten cells for how far it has gone, the streak with this week's days, and
// what comes next. The capsule takes the phase's color: green in a break.
export function focusBandDesk(now = Date.now()) {
  const f = state.focus;
  const color = phaseColor(f);
  const { current, best } = streaks(f, now);
  const pct = progress(f, now) * 100;
  const week = Array.from({ length: 7 }, (_, i) => f.history[daysBefore(now, 6 - i)] ?? 0);
  const squares = { source: K.svg(63, 9, week.map((n, i) => `<rect x="${i * 9}" y="1" width="7" height="7" rx="1.5" fill="${n ? FOCUS_META.color : "#8F8D87"}" fill-opacity="${LEVELS[level(n)]}"/>`).join("")), width: 63, height: 9 };
  const sections = [
    { key: "phase", color, parts: [value(phaseLabel(f), color), f.phase === "idle" ? null : value(`${clock(remaining(f, now))}${f.paused ? " ⏸" : ""}`)],
      tip: [`Focus ${f.work} min · Break ${f.rest} min`, `${f.done} round${f.done === 1 ? "" : "s"} done today`] },
    f.phase === "idle" ? null : { key: "progress", color, parts: [draw(K.cells(pct, color, { n: 10 }), `${Math.round(pct)}% through`)] },
    { key: "streak", color: theme.amber, parts: [current ? value(`🔥 ${current} day${current === 1 ? "" : "s"}`, theme.amber) : sub("no streak yet"), draw(squares, "This week"), sub("this week")],
      tip: [current ? `${current} day${current === 1 ? "" : "s"} in a row` : "Finish a round today to start one", `best ${best} day${best === 1 ? "" : "s"}`] },
    { key: "next", color, parts: [sub(nextText(f, now))] },
  ];
  return { color, sections: sections.filter(Boolean) };
}

export function focusStatus(now = Date.now()) {
  const f = state.focus;
  if (f.phase === "idle") return "";
  return `${f.phase === "break" ? "☕" : "🍅"} ${clock(remaining(f, now))}${f.paused ? " ⏸" : ""}`;
}

// The tab's badge from another room: minutes left while running.
export function focusBadge(now = Date.now()) {
  const f = state.focus;
  if (f.phase === "idle") return null;
  return { text: f.paused ? "⏸" : `${Math.ceil(remaining(f, now) / 60_000)}m`, color: phaseColor(f) };
}

export function focusSnapshot(now = Date.now()) {
  const f = state.focus;
  const left = clock(remaining(f, now));
  const head = f.phase === "idle" ? `Ready to focus (${f.work} / ${f.rest} min).`
    : f.phase === "break" ? `On a break, ${left} left${f.paused ? ", paused" : ""}.`
    : `Focusing, ${left} to go of ${Math.round(spanMs(f) / 60_000)} min${f.paused ? ", paused" : ""}.`;
  const today = f.done ? `${f.done} round${f.done === 1 ? "" : "s"} today, ${spent(f.focusedMs)} focused.` : "No rounds yet today.";
  const { current } = streaks(f, now);
  return `◷ ${head} ${today}${current ? ` 🔥 ${current}-day streak.` : ""}`;
}
