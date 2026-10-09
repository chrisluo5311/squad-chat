// The built-in rooms, drawn from state alone: Usage (this session's context,
// limits, spend, tools and subagents), Git (the branch, pull requests,
// Actions, issues) and Agents (every session on this computer, and a live
// feed of tool calls). Each has a docked layout of cards, a compact one for
// the inline pane, a one-line summary for the band, and a plain-text
// snapshot for sharing to a chat room.

import { state } from "./state.mjs";
import { theme, level, nameColor } from "./theme.mjs";
import {
  cells, clip, fit, fmtTokens, fmtUsd, fmtDur, fmtSpan, relTime, age, resetLabel,
  bar, sparkline, meter, tiles, line, col, stackCards, card, CARD_GAP, LABEL_W,
} from "./widgets.mjs";
import {
  totalTokens, cacheRatio, burnRate, limitWindows, spendSeries, toolRows, agentTree, agentCounts, isEnded, topTool,
} from "./metrics.mjs";
import { gitAttention, ghStatusText } from "./github.mjs";
import { orderSessions, mergedFeed } from "./sessions.mjs";
import { fnMeta, fnDock, fnInline, fnBandPieces, fnSnapshot } from "./fnviews.mjs";

export const SYS = {
  usage: { icon: "◔", label: "Usage", color: theme.usage },
  git: { icon: "⎇", label: "Git", color: theme.git },
  agents: { icon: "⟡", label: "Agents", color: theme.agents },
};

// A room's icon, label and color: built-in or function room.
export function roomMeta(id) {
  return SYS[id] ?? fnMeta(id);
}

const SPIN = ["◐", "◓", "◑", "◒"];
const spin = (now) => SPIN[Math.floor(now / 1000) % SPIN.length];

// "claude-opus-5-5" → "opus-5.5"
export function shortModel(id) {
  if (!id) return "";
  return String(id).replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, "-$1.$2");
}

// One rate-limit window's meter. Without a reading (it just reset) it says so.
function limitMeter(els, l, w) {
  const right = l.percentUsed == null ? "no data yet" : l.resetsAt ? `↻ ${resetLabel(l.resetsAt)}` : "";
  return meter(els, { key: `rl-${l.kind}`, label: limitName(l.kind), pct: l.percentUsed ?? undefined, width: w, right });
}

const LIMIT_NAMES = { five_hour: "5-hour", seven_day: "7-day", seven_day_opus: "7d opus", seven_day_sonnet: "7d sonnet", spend_limit: "Spend" };
function limitName(kind) {
  return LIMIT_NAMES[kind] ?? String(kind).replace(/_/g, " ");
}

const sized = (name, node, rowCount) => ({ name, node, height: 3 + rowCount });
const muted = (els, key, text) => els.Text({ key, color: theme.muted, wrap: "truncate-end", children: text });
const copyButton = (els, key, url, handlers) => (url ? { node: els.Button({ key, plain: true, dimColor: true, label: "⧉", onPress: () => handlers.onCopy?.(url) }) } : null);

// ---------------------------------------------------------------- Usage

function usageCard(els, w, handlers, now) {
  const u = state.usage;
  const rows = [];
  if (!u.measured) {
    rows.push(muted(els, "wait", "Waiting for the first reply from Claude…"));
  } else {
    const c = u.context ?? {};
    const right = c.tokens != null ? `${fmtTokens(c.tokens)}/${fmtTokens(c.window)}` : `${fmtTokens(c.window)} window`;
    rows.push(meter(els, { key: "ctx", label: u.showBreakdown ? "Context ▾" : "Context ▸", pct: c.percent, width: w, right, onPress: handlers.onToggleBreakdown }));
    if (u.showBreakdown) {
      const cats = (u.breakdown?.categories ?? []).filter((x) => !x.isDeferred && x.tokens > 0 && !/free space/i.test(x.name));
      if (!u.breakdown) rows.push(muted(els, "bd-wait", "  counting…"));
      for (const [i, x] of cats.slice(0, 6).entries()) {
        const pct = u.breakdown.maxTokens ? (x.tokens / u.breakdown.maxTokens) * 100 : 0;
        rows.push(meter(els, { key: `bd${i}`, label: `  ${x.name}`, pct, width: w, right: fmtTokens(x.tokens), color: theme.usage }));
      }
    }
    const windows = limitWindows(u);
    if (windows.length) {
      for (const l of windows) rows.push(limitMeter(els, l, w));
    } else {
      rows.push(muted(els, "nolimits", "No rate-limit windows on this account."));
    }
  }
  const meta = [shortModel(u.model), u.startedAt ? fmtSpan(now - u.startedAt) : null].filter(Boolean).join(" · ");
  return sized("Usage", card(els, { key: "usage", title: "USAGE", color: theme.usage, meta, rows }), rows.length);
}

