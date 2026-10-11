// The Usage band on the desktop:
//
//   ◔ Usage │ ☀ 77k │ ▂▅▃█ ▲ +5.3k │ (ring·moon) 5h 31% │ (ring·moon) 7d 58% │ $4.21 │ ▮▮▮▮▯ 98% cache │ ●●○ 2 running
//
// The context leads with the weather and a bar per recent prompt for what it
// added. The rings are "orbits": the arc is the share used, and for a
// rate-limit window a small moon rides the ring at the share of time already
// gone. Arc behind the moon: on pace. Arc past it: using faster than time,
// drawn warm. The terminal keeps its line of text (sysBandPieces).

import { state } from "./state.mjs";
import { theme, level, palette } from "./theme.mjs";
import { limitWindows, cacheRatio, burnRate, agentCounts, isEnded, totalTokens } from "./metrics.mjs";
import { fmtTokens, fmtUsd, resetLabel } from "./widgets.mjs";
import { forecast, shortModel } from "./sysviews.mjs";
import * as K from "./bandkit.mjs";
import { capsule, draw, label, value, sub, sep } from "./bands.mjs";

const WINDOW_MS = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 };
const SHORT = { five_hour: "5h", seven_day: "7d" };
const COLOR = { five_hour: theme.git, seven_day: theme.agents };   // leaf, lilac
const clamp = (pct) => Math.min(100, Math.max(0, Number(pct) || 0));

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

// The sections the band shows, in order; narrow bands lose the extras first.
export function usageSections(now, columns = 100) {
  const u = state.usage;
  const out = [];
  const c = u.context;
  if (c?.percent != null) {
    const f = forecast(c.percent);
    const hist = u.ctxHistory;
    const delta = hist.length >= 2 ? hist.at(-1) - hist.at(-2) : 0;
    const deltas = hist.length >= 2 ? hist.slice(1).map((t, i) => t - hist[i]).slice(columns >= 70 ? -8 : -4) : [];
    const head = `${f.icon} ${f.word} · ${Math.round(c.percent)}% of the context`;
    out.push({
      key: "ctx",
      color: f.color,
      parts: [
        draw(K.weather(f.icon, f.color), head),
        value(fmtTokens(c.tokens)),
        deltas.length ? sep() : null,
        deltas.length ? draw(K.bars(deltas, f.color), `Tokens added by the last ${deltas.length} prompts`) : null,
        delta ? sub(delta > 0 ? `▲ +${fmtTokens(delta)}` : `▼ −${fmtTokens(-delta)}`) : null,
      ],
      tip: [
        head,
        `${fmtTokens(c.tokens)} of ${fmtTokens(c.window)} tokens`,
        delta ? `last turn ${delta > 0 ? "+" : "−"}${fmtTokens(Math.abs(delta))}` : null,
        u.model ? shortModel(u.model) : null,
      ],
    });
  }
  for (const l of limitWindows(u).filter((l) => WINDOW_MS[l.kind])) {
    if (l.kind === "seven_day" && columns < 50) continue;
    const used = l.percentUsed;
    const elapsed = elapsedOf(l, now);
    const pace = paceWord(used, elapsed);
    const head = `${l.kind === "five_hour" ? "5-hour" : "7-day"} window · ${used == null ? "no reading yet" : `${Math.round(used)}% used`}`;
    out.push({
      key: l.kind,
      color: COLOR[l.kind],
      parts: [
        draw(K.orbit(used, COLOR[l.kind], { elapsed, warm: level(Math.max(used ?? 0, 60)) }), head),
        label(SHORT[l.kind]),
        value(used == null ? "–" : `${Math.round(used)}%`, used != null && used >= 85 ? theme.error : undefined),
      ],
      tip: [
        head,
        elapsed != null ? `${Math.round(elapsed)}% of the time gone` : null,
        pace,
        l.resetsAt ? `resets ${resetLabel(l.resetsAt, new Date(now))}` : null,
      ],
    });
  }
  if (u.cost?.usd > 0) {
    const rate = burnRate(u, now);
    out.push({
      key: "spend",
      color: theme.amber,
      parts: [value(fmtUsd(u.cost.usd)), rate != null && rate > 0 ? sub(`${fmtUsd(rate)}/h`) : null],
      tip: [
        `${fmtUsd(u.cost.usd)} this session`,
        rate != null ? `${fmtUsd(rate)} an hour, over the last 15 min` : null,
        `${fmtTokens(totalTokens(u))} tokens in all`,
        u.hasLimits ? "API-price equivalent on a subscription" : null,
      ],
    });
  }
  const cache = cacheRatio(u);
  if (cache != null && columns >= 60) {
    out.push({
      key: "cache",
      color: palette.teal,
      parts: [draw(K.cells(cache, palette.teal), `${Math.round(cache)}% of input read from the cache`), value(`${Math.round(cache)}%`), sub("cache")],
      tip: [
        `${Math.round(cache)}% of input read from the cache`,
        `${fmtTokens(u.tokens.cacheRead)} read · ${fmtTokens(u.tokens.cacheWrite)} written · ${fmtTokens(u.tokens.input)} fresh`,
      ],
    });
  }
  const agents = [...u.agents.values()];
  if (agents.length && columns >= 60) {
    const { running, done } = agentCounts(u);
    const marks = agents.map((a) => (!isEnded(a.status) ? "live" : a.status === "completed" ? "done" : "failed"));
    out.push({
      key: "agents",
      color: theme.agents,
      parts: [
        draw(K.dots(marks, theme.agents), `${running} running · ${done} done`),
        value(running ? `${running}` : `${done}`),
        sub(running ? "running" : "done"),
        agents.length > 6 ? sub(`+${agents.length - 6}`) : null,
      ],
      tip: [
        `${running} running · ${done} done`,
        ...agents.slice(-5).map((a) => `${isEnded(a.status) ? (a.status === "completed" ? "✓" : "✗") : "●"} ${a.type}: ${a.description ?? ""}`),
      ],
    });
  }
  return out;
}

// Null before any figure, so the caller keeps its text line ("waiting for
// the first reply").
export function usageBandDesktop(els, props, { onOpen }, now = Date.now()) {
  const columns = props.bodyColumns || 100;
  const sections = usageSections(now, columns);
  if (!sections.length) return null;
  return capsule(els, { room: "◔ Usage", color: theme.usage, sections, onOpen, columns });
}
