// Small drawings for the desktop bands: each returns an <svg> string for an
// Svg element. Colors come in as hex from theme.mjs; greys are translucent so
// one drawing reads on light and dark themes alike.

import { theme } from "./theme.mjs";

export const GREY = "rgba(127,127,127,0.45)";
export const TRACK = "rgba(127,127,127,0.25)";

export const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const clamp = (pct) => Math.min(100, Math.max(0, Number(pct) || 0));
const f1 = (n) => n.toFixed(1);

// "#7FB6E2" at `a` opacity.
export function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- shapes

// Bars, oldest first: the latest in `color`, the rest grey (or each its own
// color when `colors` is given). Heights scale from zero to the largest.
export function bars(values, color, { w = 4, gap = 2, h = 14, colors = null, all = false } = {}) {
  const max = Math.max(...values, 1);
  const width = Math.max(1, values.length) * (w + gap) - gap;
  const body = values.map((v, i) => {
    const bh = Math.max(2, (Math.max(0, v) / max) * h);
    const fill = colors?.[i] ?? (all || i === values.length - 1 ? color : GREY);
    return `<rect x="${i * (w + gap)}" y="${f1(h - bh)}" width="${w}" height="${f1(bh)}" rx="1.2" fill="${fill}"/>`;
  }).join("");
  return { source: svg(width, h, body), width, height: h };
}

// A line with a fading fill under it, ending in a dot.
export function area(values, color, { w = 40, h = 14 } = {}) {
  const vals = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(1e-9, max - min);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 3) + 1.5, h - 2 - ((v - min) / span) * (h - 4)]);
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C${f1(mx)} ${f1(pts[i - 1][1])} ${f1(mx)} ${f1(pts[i][1])} ${f1(pts[i][0])} ${f1(pts[i][1])}`;
  }
  const last = pts.at(-1);
  const id = "a" + color.replace(/[^0-9a-z]/gi, "");
  return {
    source: svg(w, h,
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.4"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
      `<path d="${d} L${f1(last[0])} ${h} L${f1(pts[0][0])} ${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<circle cx="${f1(last[0])}" cy="${f1(last[1])}" r="1.8" fill="${color}"/>`),
    width: w,
    height: h,
  };
}

// An arc on a circle, `from`% to `to`% clockwise from the top.
function arc(c, r, from, to, color, width) {
  const len = 2 * Math.PI * r;
  const a = ((clamp(to) - clamp(from)) / 100) * len;
  if (a <= 0) return "";
  return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ` +
    `stroke-dasharray="${a.toFixed(2)} ${len.toFixed(2)}" stroke-dashoffset="${(-(clamp(from) / 100) * len).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
}

// The orbit: the used arc, and a moon at the share of time gone (optional).
// Past the moon the arc turns `warm`.
export function orbit(used, color, { elapsed = null, warm = theme.amber, size = 18 } = {}) {
  const c = size / 2;
  const r = size / 2 - 2.5;
  let body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.6"/>`;
  if (used != null) {
    if (elapsed == null || used <= elapsed) body += arc(c, r, 0, used, color, 2.6);
    else body += arc(c, r, elapsed, used, warm, 2.6) + arc(c, r, 0, elapsed, color, 2.6);
  }
  if (elapsed != null) {
    const t = (clamp(elapsed) / 100) * 2 * Math.PI;
    body += `<circle cx="${f1(c + r * Math.sin(t))}" cy="${f1(c - r * Math.cos(t))}" r="2.3" fill="${color}" stroke="rgba(255,255,255,0.85)" stroke-width="1"/>`;
  }
  return { source: svg(size, size, body), width: size, height: size };
}

// A ring split into colored parts, as many as there are counts: CI checks.
export function segments(parts, { size = 18 } = {}) {
  const c = size / 2;
  const r = size / 2 - 2.5;
  const total = parts.reduce((n, p) => n + p.n, 0);
  let body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.6"/>`;
  let at = 0;
  for (const p of parts) {
    if (!p.n) continue;
    const span = (p.n / total) * 100;
    body += arc(c, r, at + 2, at + span - 2, p.color, 2.6);
    at += span;
  }
  return { source: svg(size, size, body), width: size, height: size };
}