function spendCard(els, w, now) {
  const u = state.usage;
  const series = spendSeries(u, now);
  const rate = burnRate(u, now);
  const cache = cacheRatio(u);
  const spark = series.some((v) => v > 0) ? `${sparkline(series)} last 1h` : "";
  const list = [
    { value: u.cost ? fmtUsd(u.cost.usd) : "–", sub: rate != null ? `+${fmtUsd(rate)}/h` : "this session", color: theme.usage },
    { value: fmtTokens(totalTokens(u)), sub: `${fmtTokens(u.tokens.output)} out`, color: undefined },
    { value: cache == null ? "–" : `${Math.round(cache)}%`, sub: "cache hits", color: cache == null ? theme.muted : cache >= 60 ? theme.online : cache >= 30 ? theme.amber : theme.error },
  ];
  return sized("Spend", card(els, { key: "spend", title: "SPEND", color: theme.usage, meta: spark, metaColor: theme.usage, rows: [tiles(els, list, w)] }), 2);
}

// The number columns, shared by the header and every row so they line up.
const TOOL_COLS = [["p50", 6], ["p95", 6], ["calls", 7], ["fail", 6]];
const TOOL_NUMS = TOOL_COLS.reduce((n, [, w]) => n + w, 0);
const toolHeader = () => TOOL_COLS.map(([h, w]) => fit(h, w, { right: true })).join("");

function toolsCard(els, w, max) {
  const { Box } = els;
  const list = toolRows(state.usage).slice(0, max);
  const rows = [];
  if (!list.length) rows.push(muted(els, "none", "No tool calls yet."));
  const NAME = Math.min(14, Math.max(8, ...list.map((t) => cells(t.name) + 1)));
  const barW = Math.max(3, w - NAME - TOOL_NUMS);
  const top = Math.max(...list.map((t) => t.total), 1);
  const [[, w50], [, w95], [, wCalls], [, wFail]] = TOOL_COLS;
  for (const t of list) {
    const fill = bar((t.total / top) * 100, barW).fill || "╸";   // even a quick tool gets a mark
    rows.push(Box({ key: `t-${t.name}`, flexDirection: "row", children: [
      col(els, "n", clip(t.name, NAME - 1), NAME),
      Box({ key: "b", width: barW, flexShrink: 1, minWidth: 0, overflow: "hidden", children: [
        els.Text({ key: "t", color: theme.usage, wrap: "truncate-end", children: fill }),
      ] }),
      col(els, "p50", fmtDur(t.p50), w50, { right: true }),
      col(els, "p95", fmtDur(t.p95), w95, { right: true, color: theme.muted }),
      col(els, "c", String(t.count), wCalls, { right: true }),
      col(els, "e", String(t.errors), wFail, { right: true, bold: t.errors > 0, color: t.errors ? theme.error : theme.muted }),
    ] }));
  }
  // The header ends at the card's right edge, as the rows do: each label sits over its column.
  const header = list.length
    ? Box({ key: "meta", flexDirection: "row", flexShrink: 0, children: TOOL_COLS.map(([h, cw]) => col(els, h, h, cw, { right: true, color: theme.muted })) })
    : null;
  return sized("Tools", card(els, { key: "tools", title: "TOOLS", color: theme.usage, metaNode: header, rows }), rows.length);
}

function agentGlyph(status, now) {
  if (status === "completed") return { g: "✓", color: theme.online };
  if (status === "failed") return { g: "✗", color: theme.error };
  if (status === "killed") return { g: "⊘", color: theme.muted };
  if (status === "idle" || status === "waiting" || status === "pending") return { g: "○", color: theme.agents };
  return { g: spin(now), color: theme.agents };
}

function agentRow(els, key, a, { indent = "", now }) {
  const st = agentGlyph(a.status, now);
  const took = (a.endedAt ?? now) - a.startedAt;
  return line(els, key, [
    indent ? { text: indent, color: theme.muted } : null,
    { text: `${st.g} `, color: st.color },
    { text: clip(a.type, 9), width: 10, bold: true },
    { text: a.description, grow: true },
    { text: ` ${isEnded(a.status) ? "done" : fmtDur(took)}`, color: theme.muted },
    a.top ? { text: `  ${a.top}`, color: theme.muted } : null,
  ]);
}

function subagentsCard(els, max, now) {
  const tree = agentTree(state.usage);
  const { running, done } = agentCounts(state.usage);
  const rows = tree.slice(0, max).map(({ agent: a, depth, last }) => agentRow(els, `a-${a.id}`, { ...a, top: topTool(a) }, {
    indent: depth ? `${"   ".repeat(depth - 1)}${last ? "└─ " : "├─ "}` : "", now,
  }));
  if (tree.length > max) rows.push(muted(els, "more", `+${tree.length - max} more`));
  if (!rows.length) rows.push(muted(els, "none", "None yet. They show up here as Claude starts them."));
  const meta = running || done ? `${running} running · ${done} done` : "";
  return sized("Subagents", card(els, { key: "subagents", title: "SUBAGENTS", color: theme.usage, meta, metaColor: running ? theme.agents : theme.muted, rows }), rows.length);
}

function usageDock(els, w, capacity, handlers, now) {
  return stackCards(els, [
    usageCard(els, w, handlers, now),
    spendCard(els, w, now),
    toolsCard(els, w, 5),
    subagentsCard(els, 4, now),
  ], capacity);
}

// ---------------------------------------------------------------- Git

function ago(g, now) {
  if (g.status === "loading" && !g.fetchedAt) return { text: "loading…", color: theme.muted };
  if (!g.fetchedAt) return { text: "", color: theme.muted };
  return { text: `${g.stale ? "⚠ " : ""}updated ${relTime(g.fetchedAt, now)}`, color: g.stale ? theme.amber : theme.muted };
}

