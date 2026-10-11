// The Usage band on the desktop: one capsule above the prompt instead of a
// line of text. Each figure is a section with a small drawing, and hovering
// one opens a card with the detail.
//
//   ◔ Usage │ ☀ 77k │ ▂▅▃█ ▲ +5.3k │ (ring·moon) 5h 31% │ (ring·moon) 7d 58% │ $4.21 │ ▮▮▮▮▯ cache │ ●●○ agents
//
// The context leads with the weather (drawn here, after the terminal's ☀ ☁ ☂
// ☇ ↯) and a bar per recent prompt for what it added. The rings are
// "orbits": the arc is the share used, and for a rate-limit window a small moon rides the ring at the share of time already gone. Arc
// behind the moon: on pace. Arc past it: using faster than time, drawn warm.
// The terminal keeps its line of text (sysBandPieces).

import { state } from "./state.mjs";
import { theme, level } from "./theme.mjs";
import { limitWindows, cacheRatio, burnRate, agentCounts, isEnded, totalTokens } from "./metrics.mjs";
import { fmtTokens, fmtUsd, resetLabel } from "./widgets.mjs";
import { forecast, shortModel } from "./sysviews.mjs";

const WINDOW_MS = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 };
const SHORT = { five_hour: "5h", seven_day: "7d" };
const COLOR = { five_hour: theme.git, seven_day: theme.agents };   // leaf, lilac
const TEAL = "#6FC2B5";
const TRACK = "rgba(127,127,127,0.25)";
const RING = 18;
const MAX_DOTS = 6;

// "#7FB6E2" at `a` opacity.
function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const clamp = (pct) => Math.min(100, Math.max(0, Number(pct) || 0));

// ---------------------------------------------------------------- drawings

// An arc on a circle of radius r around (c, c), from `from`% to `to`% clockwise from the top.
function arc(c, r, from, to, color, width) {
  const len = 2 * Math.PI * r;
  const a = (clamp(to) - clamp(from)) / 100 * len;
  if (a <= 0) return "";
  const off = -(clamp(from) / 100) * len;
  return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ` +
    `stroke-dasharray="${a.toFixed(2)} ${len.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
}

// The orbit: track, the used arc (on pace up to the moon, warm past it), the moon.
export function orbitSvg(used, color, elapsed = null) {
  const c = RING / 2;
  const r = 6.5;
  const w = 2.6;
  let body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${w}"/>`;
  if (used != null) {
    if (elapsed == null || used <= elapsed) body += arc(c, r, 0, used, color, w);
    else body += arc(c, r, elapsed, used, level(Math.max(used, 60)), w) + arc(c, r, 0, elapsed, color, w);
  }
  if (elapsed != null) {
    const t = (clamp(elapsed) / 100) * 2 * Math.PI;
    const x = c + r * Math.sin(t);
    const y = c - r * Math.cos(t);
    body += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.3" fill="${color}" stroke="rgba(255,255,255,0.85)" stroke-width="1"/>`;
  }
  return svg(RING, RING, body);
}

// The weather, drawn: a sun with dotted rays, a cloud, an umbrella, a cloud
// with a bolt, and two arrows pressing in for "compact soon".
const WEATHER = {
  "☀": (c) => `<circle cx="9" cy="9" r="3.6" fill="${c}"/>` +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const t = (a * Math.PI) / 180;
      return `<circle cx="${(9 + 6.6 * Math.cos(t)).toFixed(2)}" cy="${(9 + 6.6 * Math.sin(t)).toFixed(2)}" r="1.15" fill="${c}"/>`;
    }).join(""),
  "☁": (c) => `<path d="M5 14h8.6a3.4 3.4 0 0 0 .2-6.8A4.6 4.6 0 0 0 5 8.3 2.9 2.9 0 0 0 5 14z" fill="${c}"/>`,
  "☂": (c) => `<path d="M2 9.5a7 7 0 0 1 14 0z" fill="${c}"/><path d="M9 9.5v5a1.8 1.8 0 0 1-3.6 0" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  "☇": (c) => `<path d="M4.4 11h8.8a3 3 0 0 0 .2-6A4.2 4.2 0 0 0 5 5.6 2.7 2.7 0 0 0 4.4 11z" fill="${c}" fill-opacity="0.55"/><path d="M9.8 8.5 7 12.6h2.6L8.4 16.5l3.4-4.9H9.2z" fill="${c}"/>`,
  "↯": (c) => `<path d="M2.5 4.5 7 9l-4.5 4.5M15.5 4.5 11 9l4.5 4.5" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 3v12" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.5 2.5"/>`,
};
export function weatherSvg(icon, color) {
  return svg(18, 18, (WEATHER[icon] ?? WEATHER["☁"])(color));
}

// What each recent prompt added to the context, a bar each: the latest in the
// weather's color, the ones before it in grey.
const BAR = { w: 4, gap: 2, h: 14 };
export function barsWidth(n) {
  return Math.max(1, n) * (BAR.w + BAR.gap) - BAR.gap;
}
export function barsSvg(deltas, color) {
  const max = Math.max(...deltas, 1);
  const body = deltas.map((d, i) => {
    const h = Math.max(2, (Math.max(0, d) / max) * BAR.h);
    const last = i === deltas.length - 1;
    return `<rect x="${i * (BAR.w + BAR.gap)}" y="${(BAR.h - h).toFixed(1)}" width="${BAR.w}" height="${h.toFixed(1)}" rx="1.2" fill="${last ? color : "rgba(127,127,127,0.45)"}"/>`;
  }).join("");
  return svg(barsWidth(deltas.length), BAR.h, body);
}

// The cache's share of input as five cells, like a battery.
export function cellsSvg(pct, color) {
  const n = 5;
  const lit = Math.round((clamp(pct) / 100) * n);
  let body = "";
  for (let i = 0; i < n; i++) body += `<rect x="${i * 5.5 + 0.5}" y="1.5" width="4" height="11" rx="1.3" fill="${i < lit ? color : TRACK}"/>`;
  return svg(n * 5.5, 14, body);
}

// One dot per subagent: the running ones breathe, the finished ones are rings.
export function dotsSvg(agents) {
  const shown = agents.slice(0, MAX_DOTS);
  const W = Math.max(8, shown.length * 9);
  const body = shown.map((a, i) => {
    const x = i * 9 + 4.5;
    if (!isEnded(a.status)) {
      return `<circle cx="${x}" cy="7" r="3.4" fill="${theme.agents}"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
    }
    const color = a.status === "completed" ? theme.agents : theme.error;
    return `<circle cx="${x}" cy="7" r="2.9" fill="none" stroke="${color}" stroke-width="1.4"/>`;
  }).join("");
  return svg(W, 14, body);
}