// Cells lit by a share: a battery of five.
export function cells(pct, color, { n = 5 } = {}) {
  const lit = Math.round((clamp(pct) / 100) * n);
  let body = "";
  for (let i = 0; i < n; i++) body += `<rect x="${i * 5.5 + 0.5}" y="1.5" width="4" height="11" rx="1.3" fill="${i < lit ? color : TRACK}"/>`;
  return { source: svg(n * 5.5, 14, body), width: n * 5.5, height: 14 };
}

// The moving drawings move by CSS inside the SVG, which runs where it's
// drawn as a plain image. SMIL needed isInteractive, a frame of its own,
// and the desktop built that frame again on every redraw (a second, while
// anything ran): the drawing went blank for an instant each time.
const css = (rules) => `<style>[class]{transform-box:fill-box}${rules}</style>`;

// Dots that breathe while alive, rings once done, red rings when failed.
export function dots(list, color, { max = 6 } = {}) {
  const shown = list.slice(0, max);
  const width = Math.max(8, shown.length * 9);
  const live = list.includes("live");
  const body = shown.map((s, i) => {
    const x = i * 9 + 4.5;
    if (s === "live") return `<circle class="b" cx="${x}" cy="7" r="3.4" fill="${color}" style="animation-delay:${(i * 0.25).toFixed(2)}s"/>`;
    if (s === "idle") return `<circle cx="${x}" cy="7" r="3.4" fill="${color}" fill-opacity="0.35"/>`;
    return `<circle cx="${x}" cy="7" r="2.9" fill="none" stroke="${s === "failed" ? theme.error : color}" stroke-width="1.4"/>`;
  }).join("");
  const style = live ? css(".b{animation:b 1.6s ease-in-out infinite}@keyframes b{50%{opacity:.3}}") : "";
  return { source: svg(width, 14, style + body), width, height: 14 };
}

// Faces, overlapping: each a circle in its person's color with an initial.
export function faces(people, { max = 4 } = {}) {
  const shown = people.slice(0, max);
  const width = Math.max(16, shown.length * 11 + 5);
  const body = shown.map((p, i) => {
    const x = i * 11 + 8;
    return `<circle cx="${x}" cy="8" r="7" fill="${p.color}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>` +
      `<text x="${x}" y="11.2" font-size="9" font-weight="700" font-family="-apple-system,Helvetica,Arial,sans-serif" text-anchor="middle" fill="#1F1E1D">${p.initial}</text>`;
  }).join("");
  return { source: svg(width, 16, body), width, height: 16 };
}

// Three dots bouncing in turn: someone typing.
export function typing(color) {
  const style = css(".t{animation:t 1s ease-in-out infinite}@keyframes t{50%{transform:translateY(-3px)}}");
  const body = [0, 1, 2].map((i) => `<circle class="t" cx="${3 + i * 6}" cy="7" r="2" fill="${color}" style="animation-delay:${(i * 0.15).toFixed(2)}s"/>`).join("");
  return { source: svg(16, 12, style + body), width: 16, height: 12 };
}

// An equalizer: bars dancing while playing, low and still when paused.
export function equalizer(color, playing) {
  const hs = [9, 5, 12, 7, 10];
  const body = hs.map((h, i) => {
    const x = i * 4;
    if (!playing) return `<rect x="${x}" y="11" width="2.6" height="3" rx="1" fill="${color}" fill-opacity="0.6"/>`;
    // A full-height bar scaled from its foot: the heights each bar runs through.
    const vals = [h, 3, h * 0.6, 13, h].map((v) => Math.max(2, Math.min(13, v)) / 13);
    const frames = vals.map((v, k) => `${k * 25}%{transform:scaleY(${v.toFixed(2)})}`).join("");
    return `<style>@keyframes e${i}{${frames}}</style>`
      + `<rect class="e" x="${x}" y="1" width="2.6" height="13" rx="1" fill="${color}" style="animation:e${i} ${(0.9 + i * 0.13).toFixed(2)}s linear infinite"/>`;
  }).join("");
  const style = playing ? css(".e{transform-origin:50% 100%}") : "";
  return { source: svg(19, 14, style + body), width: 19, height: 14 };
}

// A thin progress line with a knob.
export function progress(pct, color, { w = 46 } = {}) {
  const x = 2 + (clamp(pct) / 100) * (w - 4);
  return {
    source: svg(w, 8, `<rect x="2" y="3" width="${w - 4}" height="2" rx="1" fill="${TRACK}"/><rect x="2" y="3" width="${f1(x - 2)}" height="2" rx="1" fill="${color}"/><circle cx="${f1(x)}" cy="4" r="2.6" fill="${color}"/>`),
    width: w,
    height: 8,
  };
}