// Where the branch stands against its remote: "↑2 ↓1", or "local" (with its
// commits past main, "↑3 local") when it has no remote branch yet. Then the
// working tree: "● 23 changed" or "clean".
function syncPieces(l) {
  if (!l) return [];
  const sync = l.upstream
    ? [
      { text: `↑${l.ahead}`, color: l.ahead ? theme.sky : theme.muted, bold: l.ahead > 0 },
      { text: " " },
      { text: `↓${l.behind}`, color: l.behind ? theme.amber : theme.muted, bold: l.behind > 0 },
    ]
    : [{ text: l.unpushed ? `↑${l.unpushed} local` : "local", color: l.unpushed ? theme.amber : theme.muted }];
  const tree = l.changed
    ? { text: `● ${l.changed} changed`, color: theme.amber }
    : { text: "clean", color: theme.muted };
  return { sync, tree };
}

function checksPieces(c) {
  if (!c.total) return [{ text: "no checks", color: theme.muted }];
  return [
    { text: `✓ ${c.pass}`, color: c.pass ? theme.online : theme.muted },
    { text: `  ● ${c.pending}${c.pending ? " running" : ""}`, color: c.pending ? theme.amber : theme.muted },
    { text: `  ✗ ${c.fail}`, color: c.fail ? theme.error : theme.muted },
  ];
}

function mergePiece(pr) {
  if (pr.state === "MERGED") return { text: "merged ✓", color: theme.agents };
  if (pr.state === "CLOSED") return { text: "closed", color: theme.muted };
  if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY") return { text: "conflict ✗", color: theme.error };
  if (pr.mergeState === "BEHIND") return { text: "behind base", color: theme.amber };
  if (pr.mergeState === "BLOCKED") return { text: "blocked", color: theme.amber };
  if (pr.mergeState === "CLEAN" || pr.mergeable === "MERGEABLE") return { text: "mergeable ✓", color: theme.online };
  return { text: "merge ?", color: theme.muted };
}

function prState(pr) {
  if (pr.state === "MERGED") return { text: "merged", color: theme.agents };
  if (pr.state === "CLOSED") return { text: "closed", color: theme.muted };
  if (pr.draft) return { text: "draft", color: theme.muted };
  return { text: "open", color: theme.git };
}

// The short status a PR row ends in, most urgent first.
function prPill(pr, g) {
  if (g.reviewMe.includes(pr.number)) return { text: "● you", color: theme.amber };
  if (pr.checks.fail) return { text: "✗ CI", color: theme.error };
  if (pr.decision === "CHANGES_REQUESTED") return { text: "● changes", color: theme.amber };
  if (pr.checks.pending) return { text: "● CI", color: theme.amber };
  if (pr.draft) return { text: "draft", color: theme.muted };
  if (pr.decision === "APPROVED") return { text: "✓ approved", color: theme.online };
  if (pr.checks.total) return { text: "✓ CI", color: theme.online };
  return { text: "", color: theme.muted };
}

function repoCard(els, handlers, now) {
  const g = state.git;
  const l = g.local;
  const rows = [];
  if (l) {
    const { sync, tree } = syncPieces(l);
    rows.push(line(els, "branch", [
      { text: `⎇ ${l.branch ?? "?"}`, bold: true, color: theme.git },
      { text: "  " },
      ...sync,
      { text: "  " },
      { ...tree, grow: true },
      { node: els.Button({ key: "refresh", plain: true, dimColor: true, label: "↻", onPress: () => handlers.onRefresh?.() }) },
    ]));
  }
  const help = ghStatusText(g);
  if (help) rows.push(els.Text({ key: "help", color: theme.warn, wrap: "wrap", children: help }));
  else if (g.error && (g.stale || !g.fetchedAt || g.error === "no GitHub remote")) rows.push(muted(els, "err", g.error === "no GitHub remote" ? "No GitHub remote: only the local branch shows here." : `⚠ ${g.error}`));
  if (!rows.length) rows.push(muted(els, "wait", "Reading the repository…"));
  const when = ago(g, now);
  const helpRows = help ? Math.ceil(cells(help) / 44) : 0;
  return sized("Repo", card(els, { key: "repo", title: g.repo?.name || "REPOSITORY", color: theme.git, meta: when.text, metaColor: when.color, rows }), rows.length + Math.max(0, helpRows - 1));
}

