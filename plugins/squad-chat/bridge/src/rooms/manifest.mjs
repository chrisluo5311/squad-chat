// A function room's manifest (room.json), checked before the room loads.
// A manifest is data: it names its providers (which must exist), the hosts
// they may reach, and a layout built from a fixed set of widgets whose
// bindings are plain paths into the providers' data. Nothing in it runs.

export const SCHEMA = 1;
export const COLORS = ["sky", "leaf", "lilac", "amber", "coral", "rose", "teal", "sand", "red"];
const RESERVED = new Set(["chat", "usage", "git", "agents", "all", "none"]);

const ID = /^[a-z][a-z0-9-]{1,23}$/;
const PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const INTERVAL = /^\d+(ms|s|m|h)$/;
const ACTION = /^[a-z][a-z0-9_]{0,19}$/;


// The widgets a layout may use, and each one's fields: "path" (into the
// data), "field" (of an item), "text" (a template with {path} holes),
// "int", "bool", "color", "drop" (a ✕ on each row that takes it out of a
// list setting), "pick" (a row pressed is kept in a string setting, and
// shown at the path `as` in place of what the provider put there).
const WIDGETS = {
  list: { items: "path!", title: "field!", mark: "field", tag: "field", preview: "field", copy: "field", share: "field", act: "act", max: "int", empty: "text", code: "bool", lit: "field", score: "field", group: "field", open: "field", remove: "act", pause: "text", more: "text" },
  buttons: { buttons: "buttons!", split: "int", level: "path" },
  // `more`: words after the "+ 3 more" line, or on one of their own.
  table: { items: "path!", columns: "columns!", drop: "drop", pick: "pick", max: "int", empty: "text", more: "text" },
  tiles: { tiles: "tiles!" },
  meter: { label: "text!", value: "path!", right: "text", color: "color" },
  text: { text: "text!", color: "color" },
  // Drawn on the desktop (a card's `desktop` body); the terminal makes do.
  stat: { value: "path!", right: "text", color: "color" },
  bar: { value: "path!", color: "color" },
  chart: { values: "path!", values2: "path", color: "color", color2: "color", max: "int", caption: "text" },
  grid: { items: "path!", title: "field!", sub: "field", value: "field", change: "field", colorFrom: "field", line: "field", pick: "pick", drop: "drop", empty: "text", icon: "field", note: "field", across: "int", pickTitle: "bool", hint: "text" },
  // A line over the hours with bars under it (temperature, chance of rain),
  // and times to read it by.
  forecast: { values: "path!", bars: "path", marks: "path", caption: "text", color: "color", color2: "color" },
  // Items as columns side by side (a week's days), the `lit` one outlined.
  strip: { items: "path!", title: "field!", icon: "field", value: "field", sub: "field", note: "field", lit: "field", empty: "text" },
  // Sunrise to sunset as an arc, the sun at `value` (0-100) through the day.
  sun: { rise: "text!", set: "text!", value: "path", sub: "text", note: "text" },
  // A menu of the items (a playlist), the `lit` one shown, and the one
  // picked handed to `act`'s action. The terminal draws nothing for it.
  select: { items: "path!", title: "field!", lit: "field", act: "act!", empty: "text" },
  media: { title: "text!", sub: "text", progress: "path", elapsed: "text", total: "text", live: "path", playing: "path", empty: "text" },
};

// The desktop band's pills: each a small drawing, words around it and a card
// on hover, all bound to the data by paths and {path} templates. A pill with
// `each` repeats for the first `max` items of a list, which its bindings
// reach as `it` ({it.symbol}). The drawings are the plugin's own; a manifest
// only picks one and says where its number comes from.
export const DRAWS = ["area", "bars", "orbit", "drop", "battery", "thermometer", "equalizer", "progress", "weather", "icon", "dot"];
export const PILL_ICONS = ["branch", "pr", "stack", "flame", "chip", "net", "spark", "clock"];
const NEEDS_VALUE = new Set(["area", "bars", "orbit", "drop", "battery", "thermometer", "progress", "weather"]);
const PILL_TEXT = ["label", "value", "sub", "msg", "tag"];

