// Function rooms, drawn from their manifests: each card's widget is filled in
// from the providers' data with plain paths ("list.items") and templates
// ("{list.count} saved"). Nothing in a manifest runs. The same layout gives
// the docked pane, the inline pane, the band and a plain-text snapshot.

import { state } from "./state.mjs";
import { theme, palette, level, nameColor } from "./theme.mjs";
import { rowsFor, cells, clip, meter, tiles, line, card, stackCards, stretchBar, barNode, bigNumber, lineChart, sparkline } from "./widgets.mjs";
import * as K from "./bandkit.mjs";
import { capsule, draw, label as pLabel, value as pValue, sub as pSub, msg as pMsg, tag as pTag } from "./bands.mjs";

export function fnMeta(id) {
  const m = state.fn.get(id)?.manifest;
  return m ? { icon: m.icon, label: m.name, color: palette[m.color] ?? theme.accent } : null;
}

// "list.items.0.name" in the providers' data.
export function lookup(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function show(v) {
  if (v == null) return "–";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "object") return "–";
  return String(v);
}

// "{list.count} saved" → "3 saved".
export function fill(template, data) {
  return String(template ?? "").replace(/\{([A-Za-z0-9_.]+)\}/g, (_, p) => show(lookup(data, p)));
}

// A text widget's text: a line whose holes came out empty takes no room.
const fillText = (template, data) => fill(template, data).split("\n").filter((l) => l.trim()).join("\n");

// About the cells the ⧉ and ⇪ buttons take after a list row's text.
const PEEK_BUTTONS = 12;
const firstLine = (s) => String(s ?? "").split("\n").find((l) => l.trim()) ?? "";
const color = (name, fallback) => palette[name] ?? fallback;
const muted = (els, key, text) => els.Text({ key, color: theme.muted, wrap: "truncate-end", children: text });

// `obj` with `value` at `path`, the objects on the way copied.
function withPath(obj, path, value) {
  const [k, ...rest] = String(path).split(".");
  return { ...obj, [k]: rest.length ? withPath(obj?.[k] ?? {}, rest.join("."), value) : value };
}

// The tables whose rows are picked.
function pickTables(manifest) {
  const out = [];
  const walk = (b) => (Array.isArray(b) ? b.forEach(walk) : b?.pick ? out.push(b) : null);
  (manifest.layout?.cards ?? []).forEach((c) => { walk(c.body); walk(c.desktop); });
  walk(manifest.layout?.inline);
  return out;
}

// The row a table's setting names, or null (then what the provider put at
// `as` stays).
function pickedRow(room, b, data) {
  const items = lookup(data, b.items);
  if (!Array.isArray(items)) return null;
  const want = String(room.settings?.[b.pick.setting] ?? room.manifest.settings?.[b.pick.setting]?.default ?? "").toLowerCase();
  return items.find((it) => String(lookup(it, b.pick.field) ?? "").toLowerCase() === want) ?? null;
}

function roomState(id) {
  const room = state.fn.get(id);
  const providers = room?.manifest.providers ?? [];
  const loaded = providers.length > 0 && providers.every((p) => room.data[p.id] != null);
  const error = providers.map((p) => room.error[p.id]).find(Boolean) ?? null;
  const stale = providers.some((p) => room.stale[p.id]);
  let data = room?.data ?? {};
  for (const b of room ? pickTables(room.manifest) : []) {
    const row = pickedRow(room, b, data);
    if (row) data = withPath(data, b.pick.as, row);
  }
  return { room, data, loaded, error, stale };
}

// ---------------------------------------------------------------- widgets

// A list row as the desktop draws it with `code`: the title and its tag,
// Share and the row's act as labeled buttons, then the first lines of the
// preview as a code block, a little below, which carries its own copy. The
// act (Delete) asks once more before it runs.
const CODE_LINES = 4;
let armed = null;   // the row whose act was pressed once: { key, at }
function codeRow(els, k, b, item, title, handlers, room) {
  const { Box, Text, Button, Code } = els;
  const tag = b.tag ? lookup(item, b.tag) : null;
  const shareText = b.share ? lookup(item, b.share) : null;
  const actOn = b.act ? lookup(item, b.act.field) : null;
  const isArmed = armed?.key === k && Date.now() - armed.at < 5000;
  const act = () => {
    if (!(armed?.key === k && Date.now() - armed.at < 5000)) { armed = { key: k, at: Date.now() }; handlers.onRedraw?.(); return; }
    armed = null;
    handlers.onAction?.(room, { provider: b.act.provider, action: b.act.action, args: { [b.act.field.split(".").at(-1)]: actOn } });
  };
  const lines = String(lookup(item, b.preview) ?? "").split("\n");
  const shown = lines.slice(0, CODE_LINES).join("\n");
  return [
    Box({ key: k, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
      Text({ key: "t", bold: true, wrap: "truncate-end", children: title }),
      tag ? Text({ key: "tag", color: theme.muted, children: `· ${tag}` }) : null,
      Box({ key: "push", flexGrow: 1, minWidth: 1 }),
      shareText != null ? Button({ key: `share-${k}`, label: "⇪ Share", onPress: () => handlers.onShareItem?.({ title, lang: tag ?? null, body: String(shareText) }) }) : null,
      actOn != null ? Button({ key: `act-${k}`, label: isArmed ? "Sure?" : b.act.label, onPress: act }) : null,
    ].filter(Boolean) }),
    els.Svg({ key: `${k}-gap`, source: K.svg(1, 6, ""), alt: "gap", width: 1, height: 6 }),
    Box({ key: `${k}-code`, marginBottom: 1, children: [
      Code({ key: "c", source: shown, ...(tag ? { language: String(tag) } : {}) }),
    ] }),
    lines.length > CODE_LINES ? muted(els, `${k}-more`, `+ ${lines.length - CODE_LINES} more line${lines.length - CODE_LINES === 1 ? "" : "s"}`) : null,
  ].filter(Boolean);
}

// A story's open and share, at the end of its row: ↗ opens the link (the
// desktop's own anchor), ⇪ shares it to a chat room.
function storyActions(els, k, b, item, title, handlers) {
  const url = b.open ? lookup(item, b.open) : null;
  const shareText = b.share ? lookup(item, b.share) : null;
  return [
    url ? els.Link({ href: String(url), label: "↗" }) : null,
    shareText ? els.Button({ key: `share-${k}`, plain: true, label: "⇪", onPress: () => handlers.onShareItem?.({ title, lang: null, body: String(shareText) }) }) : null,
  ].filter(Boolean);
}

// A row a little apart from the one above it.
const rowGap = (els, k, i) => (i ? els.Svg({ key: `${k}-gap`, source: K.svg(1, 6, ""), alt: "gap", width: 1, height: 6 }) : null);