// ---------------------------------------------------------------- figures

// How much of a window's time is gone, 0-100, or null when unknown.
function elapsedOf(l, now) {
  const len = WINDOW_MS[l.kind];
  const end = Date.parse(l.resetsAt ?? "");
  if (!len || Number.isNaN(end)) return null;
  return clamp(100 - ((end - now) / len) * 100);
}

function paceWord(used, elapsed) {
  if (used == null || elapsed == null) return null;
  const gap = Math.round(used - elapsed);
  if (gap > 2) return `${gap} pts ahead of the clock`;
  if (gap < -2) return `${-gap} pts of room against the clock`;
  return "right on pace";
}

// ---------------------------------------------------------------- the capsule

// The sections the band shows, in order; narrow bands lose the extras first.
export function usageSections(now, columns = 100) {
  const u = state.usage;
  const out = [];
  const c = u.context;
  if (c?.percent != null) {
    const f = forecast(c.percent);
    const hist = u.ctxHistory;
    const delta = hist.length >= 2 ? hist.at(-1) - hist.at(-2) : 0;
    out.push({
      key: "ctx",
      color: f.color,
      weather: f.icon,
      value: fmtTokens(c.tokens),
      bars: hist.length >= 2 ? hist.slice(1).map((t, i) => t - hist[i]).slice(columns >= 70 ? -8 : -4) : null,
      sub: delta ? (delta > 0 ? `▲ +${fmtTokens(delta)}` : `▼ −${fmtTokens(-delta)}`) : null,
      tip: [
        `${f.icon} ${f.word} · ${Math.round(c.percent)}% of the context`,
        `  ${fmtTokens(c.tokens)} of ${fmtTokens(c.window)} tokens`,
        delta ? `  last turn ${delta > 0 ? "+" : "−"}${fmtTokens(Math.abs(delta))}` : null,
        u.model ? `  ${shortModel(u.model)}` : null,
      ],
    });
  }
  for (const l of limitWindows(u).filter((l) => WINDOW_MS[l.kind])) {
    if (l.kind === "seven_day" && columns < 50) continue;
    const used = l.percentUsed;
    const elapsed = elapsedOf(l, now);
    const pace = paceWord(used, elapsed);
    out.push({
      key: l.kind,
      color: COLOR[l.kind],
      ring: { used, elapsed },
      label: SHORT[l.kind],
      value: used == null ? "–" : `${Math.round(used)}%`,
      valueColor: used != null && used >= 85 ? theme.error : undefined,
      tip: [
        `${l.kind === "five_hour" ? "5-hour" : "7-day"} window · ${used == null ? "no reading yet" : `${Math.round(used)}% used`}`,
        elapsed != null ? `  ${Math.round(elapsed)}% of the time gone` : null,
        pace ? `  ${pace}` : null,
        l.resetsAt ? `  resets ${resetLabel(l.resetsAt, new Date(now))}` : null,
      ],
    });
  }
  if (u.cost?.usd > 0) {
    const rate = burnRate(u, now);
    out.push({
      key: "spend",
      color: theme.amber,
      value: fmtUsd(u.cost.usd),
      sub: rate != null && rate > 0 ? `${fmtUsd(rate)}/h` : null,
      tip: [
        `${fmtUsd(u.cost.usd)} this session`,
        rate != null ? `  ${fmtUsd(rate)} an hour, over the last 15 min` : null,
        `  ${fmtTokens(totalTokens(u))} tokens in all`,
        state.usage.hasLimits ? "  API-price equivalent on a subscription" : null,
      ],
    });
  }
  const cache = cacheRatio(u);
  if (cache != null && columns >= 60) {
    out.push({
      key: "cache",
      color: TEAL,
      cells: cache,
      value: `${Math.round(cache)}%`,
      sub: "cache",
      tip: [
        `${Math.round(cache)}% of input read from the cache`,
        `  ${fmtTokens(u.tokens.cacheRead)} read · ${fmtTokens(u.tokens.cacheWrite)} written · ${fmtTokens(u.tokens.input)} fresh`,
      ],
    });
  }
  const agents = [...u.agents.values()];
  if (agents.length && columns >= 60) {
    const { running, done } = agentCounts(u);
    out.push({
      key: "agents",
      color: theme.agents,
      dots: agents,
      value: running ? `${running}` : `${done}`,
      sub: running ? "running" : "done",
      tip: [
        `${running} running · ${done} done`,
        ...agents.slice(-5).map((a) => `  ${isEnded(a.status) ? (a.status === "completed" ? "✓" : "✗") : "●"} ${a.type}: ${a.description ?? ""}`),
      ],
    });
  }
  return out;
}