// A drop filled to a share: the chance of rain.
export function drop(pct, color) {
  const fill = 2 + (1 - clamp(pct) / 100) * 13;
  const shape = "M7 1.5C7 1.5 2 7.6 2 10.8a5 5 0 0 0 10 0C12 7.6 7 1.5 7 1.5z";
  return {
    source: svg(14, 16, `<defs><clipPath id="d"><path d="${shape}"/></clipPath></defs><path d="${shape}" fill="${TRACK}"/>` +
      `<rect x="0" y="${f1(fill)}" width="14" height="16" fill="${color}" clip-path="url(#d)"/><path d="${shape}" fill="none" stroke="${color}" stroke-width="1.2"/>`),
    width: 14,
    height: 16,
  };
}

// A battery with its charge, and a bolt while charging.
export function battery(pct, color, charging) {
  const w = 12 * (clamp(pct) / 100);
  return {
    source: svg(20, 12, `<rect x="0.75" y="1.75" width="15.5" height="8.5" rx="2" fill="none" stroke="${GREY}" stroke-width="1.5"/><rect x="17" y="4.5" width="2" height="3" rx="0.8" fill="${GREY}"/>` +
      `<rect x="2.5" y="3.5" width="${f1(w)}" height="5" rx="1" fill="${color}"/>` +
      (charging ? `<path d="M9.5 1 6.5 6.5h2.5L8 11l3.5-5.6H9z" fill="#ECE7E1" stroke="rgba(0,0,0,0.35)" stroke-width="0.6"/>` : "")),
    width: 20,
    height: 12,
  };
}

// A thermometer, filled toward hot.
export function thermometer(c, color) {
  const level = Math.min(1, Math.max(0, (c - 30) / 70));
  const top = 11 - level * 8;
  return {
    source: svg(10, 16, `<rect x="3" y="1" width="4" height="11" rx="2" fill="none" stroke="${GREY}" stroke-width="1.3"/><rect x="4.3" y="${f1(top)}" width="1.4" height="${f1(12 - top)}" fill="${color}"/><circle cx="5" cy="12.5" r="2.6" fill="${color}"/>`),
    width: 10,
    height: 16,
  };
}

// ---------------------------------------------------------------- icons

const ICONS = {
  // Two branches meeting: git.
  branch: (c) => `<circle cx="5" cy="3.5" r="2" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="5" cy="14.5" r="2" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="13" cy="5.5" r="2" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M5 5.5v7M13 7.5c0 3-4 3.5-7.4 5.6" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  // A pull request: two dots and a curved arrow.
  pr: (c) => `<circle cx="4.5" cy="4" r="2" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="4.5" cy="14" r="2" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="13.5" cy="14" r="2" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M4.5 6v6M13.5 12V7a2.5 2.5 0 0 0-2.5-2.5H8M9.8 2.6 7.8 4.5l2 1.9" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Papers, stacked: snippets.
  stack: (c) => `<rect x="5" y="2" width="10" height="12" rx="2" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="1.4"/><rect x="2.5" y="4.5" width="10" height="12" rx="2" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.4"/><path d="M5.5 9h4M5.5 12h2.5" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  // A flame: what's hot on the news.
  flame: (c) => `<path d="M9 1.5c.6 3-2.8 4.6-2.8 8a2.8 2.8 0 0 0 5.6.3c0-1.2-.5-2-1-2.6 2.4.8 3.7 3 3.7 5.1A5.5 5.5 0 0 1 3.5 12c0-5 5.5-6.3 5.5-10.5z" fill="${c}" fill-opacity="0.85"/>`,
  // A chip: the CPU.
  chip: (c) => `<rect x="4" y="4" width="10" height="10" rx="2" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="1.5"/><rect x="7" y="7" width="4" height="4" rx="0.8" fill="${c}"/><path d="M7 1.5v2M11 1.5v2M7 14.5v2M11 14.5v2M1.5 7h2M1.5 11h2M14.5 7h2M14.5 11h2" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  // Arrows down and up: the network.
  net: (c) => `<path d="M5.5 2.5v12M2 11l3.5 3.5L9 11" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 15.5v-12M9 7l3.5-3.5L16 7" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`,
  // A window of sessions: Agents.
  spark: (c) => `<path d="M9 1.5l1.7 5 5 1.7-5 1.7L9 15l-1.7-5.1-5-1.7 5-1.7z" fill="${c}" fill-opacity="0.85"/>`,
  // A clock: when the market opens.
  clock: (c) => `<circle cx="9" cy="9" r="6.5" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M9 5.5V9l2.4 1.6" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
};
export function icon(name, color, size = 16) {
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 18 18">${ICONS[name](color)}</svg>`, width: size, height: size };
}