// A story as Hacker News shows it, on the desktop with `score`: the score in
// a box at the left (stronger at 300 and up), the title and its details
// beside it, open and share at the right.
function scoreRow(els, k, b, item, title, handlers, accent, i) {
  const { Box, Text } = els;
  const score = Number(lookup(item, b.score)) || 0;
  const hot = score >= 300;
  const c = accent ?? theme.accent;
  const detail = b.preview ? firstLine(lookup(item, b.preview)) : "";
  return [rowGap(els, k, i), Box({ key: k, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
    Box({ key: "score", flexDirection: "column", alignItems: "center", width: 5, flexShrink: 0, backgroundColor: hot ? K.tint(theme.accent, 0.2) : K.tint("#8F8D87", 0.18), children: [
      Text({ key: "n", bold: true, color: hot ? theme.accent : undefined, children: String(score) }),
      Text({ key: "u", color: theme.muted, children: "pts" }),
    ] }),
    Box({ key: "text", flexDirection: "column", flexGrow: 1, minWidth: 0, children: [
      Text({ key: "t", bold: true, wrap: "truncate-end", children: title }),
      detail ? Text({ key: "d", color: theme.muted, wrap: "truncate-end", children: detail }) : null,
    ].filter(Boolean) }),
    ...storyActions(els, k, b, item, title, handlers),
  ] })].filter(Boolean);
}

// The list grouped by a field (a feed's source), each group under a chip with
// its count and a fold. The tag (the age) sits at each row's right.
const foldedGroups = new Set();
function groupedList(els, b, items, key, handlers) {
  const { Box, Text, Button } = els;
  const groups = new Map();
  for (const it of items) {
    const g = String(lookup(it, b.group) ?? "");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const nodes = [];
  [...groups].forEach(([g, list], gi) => {
    const c = nameColor(g);
    const folded = foldedGroups.has(`${key}:${g}`);
    nodes.push(Box({ key: `${key}-g${gi}`, flexDirection: "row", alignItems: "center", columnGap: 1, marginTop: gi ? 1 : 0, children: [
      Text({ key: "src", bold: true, color: c, backgroundColor: K.tint(c, 0.18), children: ` ${g || "other"} ` }),
      Text({ key: "n", color: theme.muted, children: String(list.length) }),
      Button({ key: `fold-${key}-${gi}`, plain: true, dimColor: true, label: folded ? "▸" : "▾", onPress: () => {
        const id = `${key}:${g}`;
        if (!foldedGroups.delete(id)) foldedGroups.add(id);
        handlers.onRedraw?.();
      } }),
    ] }));
    if (folded) return;
    list.forEach((it, i) => {
      const k = `${key}-${String(it?.id ?? `${gi}-${i}`)}`;
      const title = show(lookup(it, b.title));
      const tag = b.tag ? lookup(it, b.tag) : null;
      nodes.push(rowGap(els, k, 1));
      nodes.push(Box({ key: k, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
        Text({ key: "t", bold: true, wrap: "truncate-end", children: title }),
        Box({ key: "push", flexGrow: 1, minWidth: 1 }),
        tag ? Text({ key: "tag", color: theme.muted, children: String(tag) }) : null,
        ...storyActions(els, k, b, it, title, handlers),
      ].filter(Boolean) }));
    });
  });
  return { nodes, height: nodes.length };
}

// Items as tiles, two across: the title and its change at the top with a pin,
// the value large, the sub line, and the item's line as a filled chart along
// the bottom, all in the item's color. The pin keeps the item in the `pick`
// setting (the band shows that one); the pinned tile is outlined.
function gridWidget(els, b, data, w, key, handlers, room, accent) {
  const { Box, Text, Button } = els;
  const items = lookup(data, b.items);
  if (!Array.isArray(items) || !items.length) return { nodes: [Text({ key, color: theme.muted, wrap: "wrap", children: b.empty ?? "Nothing here yet." })], height: 1 };
  const picked = b.pick ? String(lookup(data, `${b.pick.as}.${b.pick.field}`) ?? "") : null;
  // A tile's ✕ takes it out of a list setting, while the list holds more than its least.
  const dropSt = b.drop ? state.fn.get(room)?.manifest.settings?.[b.drop.setting] : null;
  const dropList = dropSt ? state.fn.get(room)?.settings?.[b.drop.setting] ?? dropSt.default ?? [] : [];
  const canDrop = !!dropSt && dropList.length > (dropSt.min ?? 1);
  const tile = (it, i) => {
    const c = color(b.colorFrom ? lookup(it, b.colorFrom) : null, accent ?? theme.accent);
    const id = b.pick ? String(lookup(it, b.pick.field) ?? "") : "";
    const pinned = b.pick && id === picked;
    const value = b.value ? show(lookup(it, b.value)) : "";
    const line = b.line ? lookup(it, b.line) : null;
    const title = show(lookup(it, b.title));
    const pick = () => { if (!pinned) handlers.onSetSetting?.(room, b.pick.setting, id); };
    // With `icon`, the item's sky drawn beside its value (a city's weather).
    const sym = b.icon ? lookup(it, b.icon) : null;
    const big = value && value !== "–" ? bigNumber(els, "v", value, "#E8E6E1") : null;
    return Box({ key: `${key}-t${i}`, flexDirection: "column", width: 1, flexGrow: 1, minWidth: 0, borderStyle: "round", borderColor: pinned ? accent ?? theme.accent : theme.border, paddingX: 1, children: [
      Box({ key: "top", flexDirection: "row", alignItems: "center", columnGap: 1, children: [
        // `pickTitle`: the title is pressed to pick the tile, in place of a pin.
        b.pick && b.pickTitle
          ? Button({ key: `pick-${key}-${i}`, plain: true, label: title, onPress: pick })
          : Text({ key: "t", bold: true, wrap: "truncate-end", children: title }),
        Box({ key: "push", flexGrow: 1, minWidth: 1 }),
        b.change ? Text({ key: "c", color: c, children: show(lookup(it, b.change)) }) : null,
        b.pick && !b.pickTitle ? Button({ key: `pin-${key}-${i}`, plain: true, dimColor: !pinned, label: pinned ? "📌" : "⚲", onPress: pick }) : null,
        canDrop && lookup(it, b.drop.field) != null ? Button({ key: `drop-${key}-${i}`, plain: true, dimColor: true, label: "✕", onPress: () => handlers.onSetSetting?.(room, b.drop.setting, `-${lookup(it, b.drop.field)}`) }) : null,
      ].filter(Boolean) }),
      typeof sym === "string" && sym && big
        ? Box({ key: "vi", flexDirection: "row", alignItems: "center", columnGap: 1, children: [els.Svg({ key: "sky", ...K.weather(sym, theme.amber, 22), alt: sym }), big] })
        : big,
      b.sub ? Text({ key: "s", color: theme.muted, wrap: "truncate-end", children: show(lookup(it, b.sub)) }) : null,
      b.note ? Text({ key: "n", color: theme.muted, wrap: "truncate-end", children: show(lookup(it, b.note)) }) : null,
      Array.isArray(line) && line.length > 1 ? lineChart(els, "chart", [line.map(Number)], [c], { height: 24 }) : null,
    ].filter(Boolean) });
  };
  const nodes = [];
  const across = b.across ?? 2;
  for (let i = 0; i < items.length; i += across) {
    // The tiles split the row; a short last row keeps their width, beside fillers.
    const row = items.slice(i, i + across).map((it, j) => tile(it, i + j));
    for (let f = row.length; f < across; f++) row.push(Box({ key: `${key}-fill${f}`, width: 1, flexGrow: 1, minWidth: 0 }));
    nodes.push(Box({ key: `${key}-r${i}`, flexDirection: "row", columnGap: 1, marginTop: i ? 1 : 0, children: row }));
  }
  // A hint under the tiles, while there's more than one to pick from.
  const hint = b.hint && items.length > 1 ? fill(b.hint, data) : "";
  if (hint) nodes.push(Text({ key: `${key}-hint`, color: theme.muted, wrap: "truncate-end", children: hint }));
  return { nodes, height: Math.ceil(items.length / across) * (6 + (b.note ? 1 : 0)) + (hint ? 1 : 0) };
}

