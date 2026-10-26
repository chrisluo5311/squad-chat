// The servers and devices someone watches, checked on the room's interval:
// whether each answers, how fast, and its history. A target is what was
// typed into the room's `targets` setting, never a manifest's (manifest.mjs
// holds a ping provider to a setting that starts empty):
//
//   example.com, 192.168.1.10     ICMP: ping, 3 packets
//   example.com:5432, tcp://…     TCP: a connection to the port, then closed
//   https://example.com/health    HTTP: one GET, timed from DNS to the first
//                                 byte, with its certificate's end date
//
// Every session's bridge may run this, so a target checked less than
// MIN_GAP ago by another one isn't checked again, and the history (the last
// checks, hours for 24 h, days for 90, incidents) is changed holding a lock.
// The history is kept in the room's data dir and never leaves the computer.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { RoomError } from "../net.mjs";
import { locked } from "../lock.mjs";

// A target checked this recently isn't checked again: another session just
// did, or a setting changed (a server added) between the 30 s ticks, which
// then checks only the new one rather than waiting on every slow server.
// Ticks start 30 s after the last run ends, so each still checks them all.
const MIN_GAP = 25_000;
const TIMEOUT_MS = 5_000;
const CHECKS = 120;     // the last checks kept: an hour at 30 s
const BEATS = 40;       // the heartbeat drawn in the list
const DAYS = 90;
const SHARE_ROWS = 6;
const MAX_TARGETS = 20;
const INCIDENTS = 30;
const RECOVERED_MS = 10 * 60_000;   // how long "back up" stays an alert
const checkNow = new Set();         // room data dirs whose next run checks everything now

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV6 = /^[0-9a-f:]+$/i;

// ---------------------------------------------------------------- targets

// What was typed, as a target: { key, kind, host, port, url, name }, or
// null when it isn't one.
export function parseTarget(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) {
    let u;
    try { u = new URL(raw); } catch { return null; }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!(HOSTNAME.test(host) || (host.includes(":") && IPV6.test(host)))) return null;
    if (u.username || u.password) return null;
    const path = u.pathname === "/" ? "" : u.pathname;
    // One key however it's written: no "/" alone at the end, no default port.
    // The path keeps its case: a server may tell /Health from /health.
    const key = `${u.protocol}//${u.host}${path}${u.search}`;
    return { key, kind: u.protocol === "https:" ? "HTTPS" : "HTTP", host, url: u.href, name: `${u.hostname}${u.port ? `:${u.port}` : ""}${path}`.slice(0, 40) };
  }
  const tcp = /^(?:tcp:\/\/)?(\[[0-9a-f:]+\]|[^:/\s]+):(\d{1,5})$/i.exec(raw);
  if (tcp) {
    const host = tcp[1].replace(/^\[|\]$/g, "");
    const port = Number(tcp[2]);
    if (!(port >= 1 && port <= 65535)) return null;
    if (!(HOSTNAME.test(host) || (host.includes(":") && IPV6.test(host)))) return null;
    return { key: `${tcp[1]}:${port}`.toLowerCase(), kind: "TCP", host, port, name: `${tcp[1]}:${port}`.slice(0, 40) };
  }
  if (HOSTNAME.test(raw) || ((raw.match(/:/g) ?? []).length >= 2 && IPV6.test(raw))) {
    return { key: raw.toLowerCase(), kind: "ICMP", host: raw, name: raw.slice(0, 40) };
  }
  return null;
}

// ---------------------------------------------------------------- probes

