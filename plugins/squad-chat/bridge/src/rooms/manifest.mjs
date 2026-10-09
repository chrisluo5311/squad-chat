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

// A setting's kinds. A "list" holds strings (or URLs, whose hosts must be
// the room's own), "enum" one of `values`.
const SETTING_TYPES = ["list", "enum", "string", "bool", "int"];
const SETTING_KEY = /^[a-z][a-z0-9_]{0,19}$/;

function checkSettings(settings, hosts, errors) {
  if (settings == null) return;
  if (typeof settings !== "object" || Array.isArray(settings)) return errors.push("settings: an object");
  const keys = Object.keys(settings);
  if (keys.length > 8) errors.push("settings: at most 8");
  for (const key of keys) {
    const st = settings[key];
    const where = `settings.${key}`;
    if (!SETTING_KEY.test(key)) errors.push(`${where}: a key of 1-20 lowercase letters, digits or _`);
    if (!SETTING_TYPES.includes(st?.type)) { errors.push(`${where}.type: one of ${SETTING_TYPES.join(", ")}`); continue; }
    if (st.label != null && !str(st.label, 40)) errors.push(`${where}.label: 1-40 characters`);
    if (st.type === "enum" && !(Array.isArray(st.values) && st.values.length && st.values.length <= 10 && st.values.every((v) => str(v, 30)))) errors.push(`${where}.values: 1-10 choices`);
    if (st.type === "list" && st.item != null && !["string", "url"].includes(st.item)) errors.push(`${where}.item: string or url`);
    if (st.type === "list" && st.max != null && !(Number.isInteger(st.max) && st.max > 0 && st.max <= 20)) errors.push(`${where}.max: 1-20`);
    if (st.type === "int" && [st.min, st.max].some((v) => v != null && !Number.isInteger(v))) errors.push(`${where}: min and max are whole numbers`);
    const bad = settingError(st, st.default, hosts);
    if (bad) errors.push(`${where}.default: ${bad}`);
  }
}

// What's wrong with `value` for setting `st`, or null when it's fine.
export function settingError(st, value, hosts = []) {
  switch (st.type) {
    case "list": {
      if (!Array.isArray(value)) return "a list";
      if (value.length > (st.max ?? 10)) return `at most ${st.max ?? 10}`;
      for (const v of value) {
        if (!str(v, st.item === "url" ? 300 : 100)) return `each one 1-${st.item === "url" ? 300 : 100} characters`;
        if (st.item === "url") {
          let u;
          try { u = new URL(v); } catch { return `not a URL: ${v}`; }
          if (u.protocol !== "https:") return `not https: ${v}`;
          if (!hosts.includes(u.hostname.toLowerCase())) return `${u.hostname} isn't one of this room's hosts (${hosts.join(", ")})`;
        }
      }
      return null;
    }
    case "enum": return st.values?.includes(value) ? null : `one of ${(st.values ?? []).join(", ")}`;
    case "string": return str(value, 100) ? null : "1-100 characters";
    case "bool": return typeof value === "boolean" ? null : "on or off";
    case "int":
      if (!Number.isInteger(value)) return "a whole number";
      if (st.min != null && value < st.min) return `at least ${st.min}`;
      if (st.max != null && value > st.max) return `at most ${st.max}`;
      return null;
    default: return "unknown setting";
  }
}

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
      for (const [k, v] of Object.entries(p?.params ?? {})) {
        const ref = typeof v === "string" && /^\$settings\.(.+)$/.exec(v);
        if (ref && !(m.settings && Object.hasOwn(m.settings, ref[1]))) errors.push(`${where}.params.${k}: no setting called ${ref[1]}`);
      }
      for (const k of ["visible", "background"]) {
        const v = p?.interval?.[k];
        if (v != null && !(INTERVAL.test(v) && parseInterval(v) >= 1000)) errors.push(`${where}.interval.${k}: like 30s or 10m, at least 1s`);
      }
    });
  }

  checkSettings(m.settings, Array.isArray(hosts) ? hosts.map((h) => String(h).toLowerCase()) : [], errors);

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