function branchCard(els, handlers) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const pr = g.pr;
  if (!pr) {
    return sized("This branch", card(els, { key: "branch", title: "THIS BRANCH", color: theme.git, meta: "no pull request", rows: [
      muted(els, "none", g.local?.ahead ? "Pushed commits, no PR yet. Open one with gh pr create." : "No pull request for this branch."),
    ] }), 1);
  }
  const st = prState(pr);
  const reviewers = [
    ...pr.reviews.map((r) => ({ text: `${r.state === "APPROVED" ? "✓" : r.state === "CHANGES_REQUESTED" ? "✗" : "●"} ${r.login}`, color: r.state === "APPROVED" ? theme.online : r.state === "CHANGES_REQUESTED" ? theme.error : theme.muted })),
    ...pr.requested.filter((x) => !pr.reviews.some((r) => r.login === x)).map((x) => ({ text: `● ${x}`, color: theme.amber })),
  ];
  const rows = [
    line(els, "title", [{ text: pr.title, grow: true, bold: true }]),
    line(els, "checks", [...checksPieces(pr.checks), { text: "", grow: true }, mergePiece(pr)]),
    line(els, "reviews", [
      { text: "reviews ", color: theme.muted },
      ...(reviewers.length ? reviewers.flatMap((r, i) => [i ? { text: "  " } : null, r]) : [{ text: pr.decision === "REVIEW_REQUIRED" ? "needed, none asked yet" : "none", color: theme.muted }]),
    ]),
    els.Box({ key: "actions", flexDirection: "row", gap: 2, children: [
      els.Button({ key: "copy-pr", label: "Copy link", onPress: () => handlers.onCopy?.(pr.url) }),
    ] }),
  ];
  return sized("This branch", card(els, { key: "branch", title: "THIS BRANCH", color: theme.git, meta: `PR #${pr.number} · ${st.text}`, metaColor: st.color, rows }), rows.length);
}

function prsCard(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const list = g.prs.filter((p) => p.number !== g.pr?.number)
    .sort((a, b) => Number(g.reviewMe.includes(b.number)) - Number(g.reviewMe.includes(a.number)) || b.updatedAt - a.updatedAt);
  const rows = list.slice(0, max).map((p) => {
    const pill = prPill(p, g);
    return line(els, `pr-${p.number}`, [
      { text: `#${p.number}`, width: 6, color: theme.muted },
      { text: p.title, grow: true },
      { text: clip(pill.text, 10), width: 11, right: true, color: pill.color },
      { text: clip(age(p.updatedAt, now), 4), width: 5, right: true, color: theme.muted },
      { text: " " },
      copyButton(els, "copy", p.url, handlers),
    ]);
  });
  if (list.length > max) rows.push(muted(els, "more", `+${list.length - max} more`));
  if (!rows.length) rows.push(muted(els, "none", "No other open pull requests."));
  const meta = `${g.prs.length} open${g.reviewMe.length ? ` · ${g.reviewMe.length} for you` : ""}`;
  return sized("Pull requests", card(els, { key: "prs", title: "PULL REQUESTS", color: theme.git, meta, metaColor: g.reviewMe.length ? theme.amber : theme.muted, rows }), rows.length);
}

function runGlyph(r, now) {
  if (r.status !== "completed") return { g: spin(now), color: theme.amber };
  if (r.conclusion === "success") return { g: "✓", color: theme.online };
  if (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "startup_failure") return { g: "✗", color: theme.error };
  return { g: "⊘", color: theme.muted };
}

function runsCard(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const rows = g.runs.slice(0, max).map((r) => {
    const st = runGlyph(r, now);
    const when = r.status === "completed" ? age(r.updatedAt, now) : `${r.status === "queued" ? "queued" : "running"} ${fmtDur(now - r.startedAt)}`;
    return line(els, `run-${r.id}`, [
      { text: `${st.g} `, color: st.color },
      { text: clip(r.name, 12), width: 13, bold: true },
      { text: r.branch, color: theme.muted, grow: true },
      { text: ` ${when} `, color: r.status === "completed" ? theme.muted : theme.amber },
      copyButton(els, "copy", r.url, handlers),
    ]);
  });
  if (!rows.length) rows.push(muted(els, "none", "No workflow runs."));
  const failing = g.runs.filter((r) => r.status === "completed" && runGlyph(r, now).g === "✗").length;
  const running = g.runs.filter((r) => r.status !== "completed").length;
  const meta = [running ? `${running} running` : null, failing ? `${failing} failed` : null].filter(Boolean).join(" · ");
  return sized("Actions", card(els, { key: "runs", title: "ACTIONS", color: theme.git, meta, metaColor: failing ? theme.error : running ? theme.amber : theme.muted, rows }), rows.length);
}

const SEVERITY = { critical: theme.error, high: theme.error, medium: theme.amber, moderate: theme.amber, low: theme.muted };

function issuesCard(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const rows = [];
  for (const i of g.issues.slice(0, max)) {
    rows.push(line(els, `is-${i.number}`, [
      { text: `#${i.number}`, width: 6, color: theme.muted },
      { text: i.title, grow: true },
      i.labels[0] ? { text: ` ${clip(i.labels[0], 12)}`, color: theme.agents } : null,
      { text: clip(age(i.updatedAt, now), 4), width: 5, right: true, color: theme.muted },
      { text: " " },
      copyButton(els, "copy", i.url, handlers),
    ]));
  }
  for (const a of (g.alerts ?? []).slice(0, Math.max(1, max - rows.length))) {
    rows.push(line(els, `al-${a.number}`, [
      { text: "⚠ ", color: SEVERITY[a.severity] ?? theme.amber },
      { text: a.pkg, bold: true, grow: true },
      { text: ` ${a.severity} `, color: SEVERITY[a.severity] ?? theme.amber },
      copyButton(els, "copy", a.url, handlers),
    ]));
  }
  if (!rows.length) rows.push(muted(els, "none", "No issues assigned to you."));
  const nAlerts = g.alerts?.length ?? 0;
  const meta = `${g.issues.length} assigned${nAlerts ? ` · ${nAlerts} ⚠` : ""}`;
  return sized("Issues", card(els, { key: "issues", title: "ISSUES & ALERTS", color: theme.git, meta, metaColor: nAlerts ? theme.amber : theme.muted, rows }), rows.length);
}

