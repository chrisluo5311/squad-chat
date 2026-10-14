// The Habits room: goals checked off once a day, or a number of times a day
// ("Water x8"), each with its streak drawn as GitHub draws contributions.
// The goals and their days are kept in $.store, the same in every session.
//
// Plain logic and drawing: the mod owns the store and the clock.

import { state } from "./state.mjs";
import { theme } from "./theme.mjs";
import { line, card, stackCards, cells } from "./widgets.mjs";
import * as K from "./bandkit.mjs";
import { draw, value, sub, msg } from "./bands.mjs";
import { dayOf, daysBefore, dayAfter } from "./focus.mjs";

export const HABITS_META = { icon: "✓", label: "Habits", color: "#6FC2B5" };
const TEAL = HABITS_META.color;
const GREY = "#8F8D87";

export const MAX_HABITS = 12;
const MAX_NAME = 24;
const MAX_TARGET = 99;
const KEEP_DAYS = 371;   // 53 weeks
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createHabits() {
  return {
    goals: [],     // [{ id: "h1", name: "Read 30 min", target: 1 }], in the order added
    history: {},   // goal id → { "2026-10-13": times done that day }, the last year
  };
}

// ---------------------------------------------------------------- the goals

const count = (h, g, day) => h.history[g.id]?.[day] ?? 0;
const doneOn = (h, g, day) => count(h, g, day) >= g.target;

// How many of the goals are done today, and the ones that aren't.
export function today(h, now) {
  const day = dayOf(now);
  const left = h.goals.filter((g) => !doneOn(h, g, day));
  return { done: h.goals.length - left.length, total: h.goals.length, left, day };
}