// The card a section opens on hover: placed above the band, hidden until then.
function hoverCard({ Box, Text }, color, lines) {
  return Box({
    position: "absolute",
    bottom: 1,
    left: 0,
    display: "none",
    hover: { display: "flex" },
    flexDirection: "column",
    paddingX: 1,
    borderStyle: "round",
    borderColor: tint(color, 0.55),
    backgroundColor: "background",
    children: lines.filter(Boolean).map((t, i) => (t.startsWith("  ")
      ? Text({ key: `t${i}`, color: theme.muted, children: t.trim() })
      : Text({ key: `t${i}`, bold: true, color, children: t }))),
  });
}

function section(els, s) {
  const { Box, Text, Svg } = els;
  const parts = [];
  if (s.weather) parts.push(Svg({ key: "wx", source: weatherSvg(s.weather, s.color), alt: s.tip[0], width: 18, height: 18 }));
  if (s.ring) parts.push(Svg({ key: "ring", source: orbitSvg(s.ring.used, s.color, s.ring.elapsed ?? null), alt: s.tip[0], width: RING, height: RING }));
  if (s.cells != null) parts.push(Svg({ key: "cells", source: cellsSvg(s.cells, s.color), alt: s.tip[0], width: 28, height: 14 }));
  if (s.dots) parts.push(Svg({ key: "dots", source: dotsSvg(s.dots), alt: s.tip[0], width: Math.max(8, Math.min(MAX_DOTS, s.dots.length) * 9), height: 14, isInteractive: true }));
  if (s.label) parts.push(Text({ key: "l", color: theme.muted, children: s.label }));
  parts.push(Text({ key: "v", bold: true, ...(s.valueColor ? { color: s.valueColor } : {}), children: s.value }));
  if (s.bars) {
    parts.push(Text({ key: "bsep", color: theme.muted, children: "│" }));
    parts.push(Svg({ key: "bars", source: barsSvg(s.bars, s.color), alt: `Tokens added by the last ${s.bars.length} prompts`, width: barsWidth(s.bars.length), height: BAR.h }));
  }
  if (s.sub) parts.push(Text({ key: "s", color: theme.muted, children: s.sub }));
  if (s.key === "agents" && s.dots.length > MAX_DOTS) parts.push(Text({ key: "more", color: theme.muted, children: `+${s.dots.length - MAX_DOTS}` }));
  return Box({
    key: `ub-${s.key}`,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 1,
    flexShrink: 0,
    paddingX: 1,
    hover: { backgroundColor: tint(s.color, 0.16) },
    children: [...parts, hoverCard(els, s.color, s.tip)],
  });
}

// The whole band: the capsule, then the Open button. Null before any figure,
// so the caller keeps its text line ("waiting for the first reply").
export function usageBandDesktop(els, props, { onOpen }, now = Date.now()) {
  const { Box, Text, Button } = els;
  const list = usageSections(now, props.bodyColumns || 100);
  if (!list.length) return null;
  const children = [Box({ key: "ub-room", flexShrink: 0, paddingX: 1, children: [Text({ key: "t", bold: true, color: theme.usage, children: "◔ Usage" })] })];
  for (const s of list) {
    children.push(Box({ key: `ub-sep-${s.key}`, flexShrink: 0, children: [Text({ key: "t", color: theme.muted, children: "│" })] }));
    children.push(section(els, s));
  }
  return Box({ flexDirection: "row", alignItems: "center", children: [
    Box({
      key: "ub",
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
      borderStyle: "round",
      borderColor: tint(theme.usage, 0.35),
      backgroundColor: tint(theme.usage, 0.07),
      paddingY: 0,
      children,
    }),
    Box({ key: "gap", flexGrow: 1 }),
    Box({ key: "open-box", flexShrink: 0, marginLeft: 1, children: [Button({ key: "open", label: "Open", variant: "primary", onPress: onOpen })] }),
  ] });
}
