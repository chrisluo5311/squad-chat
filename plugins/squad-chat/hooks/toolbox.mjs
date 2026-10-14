// The Toolbox room: small tools a developer reaches for (Base64, JWT, UUID,
// hashes, Unix times, cron …), picked from a menu and run on what's typed.
// What's typed and what comes out live in this session's memory only: they
// are never kept, and the room is never shared to a chat.
//
// Plain logic and drawing: the tools are in toolkit.mjs, and the mod reads
// the clipboard and copies.

import { state } from "./state.mjs";
import { theme } from "./theme.mjs";
import { line, card, stackCards, cells, clip } from "./widgets.mjs";
import * as K from "./bandkit.mjs";
import { draw, label, value, sub, msg, chip } from "./bands.mjs";
import { TOOLS, GROUPS, TOOL_IDS, findTool, runTool, detectClip } from "./toolkit.mjs";

export const TOOLBOX_META = { icon: "⚒", label: "Toolbox", color: "#D9A877" };
const SAND = TOOLBOX_META.color;
const COPIED_MS = 5_000;          // how long the band says "copied"
const SOON_MS = 10 * 60_000;      // a JWT on the clipboard this close to its exp marks the tab
const MASK = "••••••••••••";
const BLOCK_LINES = 12;           // a block result's lines shown before "+3 more lines"

export function createToolbox() {
  return {
    tool: "uuid",   // the tool on show
    input: "",      // what it runs on
    out: null,      // its last result (toolkit.mjs)
    at: 0,          // when it ran
    used: false,    // a tool has run in this session: the band says what
    reveal: false,  // a secret result drawn plainly
    copiedAt: 0,    // ⧉ pressed: the band says so for a moment
    clipSeen: null, // the newest clipboard item when it ran: one copied since is newer
    runs: 0,        // runs started: only the latest one's result is kept
  };
}

// Run the tool on show again: on a new input, a new tool, or ↻. A run
// that ends after a newer one began (a long hash, then UUID picked) is
// dropped, so a card never shows another tool's rows.
export async function rerun(tb, now, { used = true } = {}) {
  const run = ++tb.runs;
  const out = await runTool(tb.tool, tb.input, now);
  if (run !== tb.runs) return tb.out;
  tb.out = out;
  tb.at = now;
  tb.reveal = false;
  if (used) { tb.used = true; tb.clipSeen = state.clipboard?.items?.[0]?.id ?? null; }
  return tb.out;
}

// A tool from the menu: shown, and run on nothing (a generator makes its
// first batch) or on what was there, when the tool reads text.
export async function pickTool(tb, id, now) {
  if (!TOOLS[id]) return null;
  const was = tb.tool;
  tb.tool = id;
  // Options for one generator ("5 v7") mean nothing to another tool.
  if (was !== id && (TOOLS[id].generates || TOOLS[was]?.generates)) tb.input = "";
  return rerun(tb, now, { used: !!TOOLS[id].generates || !!tb.input });
}

// Words typed in the room's box, or after /tool. A tool's name alone shows
// it; "/tool hash hello" picks one and runs it; anything else typed in the
// box is the input for the tool on show. Returns what to say ("" when the
// room shows it), or null when the words weren't for the room.
export async function toolWords(tb, text, now, { typed = false } = {}) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const [first, ...rest] = t.split(/\s+/);
  const id = findTool(first);
  if (id && (!typed || !rest.length)) {
    tb.tool = id;
    tb.input = t.slice(first.length).trim();
    await rerun(tb, now, { used: !!TOOLS[id].generates || !!tb.input });
    return "";
  }
  if (!typed) return null;
  tb.input = t;
  await rerun(tb, now);
  return "";
}

// The text a result row copies, and how it's drawn.
const copyOf = (r) => (r.copy === false ? null : r.copy ?? r.text);
const shown = (tb, r) => (r.secret && !tb.reveal ? MASK : r.text);
const tone = (t) => (t === "ok" ? theme.online : t === "bad" ? theme.error : theme.amber);

// ---------------------------------------------------------------- the menu

const groupTools = (g) => TOOL_IDS.filter((id) => TOOLS[id].group === g);
const LABEL_W = 9;

// How many rows a group's buttons take at `w`: a button is its label and a
// space each side, a cell apart.
function chipRows(ids, w, desk) {
  const room = Math.max(10, w - 4 - LABEL_W);
  let rows = 1, used = 0;
  for (const id of ids) {
    const need = cells(TOOLS[id].label) + (desk ? 4 : 4) + 1;
    if (used && used + need > room) { rows++; used = 0; }
    used += need;
  }
  return rows;
}