// Days in a row with the goal met, up to today (or yesterday, when today
// isn't done yet), and the longest run kept.
export function habitStreaks(h, g, now) {
  const oldest = daysBefore(now, KEEP_DAYS);
  const days = Object.keys(h.history[g.id] ?? {}).filter((day) => day >= oldest && doneOn(h, g, day)).sort();
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

// Two names are the same habit when they read the same: case, spaces,
// full-width letters and digits (as an IME types them) and a stop at the
// end don't count. "Read 30 min", "read30min." and "Ｒｅａｄ ３０ ｍｉｎ" are one.
export const nameKey = (name) => String(name ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[.。!！?？,，、;；:：~～]+$/, "");
const sameName = (h, name, except = null) => h.goals.find((g) => g !== except && nameKey(g.name) === nameKey(name));

// A goal by its number (1, 2 …), its name, or the start of one name.
export function findHabit(h, text) {
  const want = String(text ?? "").trim().toLowerCase();
  if (!want) return null;
  if (/^\d+$/.test(want)) return h.goals[Number(want) - 1] ?? null;
  const exact = sameName(h, want);
  if (exact) return exact;
  const starts = h.goals.filter((g) => g.name.toLowerCase().startsWith(want));
  return starts.length === 1 ? starts[0] : null;
}

// "Water x8" (or ×8, *8): a name and how many times a day; once otherwise.
// An x counts only after a space, so "Inbox 0" and "Relax 5" stay names.
// Full-width text (an IME's "Ｗａｔｅｒ ｘ８") reads as the half-width it shows.
const COUNTED = /^(.*?\S)(?:\s+[x×*]|\s*[×*])\s*(\d{1,2})$/i;
function parseGoal(text) {
  const t = String(text ?? "").normalize("NFKC").trim();
  const m = COUNTED.exec(t);
  const name = (m ? m[1] : t).trim().replace(/\s+/g, " ");
  const target = m ? Math.min(MAX_TARGET, Math.max(1, Number(m[2]))) : 1;
  return { name, target };
}

function nextId(h) {
  const used = h.goals.map((g) => Number(g.id.slice(1)) || 0);
  return `h${Math.max(0, ...used) + 1}`;
}

// Each returns what to say: the change made, or why it wasn't.
export function addHabit(h, text) {
  const { name, target } = parseGoal(text);
  if (!name) return "Name the habit: add Read 30 min, or add Water x8 for one done 8 times a day.";
  if ([...name].length > MAX_NAME) return `A habit's name is ${MAX_NAME} characters at most.`;
  const taken = sameName(h, name);
  if (taken) return `There's already a habit called ${taken.name}.`;
  if (h.goals.length >= MAX_HABITS) return `${MAX_HABITS} habits at most: remove one first.`;
  h.goals.push({ id: nextId(h), name, target });
  return `Added ${name}${target > 1 ? `, ${target} times a day` : ""}.`;
}

export function removeHabit(h, text) {
  const g = findHabit(h, text);
  if (!g) return noSuch(h, text);
  return dropGoal(h, g);
}

function dropGoal(h, g) {
  h.goals = h.goals.filter((x) => x !== g);
  delete h.history[g.id];
  return `Removed ${g.name} and its streak.`;
}

// "Read -> Read 20 min", or "Water -> Water x10" to change the count too.
export function renameHabit(h, text) {
  const [from, to] = String(text ?? "").split(/\s*(?:->|→)\s*/);
  const g = findHabit(h, from);
  if (!g) return noSuch(h, from);
  const next = parseGoal(to);
  if (!next.name) return "Rename with old -> new: rename Read -> Read 20 min.";
  if ([...next.name].length > MAX_NAME) return `A habit's name is ${MAX_NAME} characters at most.`;
  const taken = sameName(h, next.name, g);
  if (taken) return `There's already a habit called ${taken.name}.`;
  const was = g.name;
  g.name = next.name;
  if (COUNTED.test(to.normalize("NFKC").trim())) g.target = next.target;
  return `${was} is now ${g.name}${g.target > 1 ? `, ${g.target} times a day` : ""}.`;
}

// Today's count, a step up or down, kept between none and the goal's.
export function markHabit(h, id, dir, now) {
  const g = h.goals.find((x) => x.id === id);
  if (!g) return null;
  const day = dayOf(now);
  const days = (h.history[g.id] ??= {});
  const n = Math.min(g.target, Math.max(0, (days[day] ?? 0) + dir));
  if (n) days[day] = n;
  else delete days[day];
  const oldest = daysBefore(now, KEEP_DAYS);
  for (const d of Object.keys(days)) if (d < oldest) delete days[d];
  return g;
}

// ✕ on a card: the habit and its days go. Returns what to say and what
// Cancel needs to put it back, or null. By its id: a name such as "2"
// would read as the second habit.
export function deleteHabit(h, id) {
  const index = h.goals.findIndex((x) => x.id === id);
  if (index < 0) return null;
  const goal = { ...h.goals[index] };
  const days = { ...(h.history[id] ?? {}) };
  return { said: dropGoal(h, h.goals[index]), kept: { goal, days, index } };
}

// Cancel after ✕: the habit back where it was, with its days. A name taken
// since (or no room left) keeps it gone; an id taken since gets a new one.
export function undeleteHabit(h, { goal, days, index }) {
  const taken = sameName(h, goal.name);
  if (taken) return `There's already a habit called ${taken.name}.`;
  if (h.goals.length >= MAX_HABITS) return `${MAX_HABITS} habits at most: remove one first.`;
  const id = h.goals.some((g) => g.id === goal.id) ? nextId(h) : goal.id;
  h.goals.splice(Math.min(index, h.goals.length), 0, { ...goal, id });
  h.history[id] = { ...days };
  return `${goal.name} is back.`;
}

// ✓ on a goal done once a day: done, or not after all.
export function toggleHabit(h, id, now) {
  const g = h.goals.find((x) => x.id === id);
  if (!g) return null;
  return markHabit(h, id, doneOn(h, g, dayOf(now)) ? -g.target : 1, now);
}

function noSuch(h, text) {
  const names = h.goals.map((g, i) => `${i + 1} ${g.name}`).join(", ");
  return h.goals.length ? `No habit called ${String(text ?? "").trim()}. There are ${names}.` : "No habits yet: add Read 30 min.";
}

// Words typed in the room's box (`typed`), or after /habit. Returns what to
// say, or null when the words weren't for the room.
export function habitWords(h, text, now, { typed = false } = {}) {
  const t = String(text ?? "").trim();
  const m = /^(add|new|remove|rm|delete|rename|done|check|undo)\b\s*([\s\S]*)$/i.exec(t);
  if (!m) {
    // In the box, anything else is a new habit: the button says add.
    if (typed) return addHabit(h, t);
    // After /habit, a habit's own name checks it off (another time, for a counted one).
    const g = findHabit(h, t);
    if (!g || /^\d+$/.test(t)) return null;
    return doneWord(h, g, 1, now);
  }
  const [, verb, rest] = m;
  // In the box a habit may start with one of these words ("Check email"):
  // the word is a command only when what follows fits it.
  if (typed) {
    const v = verb.toLowerCase();
    const fits = v === "add" ? !!rest.trim() : v === "rename" ? /->|→/.test(rest) : v === "new" ? false : !!findHabit(h, rest);
    if (!fits) return addHabit(h, t);
  }
  switch (verb.toLowerCase()) {
    case "add": case "new": return addHabit(h, rest);
    case "remove": case "rm": case "delete": return rest ? removeHabit(h, rest) : "Say which: remove Run.";
    case "rename": return renameHabit(h, rest);
    case "done": case "check": case "undo": {
      const g = findHabit(h, rest);
      if (!g) return noSuch(h, rest);
      return doneWord(h, g, verb.toLowerCase() === "undo" ? -1 : 1, now);
    }
  }
  return null;
}

function doneWord(h, g, dir, now) {
  markHabit(h, g.id, dir, now);
  const n = count(h, g, dayOf(now));
  const { current } = habitStreaks(h, g, now);
  if (g.target > 1) return `${g.name}: ${n}/${g.target} today${n >= g.target && current ? ` · 🔥 ${current}` : ""}.`;
  return n ? `${g.name} done${current ? ` · 🔥 ${current} day${current === 1 ? "" : "s"}` : ""}.` : `${g.name} not done today.`;
}

// What's kept in $.store, and read back from it.
export function habitsSaved(h) {
  return { goals: h.goals, history: h.history };
}

export function restoreHabits(h, saved) {
  if (!saved || typeof saved !== "object") return;
  const goals = Array.isArray(saved.goals) ? saved.goals : [];
  h.goals = goals
    .filter((g) => g && typeof g.id === "string" && /^h\d+$/.test(g.id) && typeof g.name === "string" && g.name.trim())
    .slice(0, MAX_HABITS)
    .map((g) => ({ id: g.id, name: g.name.trim().slice(0, 64), target: Math.min(MAX_TARGET, Math.max(1, Number(g.target) | 0 || 1)) }));
  const history = saved.history && typeof saved.history === "object" ? saved.history : {};
  h.history = Object.fromEntries(h.goals.map((g) => [g.id, Object.fromEntries(Object.entries(history[g.id] ?? {})
    .filter(([day, n]) => DAY.test(day) && Number.isInteger(n) && n > 0))]));
}

// ---------------------------------------------------------------- drawing

// The squares' shades, Less to More, as GitHub has them: a count of the
// day's goal in four steps, a goal done once a day in one.
const LEVELS = [0.16, 0.35, 0.55, 0.78, 1];
const level = (n, target) => (n <= 0 ? 0 : target === 1 ? 4 : Math.max(1, Math.min(4, Math.ceil((n / target) * 4))));
const flame = (n) => `🔥 ${n} day${n === 1 ? "" : "s"}`;

// The weeks as columns, Sunday at the top, today's week last: each day's
// count, or null for the days after today.
function grid(h, g, now, weeks) {
  const dow = new Date(now).getDay();
  const cols = [];
  for (let wk = weeks - 1; wk >= 0; wk--) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const back = wk * 7 + (dow - d);
      col.push(back < 0 ? null : count(h, g, daysBefore(now, back)));
    }
    cols.push(col);
  }
  return cols;
}

