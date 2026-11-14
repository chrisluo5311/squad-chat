// The Usage band on the desktop:
//
//   ◔ Usage │ ☀ 77k │ ▂▅▃█ ▲ +5.3k │ (ring·moon) 5h 31% │ #7 update_plan 0.4s │ $4.21 │ ▮▮▮▮▯ 98% cache
//
// The context leads with the weather and a bar per recent prompt for what it
// added. The rings are "orbits": the arc is the share used, and for a
// rate-limit window a small moon rides the ring at the share of time already
// gone. Arc behind the moon: on pace. Arc past it: using faster than time,
// drawn warm. Then the trajectory: what Claude is doing, or how many
// requests once idle (the 7-day window is the room's). The terminal keeps
// its line of text (sysBandPieces).

import { state } from "./state.mjs";
import { theme, level, palette } from "./theme.mjs";
import { limitWindows, cacheRatio, burnRate, totalTokens, trajectoryLive, trajectoryTotals } from "./metrics.mjs";
import { took, shortTool } from "./trajview.mjs";
import { fmtTokens, fmtUsd, resetLabel } from "./widgets.mjs";
import { forecast, shortModel } from "./sysviews.mjs";
import * as K from "./bandkit.mjs";
import { capsule, draw, label, value, sub, sep } from "./bands.mjs";

const WINDOW_MS = { five_hour: 5 * 3_600_000 };
const SHORT = { five_hour: "5h" };
const COLOR = { five_hour: theme.git };   // leaf
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
  // The 5-hour window; the 7-day one is the room's, its place the trajectory's.
  for (const l of limitWindows(u).filter((l) => l.kind === "five_hour")) {
    const used = l.percentUsed;
    const elapsed = elapsedOf(l, now);
    const pace = paceWord(used, elapsed);
    const head = `5-hour window · ${used == null ? "no reading yet" : `${Math.round(used)}% used`}`;
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
  // The trajectory, after the 5-hour window: while Claude works what it is
  // doing ("#7 update_plan 0.4s"), once idle how many requests and how fast.
  // Narrower forms for a narrow band, down to the tool alone or "7 req"; the
  // chart over the last requests on a wide one.
  if (u.steps.length) {
    const live = trajectoryLive(u);
    const tt = trajectoryTotals(u);
    const wide = columns >= 130;
    const marks = u.steps.slice(-10).map((s) => ({
      live: s.status === "streaming",
      calls: s.calls.map((c) => ({ color: c.isError ? theme.error : c.tool === "Agent" || c.tool === "Task" ? palette.teal : theme.accent, live: !c.done })),
    }));
    const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
    const chart = wide ? draw(K.lanes(marks, theme.agents), "The last requests and their calls") : null;
    let parts, smaller, head;
    if (live) {
      const tool = live.call ? shortTool(live.call.tool) : null;
      const doing = !tool ? live.doing : wide && live.call.summary ? `${tool} ${live.call.summary}` : tool;
      const n = value(`#${live.step.n}`, theme.agents);
      const time = sub(took(now - live.since));
      head = `Request #${live.step.n} · ${doing}`;
      parts = [chart, n, sub(cut(doing, wide ? 18 : 12)), time];
      smaller = [[n, sub(cut(doing, 12)), time], [n, sub(cut(doing, 8))], [value(cut(tool ?? live.doing, 6), theme.agents)]];
    } else {
      const reqs = `request${tt.requests === 1 ? "" : "s"}`;
      head = `${tt.requests} ${reqs}${tt.tps ? ` · ${tt.tps} tok/s` : ""}`;
      parts = [chart, value(String(tt.requests)), sub(reqs), tt.tps ? sub(`· ${tt.tps} tok/s`) : null];
      smaller = [[value(String(tt.requests)), sub(reqs)], [value(String(tt.requests)), sub("req")]];
    }
    out.push({
      key: "trajectory",
      color: theme.agents,
      parts,
      smaller,
      tip: [
        head,
        ...u.steps.slice(-3).flatMap((s) => [
          `#${s.n} ${s.status === "failed" ? "failed" : s.status === "streaming" ? "writing" : `${s.output ?? 0} tokens out`}`,
          ...s.calls.slice(-3).map((c) => `  ${c.tool}${c.summary ? ` ${c.summary}` : ""}${c.isError ? " ✗" : c.done ? "" : " …"}`),
        ]).slice(-6),
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
  return out;
}

// Null before any figure, so the caller keeps its text line ("waiting for
// the first reply").
export function usageBandDesktop(els, props, { onOpen, onCycle }, now = Date.now()) {
  const columns = props.bodyColumns || 100;
  const sections = usageSections(now, columns);
  if (!sections.length) return null;
  return capsule(els, { room: "◔ Usage", color: theme.usage, sections, onOpen, onCycle, columns });
}