function checkPills(pills, errors) {
  if (pills == null) return;
  if (!Array.isArray(pills) || !pills.length || pills.length > 6) return errors.push("layout.pills: 1-6 pills");
  pills.forEach((p, i) => {
    const where = `layout.pills[${i}]`;
    if (!p || typeof p !== "object") return errors.push(`${where}: not an object`);
    for (const k of ["when", "each", "colorFrom"]) if (p[k] != null && !(typeof p[k] === "string" && PATH.test(p[k]))) errors.push(`${where}.${k}: not a path`);
    if (p.max != null && !(Number.isInteger(p.max) && p.max > 0 && p.max <= 6)) errors.push(`${where}.max: 1-6`);
    if (p.color != null && !COLORS.includes(p.color)) errors.push(`${where}.color: one of ${COLORS.join(", ")}`);
    for (const k of PILL_TEXT) if (p[k] != null && !str(p[k], 200)) errors.push(`${where}.${k}: 1-200 characters`);
    if (p.tip != null && !(Array.isArray(p.tip) && p.tip.length && p.tip.length <= 6 && p.tip.every((t) => str(t, 200)))) errors.push(`${where}.tip: 1-6 lines of 1-200 characters`);
    const d = p.draw;
    if (d != null) {
      if (!DRAWS.includes(d?.type)) errors.push(`${where}.draw.type: one of ${DRAWS.join(", ")}`);
      else {
        if (NEEDS_VALUE.has(d.type) && !(typeof d.value === "string" && PATH.test(d.value))) errors.push(`${where}.draw.value: a path`);
        if (d.flag != null && !(typeof d.flag === "string" && PATH.test(d.flag))) errors.push(`${where}.draw.flag: not a path`);
        if (d.type === "icon" && !PILL_ICONS.includes(d.icon)) errors.push(`${where}.draw.icon: one of ${PILL_ICONS.join(", ")}`);
      }
      for (const k of Object.keys(d ?? {})) if (!["type", "value", "flag", "icon"].includes(k)) errors.push(`${where}.draw.${k}: not a field of a drawing`);
    }
    if (!PILL_TEXT.some((k) => p[k] != null) && d == null) errors.push(`${where}: shows nothing (a drawing or some text)`);
    for (const k of Object.keys(p)) if (![...PILL_TEXT, "when", "each", "max", "color", "colorFrom", "tip", "draw"].includes(k)) errors.push(`${where}.${k}: not a field of a pill`);
  });
}

// A setting's kinds. A "list" holds strings (or URLs, whose hosts must be
// the room's own), "enum" one of `values`. A list with `add` takes what's
// typed as more of it, and `min` is how few it may hold.
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
    if (st.type === "list" && st.add != null && typeof st.add !== "boolean") errors.push(`${where}.add: true or false`);
    if (st.type === "list" && st.min != null && !(Number.isInteger(st.min) && st.min >= 0 && st.min <= (st.max ?? 10))) errors.push(`${where}.min: 0 to its max`);
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
      if (value.length < (st.min ?? 0)) return `at least ${st.min}`;
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

// -1, 0 or 1 for two "1.2.3" versions.
export function compareVersions(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

export function parseInterval(s) {
  if (s == null) return null;
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(s));
  if (!m) return null;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
}

const str = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

// A card's body: one widget, or a column of up to 6.
// `uses` collects the actions buttons and rows name, checked against the
// providers once the whole manifest is read.
function checkBody(body, where, errors, uses) {
  if (!Array.isArray(body)) return checkWidget(body, where, errors, uses);
  if (!body.length || body.length > 6) return errors.push(`${where}: 1-6 widgets`);
  body.forEach((b, i) => checkWidget(b, `${where}[${i}]`, errors, uses));
}