// A small equalizer: three bars in the accent, still (a drawing can't move).
const equalizer = (els, key, c) => els.Svg({ key, source: K.svg(14, 14, [[0, 6], [5, 11], [10, 8]].map(([x, h]) => `<rect x="${x}" y="${14 - h}" width="3.5" height="${h}" rx="1" fill="${c}"/>`).join("")), alt: "playing", width: 14, height: 14 });

// A list row as the desktop draws it with `lit`: the row whose `lit` field
// is set has a tinted ground and the accent, and a ♫ button (the room's
// `pause` action) where the others have their ▶ (the row's act), the same
// size so the titles line up. The tag is a chip, then the row's ✕ (`remove`),
// which asks once more. Rows sit a little apart.
function litRow(els, k, b, item, title, handlers, room, accent, i) {
  const { Box, Text, Button } = els;
  const on = !!lookup(item, b.lit);
  const tag = b.tag ? lookup(item, b.tag) : null;
  const actOn = b.act ? lookup(item, b.act.field) : null;
  const rmOn = b.remove ? lookup(item, b.remove.field) : null;
  const c = accent ?? theme.accent;
  const run = (a, v) => handlers.onAction?.(room, { provider: a.provider, action: a.action, args: v == null ? {} : { [a.field.split(".").at(-1)]: v } });
  const isArmed = armed?.key === `rm-${k}` && Date.now() - armed.at < 5000;
  const remove = () => {
    if (!(armed?.key === `rm-${k}` && Date.now() - armed.at < 5000)) { armed = { key: `rm-${k}`, at: Date.now() }; handlers.onRedraw?.(); return; }
    armed = null;
    run(b.remove, rmOn);
  };
  return [
    i ? els.Svg({ key: `${k}-gap`, source: K.svg(1, 5, ""), alt: "gap", width: 1, height: 5 }) : null,
    Box({ key: k, flexDirection: "row", alignItems: "center", columnGap: 1, paddingX: 1, ...(on ? { backgroundColor: K.tint(c, 0.12) } : {}), children: [
      on ? Button({ key: `act-${k}`, label: "♫", onPress: () => (b.pause ? run({ action: b.pause }, null) : null) })
        : actOn != null ? Button({ key: `act-${k}`, label: b.act.label, onPress: () => run(b.act, actOn) }) : null,
      Text({ key: "t", bold: true, color: on ? c : undefined, wrap: "truncate-end", children: title }),
      Box({ key: "push", flexGrow: 1, minWidth: 1 }),
      tag ? Text({ key: "tag", color: on ? c : theme.muted, backgroundColor: K.tint(on ? c : "#8F8D87", 0.18), children: ` ${tag} ` }) : null,
      // plain and dimColor take true alone: an armed ✕ leaves them out.
      rmOn != null ? Button({ key: `rm-${k}`, ...(isArmed ? {} : { plain: true, dimColor: true }), label: isArmed ? "Sure?" : "✕", onPress: remove }) : null,
    ].filter(Boolean) }),
  ].filter(Boolean);
}

// What's playing, as a music app shows it: a cover square, the title and
// where it's from, then the track's time as a bar (elapsed, bar, total), or
// LIVE for a stream with no length.
function mediaWidget(els, b, data, key, accent) {
  const { Box, Text } = els;
  const title = fill(b.title, data).trim();
  const sub = b.sub ? fill(b.sub, data).trim() : "";
  const c = accent ?? theme.accent;
  if (!title || title === "–") return { nodes: [Text({ key, color: theme.muted, children: b.empty ? fill(b.empty, data) : "Not playing" })], height: 1 };
  if (!els.Svg) {
    const time = [b.elapsed ? fill(b.elapsed, data) : "", b.total ? fill(b.total, data) : ""].filter((x) => x && x !== "–").join(" / ");
    return { nodes: [Text({ key, wrap: "wrap", children: [title, sub, time].filter(Boolean).join("\n") })], height: 3 };
  }
  const live = b.live ? !!lookup(data, b.live) : false;
  const playing = b.playing ? !!lookup(data, b.playing) : true;
  const pct = b.progress ? Number(lookup(data, b.progress)) : NaN;
  const cover = els.Svg({ key: "cover", width: 52, height: 52, alt: "cover", source: K.svg(52, 52,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${theme.amber}"/></linearGradient></defs>`
    + `<rect width="52" height="52" rx="9" fill="url(#g)"/><text x="26" y="34" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="22" fill="#1F1E1D">♫</text>`) });
  const time = live
    ? [playing ? equalizer(els, "eq", c) : null, Text({ key: "live", bold: true, color: c, backgroundColor: K.tint(c, 0.18), children: " ● LIVE " }),
      b.elapsed ? Text({ key: "since", color: theme.muted, children: fill(b.elapsed, data) }) : null].filter(Boolean)
    : [Text({ key: "a", color: theme.muted, children: b.elapsed ? fill(b.elapsed, data) : "" }),
      stretchBar(els, "bar", Number.isFinite(pct) ? pct : 0, c),
      Text({ key: "b", color: theme.muted, children: b.total ? fill(b.total, data) : "" })];
  return { nodes: [Box({ key, flexDirection: "row", alignItems: "center", columnGap: 2, children: [
    cover,
    Box({ key: "text", flexDirection: "column", flexGrow: 1, minWidth: 0, children: [
      Text({ key: "t", bold: true, wrap: "truncate-end", children: title }),
      sub ? Text({ key: "s", color: theme.muted, wrap: "truncate-end", children: sub }) : null,
      Box({ key: "time", flexDirection: "row", alignItems: "center", columnGap: 1, children: time }),
    ].filter(Boolean) }),
  ] }), els.Svg({ key: `${key}-gap`, source: K.svg(1, 8, ""), alt: "gap", width: 1, height: 8 })], height: 4 };
}