// A month's short name over the week it starts in; one too close to the
// last is left out, as GitHub does.
function monthLabels(now, weeks, step, left) {
  const dow = new Date(now).getDay();
  let out = "", lastMonth = -1, lastX = -99;
  for (let wk = weeks - 1, x = 0; wk >= 0; wk--, x++) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (wk * 7 + dow));
    const m = d.getMonth();
    if (m !== lastMonth && x * step - lastX >= 28) {
      out += `<text x="${left + x * step}" y="10" font-size="10" fill="#9A968F">${d.toLocaleDateString("en-US", { month: "short" })}</text>`;
      lastX = x * step;
    }
    lastMonth = m;
  }
  return out;
}

// The weeks that fit the card: the day names take a little of the width.
const weeksFor = (w) => Math.max(12, Math.min(26, Math.floor((w * 8 - 28) / 14)));

function heatmap(els, h, g, w, now) {
  const weeks = weeksFor(w);
  const cell = 11, gap = 3, step = cell + gap, top = 15, left = 28;
  const cols = grid(h, g, now, weeks);
  const last = cols.length - 1, dow = new Date(now).getDay();
  const squares = cols.flatMap((col, x) => col.map((n, y) => {
    if (n == null) return "";
    const L = level(n, g.target);
    // Today's square is ringed, so the column it's in reads as this week.
    const ring = x === last && y === dow ? ' stroke="#ECE7E1" stroke-width="1.2"' : "";
    return `<rect x="${left + x * step}" y="${top + y * step}" width="${cell}" height="${cell}" rx="2.5" fill="${L ? TEAL : GREY}" fill-opacity="${LEVELS[L]}"${ring}/>`;
  })).join("");
  const names = ["Mon", "Wed", "Fri"].map((t, i) => `<text x="0" y="${top + (1 + i * 2) * step + 9}" font-size="10" fill="#9A968F">${t}</text>`).join("");
  const W = left + weeks * step - gap, H = top + 7 * step - gap;
  const met = cols.flat().filter((n) => n != null && n >= g.target).length;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, system-ui, sans-serif">${monthLabels(now, weeks, step, left)}${names}${squares}</svg>`;
  return { node: els.Svg({ key: "grid", source, alt: `${g.name}: ${met} day${met === 1 ? "" : "s"} done in the last ${weeks} weeks`, width: W, height: H }), met, weeks };
}