function gitDock(els, w, capacity, handlers, now) {
  return stackCards(els, [
    repoCard(els, handlers, now),
    branchCard(els, handlers),
    prsCard(els, handlers, 4, now),
    runsCard(els, handlers, 3, now),
    issuesCard(els, handlers, 3, now),
  ], capacity);
}

// ---------------------------------------------------------------- Agents

function allSessions() {
  return orderSessions(state.self, state.sessions);
}

// Subagents of a session still at work.
const liveAgents = (s) => (s.agents ?? []).filter((a) => !isEnded(a.status)).length;
// A session is busy while its turn runs or any of its agents does: a turn
// can end with a background agent still at work.
const sessionBusy = (s) => (s.activity?.state && s.activity.state !== "idle") || liveAgents(s) > 0;

function activityPieces(s, now) {
  const a = s.activity ?? { state: "idle" };
  const live = liveAgents(s);
  const since = a.since ? now - a.since : 0;
  const tail = [s.cost != null ? fmtUsd(s.cost) : null, s.context != null ? `ctx ${Math.round(s.context)}%` : null].filter(Boolean).join(" · ");
  const head = a.state === "tool" ? { text: `running ${a.tool} · ${fmtDur(since)}`, color: theme.agents }
    : a.state === "thinking" ? { text: `thinking · ${fmtDur(since)}`, color: theme.agents }
      : live ? { text: `waiting on ${live} agent${live === 1 ? "" : "s"}`, color: theme.agents }
        : { text: `idle${a.since ? ` ${age(a.since, now)}` : ""}`, color: theme.muted };
  return [{ text: "  " }, head, tail ? { text: ` · ${tail}`, color: theme.muted, grow: true } : { text: "", grow: true }];
}

function sessionRows(els, s, handlers, now, maxAgents) {
  const here = s.id === state.sessionId;
  const busy = sessionBusy(s);
  const color = nameColor(s.id);
  const folded = state.collapsed.has(s.id);
  const agents = s.agents ?? [];
  const live = agents.filter((a) => !isEnded(a.status)).length;
  const rows = [line(els, `s-${s.id}`, [
    { text: `${busy ? "●" : "○"} `, color: busy ? color : theme.muted },
    { text: s.project, bold: true, color },
    here ? { text: " (here)", color: theme.muted } : null,
    { text: s.branch ? `  ${s.branch}` : "", color: theme.muted, grow: true },
    { text: ` ${shortModel(s.model)} `, color: theme.muted },
    agents.length
      ? { node: els.Button({ key: "fold", plain: true, dimColor: true, label: folded ? `▸${live || agents.length}` : "▾", onPress: () => handlers.onToggleSession?.(s.id) }) }
      : { text: " " },   // keeps the model column in line with rows that have the fold mark
  ]), line(els, `sa-${s.id}`, activityPieces(s, now))];
  if (!folded) {
    const shown = agents.slice(0, maxAgents);
    for (const a of shown) {
      const indent = `  ${"   ".repeat(a.depth ?? 0)}${a.last || a === shown.at(-1) ? "└─ " : "├─ "}`;
      rows.push(agentRow(els, `ag-${s.id}-${a.id}`, a, { indent, now }));
    }
    if (agents.length > maxAgents) rows.push(muted(els, `agm-${s.id}`, `     +${agents.length - maxAgents} more`));
  }
  return rows;
}

function sessionsCard(els, handlers, maxRows, now) {
  const list = allSessions();
  const rows = [];
  for (const s of list) {
    const next = sessionRows(els, s, handlers, now, s.id === state.sessionId ? 4 : 2);
    if (rows.length && rows.length + next.length > maxRows) {
      rows.push(muted(els, "more", `+${list.length - list.indexOf(s)} more sessions`));
      break;
    }
    rows.push(...next);
  }
  if (!rows.length) rows.push(muted(els, "none", "Starting…"));
  const meta = `${list.length} on this computer`;
  return sized("Sessions", card(els, { key: "sessions", title: "SESSIONS", color: theme.agents, meta, rows }), rows.length);
}

const FILTERS = { all: "all", here: "here", errors: "errors" };

function feedRow(els, f, w, now) {
  const t = new Date(f.at);
  const clock = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  const who = f.agent ? ` ↳ ${f.agent}` : f.session;
  const end = f.done ? (f.isError ? { text: " ✗", color: theme.error } : { text: " ✓", color: theme.online }) : { text: ` ${spin(now)}`, color: theme.agents };
  return line(els, `f-${f.sessionId}-${f.key}`, [
    w >= 46 ? { text: `${clock} `, color: theme.muted } : null,
    { text: clip(who, w >= 46 ? 11 : 9), width: w >= 46 ? 12 : 10, color: f.agent ? theme.muted : nameColor(f.sessionId) },
    { text: clip(f.tool, 6), width: 7, bold: true },
    { text: f.summary || "", color: theme.muted, grow: true },
    f.times > 1 ? { text: ` ×${f.times}`, color: theme.agents } : null,
    { text: ` ${f.done ? fmtDur(f.ms) : fmtDur(now - f.at)}`, color: f.done ? theme.muted : theme.agents },
    end,
  ]);
}