// A button's label: its `alt` while the path `altWhen` holds, so one button
// shows the one thing it will do (⏸ while playing, ▶ while not).
// A line over the hours (the temperature) with bars under it (the chance
// of rain, 0-100), stretched across the card, the times under them. The
// high and the low are marked on the line: a dot, and the degrees by it.
function forecastWidget(els, b, data, w, key, accent) {
  const { Box, Text } = els;
  const vals = (lookup(data, b.values) ?? []).map((v) => (v == null ? NaN : Number(v)));
  const bars = (b.bars ? lookup(data, b.bars) ?? [] : []).map((v) => Number(v) || 0);
  const marks = b.marks ? lookup(data, b.marks) ?? [] : [];
  const caption = b.caption ? fill(b.caption, data) : "";
  const known = vals.filter(Number.isFinite);
  if (known.length < 2) return { nodes: [], height: 0 };
  const lineC = color(b.color, theme.amber);
  const barC = color(b.color2, palette.sky ?? theme.accent);
  if (!els.Svg) {
    return { nodes: [Text({ key, color: lineC, wrap: "truncate-end", children: sparkline(vals.map((x) => x - Math.min(...known)), w) })], height: 1 };
  }
  const W = 1000, LINE = 44, BAR = 22;
  const top = Math.max(...known), bottom = Math.min(...known);
  const span = Math.max(top - bottom, 1);
  const n = vals.length;
  const x = (i) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v) => LINE - 3 - ((v - bottom) / span) * (LINE - 8);
  const d = vals.map((v, i) => (Number.isFinite(v) ? `${x(i).toFixed(1)} ${y(v).toFixed(1)}` : null)).filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p}`).join(" ");
  const hiAt = vals.indexOf(top), loAt = vals.indexOf(bottom);
  // A dot that stays round however the drawing is stretched: a stroke of no
  // length with round caps, its width not scaled.
  const dot = (i, v) => `<path d="M${x(i).toFixed(1)} ${y(v).toFixed(1)}h0" stroke="${lineC}" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const svg = (k, h, body, alt) => Box({ key: k, flexDirection: "row", children: [Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", children: [
    els.Svg({ key: "svg", source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">${body}</svg>`, alt, height: h }),
  ] })] });
  // Words can't sit in the stretched drawing (they'd stretch too), so each
  // is a row of its own, pushed along it to its point's share of the width.
  const at = (k, i, text, style) => Box({ key: k, flexDirection: "row", children: [
    Box({ key: "l", flexGrow: i, minWidth: 0 }),
    Text({ key: "t", ...style, children: text }),
    Box({ key: "r", flexGrow: n - 1 - i, minWidth: 0 }),
  ] });
  const slot = bars.length ? W / bars.length : 0;
  const rects = bars.map((v, i) => {
    const h = Math.max(1, (Math.min(100, v) / 100) * BAR);
    return `<rect x="${(i * slot + slot * 0.15).toFixed(1)}" y="${(BAR - h).toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="${barC}" fill-opacity="${v ? 0.8 : 0.25}"/>`;
  }).join("");
  const nodes = [
    at(`${key}-hi`, hiAt, `${top}°`, { bold: true, color: lineC }),
    svg(key, LINE, `<path d="${d} L${W} ${LINE} L0 ${LINE}Z" fill="${K.tint(lineC, 0.15)}"/>`
      + `<path d="${d}" fill="none" stroke="${lineC}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${dot(hiAt, top)}${dot(loAt, bottom)}`, "forecast"),
    at(`${key}-lo`, loAt, `${bottom}°`, { color: theme.muted }),
  ];
  if (bars.length) nodes.push(svg(`${key}-rain`, BAR, rects, "rain"));
  if (marks.length) {
    // The times spread under the chart: the first at the left edge.
    const row = [];
    marks.forEach((m, i) => {
      if (i) row.push(Box({ key: `p${i}`, flexGrow: 1, minWidth: 1 }));
      row.push(Text({ key: `m${i}`, color: theme.muted, children: show(m) }));
    });
    row.push(Box({ key: "pend", flexGrow: 1, minWidth: 1 }));
    nodes.push(Box({ key: `${key}-marks`, flexDirection: "row", children: row }));
  }
  if (caption) nodes.push(Text({ key: `${key}-cap`, color: theme.muted, wrap: "truncate-end", children: caption }));
  return { nodes, height: 7 + (marks.length ? 1 : 0) + (caption ? 1 : 0) };
}

// Items as columns side by side, each its title, sky, value, sub and note
// down the middle (a week: day, sky, high, low, rain); the `lit` one outlined.
function stripWidget(els, b, data, w, key, accent) {
  const { Box, Text } = els;
  const items = lookup(data, b.items);
  if (!Array.isArray(items) || !items.length) return { nodes: [Text({ key, color: theme.muted, wrap: "wrap", children: b.empty ?? "Nothing here yet." })], height: 1 };
  if (!els.Svg) {
    const text = items.map((it) => [lookup(it, b.title), b.icon && lookup(it, b.icon), b.value && lookup(it, b.value)].filter(Boolean).join(" ")).join(" · ");
    return { nodes: [Text({ key, wrap: "wrap", children: text })], height: rowsFor(text, w) };
  }
  const col = (it, i) => {
    const sym = b.icon ? lookup(it, b.icon) : null;
    const lit = b.lit && !!lookup(it, b.lit);
    return Box({ key: `${key}-d${i}`, flexDirection: "column", alignItems: "center", width: 1, flexGrow: 1, minWidth: 0, borderStyle: "round", borderColor: lit ? accent ?? theme.accent : theme.border, children: [
      Text({ key: "t", color: lit ? accent : undefined, wrap: "truncate-end", children: show(lookup(it, b.title)) }),
      typeof sym === "string" && sym ? els.Svg({ key: "sky", ...K.weather(sym, theme.amber, 16), alt: sym }) : null,
      b.value ? Text({ key: "v", bold: true, wrap: "truncate-end", children: show(lookup(it, b.value)) }) : null,
      b.sub ? Text({ key: "s", color: theme.muted, wrap: "truncate-end", children: show(lookup(it, b.sub)) }) : null,
      b.note ? Text({ key: "n", color: palette.sky ?? theme.accent, wrap: "truncate-end", children: show(lookup(it, b.note)) }) : null,
    ].filter(Boolean) });
  };
  return { nodes: [Box({ key, flexDirection: "row", columnGap: 1, children: items.map(col) })], height: 7 };
}

