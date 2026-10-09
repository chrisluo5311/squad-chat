// RSS 2.0 and Atom feeds, newest first across all of them. A feed reader
// goes wherever the room points it, so its hosts are the manifest's ("*"):
// a feed's URL must be on one of them (the setting is checked for that).
// No XML library: the few elements a headline needs, read with patterns.

import { ago } from "./hn.mjs";

const PER_FEED = 10;
const TOTAL = 30;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

export function decode(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1];

// A feed's entries: { title, link, at }.
export function parseFeed(xml) {
  const head = xml.split(/<item[\s>]|<entry[\s>]/i)[0];
  const feedTitle = decode(tag(head, "title"));
  const entries = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items = entries.map((e) => {
    const atomLink = /<link\b[^>]*\brel=["']alternate["'][^>]*>/i.exec(e)?.[0] ?? /<link\b[^>]*\bhref=[^>]*>/i.exec(e)?.[0];
    const link = decode(tag(e, "link")) || (atomLink ? /\bhref=["']([^"']+)["']/i.exec(atomLink)?.[1] : "") || decode(tag(e, "guid"));
    const when = decode(tag(e, "pubDate") ?? tag(e, "published") ?? tag(e, "updated") ?? tag(e, "dc:date"));
    const at = Date.parse(when);
    return { title: decode(tag(e, "title")), link: decode(link), at: Number.isFinite(at) ? at : 0 };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link));
  return { title: feedTitle, items };
}

// "Ars Technica - All content" → "Ars Technica".
const shortName = (title, url) => (title.split(/\s+[-|–:—]\s+|：/)[0] || new URL(url).hostname.replace(/^www\./, "")).slice(0, 24);

export default {
  type: "rss",
  hosts: "*",
  async fetch(params, ctx) {
    const feeds = Array.isArray(params.feeds) ? params.feeds : [];
    const results = await Promise.allSettled(feeds.map(async (url) => {
      const r = await ctx.fetch(url);
      if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}`);
      const feed = parseFeed(r.text);
      const source = shortName(feed.title, url);
      return feed.items.slice(0, PER_FEED).map((x) => ({ ...x, source }));
    }));
    const failed = results.map((r, i) => (r.status === "rejected" ? new URL(feeds[i]).hostname : null)).filter(Boolean);
    if (feeds.length && failed.length === feeds.length) throw results[0].reason;
    const now = Date.now();
    const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => b.at - a.at)
      .slice(0, TOTAL)
      .map((x, i) => ({
        id: `r${i}`,
        title: x.title,
        url: x.link,
        source: x.source,
        meta: `${x.source}${x.at ? ` · ${ago(x.at / 1000, now)}` : ""}`,
        share: `${x.title}\n${x.link}`,
      }));
    return { items, count: items.length, failed: failed.join(", ") };
  },
};
