// The providers that read the web, against answers shaped like the real
// ones (recorded from each service), through a fake ctx.fetch. No network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import openMeteo from "../plugins/squad-chat/bridge/src/rooms/providers/open-meteo.mjs";
import hn from "../plugins/squad-chat/bridge/src/rooms/providers/hn.mjs";
import rss, { parseFeed, decode } from "../plugins/squad-chat/bridge/src/rooms/providers/rss.mjs";
import { allowedHosts } from "../plugins/squad-chat/bridge/src/rooms/net.mjs";

// ctx.fetch answering from `routes` (first prefix that matches), recording each URL.
function fakeCtx(routes) {
  const seen = [];
  return {
    seen,
    fetch: async (url) => {
      seen.push(url);
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!hit) throw Object.assign(new Error(`no route for ${url}`), { status: 502 });
      const [status, body] = typeof hit[1] === "function" ? hit[1](url) : hit[1];
      const text = typeof body === "string" ? body : JSON.stringify(body);
      return { status, ok: status < 400, text, json: () => JSON.parse(text) };
    },
  };
}

const FORECAST = {
  current: { temperature_2m: 23.4, apparent_temperature: 26.9, weather_code: 61, relative_humidity_2m: 85, wind_speed_10m: 4.4, is_day: 1 },
  hourly: { time: Array.from({ length: 24 }, (_, i) => `2026-10-09T${String(i).padStart(2, "0")}:00`), precipitation_probability: Array.from({ length: 24 }, (_, i) => (i === 15 ? 80 : 10)) },
  daily: { time: ["2026-10-09", "2026-10-10", "2026-10-11"], weather_code: [61, 3, 0], temperature_2m_max: [27.9, 27.8, 28.1], temperature_2m_min: [21.2, 23, 22.6], precipitation_probability_max: [80, 20, 0] },
};

describe("open-meteo", () => {
  it("finds each city, then its forecast and air quality, as display strings", async () => {
    const ctx = fakeCtx({
      "https://geocoding-api.open-meteo.com/v1/search?name=Taipei": [200, { results: [{ name: "Taipei", country_code: "TW", latitude: 25.05, longitude: 121.53 }] }],
      "https://geocoding-api.open-meteo.com/v1/search?name=Atlantis": [200, { generationtime_ms: 0.4 }],
      "https://api.open-meteo.com/v1/forecast": [200, FORECAST],
      "https://air-quality-api.open-meteo.com/": [200, { current: { us_aqi: 57 } }],
    });
    const d = await openMeteo.fetch({ cities: ["Taipei", "Atlantis"], units: "metric" }, ctx);
    const t = d.first;
    assert.equal(t.name, "Taipei");
    assert.deepEqual([t.icon, t.desc, t.tempText, t.feels, t.range, t.rainText, t.aqiText, t.wind], ["☂", "Rain", "23°", "feels 27°", "28° / 21°", "☂ 80%", "AQI 57 moderate", "4 km/h"]);
    assert.match(t.rainLine, /^☂ ▂{15}▇▂{8}  peak 80% at 15:00$/);   // scaled to 100%, not to the peak
    assert.deepEqual(d.days.map((x) => `${x.day} ${x.icon} ${x.range} ${x.rain}`), ["Today ☂ 28° / 21° ☂ 80%", "Sat ☁ 28° / 23° ☂ 20%", "Sun ☀ 28° / 23° ☂ 0%"]);
    assert.equal(d.cities[1].aqiText, "no place called Atlantis");   // one bad city doesn't sink the rest

    // A name is looked up once; imperial asks for °F and mph.
    ctx.seen.length = 0;
    await openMeteo.fetch({ cities: ["Taipei"], units: "imperial" }, ctx);
    assert.ok(!ctx.seen.some((u) => u.includes("geocoding")));
    assert.match(ctx.seen.find((u) => u.includes("/v1/forecast")), /temperature_unit=fahrenheit&wind_speed_unit=mph/);
  });

  it("tells a busy service from a city that doesn't exist, and names hazardous air", async () => {
    const busy = fakeCtx({ "https://geocoding-api.open-meteo.com/": [429, { error: true, reason: "Too many requests" }] });
    await assert.rejects(openMeteo.fetch({ cities: ["Springfield"] }, busy), /place search answered 429/);
    const smoky = fakeCtx({
      "https://geocoding-api.open-meteo.com/": [200, { results: [{ name: "Delhi", country_code: "IN", latitude: 28.6, longitude: 77.2 }] }],
      "https://api.open-meteo.com/v1/forecast": [200, FORECAST],
      "https://air-quality-api.open-meteo.com/": [200, { current: { us_aqi: 342 } }],
    });
    assert.equal((await openMeteo.fetch({ cities: ["Delhi"] }, smoky)).first.aqiText, "AQI 342 hazardous");
  });

  it("fails as a whole only when every city does", async () => {
    const ctx = fakeCtx({ "https://geocoding-api.open-meteo.com/": [200, { results: [] }] });
    await assert.rejects(openMeteo.fetch({ cities: ["Nowhere"] }, ctx), /no place called Nowhere/);
    assert.deepEqual(await openMeteo.fetch({ cities: [] }, ctx), { cities: [], first: null, days: [] });
  });
});