// Sunrise to sunset as an arc across the card, the sun on it where the day
// is now (`value`, 0-100; at night a moon at its top instead), the `note`
// (what comes next) under it, sunrise and sunset at its feet and the `sub`
// (the daylight) between them.
function sunWidget(els, b, data, w, key) {
  const { Box, Text } = els;
  const rise = fill(b.rise, data);
  const set = fill(b.set, data);
  if (!rise || !set) return { nodes: [], height: 0 };
  const sub = b.sub ? fill(b.sub, data) : "";
  const note = b.note ? fill(b.note, data) : "";
  if (!els.Svg) {
    const text = [`☀ ${rise} → ${set}`, sub, note].filter(Boolean).join(" · ");
    return { nodes: [Text({ key, wrap: "wrap", children: text })], height: rowsFor(text, w) };
  }
  const sunC = theme.amber;
  const W = 480, H = 84, Y = 76;
  const P = [[20, Y], [W / 2, -36], [W - 20, Y]];
  // None at night: the provider leaves it out, and Number(null) would be 0.
  const raw = b.value != null ? lookup(data, b.value) : null;
  const pct = raw == null || raw === "" ? NaN : Number(raw);
  const day = Number.isFinite(pct);
  const lerp = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  const pt = (p) => p.map((n) => n.toFixed(1)).join(",");
  let mark;
  if (day) {
    // The arc up to now, split from the whole at t (de Casteljau).
    const t = Math.min(1, Math.max(0, pct / 100));
    const q0 = lerp(P[0], P[1], t), q1 = lerp(P[1], P[2], t), at = lerp(q0, q1, t);
    mark = `<path d="M${pt(P[0])} Q${pt(q0)} ${pt(at)}" fill="none" stroke="${sunC}" stroke-width="2.5"/>`
      + `<circle cx="${at[0].toFixed(1)}" cy="${at[1].toFixed(1)}" r="7" fill="${sunC}"/>`;
  } else {
    mark = `<path d="M${W / 2 + 4} 8a9 9 0 1 0 8 14.5A8 8 0 0 1 ${W / 2 + 4} 8z" fill="#C9C6BE"/>`;
  }
  // A drawing needs a real color: the theme's "subtle" is a name only Text knows.
  const words = note ? `<text x="${W / 2}" y="${Y - 8}" fill="#B9B6AE" font-family="-apple-system, system-ui, sans-serif" font-size="13" text-anchor="middle">${note.replace(/[<&>]/g, "")}</text>` : "";
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<line x1="0" y1="${Y}" x2="${W}" y2="${Y}" stroke="#4A4946"/>`
    + `<path d="M${pt(P[0])} Q${pt(P[1])} ${pt(P[2])}" fill="none" stroke="${day ? "#4A4946" : "#3A3936"}" stroke-width="1.5" stroke-dasharray="4 4"/>${mark}${words}</svg>`;
  const end = (k, label, time, align) => Box({ key: k, flexDirection: "column", alignItems: align, children: [
    Text({ key: "l", color: theme.muted, children: label }),
    Text({ key: "t", bold: true, children: time }),
  ] });
  return { nodes: [
    Box({ key, flexDirection: "row", justifyContent: "center", children: [Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", alignItems: "center", children: [
      els.Svg({ key: "arc", source, alt: day ? `sun ${Math.round(pct)}%` : "sun, night", height: H }),
    ] })] }),
    Box({ key: `${key}-ends`, flexDirection: "row", alignItems: "flex-end", children: [
      end("rise", "SUNRISE", rise, "flex-start"),
      Box({ key: "mid", flexGrow: 1, minWidth: 0, alignItems: "center", children: [sub ? Text({ key: "s", color: theme.muted, wrap: "truncate-end", children: sub }) : null].filter(Boolean) }),
      end("set", "SUNSET", set, "flex-end"),
    ] }),
  ], height: 7 };
}

const btnLabel = (x, data) => (x.alt && x.altWhen && lookup(data, x.altWhen) ? x.alt : x.label);

