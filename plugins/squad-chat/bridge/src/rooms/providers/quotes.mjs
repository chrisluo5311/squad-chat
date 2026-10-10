// Stock quotes for a watchlist, no key needed:
//
//   Taiwan  TWSE's MIS service (the exchange's own, near real time): a code
//           like 2330 is asked for on both the listed (tse) and the OTC (otc)
//           market, and whichever exists answers. "TAIEX" is the index.
//   Others  Yahoo Finance's chart endpoint (unofficial, so it sits behind this
//           one function): AAPL, BRK-B, ^GSPC, 7203.T, 0700.HK.
//
// Yahoo also gives every quote's intraday line, Taiwan's included, for the
// chart. A market is open only when its data is from today and the clock is
// inside its session: TWSE keeps answering on holidays with the last trading
// day's prices. While every market is closed nothing is asked for more than
// every 15 minutes. Prices may be delayed. None of this is investment advice.

import { RoomError } from "../net.mjs";

const MAX = 12;
const CLOSED_REFRESH_MS = 15 * 60_000;
const SPARKS = "▁▂▃▄▅▆▇█";
const SYMBOL = /^\^?[A-Za-z0-9][A-Za-z0-9.=-]{0,14}$/;
const cache = new Map();   // room data dir → { at, key, data }

const num = (s) => (s == null || s === "-" || s === "" ? NaN : Number(String(s).replace(/,/g, "")));

// What a watchlist entry asks for: a TWSE code, or a Yahoo symbol.
export function classify(entry) {
  const s = String(entry ?? "").trim();
  if (/^taiex$/i.test(s)) return { symbol: "TAIEX", tw: "t00", yahoo: "^TWII" };
  let m = /^(\d{4,6}[A-Z]?)(?:\.(TW|TWO))?$/i.exec(s);
  if (m) return { symbol: m[1].toUpperCase(), tw: m[1].toUpperCase(), market: m[2]?.toUpperCase() === "TWO" ? "otc" : m[2] ? "tse" : null, yahoo: `${m[1].toUpperCase()}.${m[2]?.toUpperCase() === "TWO" ? "TWO" : "TW"}` };
  if (!SYMBOL.test(s)) return null;
  return { symbol: s.toUpperCase(), yahoo: s.toUpperCase() };
}

function spark(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return "";
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const step = Math.max(1, Math.ceil(v.length / 24));   // 24 cells at most
  return v.filter((_, i) => i % step === 0).map((x) => SPARKS[hi > lo ? Math.round(((x - lo) / (hi - lo)) * 7) : 3]).join("");
}

function price(n, tw) {
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", tw ? { maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function volume(n, tw) {
  if (!Number.isFinite(n)) return "";
  if (tw) return `${n.toLocaleString("en-US")} lots`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

// "YYYYMMDD" and minutes since midnight, in a time zone.
function clock(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}${p.month}${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekend: p.weekday === "Sat" || p.weekday === "Sun" };
}

// TWSE is open on a weekday from 9:00 to 13:30 Taipei time, and only when
// the quote is today's (holidays answer with the last trading day's).
export function twOpen(dataDay, now) {
  const c = clock(now, "Asia/Taipei");
  return dataDay === c.day && !c.weekend && c.minutes >= 9 * 60 && c.minutes <= 13 * 60 + 30;
}

async function twse(entries, ctx) {
  if (!entries.length) return new Map();
  const ex = entries.flatMap((e) => (e.symbol === "TAIEX" ? ["tse_t00.tw"] : e.market ? [`${e.market}_${e.tw.toLowerCase()}.tw`] : [`tse_${e.tw.toLowerCase()}.tw`, `otc_${e.tw.toLowerCase()}.tw`]));
  const r = await ctx.fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex.join("|")}&json=1&delay=0`);
  if (!r.ok) throw new RoomError(502, `TWSE answered ${r.status}`);
  const out = new Map();
  for (const m of r.json().msgArray ?? []) {
    if (!m?.c) continue;
    const last = num(m.z);
    const bid = num(String(m.b ?? "").split("_")[0]);
    const prev = num(m.y);
    out.set(m.c === "t00" ? "TAIEX" : m.c.toUpperCase(), {
      ex: m.ex,
      name: m.c === "t00" ? "加權指數" : m.n,
      price: Number.isFinite(last) ? last : Number.isFinite(bid) && bid > 0 ? bid : prev,
      prev,
      volume: num(m.v),
      day: m.d,
      time: String(m.t ?? "").slice(0, 5),
    });
  }
  return out;
}

async function yahoo(symbol, ctx) {
  const r = await ctx.fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`);
  if (r.status === 404) throw new RoomError(404, `no symbol ${symbol}`);
  if (!r.ok) throw new RoomError(502, `Yahoo answered ${r.status} for ${symbol}`);
  const x = r.json().chart?.result?.[0];
  if (!x?.meta) throw new RoomError(404, `no symbol ${symbol}`);
  const m = x.meta;
  return {
    name: m.shortName || m.longName || symbol,
    price: m.regularMarketPrice,
    prev: m.chartPreviousClose ?? m.previousClose,
    volume: m.regularMarketVolume,
    at: (m.regularMarketTime ?? 0) * 1000,
    session: m.currentTradingPeriod?.regular,
    tz: m.exchangeTimezoneName,
    line: x.indicators?.quote?.[0]?.close ?? [],
  };
}