describe("hn", () => {
  it("reads the list, then each story", async () => {
    const now = Math.round(Date.now() / 1000);
    const ctx = fakeCtx({
      "https://hacker-news.firebaseio.com/v0/beststories.json": [200, [1, 2, 3]],
      "https://hacker-news.firebaseio.com/v0/item/1.json": [200, { id: 1, title: "Deno Is Joining Cloudflare", url: "https://deno.com/blog/cloudflare", score: 458, descendants: 254, time: now - 7200 }],
      "https://hacker-news.firebaseio.com/v0/item/2.json": [200, { id: 2, title: "Ask HN: What are you working on?", score: 12, descendants: 30, time: now - 600 }],
      "https://hacker-news.firebaseio.com/v0/item/3.json": [500, "oops"],
    });
    const d = await hn.fetch({ list: "best", count: 3 }, ctx);
    assert.equal(d.count, 2);
    assert.deepEqual(d.items[0], {
      id: "1", title: "Deno Is Joining Cloudflare", url: "https://deno.com/blog/cloudflare", source: "deno.com",
      meta: "▲ 458 · 254 comments · 2h", share: "Deno Is Joining Cloudflare\nhttps://deno.com/blog/cloudflare\nhttps://news.ycombinator.com/item?id=1",
    });
    assert.equal(d.items[1].url, "https://news.ycombinator.com/item?id=2");   // an Ask HN links to itself
    assert.deepEqual(await hn.fetch({ list: "off" }, ctx), { items: [], count: 0, off: true });
    // An error answer is an error, not an empty front page.
    await assert.rejects(hn.fetch({ list: "top" }, fakeCtx({ "https://hacker-news.firebaseio.com/": [503, null] })), /Hacker News answered 503/);
  });
});

describe("rss", () => {
  const RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>iThome News</title>
    <item><title><![CDATA[台積電 &amp; AI 晶片]]></title><link>https://www.ithome.com.tw/news/1</link><pubDate>Fri, 09 Oct 2026 10:00:00 +0800</pubDate></item>
    <item><title>No link</title></item></channel></rss>`;
  const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title type="html">The Verge - All Posts</title>
    <entry><title type="html">Apple&#8217;s new &lt;thing&gt;</title><link rel="alternate" type="text/html" href="https://www.theverge.com/a"/><published>2026-10-09T05:00:00Z</published></entry></feed>`;

  it("reads RSS and Atom, entities, CDATA and all", () => {
    assert.deepEqual(parseFeed(RSS), { title: "iThome News", items: [{ title: "台積電 & AI 晶片", link: "https://www.ithome.com.tw/news/1", at: Date.parse("2026-10-09T02:00:00Z") }] });
    assert.deepEqual(parseFeed(ATOM).items, [{ title: "Apple’s new ‹thing›", link: "https://www.theverge.com/a", at: Date.parse("2026-10-09T05:00:00Z") }]);
    assert.equal(parseFeed(ATOM).title, "The Verge - All Posts");
    assert.equal(decode("a <b>bold</b>&nbsp;&#x41;&bogus; z"), "a bold A&bogus; z");
    // Nothing that reads as a tag comes out, however it went in.
    for (const evil of ["<scr<script>ipt>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;", "&#60;img src=x onerror=alert(1)&#62;", "<<b>script>x"]) {
      assert.doesNotMatch(decode(evil), /[<>]/, evil);
    }
    assert.equal(decode("&lt;script&gt;"), "‹script›");
  });

  it("merges feeds newest first, and keeps going when one fails", async () => {
    const ctx = fakeCtx({ "https://www.ithome.com.tw/rss": [200, RSS], "https://www.theverge.com/rss": [200, ATOM], "https://techcrunch.com/feed/": [503, "down"] });
    const d = await rss.fetch({ feeds: ["https://www.ithome.com.tw/rss", "https://www.theverge.com/rss", "https://techcrunch.com/feed/"] }, ctx);
    assert.deepEqual(d.items.map((x) => `${x.source}: ${x.title}`), ["The Verge: Apple’s new ‹thing›", "iThome News: 台積電 & AI 晶片"]);
    assert.equal(d.failed, "techcrunch.com");
    await assert.rejects(rss.fetch({ feeds: ["https://techcrunch.com/feed/"] }, ctx), /answered 503/);
  });

  it("reaches only the hosts its room names", () => {
    assert.equal(rss.hosts, "*");
    assert.deepEqual(allowedHosts("*", ["TechCrunch.com"]), ["techcrunch.com"]);
  });
});