// One widget's rows, at most `limit` of them: { nodes, height }.
function widget(els, b, data, w, handlers, { limit = Infinity, accent, key = "w", room } = {}) {
  const { Box, Text, Button } = els;
  if (b.type === "buttons" && els.Svg && b.split) {
    // The desktop: the first `split` buttons at the left, the rest at the
    // right around the level they move ("− 60% +").
    const btn = (x, i) => Button({ key: `act-${key}-${i}`, label: btnLabel(x, data), onPress: () => handlers.onAction?.(room, { provider: x.provider, action: x.action, args: x.args ?? {} }) });
    const level = b.level != null ? Number(lookup(data, b.level)) : NaN;
    const right = b.buttons.slice(b.split).map((x, i) => btn(x, b.split + i));
    if (Number.isFinite(level) && right.length) right.splice(Math.ceil(right.length / 2), 0, Text({ key: "level", bold: true, color: accent, children: `${Math.round(level)}%` }));
    return { nodes: [Box({ key, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
      ...b.buttons.slice(0, b.split).map(btn),
      Box({ key: "push", flexGrow: 1, minWidth: 1 }),
      ...right,
    ] })], height: 1 };
  }
  if (b.type === "buttons") {
    return { nodes: [Box({ key, flexDirection: "row", gap: 1, flexWrap: "wrap", children: b.buttons.map((btn, i) => Box({ key: `b${i}`, flexShrink: 0, children: [
      Button({ key: `act-${key}-${i}`, label: btnLabel(btn, data), onPress: () => handlers.onAction?.(room, { provider: btn.provider, action: btn.action, args: btn.args ?? {} }) }),
    ] })) })], height: 1 };
  }
  if (b.type === "list" || b.type === "table") {
    const all = lookup(data, b.items);
    const items = Array.isArray(all) ? all : [];
    if (!items.length) {
      const text = b.empty ?? "Nothing here yet.";
      return { nodes: [Text({ key: `${key}-empty`, color: theme.muted, wrap: "wrap", children: text })], height: rowsFor(text, w) };
    }
    if (els.Svg && b.group) return groupedList(els, b, items, key, handlers);
    const header = b.type === "table" && b.columns.some((c) => c.label) ? 1 : 0;
    const per = b.type === "list" && b.preview ? 2 : 1;
    let n = Math.min(items.length, b.max ?? items.length);
    if (header + n * per > limit) n = Math.max(0, Math.floor((limit - header - 1) / per));
    const more = items.length - n;
    const nodes = [];
    // The column marked `grow` takes the row's spare space, or else the last
    // one when it has no width.
    const grows = (c, i) => (b.columns.some((x) => x.grow) ? !!c.grow : i === b.columns.length - 1 && !c.width);
    // A row's ✕ takes it out of a list setting, while the list holds more
    // than its least. Its column stays when the ✕ goes, so rows line up.
    const dropSt = b.drop ? state.fn.get(room)?.manifest.settings?.[b.drop.setting] : null;
    const dropList = dropSt ? state.fn.get(room)?.settings?.[b.drop.setting] ?? dropSt.default ?? [] : [];
    const canDrop = !!dropSt && dropList.length > (dropSt.min ?? 0);
    const picked = b.pick ? lookup(data, `${b.pick.as}.${b.pick.field}`) : null;
    if (header) {
      nodes.push(line(els, `${key}-head`, [...b.columns.map((c, i) => (grows(c, i)
        ? { text: c.label ?? "", color: theme.muted, grow: true, right: c.right }
        : { text: c.label ?? "", width: c.width ?? 12, right: c.right, color: theme.muted })), dropSt ? { text: "", width: 1 } : null], { gap: 1 }));
    }
    items.slice(0, n).forEach((item, i) => {
      const k = `${key}-${String(item?.id ?? i)}`;
      if (b.type === "table") {
        // A column's color: fixed, or named by the row ("colorFrom": a
        // field holding one of the palette's names, as a quote's up or down).
        const tint = (c) => color(c.colorFrom ? lookup(item, c.colorFrom) : null, color(c.color));
        const dropOn = canDrop ? lookup(item, b.drop.field) : null;
        // With `pick`, the growing column is pressed to pick its row, and
        // the rows not picked are dimmed.
        const pickOn = b.pick ? lookup(item, b.pick.field) : null;
        const pickBtn = (text) => Button({ key: `pick-${k}`, plain: true, label: text, dimColor: String(pickOn) !== String(picked), onPress: () => handlers.onSetSetting?.(room, b.pick.setting, String(pickOn)) });
        nodes.push(line(els, k, [...b.columns.map((c, j) => (grows(c, j)
          ? { text: show(lookup(item, c.field)), grow: true, right: c.right, color: tint(c), node: pickOn != null ? pickBtn(show(lookup(item, c.field))) : undefined }
          : { text: show(lookup(item, c.field)), width: c.width ?? 12, right: c.right, color: tint(c) })),
        dropOn != null
          ? { node: Button({ key: `drop-${k}`, plain: true, label: "✕", onPress: () => handlers.onSetSetting?.(room, b.drop.setting, `-${dropOn}`) }) }
          : dropSt ? { text: "", width: 1 } : null], { gap: 1 }));
        return;
      }
      // Numbered snippets read "#2", and on one row with no preview under it
      // their first line follows the number, as a number alone says nothing.
      const numbered = room === "snippet" && /^\d+$/.test(show(lookup(item, b.title)));
      const title = numbered ? `#${show(lookup(item, b.title))}` : show(lookup(item, b.title));
      // Cut to the room left beside the number and the ⧉ ⇪ buttons: VS Code
      // wraps a row whose text runs past the pane rather than cutting it.
      const peek = numbered && per === 1 ? clip(firstLine(lookup(item, b.preview ?? b.copy)), w - cells(title) - 2 - PEEK_BUTTONS) : "";
      if (els.Svg && b.score) return nodes.push(...scoreRow(els, k, b, item, title, handlers, accent, i));
      if (els.Svg && b.lit) return nodes.push(...litRow(els, k, b, item, title, handlers, room, accent, i));
      if (els.Svg && b.code) return nodes.push(...codeRow(els, k, b, item, title, handlers, room));
      // A mark before the title, in a column of its own so titles line up:
      // the ♫ on the station playing.
      const mark = b.mark ? show(lookup(item, b.mark)) : null;
      const tag = b.tag ? lookup(item, b.tag) : null;
      const copyText = b.copy ? lookup(item, b.copy) : null;
      const shareText = b.share ? lookup(item, b.share) : null;
      const actOn = b.act ? lookup(item, b.act.field) : null;
      nodes.push(line(els, k, [
        actOn != null ? { node: Button({ key: `act-${k}`, plain: true, label: b.act.label, onPress: () => handlers.onAction?.(room, { provider: b.act.provider, action: b.act.action, args: { [b.act.field.split(".").at(-1)]: actOn } }) }) } : null,
        actOn != null ? { text: " " } : null,
        mark != null ? { text: mark, width: 2, color: accent } : null,
        { text: title, bold: true, grow: !peek },
        peek ? { text: `  ${peek}`, color: theme.muted, grow: true } : null,
        tag ? { text: ` ${tag}`, color: theme.muted } : null,
        copyText ? { text: " " } : null,
        copyText ? { node: Button({ key: `copy-${k}`, plain: true, label: "⧉", onPress: (press) => handlers.onCopy?.(String(copyText), press?.surface) }) } : null,
        shareText ? { text: " " } : null,
        shareText ? { node: Button({ key: `share-${k}`, plain: true, label: "⇪", onPress: () => handlers.onShareItem?.({ title, lang: tag ?? null, body: String(shareText) }) }) } : null,
      ]));
      if (per === 2) nodes.push(line(els, `${k}-p`, [{ text: `  ${firstLine(lookup(item, b.preview))}`, color: accent ?? theme.muted, dim: true, grow: true }]));
    });
    if (more > 0) nodes.push(muted(els, `${key}-more`, `+ ${more} more`));
    return { nodes, height: header + n * per + (more > 0 ? 1 : 0) };
  }
  if (b.type === "tiles") {
    const list = b.tiles.map((t) => ({ value: fill(t.value, data), sub: t.sub ? fill(t.sub, data) : "", color: color(t.tone ? lookup(data, t.tone) : t.color, color(t.color, accent)) }));
    return { nodes: [tiles(els, list, w)], height: 2 };
  }
  if (b.type === "media") return mediaWidget(els, b, data, key, accent);
  if (b.type === "grid") return gridWidget(els, b, data, w, key, handlers, room, accent);
  if (b.type === "forecast") return forecastWidget(els, b, data, w, key, accent);
  if (b.type === "strip") return stripWidget(els, b, data, w, key, accent);
  if (b.type === "sun") return sunWidget(els, b, data, w, key);
  if (b.type === "stat") {
    // A percent set large, its level's color, a note at the right.
    const pct = Number(lookup(data, b.value));
    const known = Number.isFinite(pct);
    const tint = b.color ? color(b.color) : known ? level(pct) : theme.muted;
    const text = known ? `${Math.round(pct)}%` : "–";
    const right = b.right ? fill(b.right, data) : "";
    return { nodes: [Box({ key, flexDirection: "row", alignItems: "center", children: [
      els.Svg ? bigNumber(els, "n", text, tint) : Text({ key: "n", bold: true, color: tint, children: text }),
      Box({ key: "push", flexGrow: 1, minWidth: 1 }),
      right ? Text({ key: "r", color: theme.muted, wrap: "truncate-end", children: right }) : null,
    ].filter(Boolean) })], height: els.Svg ? 2 : 1 };
  }
  if (b.type === "bar") {
    const pct = Number(lookup(data, b.value));
    const tint = b.color ? color(b.color) : level(pct);
    return { nodes: [els.Svg
      ? Box({ key, flexDirection: "row", children: [stretchBar(els, "b", pct, tint, { thick: true })] })
      : barNode(els, key, pct, w, tint)], height: 1 };
  }
  if (b.type === "chart") {
    const series = [lookup(data, b.values), b.values2 ? lookup(data, b.values2) : null].filter(Array.isArray).map((v) => v.map(Number));
    const colors = [color(b.color, accent), color(b.color2, theme.usage)];
    const caption = b.caption ? fill(b.caption, data) : "";
    if (!series.length) return { nodes: [], height: 0 };
    if (!els.Svg) {
      const top = b.max ?? Math.max(1, ...series.flat().filter(Number.isFinite));
      return { nodes: series.map((v, i) => Text({ key: `${key}-${i}`, color: colors[i], wrap: "truncate-end", children: sparkline(v.map((x) => (Number.isFinite(x) ? (x / top) * 100 : 0)), w) })), height: series.length };
    }
    const nodes = [lineChart(els, key, series, colors, { max: b.max })];
    if (caption) nodes.push(Text({ key: `${key}-cap`, color: theme.muted, wrap: "truncate-end", children: caption }));
    return { nodes, height: 2 + (caption ? 1 : 0) };
  }
  if (b.type === "meter") {
    const pct = Number(lookup(data, b.value));
    return { nodes: [meter(els, { key, label: fill(b.label, data), pct: Number.isFinite(pct) ? pct : undefined, width: w, right: b.right ? fill(b.right, data) : "", color: b.color ? color(b.color) : undefined })], height: 1 };
  }
  const text = fillText(b.text, data);
  if (!text) return { nodes: [], height: 0 };
  return { nodes: [Box({ key, children: [Text({ key: "t", color: color(b.color), wrap: "wrap", children: text })] })], height: rowsFor(text, w) };
}