// `ping`'s replies: the times, and how many were sent and came back.
export function parsePing(text) {
  const times = [...String(text ?? "").matchAll(/time[=<]([\d.]+)\s*ms/g)].map((m) => Number(m[1]));
  const sum = /(\d+) packets transmitted, (\d+) (?:packets )?received/.exec(String(text ?? ""));
  const sent = sum ? Number(sum[1]) : times.length;
  const got = sum ? Number(sum[2]) : times.length;
  return { times, sent, got };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function pingArgv(t, platform) {
  const v6 = t.host.includes(":");
  // A user may not send faster than 0.2 s apart. -W is how long to wait for
  // each reply: milliseconds on macOS, seconds on Linux.
  if (platform === "darwin") return [v6 ? "/sbin/ping6" : "/sbin/ping", "-c", "3", "-i", "0.2", ...(v6 ? [] : ["-W", "2000"]), "--", t.host];
  return ["ping", ...(v6 ? ["-6"] : []), "-c", "3", "-i", "0.2", "-W", "2", "--", t.host];
}

async function probeIcmp(t, ctx) {
  if (ctx.platform !== "darwin" && ctx.platform !== "linux") return { ok: false, why: "ping needs macOS or Linux" };
  // ping exits 0 when at least one reply came back, so null means none did
  // (or ping is missing, which the next line can't tell apart).
  const out = await ctx.run(pingArgv(t, ctx.platform), { timeoutMs: 8_000 });
  const { times, sent, got } = parsePing(out);
  if (!got || !times.length) return { ok: false, why: "no reply", loss: 1 };
  return { ok: true, ms: median(times), loss: sent ? (sent - got) / sent : 0 };
}

// An error as a few words someone can act on.
export function whyOf(err) {
  const code = err?.code ?? "";
  return {
    ECONNREFUSED: "refused",
    ENOTFOUND: "unknown host",
    EAI_AGAIN: "DNS didn't answer",
    ECONNRESET: "connection reset",
    EHOSTUNREACH: "host unreachable",
    ENETUNREACH: "network unreachable",
    ETIMEDOUT: `no answer in ${TIMEOUT_MS / 1000}s`,
    CERT_HAS_EXPIRED: "certificate expired",
    DEPTH_ZERO_SELF_SIGNED_CERT: "self-signed certificate",
    SELF_SIGNED_CERT_IN_CHAIN: "self-signed certificate",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificate not trusted",
    ERR_TLS_CERT_ALTNAME_INVALID: "certificate is for another name",
  }[code] ?? (code || String(err?.message ?? err).slice(0, 60));
}

function probeTcp(t, ctx) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = false;
    let sock;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock?.destroy(); } catch { /* closing anyway */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, why: `no answer in ${TIMEOUT_MS / 1000}s` }), TIMEOUT_MS);
    try {
      sock = ctx.connect({ host: t.host, port: t.port });
      sock.on("connect", () => finish({ ok: true, ms: performance.now() - t0 }));
      sock.on("error", (err) => finish({ ok: false, why: whyOf(err) }));
    } catch (err) { finish({ ok: false, why: whyOf(err) }); }
  });
}

// One GET, timed: DNS, the connection, TLS and the first byte. It never
// follows a redirect (a 3xx is an answer) and reads no body.
export function httpProbe(url, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const t0 = performance.now();
    const at = {};
    let done = false;
    let req;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { req?.destroy(); } catch { /* closing anyway */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, why: `no answer in ${timeoutMs / 1000}s` }), timeoutMs);
    const send = u.protocol === "https:" ? httpsRequest : httpRequest;
    req = send(u, { method: "GET", agent: false, headers: { "user-agent": "squad-chat ping", accept: "*/*" } });
    req.on("socket", (s) => {
      s.on("lookup", () => { at.dns = performance.now(); });
      s.on("connect", () => { at.tcp = performance.now(); });
      s.on("secureConnect", () => {
        at.tls = performance.now();
        try { const end = Date.parse(s.getPeerCertificate()?.valid_to); if (Number.isFinite(end)) at.certEnd = end; } catch { /* no certificate to read */ }
      });
    });
    req.on("response", (res) => {
      const first = performance.now();
      res.resume();
      const dns = at.dns ? at.dns - t0 : 0;
      const tcp = at.tcp ? at.tcp - (at.dns ?? t0) : 0;
      const tls = at.tls && at.tcp ? at.tls - at.tcp : 0;
      const wait = first - (at.tls ?? at.tcp ?? t0);
      const code = res.statusCode;
      finish({ ok: code < 400, ms: first - t0, code, why: code >= 400 ? `HTTP ${code}` : undefined, split: [dns, tcp, tls, wait].map((x) => Math.max(0, Math.round(x))), certEnd: at.certEnd });
    });
    req.on("error", (err) => finish({ ok: false, why: whyOf(err) }));
    req.end();
  });
}

function probe(t, ctx) {
  if (t.kind === "ICMP") return probeIcmp(t, ctx);
  if (t.kind === "TCP") return probeTcp(t, ctx);
  return (ctx.httpProbe ?? httpProbe)(t.url, { timeoutMs: TIMEOUT_MS });
}

// ---------------------------------------------------------------- history

const emptyHistory = () => ({ v: 1, targets: {}, incidents: [], paused: [] });

