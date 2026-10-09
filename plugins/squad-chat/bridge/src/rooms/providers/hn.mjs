// Hacker News through its public Firebase API: a list of ids, then one
// request per story. `list` is top, best, new or off.

const LISTS = { top: "topstories", best: "beststories", new: "newstories" };

export function ago(sec, now = Date.now()) {
  const s = Math.max(0, Math.round(now / 1000 - sec));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

function host(url) {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; }
}

export default {
  type: "hn",
  hosts: ["hacker-news.firebaseio.com"],
  async fetch(params, ctx) {
    const list = LISTS[params.list] ? params.list : params.list === "off" ? "off" : "top";
    if (list === "off") return { items: [], count: 0, off: true };
    const count = Math.min(30, Math.max(1, Number(params.count) || 12));
    const ids = (await ctx.fetch(`https://hacker-news.firebaseio.com/v0/${LISTS[list]}.json`)).json();
    const stories = await Promise.all((Array.isArray(ids) ? ids : []).slice(0, count).map((id) =>
      ctx.fetch(`https://hacker-news.firebaseio.com/v0/item/${Number(id)}.json`).then((r) => r.json()).catch(() => null)));
    const now = Date.now();
    const items = stories.filter((s) => s?.title).map((s) => {
      const discuss = `https://news.ycombinator.com/item?id=${s.id}`;
      const url = s.url || discuss;
      return {
        id: String(s.id),
        title: s.title,
        url,
        source: host(s.url) ?? "HN",
        meta: `▲ ${s.score ?? 0} · ${s.descendants ?? 0} comments · ${ago(s.time, now)}`,
        share: `${s.title}\n${url}${url === discuss ? "" : `\n${discuss}`}`,
      };
    });
    return { items, count: items.length, list };
  },
};
