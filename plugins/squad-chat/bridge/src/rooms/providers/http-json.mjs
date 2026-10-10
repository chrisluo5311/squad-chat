// Any JSON API a room names, with no code: a URL (settings fill its {holes}),
// an object of objects turned into rows a list or a table can show, and
// fields picked out by path and formatted for the pane. Its hosts are the
// manifest's ("*"): the URL must be https and on one of them.
//
//   "params": {
//     "url": "https://api.coingecko.com/api/v3/simple/price?ids={coins}&vs_currencies={currency}",
//     "vars": { "coins": "$settings.coins", "currency": "$settings.currency" },
//     "rows": { "from": "", "key": "id", "order": "coins" },
//     "fields": { "price": { "path": "{currency}", "format": "number" } },
//     "values": { "date": { "path": "date", "format": "text" } }
//   }
//
// Each field gives `<name>` (the display string) and `<name>Value` (the
// number, for alerts). A signed one adds `<name>Arrow` (▲ ▼) and
// `<name>Color` (a palette name: green for up unless "up": "red").

import { RoomError } from "../net.mjs";

const MAX_ROWS = 100;
const FORMATS = new Set(["text", "number", "compact", "percent", "signed", "signed-percent", "date", "age"]);
export { FORMATS };

const get = (obj, path) => String(path ?? "").split(".").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);

// "{coins}" → "bitcoin,ethereum", each part URL-encoded when `encode`.
export function fillVars(template, vars, encode = false) {
  return String(template ?? "").replace(/\{([a-z][a-z0-9_]*)\}/gi, (m, name) => {
    if (!Object.hasOwn(vars, name)) return m;
    const v = vars[name];
    const parts = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? ""));
    return parts.map((p) => (encode ? encodeURIComponent(p) : p)).join(",");
  });
}

function toTime(v) {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : NaN;
}

function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function ago(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

// One field: its display string, and the number behind it.
export function formatField(raw, spec, now = Date.now()) {
  const fmt = spec.format ?? "text";
  const out = {};
  if (fmt === "text") return { text: raw == null ? "" : String(raw) };
  if (fmt === "date" || fmt === "age") {
    const t = toTime(raw);
    if (!Number.isFinite(t)) return { text: "" };
    out.value = t;
    out.text = fmt === "age" ? ago(t, now) : new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return out;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return { text: "–" };
  const d = Number.isInteger(spec.digits) ? Math.max(0, Math.min(8, spec.digits)) : null;
  const num = (x) => x.toLocaleString("en-US", d == null ? { maximumFractionDigits: Math.abs(x) >= 100 ? 2 : 4 } : { minimumFractionDigits: d, maximumFractionDigits: d });
  out.value = n;
  if (fmt === "number") out.text = num(n);
  else if (fmt === "compact") out.text = compact(n);
  else if (fmt === "percent") out.text = `${n.toFixed(d ?? 1)}%`;
  else {
    const body = fmt === "signed-percent" ? `${Math.abs(n).toFixed(d ?? 2)}%` : num(Math.abs(n));
    // Up or down as shown: a change that rounds to zero is flat, not "−0.00%".
    const shown = /[1-9]/.test(body) ? Math.sign(n) : 0;
    out.text = `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${body}`;
    const upColor = spec.up === "red" ? "rose" : "leaf";
    out.arrow = shown > 0 ? "▲" : shown < 0 ? "▼" : "–";
    out.color = shown > 0 ? upColor : shown < 0 ? (upColor === "rose" ? "leaf" : "rose") : "sand";
  }
  return out;
}

function applyFields(target, src, fields, vars, now) {
  for (const [name, spec] of Object.entries(fields ?? {})) {
    const f = formatField(get(src, fillVars(spec.path, vars)), spec, now);
    target[name] = f.text;
    if (f.value != null) target[`${name}Value`] = f.value;
    if (f.arrow) { target[`${name}Arrow`] = f.arrow; target[`${name}Color`] = f.color; }
  }
  return target;
}

// An array as it is, or an object of objects (or of numbers) as rows, each
// carrying its key.
export function toRows(src, key = "id") {
  if (Array.isArray(src)) return src.slice(0, MAX_ROWS).map((x) => (x && typeof x === "object" ? { ...x } : { value: x }));
  if (!src || typeof src !== "object") return [];
  return Object.entries(src).slice(0, MAX_ROWS).map(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? { [key]: k, ...v } : { [key]: k, value: v }));
}

export default {
  type: "http-json",
  hosts: "*",
  async fetch(params, ctx) {
    const vars = params.vars && typeof params.vars === "object" ? params.vars : {};
    const url = fillVars(params.url, vars, true);
    if (!/^https:\/\//i.test(url)) throw new RoomError(400, "http-json reads https URLs only");
    const r = await ctx.fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new RoomError(502, `${new URL(url).hostname} answered ${r.status}`);
    const json = r.json();
    const now = ctx.now?.() ?? Date.now();
    const out = applyFields({}, json, params.values, vars, now);
    if (params.rows) {
      const key = params.rows.key || "id";
      let rows = toRows(params.rows.from ? get(json, fillVars(params.rows.from, vars)) : json, key);
      // In the order a setting lists them (coins as typed), the rest after.
      const order = params.rows.order && Array.isArray(vars[params.rows.order]) ? vars[params.rows.order].map((x) => String(x).toLowerCase()) : null;
      if (order) {
        const rank = (row) => { const i = order.indexOf(String(row[key]).toLowerCase()); return i < 0 ? order.length : i; };
        rows = rows.sort((a, b) => rank(a) - rank(b));
      }
      out.rows = rows.map((row) => applyFields({ ...row }, row, params.fields, vars, now));
      out.count = out.rows.length;
    }
    out.updated = new Date(now).toTimeString().slice(0, 5);
    return out;
  },
};