function loadHistory(dir) {
  try {
    const h = JSON.parse(readFileSync(join(dir, "history.json"), "utf8"));
    if (h && typeof h === "object" && h.targets && typeof h.targets === "object") return { ...emptyHistory(), ...h };
  } catch { /* none yet, or unreadable: start again */ }
  return emptyHistory();
}

function saveHistory(dir, h) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "history.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(h), { mode: 0o600 });
  renameSync(tmp, file);
}

const pad2 = (n) => String(n).padStart(2, "0");
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const hourKey = (ms) => String(Math.floor(ms / 3_600_000) * 3_600_000);
const clockOf = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const hhmm = (ms) => clockOf(ms).slice(0, 5);

// A target's open incidents end at `at`.
function closeIncidents(h, key, at) {
  for (const x of h.incidents) if (x.key === key && x.to == null) x.to = at;
}

// One check's result added to a target's history. `alertAfter` failed
// checks in a row make it down; the first good one after makes it up again.
export function recordCheck(h, t, res, { at, slowMs, alertAfter }) {
  const e = h.targets[t.key] ??= { checks: [], hours: {}, days: {}, fails: 0 };
  const ok = !!res.ok;
  const slow = ok && res.ms >= slowMs;
  const beat = ok ? (slow ? "s" : "u") : "x";
  e.checks.push({ t: at, ms: ok ? Math.round(res.ms * 10) / 10 : null, b: beat, ...(res.loss ? { loss: res.loss } : {}), ...(res.code ? { code: res.code } : {}), ...(res.why ? { why: res.why } : {}) });
  if (e.checks.length > CHECKS) e.checks.splice(0, e.checks.length - CHECKS);
  for (const [bucket, k] of [[e.hours, hourKey(at)], [e.days, dayKey(at)]]) {
    const b = bucket[k] ??= [0, 0, 0];
    b[0]++;
    if (ok) b[1]++;
    if (slow) b[2]++;
  }
  for (const k of Object.keys(e.hours)) if (at - Number(k) > 25 * 3_600_000) delete e.hours[k];
  const days = Object.keys(e.days).sort();
  for (const k of days.slice(0, Math.max(0, days.length - DAYS))) delete e.days[k];
  if (res.split) e.split = res.split;
  if (res.certEnd) e.certEnd = res.certEnd;
  if (ok) {
    if (e.downSince) closeIncidents(h, t.key, at);
    e.fails = 0;
    e.failSince = null;
    e.downSince = null;
    e.why = null;
  } else {
    e.fails = (e.fails ?? 0) + 1;
    e.failSince ??= at;
    e.why = res.why ?? "no answer";
    if (!e.downSince && e.fails >= alertAfter) {
      e.downSince = e.failSince;
      h.incidents.push({ key: t.key, name: t.name, from: e.failSince, to: null, why: e.why });
      if (h.incidents.length > INCIDENTS) h.incidents.splice(0, h.incidents.length - INCIDENTS);
    }
  }
}

// ---------------------------------------------------------------- what's shown

export function fmtMs(v) {
  if (v == null || !Number.isFinite(v)) return "–";
  return v < 10 ? `${(Math.round(v * 10) / 10)} ms` : `${Math.round(v)} ms`;
}