// The weather, drawn after the terminal's single-cell symbols: a sun with
// dotted rays, a cloud, an umbrella, a cloud with a bolt, arrows pressing in,
// and for the Weather room rain, snow and fog.
const WEATHER = {
  sun: (c) => `<circle cx="9" cy="9" r="3.6" fill="${c}"/>` +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const t = (a * Math.PI) / 180;
      return `<circle cx="${(9 + 6.6 * Math.cos(t)).toFixed(2)}" cy="${(9 + 6.6 * Math.sin(t)).toFixed(2)}" r="1.15" fill="${c}"/>`;
    }).join(""),
  cloud: (c) => `<path d="M5 14h8.6a3.4 3.4 0 0 0 .2-6.8A4.6 4.6 0 0 0 5 8.3 2.9 2.9 0 0 0 5 14z" fill="${c}"/>`,
  partly: (c) => `<circle cx="6.5" cy="6" r="3" fill="${theme.amber}"/><path d="M6 15h7.8a3 3 0 0 0 .2-6A4.1 4.1 0 0 0 6 9.6 2.7 2.7 0 0 0 6 15z" fill="${c}"/>`,
  umbrella: (c) => `<path d="M2 9.5a7 7 0 0 1 14 0z" fill="${c}"/><path d="M9 9.5v5a1.8 1.8 0 0 1-3.6 0" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  rain: (c) => `<path d="M4.4 10h8.8a3 3 0 0 0 .2-6A4.2 4.2 0 0 0 5 4.6 2.7 2.7 0 0 0 4.4 10z" fill="${c}"/><path d="M6 12.5l-1 2.5M9.5 12.5l-1 2.5M13 12.5l-1 2.5" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
  snow: (c) => `<path d="M4.4 10h8.8a3 3 0 0 0 .2-6A4.2 4.2 0 0 0 5 4.6 2.7 2.7 0 0 0 4.4 10z" fill="${c}"/><circle cx="6" cy="13.5" r="1.1" fill="${c}"/><circle cx="9.5" cy="15" r="1.1" fill="${c}"/><circle cx="13" cy="13.5" r="1.1" fill="${c}"/>`,
  storm: (c) => `<path d="M4.4 11h8.8a3 3 0 0 0 .2-6A4.2 4.2 0 0 0 5 5.6 2.7 2.7 0 0 0 4.4 11z" fill="${c}" fill-opacity="0.55"/><path d="M9.8 8.5 7 12.6h2.6L8.4 16.5l3.4-4.9H9.2z" fill="${c}"/>`,
  moon: (c) => `<path d="M12.5 2.5a6.5 6.5 0 1 0 3 11.4A5.5 5.5 0 0 1 12.5 2.5z" fill="${c}"/>`,
  fog: (c) => `<path d="M3 6h12M2 9.5h14M4 13h10" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`,
  compact: (c) => `<path d="M2.5 4.5 7 9l-4.5 4.5M15.5 4.5 11 9l4.5 4.5" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 3v12" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.5 2.5"/>`,
};
// The terminal's symbols, and open-meteo's, to a drawing.
const WEATHER_OF = { "☾": "moon", "≡": "fog", "☀": "sun", "☁": "cloud", "☂": "umbrella", "☇": "storm", "↯": "compact", "⛅": "partly", "🌤": "partly", "🌧": "rain", "🌦": "rain", "❄": "snow", "🌨": "snow", "⛈": "storm", "🌫": "fog" };
export function weather(symbol, color, size = 18) {
  const draw = WEATHER[WEATHER_OF[symbol] ?? symbol] ?? WEATHER.cloud;
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 18 18">${draw(color)}</svg>`, width: size, height: size };
}