// A card's body: one widget, or a column of them, within `limit` rows.
function body(els, b, data, w, handlers, { limit = Infinity, accent, key, room }) {
  if (!Array.isArray(b)) return widget(els, b, data, w, handlers, { limit, accent, key, room });
  const nodes = [];
  let height = 0;
  b.forEach((one, i) => {
    const part = widget(els, one, data, w, handlers, { limit: Math.max(1, limit - height), accent, key: `${key}-${i}`, room });
    nodes.push(...part.nodes);
    height += part.height;
  });
  return { nodes, height };
}

// The cards whose `when` holds (a card without one always shows).
const shownCards = (layout, data) => layout.cards.filter((c) => !c.when || !!lookup(data, c.when));

// ---------------------------------------------------------------- the pane

// The docked pane's cards for a function room, in a window `capacity` rows
// tall. A list gives up rows ("+ 3 more") to fit the window, and cards
// past its bottom are a scroll away.
export function fnDock(els, id, w, capacity, handlers) {
  const meta = fnMeta(id);
  const { room, data, loaded, error, stale } = roomState(id);
  if (!room) return [];
  if (!loaded) {
    const text = error ? `⚠ ${error}` : "Loading…";
    return [card(els, { key: "fn-wait", title: meta.label.toUpperCase(), color: meta.color, rows: [els.Text({ key: "t", color: error ? theme.warn : theme.muted, wrap: "wrap", children: text })] })];
  }
  const cards = [];
  shownCards(room.manifest.layout, data).forEach((c, i) => {
    const limit = Math.max(1, capacity - 3);
    // The desktop draws a card's `desktop` body where it has one.
    const filled = body(els, els.Svg && c.desktop ? c.desktop : c.body, data, w, handlers, { limit, accent: meta.color, key: `c${i}`, room: id });
    const rows = [...filled.nodes];
    let height = filled.height;
    if (i === 0 && error) { rows.unshift(els.Text({ key: "err", color: theme.warn, wrap: "truncate-end", children: `⚠ ${error}` })); height++; }
    // A badge before the meta, in its own color: "UV 7 high · Taipei".
    const badge = c.badge && !(stale && i === 0) ? fill(c.badge, data) : "";
    const metaText = stale && i === 0 ? "stale" : c.meta ? fill(c.meta, data) : undefined;
    const metaNode = badge ? els.Box({ key: "meta", flexDirection: "row", flexShrink: 1, minWidth: 0, children: [
      els.Text({ key: "b", bold: true, color: color(c.badgeTone ? lookup(data, c.badgeTone) : null, theme.muted), children: badge }),
      metaText ? els.Text({ key: "m", color: theme.muted, wrap: "truncate-start", children: ` · ${metaText}` }) : null,
    ].filter(Boolean) }) : undefined;
    cards.push({
      name: c.title,
      height: 3 + height,
      node: card(els, { key: `fn-${i}`, title: c.title, color: meta.color, meta: metaText, metaNode, metaColor: stale && i === 0 ? theme.warn : undefined, rows }),
    });
  });
  return stackCards(els, cards, capacity, handlers.scroll);
}

// The inline pane: a head line, then the manifest's inline widget (or the
// first card's) in four rows.
export function fnInline(els, id, w, handlers) {
  const meta = fnMeta(id);
  const { room, data, loaded, error } = roomState(id);
  if (!room) return [];
  const first = room.manifest.layout.cards[0];
  const head = line(els, "head", [
    { text: `${meta.icon} ${meta.label}`, bold: true, color: meta.color },
    { text: loaded && first.meta ? `  ${fill(first.meta, data)}` : "", color: theme.muted, grow: true },
  ]);
  if (!loaded) return [head, muted(els, "wait", error ? `⚠ ${error}` : "Loading…")];
  const filled = body(els, room.manifest.layout.inline ?? first.body, data, w, handlers, { limit: 4, accent: meta.color, key: "in", room: id });
  return [head, ...(error ? [els.Text({ key: "err", color: theme.warn, wrap: "truncate-end", children: `⚠ ${error}` })] : []), ...filled.nodes];
}

// The band's line, as colored pieces.
export function fnBandPieces(id, width = 0) {
  const { room, data, loaded, error } = roomState(id);
  if (!room) return [];
  if (error && !loaded) return [{ text: `⚠ ${error}`, color: theme.warn }];
  if (!loaded) return [{ text: "loading…", color: theme.muted }];
  const l = room.manifest.layout;
  return [{ text: fitItems(fill(l.band ?? l.cards[0].meta ?? room.manifest.name, data), width), color: theme.muted }];
}

// A band's text cut at a " · " between items, never through one: the
// Stocks band ran a quote off the end mid-number. "…" says some were left.
function fitItems(text, width) {
  if (!width || cells(text) <= width) return text;
  const items = text.split(" · ");
  let out = items[0];
  for (const it of items.slice(1)) {
    if (cells(`${out} · ${it} · …`) > width) break;
    out = `${out} · ${it}`;
  }
  return cells(out) < cells(text) ? clip(`${out} · …`, width) : out;
}

// ---------------------------------------------------------------- the desktop band

