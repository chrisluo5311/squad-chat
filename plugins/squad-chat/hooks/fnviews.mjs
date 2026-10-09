// Function rooms, drawn from their manifests: each card's widget is filled in
// from the providers' data with plain paths ("list.items") and templates
// ("{list.count} saved"). Nothing in a manifest runs. The same layout gives
// the docked pane, the inline pane, the band and a plain-text snapshot.

import { state } from "./state.mjs";
import { theme, palette } from "./theme.mjs";
import { rowsFor, meter, tiles, line, card, stackCards, CARD_GAP } from "./widgets.mjs";

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

const firstLine = (s) => String(s ?? "").split("\n").find((l) => l.trim()) ?? "";
const color = (name, fallback) => palette[name] ?? fallback;
const muted = (els, key, text) => els.Text({ key, color: theme.muted, wrap: "truncate-end", children: text });

function roomState(id) {
  const room = state.fn.get(id);
  const providers = room?.manifest.providers ?? [];
  const loaded = providers.length > 0 && providers.every((p) => room.data[p.id] != null);
  const error = providers.map((p) => room.error[p.id]).find(Boolean) ?? null;
  const stale = providers.some((p) => room.stale[p.id]);
  return { room, data: room?.data ?? {}, loaded, error, stale };
}

// ---------------------------------------------------------------- widgets

// One widget's rows, at most `limit` of them: { nodes, height }.
function widget(els, b, data, w, handlers, { limit = Infinity, accent, key = "w" } = {}) {
  const { Box, Text, Button } = els;
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
    if (header) {
      nodes.push(line(els, `${key}-head`, b.columns.map((c, i) => (i === b.columns.length - 1 && !c.width
        ? { text: c.label ?? "", color: theme.muted, grow: true, right: c.right }
        : { text: c.label ?? "", width: c.width ?? 12, right: c.right, color: theme.muted }))));
    }
    items.slice(0, n).forEach((item, i) => {
      const k = `${key}-${String(item?.id ?? i)}`;
      if (b.type === "table") {
        nodes.push(line(els, k, b.columns.map((c, j) => (j === b.columns.length - 1 && !c.width
          ? { text: show(lookup(item, c.field)), grow: true, color: color(c.color) }
          : { text: show(lookup(item, c.field)), width: c.width ?? 12, right: c.right, color: color(c.color) }))));
        return;
      }
      const title = show(lookup(item, b.title));
      const tag = b.tag ? lookup(item, b.tag) : null;
      const copyText = b.copy ? lookup(item, b.copy) : null;
      const shareText = b.share ? lookup(item, b.share) : null;
      nodes.push(line(els, k, [
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
  const text = fill(b.text, data);
  return { nodes: [Box({ key, children: [Text({ key: "t", color: color(b.color), wrap: "wrap", children: text })] })], height: rowsFor(text, w) };
}

// ---------------------------------------------------------------- the pane

// The docked pane's cards for a function room, within `capacity` rows. A
// list gives up rows ("+ 3 more") before a card is left out.
export function fnDock(els, id, w, capacity, handlers) {
  const meta = fnMeta(id);
  const { room, data, loaded, error, stale } = roomState(id);
  if (!room) return [];
  if (!loaded) {
    const text = error ? `⚠ ${error}` : "Loading…";
    return [card(els, { key: "fn-wait", title: meta.label.toUpperCase(), color: meta.color, rows: [els.Text({ key: "t", color: error ? theme.warn : theme.muted, wrap: "wrap", children: text })] })];
  }
  const cards = [];
  let used = 0;
  room.manifest.layout.cards.forEach((c, i) => {
    const gap = cards.length ? CARD_GAP : 0;
    const limit = Math.max(1, capacity - used - gap - 3);
    const body = widget(els, c.body, data, w, handlers, { limit, accent: meta.color, key: `c${i}` });
    const rows = [...body.nodes];
    let height = body.height;
    if (i === 0 && error) { rows.unshift(els.Text({ key: "err", color: theme.warn, wrap: "truncate-end", children: `⚠ ${error}` })); height++; }
    cards.push({
      name: c.title,
      height: 3 + height,
      node: card(els, { key: `fn-${i}`, title: c.title, color: meta.color, meta: stale && i === 0 ? "stale" : c.meta ? fill(c.meta, data) : undefined, metaColor: stale && i === 0 ? theme.warn : undefined, rows }),
    });
    used += gap + 3 + height;
  });
  return stackCards(els, cards, capacity);
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
  const body = widget(els, room.manifest.layout.inline ?? first.body, data, w, handlers, { limit: 4, accent: meta.color, key: "in" });
  return [head, ...(error ? [els.Text({ key: "err", color: theme.warn, wrap: "truncate-end", children: `⚠ ${error}` })] : []), ...body.nodes];
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
  if (b.type === "tiles") return [b.tiles.map((t) => `${fill(t.value, data)}${t.sub ? ` ${fill(t.sub, data)}` : ""}`).join("  ·  ")];
  if (b.type === "meter") {
    const pct = Number(lookup(data, b.value));
    return [`${fill(b.label, data)}  ${Number.isFinite(pct) ? `${Math.round(pct)}%` : "–"}${b.right ? `  ${fill(b.right, data)}` : ""}`];
  }
  return [fill(b.text, data)];
}

// A function room as plain text, for a snippet card in a chat room.
export function fnSnapshot(id) {
  const { room, data, loaded } = roomState(id);
  if (!room) return "";
  const l = room.manifest.layout;
  if (!loaded) return `${room.manifest.name} · not loaded yet`;
  if (l.snapshot) return fill(l.snapshot, data);
  const out = [room.manifest.name];
  for (const c of l.cards) {
    out.push(`${c.title}${c.meta ? ` · ${fill(c.meta, data)}` : ""}`);
    out.push(...widgetText(c.body, data).map((t) => `  ${t}`));
  }
  return out.join("\n");
}