function checkWidget(body, where, errors, uses) {
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
    if (k === "bool" && typeof v !== "boolean") errors.push(`${where}.${key}: true or false`);
    if (k === "color" && !COLORS.includes(v)) errors.push(`${where}.${key}: one of ${COLORS.join(", ")}`);
    if (k === "columns") {
      if (!Array.isArray(v) || !v.length || v.length > 8) errors.push(`${where}.columns: 1-8 columns`);
      else v.forEach((c, i) => {
        if (!(typeof c?.field === "string" && PATH.test(c.field))) errors.push(`${where}.columns[${i}].field: not a path`);
        if (c.label != null && !str(c.label, 20)) errors.push(`${where}.columns[${i}].label: 1-20 characters`);
        if (c.width != null && !(Number.isInteger(c.width) && c.width > 0 && c.width <= 40)) errors.push(`${where}.columns[${i}].width: 1-40`);
        if (c.grow != null && typeof c.grow !== "boolean") errors.push(`${where}.columns[${i}].grow: true or false`);
        if (c.color != null && !COLORS.includes(c.color)) errors.push(`${where}.columns[${i}].color: one of ${COLORS.join(", ")}`);
        if (c.colorFrom != null && !(typeof c.colorFrom === "string" && PATH.test(c.colorFrom))) errors.push(`${where}.columns[${i}].colorFrom: not a path`);
        // "beats": the field holds a heartbeat ("uusx…", newest last), drawn as marks.
        if (c.beats != null && typeof c.beats !== "boolean") errors.push(`${where}.columns[${i}].beats: true or false`);
        // "under": where the pane draws pictures, the column goes on a line of its own under its row.
        if (c.under != null && typeof c.under !== "boolean") errors.push(`${where}.columns[${i}].under: true or false`);
      });
    }
    if (k === "act") {
      if (!str(v?.label, 6)) errors.push(`${where}.act.label: 1-6 characters`);
      if (!(typeof v?.action === "string" && ACTION.test(v.action))) errors.push(`${where}.act.action: an action's name`);
      else uses.push({ where: `${where}.act`, provider: v.provider, action: v.action });
      if (!(typeof v?.field === "string" && PATH.test(v.field))) errors.push(`${where}.act.field: not a path`);
    }
    if (k === "drop") {
      if (!(typeof v?.setting === "string" && SETTING_KEY.test(v.setting))) errors.push(`${where}.drop.setting: a setting's key`);
      else uses.push({ where: `${where}.drop`, setting: v.setting, settingType: "list" });
      if (!(typeof v?.field === "string" && PATH.test(v.field))) errors.push(`${where}.drop.field: not a path`);
    }
    if (k === "pick") {
      if (!(typeof v?.setting === "string" && SETTING_KEY.test(v.setting))) errors.push(`${where}.pick.setting: a setting's key`);
      else uses.push({ where: `${where}.pick`, setting: v.setting, settingType: "string" });
      if (!(typeof v?.field === "string" && PATH.test(v.field))) errors.push(`${where}.pick.field: not a path`);
      if (!(typeof v?.as === "string" && PATH.test(v.as))) errors.push(`${where}.pick.as: not a path`);
      // "toggle": the row picked is pressed again to put the setting back to its default.
      if (v?.toggle != null && typeof v.toggle !== "boolean") errors.push(`${where}.pick.toggle: true or false`);
    }
    if (k === "buttons") {
      if (!Array.isArray(v) || !v.length || v.length > 8) errors.push(`${where}.buttons: 1-8 buttons`);
      else v.forEach((btn, i) => {
        if (!str(btn?.label, 12)) errors.push(`${where}.buttons[${i}].label: 1-12 characters`);
        // A toggle: `alt` is the label while the path `altWhen` holds (⏸ while playing).
        if (btn?.alt != null && !str(btn.alt, 12)) errors.push(`${where}.buttons[${i}].alt: 1-12 characters`);
        if (btn?.altWhen != null && !(typeof btn.altWhen === "string" && PATH.test(btn.altWhen))) errors.push(`${where}.buttons[${i}].altWhen: not a path`);
        // A tab: filled while the path `lit` holds, the other buttons plain.
        if (btn?.lit != null && !(typeof btn.lit === "string" && PATH.test(btn.lit))) errors.push(`${where}.buttons[${i}].lit: not a path`);
        if (!(typeof btn?.action === "string" && ACTION.test(btn.action))) errors.push(`${where}.buttons[${i}].action: an action's name`);
        else uses.push({ where: `${where}.buttons[${i}]`, provider: btn.provider, action: btn.action });
        if (btn?.args != null && (typeof btn.args !== "object" || Array.isArray(btn.args) || JSON.stringify(btn.args).length > 200)) errors.push(`${where}.buttons[${i}].args: a small object`);
      });
    }
    if (k === "tiles") {
      if (!Array.isArray(v) || !v.length || v.length > 6) errors.push(`${where}.tiles: 1-6 tiles`);
      else v.forEach((t, i) => {
        if (!str(t?.value, 100)) errors.push(`${where}.tiles[${i}].value: 1-100 characters`);
        if (t?.sub != null && !str(t.sub, 100)) errors.push(`${where}.tiles[${i}].sub: 1-100 characters`);
        if (t?.color != null && !COLORS.includes(t.color)) errors.push(`${where}.tiles[${i}].color: one of ${COLORS.join(", ")}`);
        if (t?.tone != null && !(typeof t.tone === "string" && PATH.test(t.tone))) errors.push(`${where}.tiles[${i}].tone: not a path`);
      });
    }
  }
  for (const key of Object.keys(body)) if (key !== "type" && !(key in spec)) errors.push(`${where}.${key}: not a field of ${body.type}`);
}