function menuCard(els, tb, w, handlers) {
  const { Box, Text, Button } = els;
  const desk = !!els.Svg;
  let height = 3;
  const rows = GROUPS.map((g) => {
    const ids = groupTools(g);
    height += chipRows(ids, w, desk);
    return Box({ key: `g-${g}`, flexDirection: "row", children: [
      Box({ key: "l", width: LABEL_W, flexShrink: 0, children: [Text({ key: "t", color: theme.muted, children: g.toUpperCase() })] }),
      Box({ key: "chips", flexDirection: "row", flexWrap: "wrap", columnGap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, children: ids.map((id) => Button({
        key: `tool-${id}`,
        label: TOOLS[id].label,
        ...(id === tb.tool ? { variant: "primary" } : { plain: true, dimColor: false }),
        onPress: () => handlers.onToolPick?.(id),
      })) }),
    ] });
  });
  return { name: "Tools", node: card(els, { key: "tb-menu", title: "TOOLS", color: SAND, meta: String(TOOL_IDS.length), rows }), height };
}

// ---------------------------------------------------------------- the tool

function resultRow(els, tb, r, i, w, handlers, labelW) {
  const { Box, Text, Button } = els;
  const copy = copyOf(r);
  const btn = copy != null ? Button({ key: `tool-copy-${i}`, plain: true, label: "⧉", onPress: (press) => handlers.onToolCopy?.(copy, press?.surface) }) : null;
  const lab = labelW ? { text: r.label, width: labelW, color: theme.muted } : null;
  if (r.block) {
    const lines = shown(tb, r).split("\n");
    const keep = lines.slice(0, BLOCK_LINES);
    const more = lines.length - keep.length;
    const body = [...keep.map((t, k) => Text({ key: `l${k}`, wrap: "wrap", color: r.dim ? theme.muted : undefined, children: t || " " })),
      more > 0 ? Text({ key: "more", color: theme.muted, children: `+ ${more} more line${more === 1 ? "" : "s"}` }) : null].filter(Boolean);
    const rowsUsed = keep.reduce((n, t) => n + Math.max(1, Math.ceil(cells(t) / Math.max(10, w - 6 - labelW))), 0) + (more > 0 ? 1 : 0);
    return { rows: rowsUsed, node: Box({ key: `r${i}`, flexDirection: "row", columnGap: 1, children: [
      lab ? line(els, "lab", [lab]) : null,
      Box({ key: "body", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, children: body }),
      btn,
    ].filter(Boolean) }) };
  }
  return { rows: 1, node: line(els, `r${i}`, [
    lab,
    { text: shown(tb, r), grow: true, color: r.secret && !tb.reveal ? theme.amber : r.dim ? theme.muted : undefined },
    btn ? { node: btn } : null,
  ], { gap: 1 }) };
}

function toolCard(els, tb, w, handlers) {
  const { Box, Text, Button } = els;
  const tool = TOOLS[tb.tool];
  const out = tb.out ?? { rows: [], note: tool.hint };
  const rows = [];
  let height = 3;
  // What it ran on, for a tool that reads text.
  if (!tool.generates && tb.input) {
    rows.push(line(els, "in", [{ text: "in", width: 3, color: theme.muted }, { text: tb.input.replace(/\s+/g, " "), grow: true, color: theme.muted }], { gap: 1 }));
    height++;
  }
  if (out.error) { rows.push(Text({ key: "err", color: theme.warn, wrap: "wrap", children: out.error })); height += Math.ceil(cells(out.error) / Math.max(10, w - 4)); }
  const labelW = Math.min(10, Math.max(0, ...out.rows.map((r) => cells(r.label))));
  out.rows.forEach((r, i) => {
    const got = resultRow(els, tb, r, i, w, handlers, labelW);
    rows.push(got.node);
    height += got.rows;
  });
  if (out.status) { rows.push(Text({ key: "status", color: tone(out.status.tone), children: `● ${out.status.text}` })); height++; }
  // A note under the results ("of 5 bytes"); with none yet, what to type.
  const foot = out.note ?? (!out.rows.length && !out.error ? tool.hint : null);
  if (foot && !out.rows.length) {
    rows.push(Text({ key: "hint", color: theme.muted, wrap: "wrap", children: foot }));
    height += Math.ceil(cells(foot) / Math.max(10, w - 4));
  } else if (foot || out.copyAll) {
    rows.push(line(els, "foot", [
      { text: foot ?? "", grow: true, color: theme.muted },
      out.copyAll ? { node: Button({ key: "tool-copy-all", plain: true, label: "⧉ all", onPress: (press) => handlers.onToolCopy?.(out.copyAll, press?.surface) }) } : null,
    ], { gap: 1 }));
    height++;
  }
  const secret = out.rows.some((r) => r.secret);
  const metaNode = Box({ key: "meta", flexDirection: "row", alignItems: "center", columnGap: 1, flexShrink: 0, children: [
    out.mode ? Text({ key: "mode", color: theme.muted, children: out.mode }) : null,
    secret ? Button({ key: "tool-reveal", plain: true, dimColor: true, label: tb.reveal ? "hide" : "show", onPress: () => handlers.onToolReveal?.() }) : null,
    tool.generates
      ? Button({ key: "tool-again", plain: true, label: tb.out ? "↻ again" : "↻ make", onPress: () => handlers.onToolAgain?.() })
      : Button({ key: "tool-paste", plain: true, label: "⧉ paste", onPress: () => handlers.onToolPaste?.() }),
  ].filter(Boolean) });
  return { name: tool.label, node: card(els, { key: "tb-tool", title: tool.label.toUpperCase(), color: SAND, metaNode, rows }), height };
}

