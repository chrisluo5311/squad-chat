// A function room's manifest (room.json), checked before the room loads.
// A manifest is data: it names its providers (which must exist), the hosts
// they may reach, and a layout built from a fixed set of widgets whose
// bindings are plain paths into the providers' data. Nothing in it runs.

export const SCHEMA = 1;
export const COLORS = ["sky", "leaf", "lilac", "amber", "coral", "rose", "teal", "sand"];
const RESERVED = new Set(["chat", "usage", "git", "agents", "all", "none"]);

const ID = /^[a-z][a-z0-9-]{1,23}$/;
const PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const INTERVAL = /^\d+(ms|s|m|h)$/;

// The widgets a layout may use, and each one's fields: "path" (into the
// data), "field" (of an item), "text" (a template with {path} holes),
// "int", "bool", "color".
const WIDGETS = {
  list: { items: "path!", title: "field!", tag: "field", preview: "field", copy: "field", share: "field", max: "int", empty: "text" },
  table: { items: "path!", columns: "columns!", max: "int", empty: "text" },
  tiles: { tiles: "tiles!" },
  meter: { label: "text!", value: "path!", right: "text", color: "color" },
  text: { text: "text!", color: "color" },
};

export function parseInterval(s) {
  if (s == null) return null;
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(s));
  if (!m) return null;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
}

const str = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

function checkWidget(body, where, errors) {
  if (!body || typeof body !== "object") return errors.push(`${where}: not an object`);
  const spec = WIDGETS[body.type];
  if (!spec) return errors.push(`${where}: unknown widget "${body.type}" (${Object.keys(WIDGETS).join(", ")})`);
  for (const [key, kind] of Object.entries(spec)) {
    const v = body[key];
    const required = kind.endsWith("!");
    const k = kind.replace("!", "");
    if (v === undefined) { if (required) errors.push(`${where}.${key}: missing`); continue; }
    if ((k === "path" || k === "field") && !(typeof v === "string" && PATH.test(v))) errors.push(`${where}.${key}: not a path`);
    if (k === "text" && !str(v, 200)) errors.push(`${where}.${key}: 1-200 characters`);
    if (k === "int" && !(Number.isInteger(v) && v > 0 && v <= 100)) errors.push(`${where}.${key}: a whole number 1-100`);
    if (k === "color" && !COLORS.includes(v)) errors.push(`${where}.${key}: one of ${COLORS.join(", ")}`);
    if (k === "columns") {
      if (!Array.isArray(v) || !v.length || v.length > 8) errors.push(`${where}.columns: 1-8 columns`);
      else v.forEach((c, i) => {
        if (!(typeof c?.field === "string" && PATH.test(c.field))) errors.push(`${where}.columns[${i}].field: not a path`);
        if (c.label != null && !str(c.label, 20)) errors.push(`${where}.columns[${i}].label: 1-20 characters`);
        if (c.width != null && !(Number.isInteger(c.width) && c.width > 0 && c.width <= 40)) errors.push(`${where}.columns[${i}].width: 1-40`);
        if (c.color != null && !COLORS.includes(c.color)) errors.push(`${where}.columns[${i}].color: one of ${COLORS.join(", ")}`);
      });
    }
    if (k === "tiles") {
      if (!Array.isArray(v) || !v.length || v.length > 6) errors.push(`${where}.tiles: 1-6 tiles`);
      else v.forEach((t, i) => {
        if (!str(t?.value, 100)) errors.push(`${where}.tiles[${i}].value: 1-100 characters`);
        if (t?.sub != null && !str(t.sub, 100)) errors.push(`${where}.tiles[${i}].sub: 1-100 characters`);
        if (t?.color != null && !COLORS.includes(t.color)) errors.push(`${where}.tiles[${i}].color: one of ${COLORS.join(", ")}`);
      });
    }
  }
  for (const key of Object.keys(body)) if (key !== "type" && !(key in spec)) errors.push(`${where}.${key}: not a field of ${body.type}`);
}

// Returns the list of problems: empty when the manifest is fine.
// `providers` is the bridge's table of provider types.
export function checkManifest(m, providers) {
  const errors = [];
  if (!m || typeof m !== "object") return ["not a JSON object"];
  if (m.schema !== SCHEMA) errors.push(`schema: must be ${SCHEMA}`);
  if (!(typeof m.id === "string" && ID.test(m.id))) errors.push("id: 2-24 lowercase letters, digits or -, starting with a letter");
  else if (RESERVED.has(m.id)) errors.push(`id: "${m.id}" is taken`);
  if (!(typeof m.version === "string" && VERSION.test(m.version))) errors.push("version: like 1.0.0");
  if (!str(m.name, 20)) errors.push("name: 1-20 characters");
  if (!(typeof m.icon === "string" && [...m.icon].length === 1)) errors.push("icon: one character");
  if (!COLORS.includes(m.color)) errors.push(`color: one of ${COLORS.join(", ")}`);
  if (m.description != null && !str(m.description, 200)) errors.push("description: 1-200 characters");

  const hosts = m.permissions?.hosts ?? [];
  if (!Array.isArray(hosts) || hosts.length > 10 || !hosts.every((h) => typeof h === "string" && HOST.test(h))) errors.push("permissions.hosts: up to 10 host names");

  if (!Array.isArray(m.providers) || !m.providers.length || m.providers.length > 4) errors.push("providers: 1-4 providers");
  else {
    const seen = new Set();
    m.providers.forEach((p, i) => {
      const where = `providers[${i}]`;
      if (!(typeof p?.id === "string" && /^[a-z][a-z0-9_]{0,15}$/.test(p.id))) errors.push(`${where}.id: 1-16 lowercase letters, digits or _`);
      else if (seen.has(p.id)) errors.push(`${where}.id: "${p.id}" twice`);
      else seen.add(p.id);
      if (!providers[p?.type]) errors.push(`${where}.type: no provider called "${p?.type}"`);
      if (p?.params != null && (typeof p.params !== "object" || Array.isArray(p.params))) errors.push(`${where}.params: an object`);
      for (const k of ["visible", "background"]) {
        const v = p?.interval?.[k];
        if (v != null && !(INTERVAL.test(v) && parseInterval(v) >= 1000)) errors.push(`${where}.interval.${k}: like 30s or 10m, at least 1s`);
      }
    });
  }

  const l = m.layout;
  if (!l || typeof l !== "object") errors.push("layout: missing");
  else {
    if (!Array.isArray(l.cards) || !l.cards.length || l.cards.length > 6) errors.push("layout.cards: 1-6 cards");
    else l.cards.forEach((c, i) => {
      if (!str(c?.title, 30)) errors.push(`layout.cards[${i}].title: 1-30 characters`);
      if (c?.meta != null && !str(c.meta, 100)) errors.push(`layout.cards[${i}].meta: 1-100 characters`);
      checkWidget(c?.body, `layout.cards[${i}].body`, errors);
    });
    if (l.inline != null) checkWidget(l.inline, "layout.inline", errors);
    for (const k of ["band", "hint", "placeholder", "snapshot"]) if (l[k] != null && !str(l[k], 200)) errors.push(`layout.${k}: 1-200 characters`);
  }
  return errors;
}
