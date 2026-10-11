// The Usage band on the desktop: one capsule above the prompt instead of a
// line of text. Each figure is a section with a small drawing, and hovering
// one opens a card with the detail.
//
//   ◔ Usage │ (ring) 77k ⌒⌒ │ (ring·moon) 5h 31% │ (ring·moon) 7d 58% │ $4.21 │ ▮▮▮▮▯ cache │ ●●○ agents
//
// The rings are "orbits": the arc is the share used, and for a rate-limit
// window a small moon rides the ring at the share of time already gone. Arc
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

// The context after each turn as a soft hill: a line with a fading fill.
export function hillSvg(values, color) {
  const W = 38;
  const H = 14;
  const vals = values.slice(-10);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * (W - 2) + 1, H - 2 - ((v - min) / span) * (H - 4)]);
  // A smooth path through the points: each segment a curve with level handles.
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const last = pts.at(-1);
  const area = `${d} L${last[0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H}Z`;
  return svg(W, H,
    `<defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#h)"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.9" fill="${color}"/>`);
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
      ring: { used: c.percent },
      value: fmtTokens(c.tokens),
      hill: columns >= 70 && hist.length >= 2 ? hist : null,
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
  if (s.ring) parts.push(Svg({ key: "ring", source: orbitSvg(s.ring.used, s.color, s.ring.elapsed ?? null), alt: s.tip[0], width: RING, height: RING }));
  if (s.cells != null) parts.push(Svg({ key: "cells", source: cellsSvg(s.cells, s.color), alt: s.tip[0], width: 28, height: 14 }));
  if (s.dots) parts.push(Svg({ key: "dots", source: dotsSvg(s.dots), alt: s.tip[0], width: Math.max(8, Math.min(MAX_DOTS, s.dots.length) * 9), height: 14, isInteractive: true }));
  if (s.label) parts.push(Text({ key: "l", color: theme.muted, children: s.label }));
  parts.push(Text({ key: "v", bold: true, ...(s.valueColor ? { color: s.valueColor } : {}), children: s.value }));
  if (s.hill) parts.push(Svg({ key: "hill", source: hillSvg(s.hill, s.color), alt: "Context after each turn", width: 38, height: 14 }));
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