function feedCard(els, w, rowsLeft, handlers, now) {
  const rows = mergedFeed(allSessions(), { filter: state.feedFilter, ownId: state.sessionId, limit: Math.max(1, rowsLeft) })
    .map((f) => feedRow(els, f, w, now));
  if (!rows.length) rows.push(muted(els, "none", state.feedFilter === "errors" ? "No failed tool calls." : "Tool calls show up here as they run."));
  const metaNode = els.Button({ key: "filter", plain: true, dimColor: true, label: `${FILTERS[state.feedFilter]} ▾`, onPress: () => handlers.onCycleFilter?.() });
  return { name: "Live", node: card(els, { key: "feed", title: "LIVE", color: theme.agents, metaNode, rows, grow: true }), height: 3 + Math.min(rows.length, 1) };
}

function agentsDock(els, w, capacity, handlers, now) {
  const sessions = sessionsCard(els, handlers, Math.max(3, Math.floor((capacity - 4) * 0.55)), now);
  const left = capacity - sessions.height - CARD_GAP - 3;
  return stackCards(els, [sessions, feedCard(els, w, left, handlers, now)], capacity);
}

// ---------------------------------------------------------------- entry points

// The docked pane's body for a built-in room: cards within `capacity` rows.
export function sysDock(els, view, width, capacity, handlers, now = Date.now()) {
  const w = Math.max(20, width - 4);   // inside a card's border and padding
  if (!SYS[view]) return fnDock(els, view, w, capacity, handlers);
  if (view === "usage") return usageDock(els, w, capacity, handlers, now);
  if (view === "git") return gitDock(els, w, capacity, handlers, now);
  return agentsDock(els, w, capacity, handlers, now);
}

// The inline pane: a few lines, no cards.
export function sysInline(els, view, width, handlers, now = Date.now()) {
  const { Text } = els;
  const w = Math.max(20, width);
  if (!SYS[view]) return fnInline(els, view, w, handlers);
  const meta = SYS[view];
  const head = (text, right) => line(els, "head", [
    { text: `${meta.icon} ${meta.label}`, bold: true, color: meta.color },
    { text: text ? `  ${text}` : "", color: theme.muted, grow: true },
    right ? { text: right, color: theme.muted } : null,
  ]);
  if (view === "usage") {
    const u = state.usage;
    const parts = [head([shortModel(u.model), u.startedAt ? fmtSpan(now - u.startedAt) : null].filter(Boolean).join(" · "))];
    if (!u.measured) return [...parts, muted(els, "wait", "Waiting for the first reply from Claude…")];
    const c = u.context ?? {};
    parts.push(meter(els, { key: "ctx", label: "Context", pct: c.percent, width: w, right: c.tokens != null ? `${fmtTokens(c.tokens)}/${fmtTokens(c.window)}` : c.window ? `${fmtTokens(c.window)} window` : "" }));
    for (const l of limitWindows(u).slice(0, 2)) parts.push(limitMeter(els, l, w));
    const cache = cacheRatio(u);
    const running = agentCounts(u).running;
    parts.push(line(els, "spend", [
      { text: "Spend", width: LABEL_W, color: theme.muted },
      { text: u.cost ? fmtUsd(u.cost.usd) : "–", bold: true, color: theme.usage },
      { text: "  ·  ", color: theme.muted },
      { text: fmtTokens(totalTokens(u)), bold: true },
      { text: " tokens  ·  ", color: theme.muted },
      { text: cache == null ? "–" : `${Math.round(cache)}%`, bold: true, color: cache == null ? theme.muted : cache >= 60 ? theme.online : cache >= 30 ? theme.amber : theme.error },
      { text: " cache hits", color: theme.muted },
      running ? { text: `  ·  ⟡ ${running} running`, color: theme.agents } : null,
    ]));
    return parts;
  }
  if (view === "git") {
    const g = state.git;
    const l = g.local;
    const parts = [head("", ago(g, now).text)];
    if (l) {
      const { sync, tree } = syncPieces(l);
      parts.push(line(els, "branch", [{ text: `⎇ ${l.branch ?? "?"}`, bold: true, color: theme.git }, { text: "  " }, ...sync, { text: "  " }, { ...tree, grow: true }]));
    }
    const help = ghStatusText(g);
    if (help) return [...parts, Text({ key: "help", color: theme.warn, wrap: "wrap", children: help })];
    if (g.pr) {
      const c = g.pr.checks;
      parts.push(line(els, "pr", [{ text: `#${g.pr.number} `, color: theme.git, bold: true }, { text: g.pr.title, grow: true }, { text: ` ✓${c.pass} ●${c.pending} ✗${c.fail}`, color: c.fail ? theme.error : c.pending ? theme.amber : theme.online }]));
    }
    for (const p of g.prs.filter((p) => p.number !== g.pr?.number).slice(0, 3)) {
      const pill = prPill(p, g);
      parts.push(line(els, `pr-${p.number}`, [{ text: `#${p.number}`, width: 6, color: theme.muted }, { text: p.title, grow: true }, { text: ` ${pill.text}`, color: pill.color }]));
    }
    return parts;
  }
  const list = allSessions();
  const parts = [head(`${list.length} session${list.length === 1 ? "" : "s"}`)];
  for (const s of list.slice(0, 4)) {
    const live = (s.agents ?? []).filter((a) => !isEnded(a.status)).length;
    parts.push(line(els, `s-${s.id}`, [
      { text: `${sessionBusy(s) ? "●" : "○"} `, color: sessionBusy(s) ? nameColor(s.id) : theme.muted },
      { text: clip(s.project, 14), width: 15, bold: true, color: nameColor(s.id) },
      ...activityPieces(s, now).slice(1),
      live ? { text: ` ⟡${live}`, color: theme.agents } : null,
    ]));
  }
  return parts;
}