// Less to More for a counted goal; missed and done for the rest.
function legend(els, g) {
  const body = g.target > 1
    ? `<text x="0" y="11" font-size="11" fill="#9A968F">Less</text>`
      + LEVELS.map((o, i) => `<rect x="${28 + i * 12}" y="2" width="10" height="10" rx="2" fill="${i ? TEAL : GREY}" fill-opacity="${o}"/>`).join("")
      + `<text x="${28 + 5 * 12 + 2}" y="11" font-size="11" fill="#9A968F">More</text>`
    : `<rect x="0" y="2" width="10" height="10" rx="2" fill="${GREY}" fill-opacity="${LEVELS[0]}"/><text x="14" y="11" font-size="11" fill="#9A968F">missed</text>`
      + `<rect x="62" y="2" width="10" height="10" rx="2" fill="${TEAL}"/><text x="76" y="11" font-size="11" fill="#9A968F">done</text>`;
  const width = 120;
  return els.Svg({ key: "legend", source: K.svg(width, 14, body).replace("<svg ", '<svg font-family="-apple-system, system-ui, sans-serif" '), alt: g.target > 1 ? "Less to more" : "Missed or done", width, height: 14 });
}

// ✓ for a goal done once a day (✓ again takes it back); − and +1 for a counted one.
function buttons(els, h, g, handlers, now) {
  const { Box, Button } = els;
  const done = doneOn(h, g, dayOf(now));
  const kids = g.target > 1
    ? [
      count(h, g, dayOf(now)) ? Button({ key: `habit-${g.id}-less`, label: "−", onPress: () => handlers.onHabitMark?.(g.id, -1) }) : null,
      Button({ key: `habit-${g.id}-do`, label: done ? "✓" : "+1", variant: done ? "primary" : undefined, onPress: () => handlers.onHabitMark?.(g.id, done ? 0 : 1) }),
    ]
    : [Button({ key: `habit-${g.id}-do`, label: "✓", variant: done ? "primary" : undefined, onPress: () => handlers.onHabitToggle?.(g.id) })];
  return Box({ key: "btns", flexDirection: "row", columnGap: 1, flexShrink: 0, children: kids.filter(Boolean) });
}