// The player's stations: mpv fetches them itself, so each must be https and
// on the room's own hosts, as anything a provider fetches through the bridge.
function checkStations(stations, where, hosts, errors) {
  if (stations == null) return;
  if (!Array.isArray(stations) || stations.length > 20) return errors.push(`${where}: up to 20 stations`);
  stations.forEach((st, i) => {
    let u = null;
    try { u = new URL(String(st?.url)); } catch { /* reported below */ }
    if (!str(st?.name, 40)) errors.push(`${where}[${i}].name: 1-40 characters`);
    if (!u || u.protocol !== "https:") errors.push(`${where}[${i}].url: an https URL`);
    else if (!hosts.includes(u.hostname.toLowerCase())) errors.push(`${where}[${i}].url: ${u.hostname} isn't one of this room's hosts`);
  });
}

// http-json's params: a URL, and fields with formats it knows.
const FORMATS = ["text", "number", "compact", "percent", "signed", "signed-percent", "date", "age"];
function checkHttpJson(params, where, errors) {
  if (!(typeof params.url === "string" && /^https:\/\/[^\s]+$/.test(params.url) && params.url.length <= 300)) errors.push(`${where}.url: an https URL`);
  if (params.vars != null && (typeof params.vars !== "object" || Array.isArray(params.vars))) errors.push(`${where}.vars: an object`);
  if (params.rows != null) {
    if (typeof params.rows !== "object") errors.push(`${where}.rows: an object`);
    else if (params.rows.order != null && !(params.vars && Object.hasOwn(params.vars, params.rows.order))) errors.push(`${where}.rows.order: no var called ${params.rows.order}`);
  }
  for (const group of ["fields", "values"]) {
    const g = params[group];
    if (g == null) continue;
    if (typeof g !== "object" || Array.isArray(g) || Object.keys(g).length > 12) { errors.push(`${where}.${group}: up to 12 fields`); continue; }
    for (const [name, spec] of Object.entries(g)) {
      if (!/^[a-z][A-Za-z0-9_]{0,19}$/.test(name)) errors.push(`${where}.${group}.${name}: a field name`);
      if (!(typeof spec?.path === "string" && spec.path.length <= 100)) errors.push(`${where}.${group}.${name}.path: missing`);
      if (spec?.format != null && !FORMATS.includes(spec.format)) errors.push(`${where}.${group}.${name}.format: one of ${FORMATS.join(", ")}`);
    }
  }
}

