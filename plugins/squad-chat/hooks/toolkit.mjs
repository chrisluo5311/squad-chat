// The Toolbox room's tools: plain functions from what's typed to rows of
// results. Each tool's run(input, now) returns (or resolves to)
//   { rows: [{ label, text, copy, secret, block }], status, note, error, band }
// where `copy` is what ⧉ puts on the clipboard (the text when left out, none
// when false), `secret` rows are drawn masked, `block` rows keep their lines,
// `status` is { text, tone: "ok" | "warn" | "bad" }, and `band` is what the
// band says about it: { meta, text } (text masked when secret).
//
// A hooks module has the web's APIs and no Node: TextEncoder, atob and btoa,
// crypto.getRandomValues, randomUUID and subtle.digest. MD5 isn't among
// them, so it's written out here.

const enc = new TextEncoder();
const utf8 = (s) => enc.encode(s);
const fromUtf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const pad2 = (n) => String(n).padStart(2, "0");
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------- bytes

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Base64 or base64url, padded or not, spaces and line breaks allowed. Null
// when it isn't.
export function fromBase64(text) {
  const t = String(text ?? "").replace(/\s+/g, "");
  if (!t || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t) || t.replace(/=+$/, "").length % 4 === 1) return null;
  const std = t.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  try {
    const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// Text a person could read: valid UTF-8 without control characters (tabs
// and line breaks aside).
function readable(bytes) {
  try {
    const s = fromUtf8(bytes);
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

function randomBelow(n) {
  // Rejection sampling: no bias toward the low numbers.
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---------------------------------------------------------------- MD5

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000) >>> 0);

export function md5(bytes) {
  const n = bytes.length;
  const total = (((n + 8) >> 6) + 1) * 64;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[n] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, (n * 8) >>> 0, true);
  view.setUint32(total - 4, Math.floor(n / 0x2000_0000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d;
      d = c;
      c = b;
      const x = (a + f + MD5_K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      b = (b + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((w, i) => out.setUint32(i * 4, w, true));
  return hex(new Uint8Array(out.buffer));
}

// ---------------------------------------------------------------- time

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2025-02-08 15:33:20", in the computer's time zone, and its offset.
export function localTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
export function utcOffset(ms) {
  const off = -new Date(ms).getTimezoneOffset();
  return `${off < 0 ? "-" : "+"}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}`;
}

// "42m", "3h", "1 year, 8 months": how far apart, in the larger units.
export function span(ms, { long = false } = {}) {
  const a = Math.abs(ms);
  const units = [["year", 365.25 * 864e5, "y"], ["month", 30.44 * 864e5, "mo"], ["day", 864e5, "d"], ["hour", 36e5, "h"], ["minute", 6e4, "m"], ["second", 1e3, "s"]];
  const parts = [];
  let rest = a;
  for (const [name, size, short] of units) {
    const n = Math.floor(rest / size);
    if (!n && !parts.length) continue;
    if (n) parts.push(long ? `${n} ${name}${n === 1 ? "" : "s"}` : `${n}${short}`);
    rest -= n * size;
    if (parts.length === 2 || (parts.length && !long)) break;
  }
  return parts.length ? parts.join(long ? ", " : " ") : long ? "0 seconds" : "0s";
}
const ago = (ms, now) => (ms <= now ? `${span(now - ms, { long: true })} ago` : `in ${span(ms - now, { long: true })}`);

// A Unix time in seconds or milliseconds, or a date the engine can read.
export function readTime(text, now) {
  const t = String(text ?? "").trim();
  if (!t || /^now$/i.test(t)) return now;
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return Math.abs(n) >= 1e11 ? n : n * 1000;
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------- cron

const CRON_FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] },
  { name: "weekday", min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
];
const CRON_MACROS = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

function cronNumber(word, f) {
  const w = word.toLowerCase();
  const named = f.names?.indexOf(w) ?? -1;
  if (named >= 0) return named + (f.name === "month" ? 1 : 0);
  if (!/^\d+$/.test(w)) throw new Error(`${word} isn't a ${f.name}`);
  const n = Number(w);
  if (n < f.min || n > f.max) throw new Error(`${f.name} ${n} is outside ${f.min}-${f.max}`);
  return n;
}

// Each field as the values it takes, and as written ("*", "*/15", "9-18").
export function parseCron(text) {
  const t = String(text ?? "").trim().toLowerCase();
  const words = (CRON_MACROS[t] ?? t).split(/\s+/).filter(Boolean);
  if (words.length !== 5) throw new Error("A cron line has 5 fields: minute hour day month weekday");
  return words.map((word, i) => {
    const f = CRON_FIELDS[i];
    const values = new Set();
    for (const item of word.split(",")) {
      const [range, stepText] = item.split("/");
      const step = stepText == null ? 1 : Number(stepText);
      if (!Number.isInteger(step) || step < 1) throw new Error(`a bad step in ${item}`);
      let lo, hi;
      if (range === "*") { lo = f.min; hi = f.max; }
      else if (range.includes("-")) { const [a, b] = range.split("-"); lo = cronNumber(a, f); hi = cronNumber(b, f); }
      else { lo = cronNumber(range, f); hi = stepText == null ? lo : f.max; }
      if (lo > hi) throw new Error(`${range} runs backward`);
      for (let v = lo; v <= hi; v += step) values.add(f.name === "weekday" && v === 7 ? 0 : v);
    }
    return { word, values, any: word === "*" };
  });
}

// The next times it runs after `now`, at most `n`, within five years.
export function cronNext(fields, now, n = 3) {
  const [mi, ho, dom, mon, dow] = fields;
  const dayOk = (d) => {
    // Day of month and weekday: either, when both are given; as cron has it.
    const a = dom.values.has(d.getDate()), b = dow.values.has(d.getDay());
    return dom.any || dow.any ? a && b : a || b;
  };
  const out = [];
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const end = now + 5 * 366 * 864e5;
  while (out.length < n && d.getTime() < end) {
    if (!mon.values.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!dayOk(d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!ho.values.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!mi.values.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    out.push(d.getTime());
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }
  return out;
}

const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const sorted = (set) => [...set].sort((a, b) => a - b);

// "Every 15 minutes, between 09:00 and 18:59, Monday to Friday".
export function describeCron(fields) {
  const [mi, ho, dom, mon, dow] = fields;
  const step = (f) => /^\*\/(\d+)$/.exec(f.word)?.[1];
  const range = (f) => /^(\d+)-(\d+)$/.exec(f.word);
  const parts = [];
  const mins = sorted(mi.values), hours = sorted(ho.values);
  if (!mi.any && !step(mi) && !ho.any && !step(ho) && !range(ho) && mins.length * hours.length <= 6) {
    parts.push(`At ${list(hours.flatMap((h) => mins.map((m) => `${pad2(h)}:${pad2(m)}`)))}`);
  } else {
    if (mi.any) parts.push("Every minute");
    else if (step(mi)) parts.push(`Every ${step(mi)} minutes`);
    else parts.push(`At minute ${list(mins.map(String))}`);
    if (step(ho)) parts.push(`every ${step(ho)} hours`);
    else if (range(ho)) parts.push(`between ${pad2(range(ho)[1])}:00 and ${pad2(range(ho)[2])}:59`);
    else if (!ho.any) parts.push(`past ${list(hours.map((h) => `${pad2(h)}:00`))}`);
  }
  if (!dom.any) parts.push(`on day ${list(sorted(dom.values).map(String))} of the month`);
  if (!mon.any) parts.push(`in ${list(sorted(mon.values).map((m) => MONTHS[m - 1]))}`);
  if (!dow.any) {
    const r = range(dow);
    const days = sorted(dow.values);
    parts.push(r && days.length > 2 ? `${DAY_NAMES[Number(r[1]) % 7]} to ${DAY_NAMES[Number(r[2]) % 7]}` : `on ${list(days.map((x) => DAY_NAMES[x]))}`);
  }
  if (dom.any && mon.any && dow.any && !ho.any && !step(ho) && !range(ho) && !mi.any && !step(mi)) parts.push("every day");
  return parts.join(", ");
}

// ---------------------------------------------------------------- words

const LOREM = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua "
  + "enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit "
  + "voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt "
  + "mollit anim id est laborum").split(" ");

function sentence() {
  const n = 8 + randomBelow(9);
  const words = Array.from({ length: n }, () => LOREM[randomBelow(LOREM.length)]);
  if (n > 10) words[4 + randomBelow(3)] += ",";
  const s = words.join(" ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

// The words of "fooBar baz_qux", for the case tool: foo, Bar, baz, qux.
function wordsOf(text) {
  return String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

const HTML_NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»" };

// "a few options": a number, and words such as v7 or upper.
function options(text) {
  const words = String(text ?? "").toLowerCase().split(/[\s,·]+/).filter(Boolean);
  const num = words.find((w) => /^\d+$/.test(w));
  return { n: num == null ? null : Number(num), has: (w) => words.includes(w) };
}
const clampN = (n, lo, hi, dflt) => (n == null ? dflt : Math.min(hi, Math.max(lo, n)));

// ---------------------------------------------------------------- the tools

const row = (label, text, extra = {}) => ({ label, text: String(text), ...extra });
const empty = (note) => ({ rows: [], note });
const short = (s, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function uuidV7() {
  const b = randomBytes(16);
  const ms = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now) {
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let rand = "";
  for (const b of randomBytes(16)) rand += CROCKFORD[b % 32];
  return time + rand;
}
function ulidTime(id) {
  let t = 0;
  for (const c of id.slice(0, 10).toUpperCase()) t = t * 32 + CROCKFORD.indexOf(c);
  return t;
}

function decodeJwt(text) {
  const parts = String(text ?? "").trim().replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return null;
  const part = (p) => { const b = fromBase64(p); const s = b && readable(b); try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const header = part(parts[0]), payload = part(parts[1]);
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
  return { header, payload };
}

// What a JWT's exp says at `now`: still good for how long, or gone how long ago.
function jwtState(payload, now) {
  if (typeof payload.exp !== "number") return { text: "no exp: never expires", tone: "warn", left: null };
  const left = payload.exp * 1000 - now;
  return left > 0
    ? { text: `valid for ${span(left)}`, tone: "ok", left }
    : { text: `expired ${span(-left)} ago`, tone: "bad", left };
}

const GROUP_ENCODE = "Encode", GROUP_GENERATE = "Generate", GROUP_CONVERT = "Convert", GROUP_TEXT = "Text";

export const TOOLS = {
  base64: { label: "Base64", group: GROUP_ENCODE, hint: "Type or paste text to encode, or Base64 to decode.", run(input) {
    if (!input) return empty(this.hint);
    const bytes = fromBase64(input);
    const decoded = bytes && readable(bytes);
    const encoded = toBase64(utf8(input));
    const rows = [];
    if (decoded != null) rows.push(row("decoded", decoded));
    rows.push(row("encoded", encoded), row("url-safe", encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")));
    return { rows, band: { meta: decoded != null ? "decoded" : "encoded", text: decoded ?? encoded } };
  } },
  url: { label: "URL", group: GROUP_ENCODE, hint: "Type or paste a URL or text to encode or decode.", run(input) {
    if (!input) return empty(this.hint);
    const rows = [];
    let decoded = null;
    try { decoded = decodeURIComponent(input.replace(/\+/g, " ")); } catch { /* not encoded */ }
    if (decoded != null && decoded !== input) rows.push(row("decoded", decoded));
    rows.push(row("encoded", encodeURIComponent(input)));
    if (URL.canParse(decoded ?? input)) {
      const u = new URL(decoded ?? input);
      let k = 0;
      u.searchParams.forEach((v, key) => { if (k++ < 8) rows.push(row(`?${key}`, v)); });
    }
    return { rows, band: { meta: rows[0].label, text: rows[0].text } };
  } },
  html: { label: "HTML", group: GROUP_ENCODE, hint: "Type text to escape for HTML, or entities to read back.", run(input) {
    if (!input) return empty(this.hint);
    const escaped = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const unescaped = input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") { const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
      return HTML_NAMED[e.toLowerCase()] ?? m;
    });
    const rows = [];
    if (unescaped !== input) rows.push(row("unescaped", unescaped));
    rows.push(row("escaped", escaped));
    return { rows, band: { meta: rows[0].label, text: rows[0].text } };
  } },
  jwt: { label: "JWT", group: GROUP_ENCODE, hint: "Paste a JWT to read its header and claims. The signature isn't checked.", run(input, now) {
    if (!input) return empty(this.hint);
    const jwt = decodeJwt(input);
    if (!jwt) return { rows: [], error: "Not a JWT: it needs three parts, header.payload.signature, the first two Base64 JSON." };
    const { header, payload } = jwt;
    const rows = [row("header", JSON.stringify(header))];
    for (const [key, value] of Object.entries(payload).slice(0, 14)) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const when = ["exp", "iat", "nbf", "auth_time"].includes(key) && typeof value === "number" ? `  ${localTime(value * 1000)}` : "";
      rows.push(row(key, text + when, { copy: text }));
    }
    rows.push(row("payload", "copy the payload as JSON", { copy: JSON.stringify(payload, null, 2), dim: true }));
    const st = jwtState(payload, now);
    return { rows, status: { text: `${st.text} · signature not checked`, tone: st.tone }, band: { meta: String(header.alg ?? "?"), text: st.text } };
  } },
  uuid: { label: "UUID", group: GROUP_GENERATE, generates: true, hint: "5 · v7 · upper · nodash", run(input) {
    const o = options(input);
    const n = clampN(o.n, 1, 20, 5);
    const v7 = o.has("v7");
    const ids = Array.from({ length: n }, () => {
      let id = v7 ? uuidV7() : crypto.randomUUID();
      if (o.has("nodash")) id = id.replace(/-/g, "");
      return o.has("upper") ? id.toUpperCase() : id;
    });
    const meta = `${v7 ? "v7" : "v4"} ×${n}`;
    return { rows: ids.map((id) => row("", id)), mode: meta, copyAll: ids.join("\n"), band: { meta, text: ids[0] } };
  } },
  ulid: { label: "ULID", group: GROUP_GENERATE, generates: true, hint: "5 · or paste a ULID to read its time", run(input, now) {
    const t = String(input ?? "").trim();
    if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(t)) {
      const ms = ulidTime(t);
      return { rows: [row("time", `${localTime(ms)} ${utcOffset(ms)}`), row("unix ms", ms)], band: { meta: "read", text: localTime(ms) } };
    }
    const n = clampN(options(t).n, 1, 20, 5);
    const ids = Array.from({ length: n }, () => ulid(now));
    return { rows: ids.map((id) => row("", id)), mode: `×${n}`, copyAll: ids.join("\n"), band: { meta: `×${n}`, text: ids[0] } };
  } },
  hash: { label: "Hash", group: GROUP_GENERATE, hint: "Type or paste text to hash.", async run(input) {
    if (!input) return empty(this.hint);
    const bytes = utf8(input);
    const sha = async (name) => hex(new Uint8Array(await crypto.subtle.digest(name, bytes)));
    const rows = [row("md5", md5(bytes)), row("sha1", await sha("SHA-1")), row("sha256", await sha("SHA-256")), row("sha512", await sha("SHA-512"))];
    const s256 = rows[2].text;
    return { rows, note: `of ${bytes.length} byte${bytes.length === 1 ? "" : "s"}`, band: { meta: "sha256", text: `${s256.slice(0, 12)}…${s256.slice(-8)}` } };
  } },
  password: { label: "Password", group: GROUP_GENERATE, generates: true, hint: "20 · nosym · digits", run(input) {
    const o = options(input);
    const len = clampN(o.n, 4, 128, 20);
    const sets = o.has("digits") ? ["0123456789"]
      : ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", ...(o.has("nosym") ? [] : ["!@#$%^&*-_=+?"])];
    const pool = sets.join("");
    // One from each set, then the rest from all of them, shuffled.
    const chars = sets.map((s) => s[randomBelow(s.length)]);
    while (chars.length < len) chars.push(pool[randomBelow(pool.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = randomBelow(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    const pw = chars.slice(0, len).join("");
    const bits = Math.round(len * Math.log2(pool.length));
    const strength = bits < 50 ? { text: "weak", tone: "bad" } : bits < 80 ? { text: "fair", tone: "warn" } : { text: "strong", tone: "ok" };
    return { rows: [row("", pw, { secret: true })], status: { text: `${strength.text} · ${bits} bits`, tone: strength.tone }, strength: strength.text, mode: `${len} chars`, band: { meta: `${len} chars`, text: pw, secret: true } };
  } },
  lorem: { label: "Lorem", group: GROUP_GENERATE, generates: true, hint: "3 sentences · or another number", run(input) {
    const n = clampN(options(input).n, 1, 20, 3);
    const text = ["Lorem ipsum dolor sit amet, consectetur adipiscing elit.", ...Array.from({ length: n - 1 }, sentence)].join(" ");
    const words = text.split(/\s+/).length;
    return { rows: [row("", text, { block: true })], mode: `${n} sentence${n === 1 ? "" : "s"}`, note: `${words} words`, band: { meta: `${n} sentence${n === 1 ? "" : "s"}`, text } };
  } },

  time: { label: "Time", group: GROUP_CONVERT, hint: "A Unix time (seconds or ms), a date, or now.", run(input, now) {
    const ms = readTime(input, now);
    if (ms == null || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return { rows: [], error: `Can't read ${input} as a time: try 1739000000, 2025-02-08 15:33 or now.` };
    const rows = [
      row("unix", Math.floor(ms / 1000)), row("ms", Math.round(ms)),
      row("local", `${localTime(ms)} ${utcOffset(ms)}`, { copy: localTime(ms) }),
      row("iso", new Date(ms).toISOString()),
    ];
    return { rows, note: input && !/^now$/i.test(input) ? ago(ms, now) : "now", band: { meta: input ? "read" : "now", text: localTime(ms) } };
  } },
  base: { label: "Base", group: GROUP_CONVERT, hint: "A number: 255, 0xff, 0b1010 or 0o17.", run(input) {
    const t = String(input ?? "").trim().replace(/[_\s]/g, "").toLowerCase();
    if (!t) return empty(this.hint);
    const neg = t.startsWith("-");
    const body = neg ? t.slice(1) : t;
    const m = /^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)$/.exec(body);
    if (!m) return { rows: [], error: `${input} isn't a number: try 255, 0xff, 0b1010 or 0o17.` };
    let n = BigInt(body);
    if (neg) n = -n;
    const abs = n < 0n ? -n : n;
    const sign = n < 0n ? "-" : "";
    const group = (s, k) => s.replace(new RegExp(`\\B(?=(.{${k}})+$)`, "g"), " ");
    const from = body.startsWith("0x") ? "hex" : body.startsWith("0b") ? "bin" : body.startsWith("0o") ? "oct" : "dec";
    const rows = [
      row("dec", sign + abs.toString(10)),
      row("hex", sign + group(abs.toString(16).toUpperCase(), 4), { copy: `${sign}0x${abs.toString(16)}` }),
      row("oct", sign + abs.toString(8), { copy: `${sign}0o${abs.toString(8)}` }),
      row("bin", sign + group(abs.toString(2), 4), { copy: `${sign}0b${abs.toString(2)}` }),
    ];
    return { rows, mode: `from ${from}`, band: { meta: `from ${from}`, text: `${rows[0].text} = ${sign}0x${abs.toString(16).toUpperCase()}` } };
  } },
  cron: { label: "Cron", group: GROUP_CONVERT, hint: "A cron line: */15 9-18 * * 1-5, or @daily.", run(input, now) {
    if (!input) return empty(this.hint);
    let fields;
    try { fields = parseCron(input); } catch (err) { return { rows: [], error: `${err.message}.` }; }
    const text = describeCron(fields);
    const next = cronNext(fields, now, 3);
    const rows = [row("", text, { block: true }), ...next.map((ms, i) => row(i ? "" : "next", localTime(ms).slice(0, 16), { copy: false }))];
    if (!next.length) rows.push(row("next", "not in the next five years", { copy: false }));
    return { rows, band: { meta: next.length ? `next ${localTime(next[0]).slice(5, 16)}` : "never", text } };
  } },
  json: { label: "JSON", group: GROUP_CONVERT, hint: "Paste JSON to format it, or to squeeze it onto one line.", run(input) {
    if (!input) return empty(this.hint);
    let value;
    try { value = JSON.parse(input); } catch (err) { return { rows: [], error: `Not JSON: ${err.message}` }; }
    const pretty = JSON.stringify(value, null, 2);
    const keys = value && typeof value === "object" ? Object.keys(value).length : 0;
    return { rows: [row("pretty", pretty, { block: true }), row("minified", JSON.stringify(value))], note: Array.isArray(value) ? `an array of ${value.length}` : value && typeof value === "object" ? `an object with ${keys} key${keys === 1 ? "" : "s"}` : typeof value, band: { meta: "valid", text: JSON.stringify(value) } };
  } },

  escape: { label: "Escape", group: GROUP_TEXT, hint: "Type text to escape as a string, or \\n \\t \\u00e9 to read back.", run(input) {
    if (!input) return empty(this.hint);
    const rows = [];
    if (/\\/.test(input)) {
      const un = input.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (m, e) => {
        if (/^u\{/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
        if (/^[ux]/i.test(e) && e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
        return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", 0: "\0" }[e] ?? e;
      });
      rows.push(row("unescaped", un, { block: un.includes("\n") }));
    }
    rows.push(row("escaped", JSON.stringify(input).slice(1, -1)));
    return { rows, band: { meta: rows[0].label, text: rows[0].text } };
  } },
  count: { label: "Count", group: GROUP_TEXT, hint: "Type or paste text to count it.", run(input) {
    if (!input) return empty(this.hint);
    const chars = [...input].length;
    const cjk = (input.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
    const words = (input.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").match(/[\p{L}\p{N}'’-]+/gu) ?? []).length + cjk;
    const lines = input.split(/\r\n|\r|\n/).length;
    const rows = [
      row("chars", chars, { copy: false }), row("words", words, { copy: false }), row("lines", lines, { copy: false }),
      row("bytes", `${utf8(input).length} in UTF-8`, { copy: false }),
    ];
    return { rows, band: { meta: `${chars} chars`, text: `${words} words · ${lines} line${lines === 1 ? "" : "s"}` } };
  } },
  case: { label: "Case", group: GROUP_TEXT, hint: "Type words to change their case: user id, userId, user_id …", run(input) {
    if (!input) return empty(this.hint);
    const w = wordsOf(input);
    if (!w.length) return { rows: [], error: "No words in it." };
    const lower = w.map((x) => x.toLowerCase());
    const rows = [
      row("camel", lower[0] + w.slice(1).map(cap).join("")), row("pascal", w.map(cap).join("")),
      row("snake", lower.join("_")), row("kebab", lower.join("-")), row("constant", lower.join("_").toUpperCase()),
      row("title", w.map(cap).join(" ")), row("lower", input.toLowerCase()), row("upper", input.toUpperCase()),
    ];
    return { rows, band: { meta: "camel", text: rows[0].text } };
  } },
};

export const GROUPS = [GROUP_ENCODE, GROUP_GENERATE, GROUP_CONVERT, GROUP_TEXT];
export const TOOL_IDS = Object.keys(TOOLS);

// A tool by its id or label, any case: "uuid", "Base64", "pw".
const ALIASES = { b64: "base64", pw: "password", pass: "password", ts: "time", date: "time", timestamp: "time", sha: "hash", md5: "hash", sha256: "hash", num: "base", radix: "base", ipsum: "lorem", words: "count", esc: "escape" };
export function findTool(word) {
  const w = String(word ?? "").trim().toLowerCase();
  if (TOOLS[w]) return w;
  if (ALIASES[w]) return ALIASES[w];
  return TOOL_IDS.find((id) => TOOLS[id].label.toLowerCase() === w) ?? null;
}

export async function runTool(id, input, now) {
  try {
    return await TOOLS[id].run(String(input ?? ""), now);
  } catch (err) {
    return { rows: [], error: `${TOOLS[id].label} failed: ${err?.message ?? err}` };
  }
}

// What the clipboard holds, when a tool reads it at a glance: a JWT (its
// algorithm, role and how long it has) or a Unix time. Nothing else.
export function detectClip(text, now) {
  const t = String(text ?? "").trim();
  if (t.length < 4000 && /^(Bearer\s+)?eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/.test(t)) {
    const jwt = decodeJwt(t);
    if (jwt) {
      const st = jwtState(jwt.payload, now);
      return { kind: "JWT", alg: String(jwt.header.alg ?? "?"), role: typeof jwt.payload.role === "string" ? jwt.payload.role : null, exp: jwt.payload.exp, state: st };
    }
  }
  if (/^\d{10}(\d{3})?$/.test(t)) {
    const ms = t.length === 13 ? Number(t) : Number(t) * 1000;
    // 2001 to 2100: a ten-digit number outside that is likely something else.
    if (ms >= 978307200000 && ms < 4102444800000) return { kind: "ts", raw: t, ms, ago: ago(ms, now) };
  }
  return null;
}

export { short, span as timeSpan };
