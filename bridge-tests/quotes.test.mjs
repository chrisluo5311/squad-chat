// The Stock room's provider against answers shaped like TWSE's and Yahoo's
// (recorded from each), through a fake ctx.fetch and a fake clock. No network.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import quotes, { classify, twOpen, resetQuotes } from "../plugins/squad-chat/bridge/src/rooms/providers/quotes.mjs";

// Friday 2026-10-09: 10:00 in Taipei (TWSE open), then 22:00 (US open, TWSE closed).
const TPE_10AM = Date.parse("2026-10-09T02:00:00Z");
const TPE_10PM = Date.parse("2026-10-09T14:00:00Z");

const tw = (c, ex, n, z, y, d = "20261009") => ({ ex, c, n, z, y, v: "20154", d, t: "10:00:00", b: `${z}_` });
const chart = (name, price, prev, { start, end, at, tz = "America/New_York" } = {}) => ({
  chart: { result: [{ meta: { shortName: name, regularMarketPrice: price, chartPreviousClose: prev, regularMarketVolume: 22_467_101, regularMarketTime: at / 1000, exchangeTimezoneName: tz, currentTradingPeriod: { regular: { start: start / 1000, end: end / 1000 } } }, indicators: { quote: [{ close: [1, 2, 3, 2, 4] }] } }] },
});

function fakeCtx(now, { twse, yahoo }) {
  const seen = [];
  return {
    seen,
    ctx: {
      dataDir: "/rooms/stock",
      now: () => now.at,
      fetch: async (url) => {
        seen.push(url);
        const reply = url.includes("mis.twse.com.tw") ? twse(url) : yahoo(decodeURIComponent(/chart\/([^?]+)/.exec(url)[1]));
        const [status, body] = reply;
        const text = JSON.stringify(body);
        return { status, ok: status < 400, text, json: () => JSON.parse(text) };
      },
    },
  };
}

const US_SESSION = { start: Date.parse("2026-10-09T13:30:00Z"), end: Date.parse("2026-10-09T20:00:00Z") };

describe("quotes", () => {
  beforeEach(() => resetQuotes());

  it("reads what a watchlist entry asks for", () => {
    assert.deepEqual(classify("2330"), { symbol: "2330", tw: "2330", market: null, yahoo: "2330.TW" });
    assert.deepEqual(classify("6488.two"), { symbol: "6488", tw: "6488", market: "otc", yahoo: "6488.TWO" });
    assert.deepEqual(classify("taiex"), { symbol: "TAIEX", tw: "t00", yahoo: "^TWII" });
    assert.deepEqual(classify("brk-b"), { symbol: "BRK-B", yahoo: "BRK-B" });
    assert.equal(classify("rm -rf /"), null);
    assert.equal(classify("A".repeat(20)), null);
  });

  it("knows TWSE is open only on a weekday's session, with today's data", () => {
    assert.equal(twOpen("20261009", TPE_10AM), true);
    assert.equal(twOpen("20261008", TPE_10AM), false);   // a holiday: yesterday's prices
    assert.equal(twOpen("20261009", TPE_10PM), false);   // after 13:30
    assert.equal(twOpen("20261010", Date.parse("2026-10-10T02:00:00Z")), false);   // Saturday
  });

  it("prices Taiwan from TWSE and the rest from Yahoo, with each one's colors", async () => {
    const now = { at: TPE_10PM };
    const { ctx, seen } = fakeCtx(now, {
      twse: () => [200, { rtcode: "0000", msgArray: [tw("2330", "tse", "台積電", "2550.0000", "2585.0000"), { c: "", z: "-" }, tw("6488", "otc", "環球晶", "1130.0000", "1215.0000")] }],
      yahoo: (s) => (s === "NOPE" ? [404, { chart: { error: { code: "Not Found" } } }]
        : s === "AAPL" ? [200, chart("Apple Inc.", 335.095, 340.42, { ...US_SESSION, at: TPE_10PM - 60_000 })]
        : [200, chart(s, 100, 100, { ...US_SESSION, at: TPE_10PM, tz: "Asia/Taipei" })]),
    });
    const d = await quotes.fetch({ watchlist: ["2330", "6488", "AAPL", "NOPE"], colors: "market", move: 5 }, ctx);
    const row = (sym) => d.quotes.find((q) => q.symbol === sym);
    assert.deepEqual(
      ["arrow", "name", "priceText", "changeText", "pctText", "color", "when", "volText"].map((k) => row("2330")[k]),
      ["▼", "台積電", "2,550", "-35", "-1.35%", "leaf", "closed", "20,154 lots"],   // down is green in Taiwan
    );
    assert.deepEqual(["arrow", "priceText", "pctText", "color", "when", "volText"].map((k) => row("AAPL")[k]), ["▼", "335.10", "-1.56%", "rose", "open", "22.5M"]);   // and red in the US
    assert.equal(row("NOPE").name, "no symbol NOPE");
    assert.equal(row("2330").spark, "▁▃▆▃█");   // the day's line, from Yahoo
    assert.ok(seen.some((u) => u.includes("chart/6488.TWO")));   // an OTC code is .TWO on Yahoo
    assert.equal(d.markets, "TW closed · others open");
    assert.deepEqual(d.alerts, [{ id: "6488:down:20261009", text: "$ 6488 ▼ -7.00% at 1,130" }]);
    assert.equal(d.note, "Prices may be delayed. Not investment advice.");

    const g = await quotes.fetch({ watchlist: ["2330", "AAPL"], colors: "green-up" }, ctx);
    assert.deepEqual(g.quotes.map((q) => q.color), ["rose", "rose"]);   // green up means red down, for both
  });

  it("asks for nothing more than every 15 minutes while every market is closed", async () => {
    const now = { at: TPE_10PM };
    const { ctx, seen } = fakeCtx(now, { twse: () => [200, { msgArray: [tw("2330", "tse", "台積電", "2550", "2585", "20261008")] }], yahoo: (s) => [200, chart(s, 1, 1, { start: 0, end: 1, at: 0, tz: "Asia/Taipei" })] });
    await quotes.fetch({ watchlist: ["2330"] }, ctx);
    const asked = seen.length;
    now.at += 10 * 60_000;
    await quotes.fetch({ watchlist: ["2330"] }, ctx);
    assert.equal(seen.length, asked);
    await quotes.fetch({ watchlist: ["2330", "0050"] }, ctx);   // a new watchlist asks again
    assert.ok(seen.length > asked);
    now.at += 16 * 60_000;
    const before = seen.length;
    await quotes.fetch({ watchlist: ["2330", "0050"] }, ctx);
    assert.ok(seen.length > before);
  });

  it("falls back to Yahoo when TWSE is down, and fails only when nothing answers", async () => {
    const now = { at: TPE_10AM };
    const up = fakeCtx(now, { twse: () => [503, "down"], yahoo: (s) => [200, chart("TSMC", 2560, 2585, { start: TPE_10AM - 3_600_000, end: TPE_10AM + 3_600_000, at: TPE_10AM, tz: "Asia/Taipei" })] });
    const d = await quotes.fetch({ watchlist: ["2330"] }, up.ctx);
    assert.deepEqual([d.quotes[0].priceText, d.quotes[0].when], ["2,560.00", "open"]);
    resetQuotes();
    const down = fakeCtx(now, { twse: () => [503, "down"], yahoo: () => [503, { chart: { error: { code: "busy" } } }] });
    await assert.rejects(quotes.fetch({ watchlist: ["2330", "AAPL"] }, down.ctx), /TWSE answered 503/);
  });
});