// ping's targets: what someone typed, never the manifest's own. They must
// come from a list setting that starts empty, so a room can't aim it anywhere.
function checkPing(params, where, settings, errors) {
  const ref = typeof params.targets === "string" && /^\$settings\.(.+)$/.exec(params.targets);
  const st = ref ? settings?.[ref[1]] : null;
  if (!st || st.type !== "list" || !Array.isArray(st.default) || st.default.length) errors.push(`${where}.targets: "$settings.<key>" of a list setting that starts empty`);
}

// A manifest's alerts: a field in each row, or one value, past a threshold
// (a number, or a setting), toasted with a template.
function checkAlerts(alerts, m, errors) {
  if (alerts == null) return;
  if (!Array.isArray(alerts) || alerts.length > 6) return errors.push("alerts: up to 6");
  alerts.forEach((a, i) => {
    const where = `alerts[${i}]`;
    const path = a?.rows ?? a?.value;
    if (!(typeof path === "string" && PATH.test(path)) || (a.rows != null) === (a.value != null)) errors.push(`${where}: a rows or a value path, not both`);
    else if (!(m.providers ?? []).some((p) => p?.id === path.split(".")[0])) errors.push(`${where}: no provider called ${path.split(".")[0]}`);
    if (a?.rows != null && !(typeof a.field === "string" && PATH.test(a.field))) errors.push(`${where}.field: the row's field to watch`);
    const limits = ["above", "below", "beyond"].filter((k) => a?.[k] != null);
    if (limits.length !== 1) errors.push(`${where}: one of above, below or beyond`);
    for (const k of limits) {
      const v = a[k];
      const ref = typeof v === "string" && /^\$settings\.(.+)$/.exec(v);
      if (!(typeof v === "number" || (ref && m.settings && Object.hasOwn(m.settings, ref[1])))) errors.push(`${where}.${k}: a number or "$settings.<key>"`);
    }
    if (!str(a?.text, 100)) errors.push(`${where}.text: 1-100 characters`);
    if (!str(a?.id, 60)) errors.push(`${where}.id: 1-60 characters`);
  });
}

