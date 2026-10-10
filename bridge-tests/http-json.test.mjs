// The generic JSON provider, and a manifest's own alerts: against answers
// shaped like CoinGecko's and Frankfurter's, through a fake ctx. No network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import httpJson, { fillVars, toRows, formatField } from "../plugins/squad-chat/bridge/src/rooms/providers/http-json.mjs";
import { roomRegistry, PROVIDERS } from "../plugins/squad-chat/bridge/src/rooms/registry.mjs";
import { checkManifest } from "../plugins/squad-chat/bridge/src/rooms/manifest.mjs";

const COINGECKO = { bitcoin: { usd: 82617, usd_24h_change: 0.2579 }, ethereum: { usd: 2491.87, usd_24h_change: -0.0016 }, solana: { usd: 109.67, usd_24h_change: -12.4 } };
const FRANKFURTER = { amount: 1, base: "USD", date: "2026-10-09", rates: { EUR: 0.89238, JPY: 158.25, GBP: 0.75641 } };

function ctxFor(body, status = 200) {
  const seen = [];
  return {
    seen,
    ctx: {
      now: () => Date.parse("2026-10-10T04:00:00Z"),
      fetch: async (url, init) => { seen.push({ url, init }); const text = JSON.stringify(body); return { status, ok: status < 400, text, json: () => JSON.parse(text) }; },
    },
  };
}

const COINS = {
  url: "https://api.coingecko.com/api/v3/simple/price?ids={coins}&vs_currencies={currency}&include_24hr_change=true",
  vars: { coins: ["solana", "bitcoin", "ethereum"], currency: "usd" },
  rows: { from: "", key: "id", order: "coins" },
  fields: { price: { path: "{currency}", format: "number" }, change: { path: "{currency}_24h_change", format: "signed-percent", digits: 2 } },
};

describe("http-json", () => {
  it("fills the URL from settings, encoded", () => {
    assert.equal(fillVars("https://x.test/?ids={coins}&vs={cur}&keep={nope}", { coins: ["a b", "c&d"], cur: "usd" }, true), "https://x.test/?ids=a%20b,c%26d&vs=usd&keep={nope}");
  });

  it("turns an object of objects into rows, in the order a setting lists them, with fields formatted", async () => {
    const { ctx, seen } = ctxFor(COINGECKO);
    const d = await httpJson.fetch(COINS, ctx);
    assert.equal(seen[0].url, "https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true");
    assert.deepEqual(d.rows.map((r) => [r.id, r.price, r.change, r.changeArrow, r.changeColor]), [
      ["solana", "109.67", "−12.40%", "▼", "rose"],
      ["bitcoin", "82,617", "+0.26%", "▲", "leaf"],
      ["ethereum", "2,491.87", "0.00%", "–", "sand"],   // rounds to nothing: flat, not "−0.00%"
    ]);
    assert.equal(d.rows[0].changeValue, -12.4);
    assert.deepEqual([d.count, d.updated.length], [3, 5]);
  });

  it("takes rows from a path, numbers and all, and single values beside them", async () => {
    const { ctx } = ctxFor(FRANKFURTER);
    const d = await httpJson.fetch({ url: "https://api.frankfurter.dev/v1/latest?base={base}", vars: { base: "USD" }, rows: { from: "rates", key: "code" }, fields: { rate: { path: "value", format: "number" } }, values: { base: { path: "base" }, date: { path: "date" } } }, ctx);
    assert.deepEqual([d.base, d.date], ["USD", "2026-10-09"]);
    assert.deepEqual(d.rows.map((r) => `${r.code} ${r.rate}`), ["EUR 0.8924", "JPY 158.25", "GBP 0.7564"]);
  });

  it("formats numbers, compact, percent, signed, dates and ages", () => {
    const now = Date.parse("2026-10-10T04:00:00Z");
    const f = (raw, spec) => formatField(raw, spec, now).text;
    assert.equal(f(1234567.891, { format: "number" }), "1,234,567.89");
    assert.equal(f(0.000123456, { format: "number" }), "0.0001");
    assert.equal(f(12.5, { format: "number", digits: 3 }), "12.500");
    assert.equal(f(185793343, { format: "compact" }), "185.8M");
    assert.equal(f(42.123, { format: "percent" }), "42.1%");
    assert.equal(f(-3.5, { format: "signed" }), "−3.5");
    assert.deepEqual(formatField(2.5, { format: "signed-percent", up: "red" }, now), { value: 2.5, text: "+2.50%", arrow: "▲", color: "rose" });
    assert.equal(f("2026-10-10T01:00:00Z", { format: "age" }), "3h");
    assert.equal(f(Date.parse("2026-10-07T04:00:00Z") / 1000, { format: "age" }), "3d");   // seconds count too
    assert.equal(f("not a number", { format: "number" }), "–");
    assert.equal(f(null, { format: "text" }), "");
  });

  it("reads only https, and an error answer is an error", async () => {
    await assert.rejects(httpJson.fetch({ url: "http://x.test/" }, ctxFor({}).ctx), /https URLs only/);
    await assert.rejects(httpJson.fetch({ url: "https://x.test/" }, ctxFor({ error: "rate limited" }, 429).ctx), /answered 429/);
    assert.deepEqual(toRows([1, { a: 2 }]), [{ value: 1 }, { a: 2 }]);
    assert.deepEqual(toRows("nope"), []);
  });
});