function habitCard(els, h, g, w, handlers, now) {
  const { Box, Text } = els;
  const { current, best } = habitStreaks(h, g, now);
  const n = count(h, g, dayOf(now));
  const metaNode = Box({ key: "meta", flexDirection: "row", alignItems: "center", columnGap: 1, flexShrink: 0, children: [
    g.target > 1 ? Text({ key: "n", color: theme.muted, children: `${n}/${g.target}` }) : null,
    current ? Text({ key: "s", color: theme.amber, bold: true, children: flame(current) }) : null,
    best ? Text({ key: "b", color: theme.muted, children: `best ${best}` }) : null,
    buttons(els, h, g, handlers, now),
    els.Button({ key: `habit-${g.id}-delete`, plain: true, dimColor: true, label: "✕", onPress: () => handlers.onHabitDelete?.(g.id) }),
  ].filter(Boolean) });
  let rows;
  if (els.Svg) {
    const map = heatmap(els, h, g, w, now);
    rows = [
      map.node,
      Box({ key: "foot", flexDirection: "row", alignItems: "center", children: [
        Box({ key: "sum", flexGrow: 1, children: [Text({ key: "t", color: theme.muted, wrap: "truncate-end", children: `${map.met} day${map.met === 1 ? "" : "s"} in ${map.weeks} weeks` })] }),
        legend(els, g),
      ] }),
    ];
  } else {
    // A square and a space a day: as many weeks as the card holds.
    const weeks = Math.max(4, Math.min(26, Math.floor((w - 1) / 2)));
    const cols = grid(h, g, now, weeks);
    rows = Array.from({ length: 7 }, (_, d) => Box({ key: `d${d}`, flexDirection: "row", children: cols.map((col, x) => {
      const v = col[d];
      const L = v == null ? 0 : level(v, g.target);
      return Text({ key: `c${x}`, color: L ? TEAL : theme.muted, dimColor: !L || L < 3, children: v == null ? "  " : L ? "■ " : "· " });
    }) }));
  }
  return { name: g.id, node: card(els, { key: `habit-${g.id}`, title: g.name.toUpperCase(), color: TEAL, metaNode, rows }), height: 3 + (els.Svg ? 8 : 7) };
}

function emptyCard(els) {
  const { Text } = els;
  const rows = [
    Text({ key: "a", children: "No habits yet." }),
    Text({ key: "b", color: theme.muted, wrap: "wrap", children: "Type add Read 30 min, or add Water x8 for one done 8 times a day." }),
  ];
  return { name: "empty", node: card(els, { key: "habits-empty", title: "HABITS", color: TEAL, rows }), height: 3 + 3 };
}

export function habitsDock(els, w, capacity, handlers, now) {
  const h = state.habits;
  if (!h.goals.length) return stackCards(els, [emptyCard(els)], capacity, handlers.scroll);
  return stackCards(els, h.goals.map((g) => habitCard(els, h, g, w, handlers, now)), capacity, handlers.scroll);
}

// The inline pane: today's count, then a line a goal with its streak and its button.
export function habitsInline(els, w, handlers, now) {
  const h = state.habits;
  const t = today(h, now);
  const head = line(els, "head", [
    { text: `${HABITS_META.icon} ${HABITS_META.label}`, bold: true, color: TEAL },
    { text: t.total ? `  ${t.done}/${t.total} today` : "  add Read 30 min to start", color: theme.muted, grow: true },
  ]);
  return [head, ...h.goals.map((g) => {
    const { current } = habitStreaks(h, g, now);
    const n = count(h, g, t.day);
    return line(els, `g-${g.id}`, [
      { text: g.name, grow: true, color: doneOn(h, g, t.day) ? TEAL : undefined },
      g.target > 1 ? { text: ` ${n}/${g.target} `, color: theme.muted } : null,
      { text: current ? ` 🔥 ${current} ` : "  ", color: theme.amber, bold: true },
      { node: buttons(els, h, g, handlers, now) },
    ]);
  })];
}

// The goals not done yet: "Water 5/8, Run". With `width`, as many as fit
// and "+3 more" for the rest.
const leftName = (h, g, day) => (g.target > 1 ? `${g.name} ${count(h, g, day)}/${g.target}` : g.name);
function leftText(h, t, sepr, width = Infinity) {
  const names = t.left.map((g) => leftName(h, g, t.day));
  let out = "";
  for (let i = 0; i < names.length; i++) {
    const next = (out ? out + sepr : "") + names[i];
    const more = i + 1 < names.length ? `${sepr}+${names.length - i - 1} more` : "";
    if (out && cells(next + more) > width) return `${out}${sepr}+${names.length - i} more`;
    out = next;
  }
  return out;
}

