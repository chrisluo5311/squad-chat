// Function rooms, drawn from their manifests: each card's widget is filled in
// from the providers' data with plain paths ("list.items") and templates
// ("{list.count} saved"). Nothing in a manifest runs. The same layout gives
// the docked pane, the inline pane, the band and a plain-text snapshot.

import { state } from "./state.mjs";
import { theme, palette } from "./theme.mjs";
import { rowsFor, meter, tiles, line, card, stackCards } from "./widgets.mjs";
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
  (manifest.layout?.cards ?? []).forEach((c) => walk(c.body));
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

// One widget's rows, at most `limit` of them: { nodes, height }.
function widget(els, b, data, w, handlers, { limit = Infinity, accent, key = "w", room } = {}) {
  const { Box, Text, Button } = els;
  if (b.type === "buttons") {
    return { nodes: [Box({ key, flexDirection: "row", gap: 1, flexWrap: "wrap", children: b.buttons.map((btn, i) => Box({ key: `b${i}`, flexShrink: 0, children: [
      Button({ key: `act-${key}-${i}`, label: btn.label, onPress: () => handlers.onAction?.(room, { provider: btn.provider, action: btn.action, args: btn.args ?? {} }) }),
    ] })) })], height: 1 };
  }
  if (b.type === "list" || b.type === "table") {
    const all = lookup(data, b.items);
    const items = Array.isArray(all) ? all : [];
    if (!items.length) {
      const text = b.empty ?? "Nothing here yet.";
      return { nodes: [Text({ key: `${key}-empty`, color: theme.muted, wrap: "wrap", children: text })], height: rowsFor(text, w) };
    }
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
      const title = show(lookup(item, b.title));
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
        { text: title, bold: true, grow: true },
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
    const list = b.tiles.map((t) => ({ value: fill(t.value, data), sub: t.sub ? fill(t.sub, data) : "", color: color(t.color, accent) }));
    return { nodes: [tiles(els, list, w)], height: 2 };
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
    const filled = body(els, c.body, data, w, handlers, { limit, accent: meta.color, key: `c${i}`, room: id });
    const rows = [...filled.nodes];
    let height = filled.height;
    if (i === 0 && error) { rows.unshift(els.Text({ key: "err", color: theme.warn, wrap: "truncate-end", children: `⚠ ${error}` })); height++; }
    cards.push({
      name: c.title,
      height: 3 + height,
      node: card(els, { key: `fn-${i}`, title: c.title, color: meta.color, meta: stale && i === 0 ? "stale" : c.meta ? fill(c.meta, data) : undefined, metaColor: stale && i === 0 ? theme.warn : undefined, rows }),
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
export function fnBandPieces(id) {
  const { room, data, loaded, error } = roomState(id);
  if (!room) return [];
  if (error && !loaded) return [{ text: `⚠ ${error}`, color: theme.warn }];
  if (!loaded) return [{ text: "loading…", color: theme.muted }];
  const l = room.manifest.layout;
  return [{ text: fill(l.band ?? l.cards[0].meta ?? room.manifest.name, data), color: theme.muted }];
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
export function fnBandDesktop(id, els, { onOpen }) {
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
  return capsule(els, { room: `${meta.icon} ${meta.label}`, color: meta.color, sections, onOpen });
}

export function fnHint(id) {
  return state.fn.get(id)?.manifest.layout.hint ?? "r refreshes";
}

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