describe("a manifest's alerts", () => {
  const manifest = (alerts, extra = {}) => ({
    schema: 1, id: "coins", version: "1.0.0", name: "Coins", icon: "₿", color: "amber", author: "t",
    permissions: { hosts: ["api.example.com"] },
    settings: { move: { type: "int", default: 10, min: 0, max: 50 } },
    providers: [{ id: "c", type: "fake", params: {} }],
    alerts,
    layout: { cards: [{ title: "X", body: { type: "text", text: "{c.count}" } }] },
    ...extra,
  });
  const fake = { type: "fake", hosts: [], fetch: async () => ({ rows: [{ id: "solana", change: "−12.40%", changeValue: -12.4, changeArrow: "▼" }, { id: "bitcoin", change: "+0.26%", changeValue: 0.26, changeArrow: "▲" }], fear: 81 }) };

  async function run(alerts, settings = null) {
    const dir = mkdtempSync(join(tmpdir(), "sq-alerts-"));
    mkdirSync(join(dir, "rooms", "coins"), { recursive: true });
    writeFileSync(join(dir, "rooms", "coins", "room.json"), JSON.stringify(manifest(alerts)));
    if (settings) { mkdirSync(join(dir, "data", "coins"), { recursive: true }); writeFileSync(join(dir, "data", "coins", "settings.json"), JSON.stringify(settings)); }
    const events = [];
    const reg = roomRegistry({ dirs: [join(dir, "rooms")], dataDir: join(dir, "data"), emit: (e) => events.push(e), providers: { ...PROVIDERS, fake } });
    reg.report();
    assert.deepEqual(events[0].invalid, []);
    await reg.refresh("coins");
    reg.close();
    return events.filter((e) => e.type === "fnroom").at(-1).data.alerts;
  }

  it("toasts each row past its threshold, the threshold a setting", async () => {
    const alerts = [{ rows: "c.rows", field: "changeValue", beyond: "$settings.move", text: "₿ {id} {changeArrow} {change}", id: "{id}-{changeArrow}" }];
    assert.deepEqual(await run(alerts), [{ id: "m:solana-▼", text: "₿ solana ▼ −12.40%" }]);
    assert.deepEqual(await run(alerts, { move: 0 }), []);   // 0 turns them off
    assert.equal((await run(alerts, { move: 0.1 })).length, 1);   // not a whole number: the default (10) stands
    assert.equal((await run([{ ...alerts[0], beyond: 0.2 }])).length, 2);   // a number in the manifest
  });

  it("watches one value, above or below", async () => {
    assert.deepEqual(await run([{ value: "c.fear", above: 80, text: "greed at {value}", id: "greed" }]), [{ id: "m:greed", text: "greed at 81" }]);
    assert.deepEqual(await run([{ value: "c.fear", below: 20, text: "fear at {value}", id: "fear" }]), []);
  });

  it("checks what a manifest's alerts and http-json params say", () => {
    const providers = { ...PROVIDERS, fake };
    const bad = manifest([
      { rows: "c.rows", value: "c.fear", above: 1, text: "x", id: "x" },
      { rows: "z.rows", field: "v", above: 1, text: "x", id: "x" },
      { rows: "c.rows", field: "v", above: 1, below: 2, text: "x", id: "x" },
      { value: "c.fear", beyond: "$settings.nope", text: "x", id: "x" },
    ], { providers: [{ id: "c", type: "http-json", params: { url: "http://plain.example.com/", fields: { "Bad Name": { path: "x", format: "fancy" } }, rows: { order: "coins" }, vars: { cur: "$settings.missing" } } }] });
    const errors = checkManifest(bad, providers).join("\n");
    for (const want of [/alerts\[0\]: a rows or a value path, not both/, /alerts\[1\]: no provider called z/, /alerts\[2\]: one of above, below or beyond/, /alerts\[3\].beyond: a number or "\$settings.<key>"/, /params.url: an https URL/, /fields.Bad Name: a field name/, /format: one of text, number/, /rows.order: no var called coins/, /params.vars.cur: no setting called missing/]) {
      assert.match(errors, want);
    }
    for (const id of ["crypto", "fx-rates"]) {
      assert.deepEqual(checkManifest(JSON.parse(readFileSync(new URL(`../rooms/${id}/room.json`, import.meta.url), "utf8")), PROVIDERS), [], id);
    }
  });
});