const UP = { tw: "rose", us: "leaf" };

export default {
  type: "quotes",
  hosts: ["mis.twse.com.tw", "query1.finance.yahoo.com"],
  async fetch(params, ctx) {
    const list = (Array.isArray(params.watchlist) ? params.watchlist : []).slice(0, MAX);
    const now = ctx.now?.() ?? Date.now();
    const key = JSON.stringify([list, params.colors, params.move]);
    const was = cache.get(ctx.dataDir);
    if (was && was.key === key && !was.data.anyOpen && now - was.at < CLOSED_REFRESH_MS) return was.data;

    const entries = list.map((e) => ({ entry: e, ...classify(e) }));
    // TWSE down: Yahoo's .TW quote stands in.
    let twError = null;
    const tw = await twse(entries.filter((e) => e.tw), ctx).catch((err) => { twError = err; return new Map(); });
    // A code TWSE found on the OTC market is ".TWO" on Yahoo, not ".TW".
    for (const e of entries) if (e.tw && !e.market && tw.get(e.symbol)?.ex === "otc") e.yahoo = `${e.tw}.TWO`;
    const yh = await Promise.all(entries.map((e) => (e.yahoo ? yahoo(e.yahoo, ctx).catch((err) => ({ error: err })) : null)));

    const quotes = entries.map((e, i) => {
      if (!e.symbol) return { symbol: String(e.entry).slice(0, 15), name: "not a symbol", priceText: "", pctText: "", arrow: "?", color: "sand", spark: "", open: false };
      const t = e.tw ? tw.get(e.symbol) : null;
      const y = yh[i]?.error ? null : yh[i];
      if (!t && !y) return { symbol: e.symbol, name: yh[i]?.error?.message ?? "no quote", priceText: "", pctText: "", arrow: "?", color: "sand", spark: "", open: false };
      const isTw = !!t;
      const p = t ? t.price : y.price;
      const prev = t ? t.prev : y.prev;
      const change = p - prev;
      const pct = prev ? (change / prev) * 100 : 0;
      const dir = !Number.isFinite(change) || Math.abs(change) < 1e-9 ? 0 : change > 0 ? 1 : -1;
      const upColor = params.colors === "red-up" ? "rose" : params.colors === "green-up" ? "leaf" : isTw ? UP.tw : UP.us;
      const downColor = upColor === "rose" ? "leaf" : "rose";
      const open = t ? twOpen(t.day, now) : !!(y.session && now / 1000 >= y.session.start && now / 1000 <= y.session.end && now - y.at < 15 * 60_000);
      return {
        symbol: e.symbol,
        name: String(t?.name ?? y?.name ?? "").trim().slice(0, 24).trim(),
        price: p,
        priceText: price(p, isTw),
        changeText: Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${price(change, isTw)}` : "",
        pct: Math.round(pct * 100) / 100,
        pctText: Number.isFinite(pct) ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "",
        arrow: dir > 0 ? "▲" : dir < 0 ? "▼" : "–",
        color: dir > 0 ? upColor : dir < 0 ? downColor : "sand",
        spark: spark(y?.line ?? []),
        volText: volume(t ? t.volume : y.volume, isTw),
        market: isTw ? "TW" : "",
        open,
        when: open ? "open" : "closed",
      };
    });

    // Nothing came back at all: an error, so the last quotes stay, marked stale.
    if (list.length && quotes.every((q) => q.price == null)) throw twError ?? yh.find((x) => x?.error)?.error ?? new RoomError(502, "no quotes");
    const anyOpen = quotes.some((q) => q.open);
    const tws = quotes.filter((q) => q.market === "TW");
    const others = quotes.filter((q) => q.price != null && q.market !== "TW");
    const markets = [tws.length ? `TW ${tws.some((q) => q.open) ? "open" : "closed"}` : null, others.length ? `others ${others.some((q) => q.open) ? "open" : "closed"}` : null].filter(Boolean).join(" · ");
    const move = Number(params.move) || 0;
    const day = clock(now, "Asia/Taipei").day;
    const alerts = move > 0
      ? quotes.filter((q) => Number.isFinite(q.pct) && Math.abs(q.pct) >= move).map((q) => ({ id: `${q.symbol}:${q.pct > 0 ? "up" : "down"}:${day}`, text: `$ ${q.symbol} ${q.arrow} ${q.pctText} at ${q.priceText}` }))
      : [];
    const data = {
      quotes,
      count: quotes.length,
      markets,
      anyOpen,
      updated: new Date(now).toTimeString().slice(0, 5),
      band: quotes.filter((q) => q.price != null).slice(0, 4).map((q) => `${q.symbol} ${q.priceText} ${q.arrow}${q.pctText.replace(/^[+-]/, "")}`).join(" · ") || "no quotes",
      note: "Prices may be delayed. Not investment advice.",
      alerts,
    };
    cache.set(ctx.dataDir, { at: now, key, data });
    return data;
  },
};

export function resetQuotes() {
  cache.clear();
}