// The goals' streaks, longest first, the ones running only.
function running(h, now) {
  return h.goals.map((g) => ({ g, ...habitStreaks(h, g, now) })).filter((x) => x.current).sort((a, b) => b.current - a.current);
}

// The terminal's band, after the room's name: "3/5 today · 🔥 Meditate 27 ·
// Read 12 · left: Water 5/8, Run", the list cut to `width` with "+3 more".
export function habitsBandPieces(width = 0) {
  const h = state.habits;
  const now = Date.now();
  const t = today(h, now);
  const sep = { text: " · ", color: theme.muted };
  if (!t.total) return [{ text: "no habits yet: add one in the room", color: theme.muted }];
  const top = running(h, now).slice(0, 2);
  const pieces = [
    { text: `${t.done}/${t.total} today`, color: TEAL, bold: true },
    top.length ? sep : null,
    top.length ? { text: `🔥 ${top.map((x) => `${x.g.name} ${x.current}`).join(" · ")}`, color: theme.amber, bold: true } : null,
    sep,
  ].filter(Boolean);
  const used = pieces.reduce((n, p) => n + cells(p.text), 0);
  const room = width ? Math.max(12, width - used - cells("left: ")) : Infinity;
  pieces.push({ text: t.left.length ? `left: ${leftText(h, t, ", ", room)}` : "all done today", color: theme.muted });
  return pieces;
}

// The desktop's band, as sections for the capsule: today's count with a
// square a goal, the longest streak running, and what's left.
export function habitsBandDesk(now = Date.now()) {
  const h = state.habits;
  const t = today(h, now);
  if (!t.total) return { color: TEAL, sections: [{ key: "empty", color: TEAL, parts: [sub("no habits yet: add one in the room")] }] };
  const dots = h.goals.map((g, i) => `<rect x="${i * 9}" y="1" width="7" height="7" rx="1.5" fill="${doneOn(h, g, t.day) ? TEAL : GREY}" fill-opacity="${doneOn(h, g, t.day) ? 1 : LEVELS[0]}"/>`).join("");
  const squares = { source: K.svg(h.goals.length * 9 - 2, 9, dots), width: h.goals.length * 9 - 2, height: 9 };
  const top = running(h, now)[0];
  const sections = [
    { key: "today", color: TEAL, parts: [value(`${HABITS_META.icon} ${t.done}/${t.total}`, TEAL), draw(squares, `${t.done} of ${t.total} done today`)],
      tip: h.goals.map((g) => `${doneOn(h, g, t.day) ? "✓" : "○"} ${g.name}${g.target > 1 ? ` ${count(h, g, t.day)}/${g.target}` : ""}`) },
    { key: "streak", color: theme.amber, parts: top ? [value(`🔥 ${top.current}`, theme.amber), sub(top.g.name)] : [sub("no streak yet")],
      tip: top ? [`${top.g.name}: ${top.current} day${top.current === 1 ? "" : "s"} in a row`, `best ${top.best} day${top.best === 1 ? "" : "s"}`] : ["Check a habit off today to start one"] },
    // What's left gives way to the rest: cut short, never left out.
    { key: "left", color: TEAL, grow: true, parts: [t.left.length ? msg(`${t.left.length} left: ${leftText(h, t, " · ")}`, { dim: true }) : sub("all done today")],
      tip: t.left.length ? [`${t.left.length} left today`, ...t.left.map((g) => leftName(h, g, t.day))] : null },
  ];
  return { color: TEAL, sections };
}

// The tab's badge from another room: how many are left today.
export function habitsBadge(now = Date.now()) {
  const t = today(state.habits, now);
  return t.total && t.left.length ? { text: String(t.left.length), color: TEAL } : null;
}

// A line of chat for Share.
export function habitsSnapshot(now = Date.now()) {
  const h = state.habits;
  const t = today(h, now);
  if (!t.total) return `${HABITS_META.icon} No habits set up yet.`;
  const top = running(h, now).slice(0, 3).map((x) => `${x.g.name} ${x.current} day${x.current === 1 ? "" : "s"}`);
  const left = t.left.length ? ` Left: ${leftText(h, t, ", ")}.` : " All done today.";
  return `${HABITS_META.icon} ${t.done} of ${t.total} habits done today.${top.length ? ` 🔥 ${top.join(", ")}.` : ""}${left}`;
}