// Returns the list of problems: empty when the manifest is fine.
// `providers` is the bridge's table of provider types.
export function checkManifest(m, providers) {
  const errors = [];
  const actionsUsed = [];   // what buttons, rows and keys name
  if (!m || typeof m !== "object") return ["not a JSON object"];
  if (m.schema !== SCHEMA) errors.push(`schema: must be ${SCHEMA}`);
  if (!(typeof m.id === "string" && ID.test(m.id))) errors.push("id: 2-24 lowercase letters, digits or -, starting with a letter");
  else if (RESERVED.has(m.id)) errors.push(`id: "${m.id}" is taken`);
  if (!(typeof m.version === "string" && VERSION.test(m.version))) errors.push("version: like 1.0.0");
  if (m.minSquadChat != null && !(typeof m.minSquadChat === "string" && VERSION.test(m.minSquadChat))) errors.push("minSquadChat: like 0.15.0");
  if (m.author != null && !str(m.author, 60)) errors.push("author: 1-60 characters");
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
      // "$settings.<key>" anywhere in the params must name a setting.
      const refs = (v, at) => {
        if (typeof v === "string") {
          const ref = /^\$settings\.(.+)$/.exec(v);
          if (ref && !(m.settings && Object.hasOwn(m.settings, ref[1]))) errors.push(`${at}: no setting called ${ref[1]}`);
        } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) refs(x, `${at}.${k}`);
      };
      refs(p?.params ?? {}, `${where}.params`);
      if (p?.type === "http-json") checkHttpJson(p.params ?? {}, `${where}.params`, errors);
      if (p?.type === "ping") checkPing(p.params ?? {}, `${where}.params`, m.settings, errors);
      if (p?.type === "player") checkStations(p.params?.stations, `${where}.params.stations`, Array.isArray(hosts) ? hosts.map((h) => String(h).toLowerCase()) : [], errors);
      for (const k of ["visible", "background"]) {
        const v = p?.interval?.[k];
        if (v != null && !(INTERVAL.test(v) && parseInterval(v) >= 1000)) errors.push(`${where}.interval.${k}: like 30s or 10m, at least 1s`);
      }
    });
  }

  checkSettings(m.settings, Array.isArray(hosts) ? hosts.map((h) => String(h).toLowerCase()) : [], errors);
  checkAlerts(m.alerts, m, errors);

  const l = m.layout;
  if (!l || typeof l !== "object") errors.push("layout: missing");
  else {
    if (!Array.isArray(l.cards) || !l.cards.length || l.cards.length > 6) errors.push("layout.cards: 1-6 cards");
    else l.cards.forEach((c, i) => {
      if (!str(c?.title, 30)) errors.push(`layout.cards[${i}].title: 1-30 characters`);
      if (c?.meta != null && !str(c.meta, 100)) errors.push(`layout.cards[${i}].meta: 1-100 characters`);
      if (c?.when != null && !(typeof c.when === "string" && PATH.test(c.when))) errors.push(`layout.cards[${i}].when: not a path`);
      // "badge": a few words before the meta, colored by `badgeTone` (a path to a color's name): "UV 7 high".
      if (c?.badge != null && !str(c.badge, 60)) errors.push(`layout.cards[${i}].badge: 1-60 characters`);
      if (c?.badgeTone != null && !(typeof c.badgeTone === "string" && PATH.test(c.badgeTone))) errors.push(`layout.cards[${i}].badgeTone: not a path`);
      checkBody(c?.body, `layout.cards[${i}].body`, errors, actionsUsed);
      if (c?.desktop != null) checkBody(c.desktop, `layout.cards[${i}].desktop`, errors, actionsUsed);
    });
    if (l.inline != null) checkBody(l.inline, "layout.inline", errors, actionsUsed);
    for (const k of ["band", "hint", "placeholder", "snapshot"]) if (l[k] != null && !str(l[k], 200)) errors.push(`layout.${k}: 1-200 characters`);
    checkPills(l.pills, errors);
    // "add": a list setting that what's typed in the room's box goes into,
    // or { action, field }: an action that gets what's typed as args[field].
    if (l.add != null) {
      if (typeof l.add === "object" && !Array.isArray(l.add)) {
        if (!(typeof l.add.action === "string" && ACTION.test(l.add.action))) errors.push("layout.add.action: an action's name");
        else actionsUsed.push({ where: "layout.add", action: l.add.action });
        if (!(typeof l.add.field === "string" && SETTING_KEY.test(l.add.field))) errors.push("layout.add.field: a field's name");
      } else if (!(typeof l.add === "string" && SETTING_KEY.test(l.add))) errors.push("layout.add: a setting's key, or { action, field }");
      else actionsUsed.push({ where: "layout.add", setting: l.add, settingType: "list" });
    }
    if (l.keys != null) {
      const keys = typeof l.keys === "object" && !Array.isArray(l.keys) ? Object.entries(l.keys) : null;
      if (!keys || keys.length > 10) errors.push("layout.keys: up to 10 keys");
      else for (const [key, action] of keys) {
        if (!/^[a-z0-9]$/.test(key) || key === "r") errors.push(`layout.keys.${key}: one letter or digit, not r (refresh)`);
        if (!(typeof action === "string" && ACTION.test(action))) errors.push(`layout.keys.${key}: an action's name`);
        else actionsUsed.push({ where: `layout.keys.${key}`, action });
      }
    }
  }
  // Every action a button, row or key names must be one its provider has,
  // a row's ✕ must name a list setting and a row picked a string one.
  for (const use of actionsUsed) {
    if (use.setting) {
      if (m.settings?.[use.setting]?.type !== use.settingType) errors.push(`${use.where}.setting: no ${use.settingType} setting ${use.setting}`);
      continue;
    }
    const p = Array.isArray(m.providers) ? (use.provider ? m.providers.find((x) => x?.id === use.provider) : m.providers[0]) : null;
    const def = p ? providers[p.type] : null;
    if (!def) { errors.push(`${use.where}: no provider ${use.provider ?? ""}`.trim()); continue; }
    if (!(def.actions && Object.hasOwn(def.actions, use.action))) errors.push(`${use.where}: ${p.type} has no action ${use.action}`);
  }
  return errors;
}