// How full the context is, as weather (from token-weather, the
// claude-code-playground mod): single-width symbols that line up in any font.
const FORECAST = [
  { upTo: 25, icon: "☀", word: "Clear", color: theme.amber },
  { upTo: 50, icon: "☁", word: "Cloudy", color: theme.usage },
  { upTo: 75, icon: "☂", word: "Showers", color: "#6FC2B5" },
  { upTo: 90, icon: "☇", word: "Storm", color: theme.agents },
  { upTo: Infinity, icon: "↯", word: "Compact soon", color: theme.error },
];
export function forecast(pct) {
  return FORECAST.find((f) => pct < f.upTo) ?? FORECAST.at(-1);
}

// The band's line for a built-in room, as colored pieces, fitted to `width`
// cells. For Usage: "☂ Showers 67% 134k/200k ▁▂▅█ ▲+98k · 5-hour 12% ·
// spent $1.21": the context as a forecast once measured, the 5-hour window,
// and the spend once there is some.
export function sysBandPieces(view, width = 0) {
  if (!SYS[view]) return fnBandPieces(view);
  const sep = { text: " · ", color: theme.muted };
  const join = (list) => list.filter(Boolean).flatMap((p, i) => (i ? [sep, ...p] : p));
  const figure = (label, pct) => [{ text: `${label} `, color: theme.muted }, { text: `${Math.round(pct)}%`, color: level(pct), bold: true }];
  if (view === "usage") {
    const u = state.usage;
    const c = u.context;
    // The forecast, then the 5-hour window and the spend. On a narrow band
    // the turn's delta goes first, then the chart, then the token count.
    const weather = (detail) => {
      if (c?.percent == null) return null;
      const f = forecast(c.percent);
      const hist = u.ctxHistory;
      const delta = hist.length >= 2 ? hist.at(-1) - hist.at(-2) : 0;
      return [
        { text: `${f.icon} ${f.word} `, color: f.color, bold: true },
        { text: `${Math.round(c.percent)}%`, color: f.color, bold: true },
        detail >= 1 && c.tokens != null ? { text: ` ${fmtTokens(c.tokens)}/${fmtTokens(c.window)}`, color: theme.muted } : null,
        detail >= 2 && hist.length >= 2 ? { text: ` ${sparkline(hist, 12)}`, color: f.color } : null,
        detail >= 3 && delta ? { text: delta > 0 ? ` ▲+${fmtTokens(delta)}` : ` ▼${fmtTokens(-delta)}`, color: theme.muted } : null,
      ].filter(Boolean);
    };
    const five = limitWindows(u).find((l) => l.kind === "five_hour");
    const tail = [
      five ? (five.percentUsed == null
        ? [{ text: "5-hour ", color: theme.muted }, { text: "–", color: theme.muted }]
        : figure("5-hour", five.percentUsed)) : null,
      u.cost?.usd > 0 ? [{ text: "spent ", color: theme.muted }, { text: fmtUsd(u.cost.usd), color: theme.usage, bold: true }] : null,
    ];
    let pieces = [];
    for (let detail = 3; detail >= 0; detail--) {
      pieces = join([weather(detail), ...tail]);
      if (!width || cells(pieces.map((p) => p.text).join("")) <= width) break;
    }
    return pieces.length ? pieces : [{ text: "waiting for the first reply", color: theme.muted }];
  }
  if (view === "git") {
    const g = state.git;
    if (g.status === "no-repo") return [{ text: "not a git repository", color: theme.warn }];
    const pr = g.pr;
    // git works without gh: the branch shows either way.
    return join([
      g.local?.branch ? [{ text: g.local.branch, color: theme.git, bold: true }] : null,
      g.local ? syncPieces(g.local).sync : null,
      g.local ? [syncPieces(g.local).tree] : null,
      ghStatusText(g) ? [{ text: "gh isn't set up", color: theme.warn }] : null,
      pr ? [{ text: `#${pr.number} `, color: theme.muted }, ...checksPieces(pr.checks).map((p) => ({ ...p, text: p.text.replace(" running", "") }))] : null,
      g.reviewMe.length ? [{ text: `${g.reviewMe.length} review${g.reviewMe.length === 1 ? "" : "s"} for you`, color: theme.amber }] : null,
    ]);
  }
  const list = allSessions();
  const running = list.reduce((n, s) => n + (s.agents ?? []).filter((a) => !isEnded(a.status)).length, 0);
  return join([
    [{ text: `${list.length} session${list.length === 1 ? "" : "s"}`, color: theme.muted }],
    [{ text: `${running} agent${running === 1 ? "" : "s"} running`, color: running ? theme.agents : theme.muted }],
  ]);
}