export function fmtSpan(msLong) {
  const m = Math.max(0, Math.floor(msLong / 60_000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(m / 1440)}d`;
}

// A target's checks and good ones over the hours that started in the last
// 24 h. More are kept (an hour is trimmed only at a check), so they're left out here.
function last24(e, now) {
  let n = 0, ok = 0;
  for (const [k, b] of Object.entries(e?.hours ?? {})) if (now - Number(k) < 86_400_000) { n += b[0]; ok += b[1]; }
  return [n, ok];
}

const fmtPct = (ok, n) => (n ? `${(Math.floor((ok / n) * 1000) / 10).toString()}%` : "–");

// A day's or a run of days' mark on the 90-day line: the worst of them.
function dayBeat(buckets) {
  let n = 0, ok = 0;
  for (const b of buckets) if (b) { n += b[0]; ok += b[1]; }
  if (!n) return "n";
  const r = ok / n;
  return r >= 0.999 ? "u" : r >= 0.99 ? "s" : "x";
}

// The 90 days, oldest first, as beats ("u", "s", "x" or "n"), `per` days a mark.
export function dayBeats(e, now, per = 1) {
  const out = [];
  for (let i = DAYS - 1; i >= 0; i -= per) {
    const group = [];
    for (let j = 0; j < per && i - j >= 0; j++) group.push(e?.days?.[dayKey(now - (i - j) * 86_400_000)]);
    out.push(dayBeat(group));
  }
  return out.join("");
}

// The beats as the share card's glyphs: ▮ up, ▪ slow, ▯ down, · not watched.
export const GLYPHS = { u: "▮", s: "▪", x: "▯", n: "·" };
const glyphs = (beats) => [...beats].map((b) => GLYPHS[b] ?? "·").join("");

function targetRow(t, e, { now, slowMs, paused, sinceHour }) {
  const checks = e?.checks ?? [];
  const last = checks.at(-1) ?? null;
  const hour = checks.filter((c) => c.t >= sinceHour);
  const good = hour.filter((c) => c.ms != null).map((c) => c.ms);
  const avg = good.length ? good.reduce((a, b) => a + b, 0) / good.length : null;
  const jitter = good.length > 1 ? good.slice(1).reduce((a, v, i) => a + Math.abs(v - good[i]), 0) / (good.length - 1) : null;
  const lossOf = (c) => (c.ms == null ? 1 : c.loss ?? 0);
  const loss = hour.length ? Math.round((hour.reduce((a, c) => a + lossOf(c), 0) / hour.length) * 100) : null;
  const [n, ok] = last24(e, now);
  const down = !!e?.downSince;
  const failing = !down && last?.ms == null && !!last;
  const slow = !down && !failing && last?.ms != null && last.ms >= slowMs;
  const state = paused ? "paused" : !last ? "new" : down ? "down" : failing || slow ? "slow" : "up";
  const tone = { down: "red", slow: "amber", up: "leaf" }[state] ?? null;
  const dot = { down: "○", slow: "◐", up: "●", paused: "‖", new: "·" }[state];
  const msText = state === "paused" ? "paused" : state === "new" ? "…" : down ? "down" : failing ? "lost" : fmtMs(last.ms);
  const beats = (("n".repeat(BEATS)) + checks.map((c) => c.b).join("")).slice(-BEATS);
  const certDays = e?.certEnd ? Math.floor((e.certEnd - now) / 86_400_000) : null;
  const split = t.kind.startsWith("HTTP") && e?.split
    ? `dns ${e.split[0]} · connect ${e.split[1]}${t.kind === "HTTPS" ? ` · tls ${e.split[2]}` : ""} · first byte ${e.split[3]} ms`
    : "";
  const recent = checks.slice(-5).reverse().map((c) => `${clockOf(c.t)}  ${c.ms == null ? `lost · ${c.why ?? "no answer"}` : `${c.code ? `${c.code}  ` : ""}${fmtMs(c.ms)}${c.loss ? ` · ${Math.round(c.loss * 100)}% lost` : ""}`}`).join("\n");
  return {
    id: t.key,
    name: t.name,
    target: t.raw,
    kind: t.kind,
    state,
    dot,
    tone,
    msText,
    beats,
    up24: fmtPct(ok, n),
    upTone: n && ok / n < 0.99 ? "red" : n && ok < n ? "amber" : null,
    paused,
    word: down ? `down ${fmtSpan(now - e.downSince)}` : failing ? `lost · ${e?.why ?? "no answer"}` : slow ? fmtMs(last.ms) : msText,
    nowText: msText,
    avgText: fmtMs(avg),
    jitterText: fmtMs(jitter),
    lossText: loss == null ? "–" : `${loss}%`,
    lossTone: loss ? (loss >= 5 ? "red" : "amber") : null,
    hist: checks.slice(-60).map((c) => c.ms).filter((v) => v != null),
    recent,
    split,
    cert: certDays == null ? "" : certDays < 0 ? "certificate expired" : `certificate ends in ${certDays} day${certDays === 1 ? "" : "s"}`,
    certTone: certDays != null && certDays < 14 ? (certDays < 0 ? "red" : "amber") : null,
    why: down ? `Down since ${hhmm(e.downSince)} (${fmtSpan(now - e.downSince)}): ${e.why ?? "no answer"}` : failing ? `Last check lost: ${e.why ?? "no answer"}` : "",
    checked: last ? `checked ${clockOf(last.t)}` : "not checked yet",
  };
}

const RANK = { down: 0, slow: 1, up: 2, new: 3, paused: 4 };

export function pingView(h, targets, { now, slowMs, shareNames = true, alerts = true, open = null }) {
  const paused = new Set(h.paused ?? []);
  const sinceHour = now - 3_600_000;
  const rows = targets.map((t) => targetRow(t, h.targets[t.key], { now, slowMs, paused: paused.has(t.key), sinceHour }))
    .map((r, i) => ({ ...r, order: i }))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || a.order - b.order);
  const count = (s) => rows.filter((r) => r.state === s).length;
  const up = count("up"), slow = count("slow"), down = count("down");
  let n = 0, ok = 0;
  for (const t of targets) { const [tn, tok] = last24(h.targets[t.key], now); n += tn; ok += tok; }
  const bad = rows.filter((r) => r.state === "down" || r.state === "slow");
  const watched = rows.filter((r) => r.state !== "paused").length;
  const names = new Map(rows.map((r, i) => [r.id, shareNames ? r.name : `server ${i + 1}`]));

  const band = !targets.length ? "No servers yet · /set targets example.com"
    : [...bad.map((r) => `${r.name} ${r.word}`), up ? `${up} up` : null, ...rows.filter((r) => r.state === "up").slice(0, 3).map((r) => `${r.name} ${r.msText}`)].filter(Boolean).join(" · ");

  const headline = !targets.length ? "Nothing watched yet"
    : down ? `${bad.filter((r) => r.state === "down").map((r) => names.get(r.id)).join(", ")} ${down === 1 ? "is" : "are"} down`
    : slow ? `${slow} slow, ${up} up`
    : !watched ? "All paused"
    : up === watched ? `All ${up} up`
    : up ? `${up} up, ${watched - up} not checked yet` : "Not checked yet";
  const shareRows = rows.filter((r) => r.state !== "paused").slice(0, SHARE_ROWS);
  const width = Math.max(4, ...shareRows.map((r) => [...names.get(r.id)].length));
  const share = [
    `Ping · last 90 days · ${watched} server${watched === 1 ? "" : "s"}`,
    headline,
    ...shareRows.map((r) => {
      const e = h.targets[r.id];
      let dn = 0, dok = 0;
      for (const b of Object.values(e?.days ?? {})) { dn += b[0]; dok += b[1]; }
      return `${names.get(r.id).padEnd(width)}  ${glyphs(dayBeats(e, now, 3))}  ${fmtPct(dok, dn)}`;
    }),
    watched > shareRows.length ? `+ ${watched - shareRows.length} more` : null,
  ].filter(Boolean).join("\n");

  // Every outage still going, newest first, then the latest ended ones up to five.
  const latest = [...(h.incidents ?? [])].filter((x) => targets.some((t) => t.key === x.key)).reverse();
  const going = latest.filter((x) => x.to == null);
  const incidents = [...going, ...latest.filter((x) => x.to != null).slice(0, Math.max(0, 5 - going.length))].map((x, i) => ({
    id: `${x.key}-${x.from}-${i}`,
    dot: x.to == null ? "○" : "●",
    tone: x.to == null ? "red" : "leaf",
    text: x.to == null ? `${x.name} down · ${x.why}` : `${x.name} back up · was down ${fmtSpan(x.to - x.from)}`,
    when: x.to == null ? `${hhmm(x.from)} · ${fmtSpan(now - x.from)}` : `${dayKey(x.to) === dayKey(now) ? "" : `${dayKey(x.to).slice(5)} `}${hhmm(x.to)}`,
  }));

  const out = [];
  if (alerts) {
    for (const r of rows) if (r.state === "down") out.push({ id: `down:${r.id}:${h.targets[r.id].downSince}`, text: `Ping: ${r.name} is down · ${h.targets[r.id].why ?? "no answer"}` });
    for (const x of h.incidents ?? []) if (x.to != null && now - x.to < RECOVERED_MS && targets.some((t) => t.key === x.key)) out.push({ id: `up:${x.key}:${x.to}`, text: `Ping: ${x.name} is back up after ${fmtSpan(x.to - x.from)}` });
  }
  const lastCheck = Math.max(0, ...targets.map((t) => h.targets[t.key]?.checks.at(-1)?.t ?? 0));
  const others = rows.length - Math.min(3, rows.length);
  return {
    targets: rows,
    count: rows.length,
    up,
    slow,
    down,
    pausedCount: count("paused"),
    upText: String(up),
    uptime24: fmtPct(ok, n),
    uptimeTone: n && ok / n < 0.99 ? "red" : n && ok < n ? "amber" : "leaf",
    downTone: down ? "red" : null,
    slowTone: slow ? "amber" : null,
    checked: lastCheck ? `checked ${clockOf(lastCheck)}` : "",
    meta: targets.length ? `${rows.length} server${rows.length === 1 ? "" : "s"} · slow at ${slowMs} ms` : "none yet",
    bad,
    inlineMore: others > 0 ? `${fmtPct(ok, n)} up over 24 h` : "",   // after the inline list's "+ 3 more"
    incidents,
    hasIncidents: incidents.length > 0,
    band,
    share,
    open,
    alerts: out,
  };
}

// The targets setting, parsed: what doesn't parse is left out.
function targetsOf(params) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(params.targets) ? params.targets : []) {
    const t = parseTarget(raw);
    if (!t || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push({ ...t, raw: String(raw).trim() });
  }
  return out.slice(0, MAX_TARGETS);
}

const settingsOf = (params) => ({
  slowMs: Math.max(1, Number(params.slow_ms) || 500),
  alertAfter: Math.max(1, Number(params.alert_after) || 3),
});

export default {
  type: "ping",
  hosts: [],
  async fetch(params, ctx) {
    const targets = targetsOf(params);
    const { slowMs, alertAfter } = settingsOf(params);
    const dir = ctx.dataDir;
    const now = ctx.now();
    const before = loadHistory(dir);
    const paused = new Set(before.paused ?? []);
    const all = checkNow.delete(dir);
    const lastAt = (h, t) => h.targets[t.key]?.checks.at(-1)?.t ?? 0;
    const due = targets.filter((t) => !paused.has(t.key) && (all || now - lastAt(before, t) >= MIN_GAP));
    const results = await Promise.all(due.map(async (t) => ({ t, res: await probe(t, ctx).catch((err) => ({ ok: false, why: whyOf(err) })) })));
    const at = ctx.now();
    const h = await locked(dir, "history", () => {
      const cur = loadHistory(dir);
      for (const { t, res } of results) {
        // Another session's check landed while this one ran.
        if (!all && at - lastAt(cur, t) < MIN_GAP) continue;
        recordCheck(cur, t, res, { at, slowMs, alertAfter });
      }
      // A target taken off the list takes its history with it, and its
      // outage, if it had one, ends there.
      const keep = new Set(targets.map((t) => t.key));
      for (const k of Object.keys(cur.targets)) if (!keep.has(k)) delete cur.targets[k];
      for (const x of cur.incidents) if (!keep.has(x.key)) closeIncidents(cur, x.key, at);
      cur.paused = (cur.paused ?? []).filter((k) => keep.has(k));
      saveHistory(dir, cur);
      return cur;
    });
    return pingView(h, targets, { now: at, slowMs, shareNames: params.share_names !== false, alerts: params.alerts !== false });
  },
  // A target added is one this can check, kept as its key, so the same
  // server written two ways (tcp://host:443 and host:443) is added once.
  check: {
    async targets(list) {
      const bad = list.filter((x) => !parseTarget(x));
      if (bad.length) throw new RoomError(400, `Can't watch ${bad.join(" or ")}. Use a host (example.com), host:port for a TCP port, or an http(s):// URL.`);
      return list.map((x) => parseTarget(x).key);
    },
  },
  actions: {
    // Everything checked now, not on the interval.
    check(params, args, ctx) {
      checkNow.add(ctx.dataDir);
      return { ok: true };
    },
    // The open target (or the one named) stops being checked, or starts again.
    pause(params, args, ctx) {
      const want = String(args.name ?? ctx.settings?.open ?? "").toLowerCase();
      const t = targetsOf(params).find((x) => x.key === want || x.name.toLowerCase() === want);
      if (!t) throw new RoomError(404, "Open a server first, then pause it.");
      return locked(ctx.dataDir, "history", () => {
        const h = loadHistory(ctx.dataDir);
        const paused = new Set(h.paused ?? []);
        const now = !paused.delete(t.key);
        if (now) paused.add(t.key);
        h.paused = [...paused];
        saveHistory(ctx.dataDir, h);
        return { ok: true, paused: now, name: t.name };
      });
    },
  },
};

// For tests: forget which rooms asked to check now.
export function resetPing() {
  checkNow.clear();
}

export { MIN_GAP, BEATS };