export function toolboxDock(els, w, capacity, handlers) {
  const tb = state.toolbox;
  return stackCards(els, [menuCard(els, tb, w, handlers), toolCard(els, tb, w, handlers)], capacity, handlers.scroll);
}

// The inline pane: the tool on show and its first results.
export function toolboxInline(els, w, handlers) {
  const tb = state.toolbox;
  const tool = TOOLS[tb.tool];
  const out = tb.out;
  const head = line(els, "head", [
    { text: `${TOOLBOX_META.icon} ${TOOLBOX_META.label}`, bold: true, color: SAND },
    { text: `  ${tool.label}${out?.mode ? ` ${out.mode}` : ""}`, color: theme.muted, grow: true },
  ]);
  if (!out) return [head, els.Text({ key: "hint", color: theme.muted, wrap: "wrap", children: tool.hint })];
  const labelW = Math.min(10, Math.max(0, ...out.rows.map((r) => cells(r.label))));
  return [head, ...out.rows.slice(0, 3).map((r, i) => resultRow(els, tb, { ...r, block: false, text: r.text.split("\n")[0] }, i, w, handlers, labelW).node)];
}

// ---------------------------------------------------------------- the band

// What the band is about: the last tool run, or what's on the clipboard
// (read by the Clipboard room, when it has a tab), whichever is newer.
function subject(now) {
  const tb = state.toolbox;
  const latest = state.sysRooms?.includes("clipboard") ? state.clipboard?.items?.[0] : null;
  const seen = latest ? detectClip(latest.text, now) : null;
  if (seen && (!tb.used || latest.id !== tb.clipSeen)) return { clip: seen };
  if (tb.used && tb.out && !tb.out.error && tb.out.band) return { tool: TOOLS[tb.tool], out: tb.out };
  return null;
}

const bandText = (b) => (b.secret ? MASK : String(b.text).replace(/\s+/g, " "));
const copied = (now) => now - state.toolbox.copiedAt < COPIED_MS;

// The terminal's band, after the room's name.
export function toolboxBandPieces(width = 0, now = Date.now()) {
  const s = subject(now);
  const sep = { text: " · ", color: theme.muted };
  if (!s) return [{ text: `${TOOL_IDS.length} tools`, color: SAND, bold: true }, sep, { text: "try UUID · Hash · Time · JWT", color: theme.muted }];
  if (s.clip) {
    const c = s.clip;
    if (c.kind === "JWT") return [{ text: "clipboard: JWT", color: SAND, bold: true }, sep,
      { text: c.state.tone === "bad" ? `✕ ${c.state.text}` : `● ${c.state.text}`, color: tone(c.state.tone) }, sep,
      { text: [c.alg, c.role ? `role ${c.role}` : null].filter(Boolean).join(" · "), color: theme.muted }];
    return [{ text: "clipboard: ts", color: SAND, bold: true }, sep, { text: `${c.raw} → ${localOf(c.ms)}`, color: undefined }, sep, { text: c.ago, color: theme.muted }];
  }
  const b = s.out.band;
  const head = `${s.tool.label} ${b.meta}`;
  const tail = copied(now) ? "✓ copied" : "";
  const room = width ? Math.max(8, width - cells(head) - 3 - (tail ? cells(tail) + 3 : 0)) : 60;
  return [{ text: head, color: SAND, bold: true }, sep, { text: clip(bandText(b), room), color: b.secret ? theme.amber : undefined },
    tail ? sep : null, tail ? { text: tail, color: theme.online } : null].filter(Boolean);
}

function localOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// A hammer and a wrench: the room's mark on the desktop band.
const MARK = { source: K.svg(16, 16, `<path d="M3 13.5 9.2 7.3" stroke="${SAND}" stroke-width="2.2" stroke-linecap="round"/><path d="M8 3.2a3.2 3.2 0 0 0 4.6 4.3l.9.9-1.5 1.5-.9-.9A3.2 3.2 0 0 1 7 4.3l1.6 1.6 1.3-1.3z" fill="${SAND}"/><path d="M12.5 13.5 9.5 10.5" stroke="${SAND}" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/>`), width: 16, height: 16 };
// A short line, a dot where `pct` of the way is: how much of a JWT's life is gone.
const lifeBar = (pct, color) => K.progress(pct, color, { w: 34 });

// The desktop's band, as sections for the capsule. Kept short, so the
// capsule ends well before ‹ › and Open: three sections at most, and the
// result itself cut to a few dozen characters.
export function toolboxBandDesk(now = Date.now()) {
  const s = subject(now);
  if (!s) return { color: SAND, sections: [
    { key: "tools", color: SAND, parts: [draw(MARK, "Toolbox"), value(String(TOOL_IDS.length)), sub("tools")], tip: GROUPS.map((g) => `${g}: ${groupTools(g).map((id) => TOOLS[id].label).join(", ")}`) },
    { key: "try", color: SAND, parts: [sub("try UUID · Hash · Time · JWT")] },
  ] };
  if (s.clip) {
    const c = s.clip;
    if (c.kind === "JWT") {
      const color = tone(c.state.tone);
      const life = c.state.left == null ? null : c.state.left <= 0 ? 100 : 100 - Math.min(100, (c.state.left / (60 * 60_000)) * 100);
      return { color: SAND, sections: [
        { key: "kind", color: SAND, parts: [draw(MARK, "Toolbox"), label("clipboard"), chip("JWT", SAND, theme.onAccent)] },
        { key: "exp", color, parts: [life == null ? null : draw(lifeBar(life, color), "time left"), value(c.state.text.replace(/^valid for /, ""), color), c.state.tone === "ok" ? sub("left") : null],
          tip: [`JWT · ${c.alg}`, typeof c.exp === "number" ? `exp ${localOf(c.exp * 1000)}` : "no exp", "Open the room to read the claims"] },
        { key: "alg", color: SAND, parts: [label(c.alg), c.role ? sub(`role ${c.role}`) : null] },
      ] };
    }
    return { color: SAND, sections: [
      { key: "kind", color: SAND, parts: [draw(MARK, "Toolbox"), label("clipboard"), chip("ts", SAND, theme.onAccent)] },
      { key: "when", color: theme.usage, parts: [draw(K.icon("clock", theme.usage), "time"), value(localOf(c.ms))], tip: [c.raw, c.ago] },
    ] };
  }
  const b = s.out.band;
  const sections = [
    { key: "tool", color: SAND, parts: [draw(MARK, "Toolbox"), value(s.tool.label), sub(b.meta)] },
    { key: "out", color: b.secret ? theme.amber : SAND, grow: true, parts: [b.secret ? value(MASK, theme.amber) : msg(clip(bandText(b), 40))],
      tip: b.secret ? null : [s.tool.label, ...s.out.rows.slice(0, 5).map((r) => clip(`${r.label ? `${r.label}  ` : ""}${r.text.split("\n")[0]}`, 48))] },
  ];
  if (copied(now)) sections.push({ key: "copied", color: theme.online, parts: [value("✓ copied", theme.online)] });
  else if (s.out.strength) sections.push({ key: "strength", color: tone(s.out.status?.tone), parts: [value(s.out.strength, tone(s.out.status?.tone))] });
  return { color: SAND, sections };
}

// The tab's mark from another room: a JWT on the clipboard about to expire.
export function toolboxBadge(now = Date.now()) {
  const s = subject(now);
  const left = s?.clip?.kind === "JWT" ? s.clip.state.left : null;
  return left != null && left > 0 && left < SOON_MS ? { text: "!", color: theme.amber } : null;
}