// The same as plain text.
export function sysBandText(view) {
  return sysBandPieces(view).map((p) => p.text).join("");
}

// A tab's badge: what's worth a glance from another room.
export function sysBadge(view) {
  if (view === "git" && gitAttention(state.git)) return { text: "●", color: theme.error };
  if (view === "agents") {
    const n = allSessions().reduce((k, s) => k + (s.agents ?? []).filter((a) => !isEnded(a.status)).length, 0);
    if (n) return { text: String(n), color: theme.agents };
  }
  if (view === "usage" && (state.usage.context?.percent ?? 0) >= 80) return { text: `${Math.round(state.usage.context.percent)}%`, color: level(state.usage.context.percent) };
  return null;
}

// ---------------------------------------------------------------- snapshots

const textBar = (pct, width) => {
  const { fill, track } = bar(pct, width);
  return fill + track;
};

// A built-in room as plain text, for a snippet card in a chat room.
export function snapshotText(view, now = Date.now()) {
  if (!SYS[view]) return fnSnapshot(view);
  const W = 20;
  const out = [];
  if (view === "usage") {
    const u = state.usage;
    out.push(`Usage · ${[shortModel(u.model), u.startedAt ? fmtSpan(now - u.startedAt) : null].filter(Boolean).join(" · ")}`);
    if (u.context) out.push(`${fit("Context", LABEL_W)}${textBar(u.context.percent ?? 0, W)} ${fit(`${Math.round(u.context.percent ?? 0)}%`, 4, { right: true })}  ${fmtTokens(u.context.tokens)}/${fmtTokens(u.context.window)}`);
    for (const l of limitWindows(u)) {
      out.push(`${fit(limitName(l.kind), LABEL_W)}${textBar(l.percentUsed ?? 0, W)} ${fit(l.percentUsed == null ? "–" : `${Math.round(l.percentUsed)}%`, 4, { right: true })}`);
    }
    const cache = cacheRatio(u);
    const rate = burnRate(u, now);
    out.push(`Spend    ${u.cost ? fmtUsd(u.cost.usd) : "–"}${rate != null ? ` (+${fmtUsd(rate)}/h)` : ""} · ${fmtTokens(totalTokens(u))} tokens · ${cache == null ? "–" : `${Math.round(cache)}%`} cache hits`);
    const tools = toolRows(u).slice(0, 5);
    if (tools.length) {
      out.push(`${fit("Tools", 10)}${toolHeader()}`);
      for (const t of tools) out.push(`  ${fit(t.name, 8)}${[t.p50, t.p95].map((v) => fit(fmtDur(v), 6, { right: true })).join("")}${fit(String(t.count), 7, { right: true })}${fit(String(t.errors), 6, { right: true })}`);
    }
    const { running, done } = agentCounts(u);
    if (running || done) out.push(`Agents   ${running} running · ${done} done`);
  } else if (view === "git") {
    const g = state.git;
    const l = g.local;
    const st = l ? syncPieces(l) : null;
    out.push(`${g.repo?.name || "repository"}${l ? ` · ⎇ ${l.branch} ${st.sync.map((p) => p.text).join("")} · ${st.tree.text}` : ""}`);
    if (g.pr) {
      const c = g.pr.checks;
      out.push(`PR #${g.pr.number} ${prState(g.pr).text}: ${g.pr.title}`);
      out.push(`  checks ✓${c.pass} ●${c.pending} ✗${c.fail} · ${mergePiece(g.pr).text}`);
      const revs = g.pr.reviews.map((r) => `${r.state === "APPROVED" ? "✓" : "✗"} ${r.login}`).concat(g.pr.requested.map((x) => `● ${x}`));
      if (revs.length) out.push(`  reviews ${revs.join("  ")}`);
      out.push(`  ${g.pr.url}`);
    }
    for (const p of g.prs.filter((p) => p.number !== g.pr?.number).slice(0, 5)) out.push(`#${p.number} ${clip(p.title, 50)}  ${prPill(p, g).text}`);
    for (const r of g.runs.slice(0, 3)) out.push(`${runGlyph(r, now).g} ${r.name} · ${r.branch} · ${r.status === "completed" ? age(r.updatedAt, now) : "running"}`);
  } else {
    for (const s of allSessions()) {
      out.push(`${sessionBusy(s) ? "●" : "○"} ${s.project}${s.branch ? ` (${s.branch})` : ""} · ${shortModel(s.model)} · ${s.activity?.state ?? "idle"}${s.cost != null ? ` · ${fmtUsd(s.cost)}` : ""}`);
      for (const a of s.agents ?? []) out.push(`   ${isEnded(a.status) ? (a.status === "completed" ? "✓" : "✗") : "◐"} ${a.type}: ${clip(a.description, 40)}${a.top ? ` (${a.top})` : ""}`);
    }
  }
  return out.join("\n");
}