// A template for a pill: holes with nothing behind them come out empty, and
// a text left with nothing but punctuation and spaces is dropped.
function pillText(template, scope) {
  if (template == null) return "";
  const out = String(template).replace(/\{([A-Za-z0-9_.]+)\}/g, (_, p) => {
    const v = lookup(scope, p);
    return v == null || typeof v === "object" ? "" : show(v);
  }).trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : "";
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
const nums = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []);

// A pill's drawing, from the plugin's own set: the manifest picks one and
// says where its number comes from.
function pillDrawing(d, scope, c, alt) {
  if (!d) return null;
  const v = d.value ? lookup(scope, d.value) : undefined;
  const flag = d.flag ? !!lookup(scope, d.flag) : false;
  switch (d.type) {
    case "area": return nums(v).length >= 2 ? draw(K.area(nums(v), c, { w: 32 }), alt) : null;
    case "bars": return nums(v).length ? draw(K.bars(nums(v), c, { all: true, w: 3, gap: 1.5 }), alt) : null;
    case "orbit": return num(v) != null ? draw(K.orbit(num(v), c), alt) : null;
    case "drop": return num(v) != null ? draw(K.drop(num(v), c), alt) : null;
    case "battery": return num(v) != null ? draw(K.battery(num(v), c, flag), alt) : null;
    case "thermometer": return num(v) != null ? draw(K.thermometer(num(v), c), alt) : null;
    case "progress": return num(v) != null ? draw(K.progress(num(v), c), alt) : null;
    case "equalizer": return draw(K.equalizer(c, flag), alt);
    case "weather": return typeof v === "string" && v ? draw(K.weather(v, c), alt) : null;
    case "icon": return draw(K.icon(d.icon, c), alt);
    case "dot": return draw({ source: K.svg(10, 10, `<circle cx="5" cy="5" r="4" fill="${c}"/>`), width: 10, height: 10 }, alt);
    default: return null;
  }
}

const SIGNAL = new Set(["amber", "red", "rose", "leaf"]);

function pillSection(p, scope, key, fallbackColor) {
  if (p.when && !lookup(scope, p.when)) return null;
  const tone = p.colorFrom ? lookup(scope, p.colorFrom) : null;
  const c = palette[tone] ?? palette[p.color] ?? fallbackColor;
  const tip = (p.tip ?? []).map((t) => pillText(t, scope)).filter(Boolean);
  const words = { label: pillText(p.label, scope), value: pillText(p.value, scope), sub: pillText(p.sub, scope), msg: pillText(p.msg, scope), tag: pillText(p.tag, scope) };
  const parts = [
    pillDrawing(p.draw, scope, c, tip[0] || words.value || words.label || words.msg || "drawing"),
    words.label ? pLabel(words.label, words.value ? undefined : theme.muted) : null,
    // A value takes its pill's color when the data says it should stand out:
    // up or down, warm or alarming.
    words.value ? pValue(words.value, SIGNAL.has(tone) ? c : undefined) : null,
    words.msg ? pMsg(words.msg) : null,
    words.tag ? pTag(words.tag, c) : null,
    words.sub ? pSub(words.sub) : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return { key, color: c, parts, tip, grow: !!words.msg };
}

// The band on the desktop: the manifest's pills, or, for a room without
// any, its band line in one section. Null while there is nothing to show.
export function fnBandDesktop(id, els, { onOpen, onCycle, columns = 0 }) {
  const { room, data, loaded, error } = roomState(id);
  if (!room) return null;
  const meta = fnMeta(id);
  const l = room.manifest.layout;
  let sections = [];
  if (error && !loaded) sections = [{ key: "err", color: theme.warn, parts: [pMsg(`⚠ ${error}`)], grow: true }];
  else if (!loaded) sections = [{ key: "wait", color: meta.color, parts: [pSub("loading…")] }];
  else if (Array.isArray(l.pills)) {
    l.pills.forEach((p, i) => {
      if (p.each) {
        const items = lookup(data, p.each);
        (Array.isArray(items) ? items : []).slice(0, p.max ?? 4).forEach((it, j) => sections.push(pillSection(p, { ...data, it }, `p${i}-${j}`, meta.color)));
      } else sections.push(pillSection(p, data, `p${i}`, meta.color));
    });
  }
  sections = sections.filter(Boolean);
  if (!sections.length) sections = [{ key: "line", color: meta.color, parts: [pMsg(fill(l.band ?? l.cards[0].meta ?? room.manifest.name, data))], grow: true }];
  return capsule(els, { room: `${meta.icon} ${meta.label}`, color: meta.color, sections, onOpen, onCycle, columns });
}

export function fnHint(id) {
  return state.fn.get(id)?.manifest.layout.hint ?? "r refreshes";
}

// Whether what's typed in the room's box is added to one of its lists.
export const fnAdds = (id) => !!state.fn.get(id)?.manifest.layout.add;

export function fnPlaceholder(id) {
  return state.fn.get(id)?.manifest.layout.placeholder ?? "r to refresh · /help";
}

// ---------------------------------------------------------------- snapshots

function widgetText(b, data) {
  if (b.type === "list" || b.type === "table") {
    const items = lookup(data, b.items);
    if (!Array.isArray(items) || !items.length) return [b.empty ?? "(nothing)"];
    return items.slice(0, b.max ?? 30).map((item) => (b.type === "table"
      ? b.columns.map((c) => show(lookup(item, c.field))).join("  ")
      : `• ${show(lookup(item, b.title))}${b.tag && lookup(item, b.tag) ? ` (${lookup(item, b.tag)})` : ""}`));
  }
  if (b.type === "buttons") return [];
  if (b.type === "tiles") return [b.tiles.map((t) => `${fill(t.value, data)}${t.sub ? ` ${fill(t.sub, data)}` : ""}`).join("  ·  ")];
  if (b.type === "meter") {
    const pct = Number(lookup(data, b.value));
    return [`${fill(b.label, data)}  ${Number.isFinite(pct) ? `${Math.round(pct)}%` : "–"}${b.right ? `  ${fill(b.right, data)}` : ""}`];
  }
  return [fillText(b.text, data)].filter(Boolean);
}

// Whether a function room writes its own snapshot (a line of chat), rather
// than its cards listed as a snippet.
export function fnSnapshotLine(id) {
  return !!roomState(id).room?.manifest.layout.snapshot;
}

// A function room as plain text, for a snippet card in a chat room.
export function fnSnapshot(id) {
  const { room, data, loaded } = roomState(id);
  if (!room) return "";
  const l = room.manifest.layout;
  if (!loaded) return `${room.manifest.name} · not loaded yet`;
  if (l.snapshot) return fill(l.snapshot, data);
  const out = [room.manifest.name];
  for (const c of shownCards(l, data)) {
    out.push(`${c.title}${c.meta ? ` · ${fill(c.meta, data)}` : ""}`);
    for (const b of [c.body].flat()) out.push(...widgetText(b, data).flatMap((t) => t.split("\n")).map((t) => `  ${t}`));
  }
  return out.join("\n");
}
