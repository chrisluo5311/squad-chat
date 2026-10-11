// Weather from Open-Meteo (open-meteo.com): free, no key. A city's name is
// looked up once (geocoding), then its forecast and air quality come with
// each run. Display strings are made here, so the layout only places them.

import { RoomError } from "../net.mjs";

const MAX_CITIES = 6;
const SPARKS = "▁▂▃▄▅▆▇█";

// WMO weather codes as single-width symbols and a word.
function sky(code, isDay = 1) {
  if (code === 0 || code === 1) return isDay ? ["☀", code ? "Mostly clear" : "Clear"] : ["☾", code ? "Mostly clear" : "Clear"];
  if (code === 2) return ["☁", "Partly cloudy"];
  if (code === 3) return ["☁", "Overcast"];
  if (code === 45 || code === 48) return ["≡", "Fog"];
  if (code >= 51 && code <= 57) return ["☂", "Drizzle"];
  if (code >= 61 && code <= 67) return ["☂", "Rain"];
  if (code >= 71 && code <= 77) return ["❄", "Snow"];
  if (code >= 80 && code <= 82) return ["☂", "Showers"];
  if (code === 85 || code === 86) return ["❄", "Snow showers"];
  if (code >= 95) return ["☇", "Thunderstorm"];
  return ["·", "—"];
}

// Chances of rain, 0-100, as blocks: a full block is a sure thing, so a
// 2% day stays flat.
function spark(values) {
  return values.map((v) => (v > 0 ? SPARKS[Math.min(7, Math.max(0, Math.round((v / 100) * 7)))] : SPARKS[0])).join("");
}

const round = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const DAY = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

const geocoded = new Map();   // lowercased name → place, for the bridge's life

async function place(name, ctx) {
  const k = name.toLowerCase();
  if (geocoded.has(k)) return geocoded.get(k);
  const r = await ctx.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
  // A busy or failing service isn't a city that doesn't exist.
  if (!r.ok) throw new RoomError(502, `Open-Meteo's place search answered ${r.status}`);
  const hit = r.json().results?.[0];
  if (!hit) throw new RoomError(404, `no place called ${name}`);
  const p = { name: hit.name, country: hit.country_code ?? "", lat: hit.latitude, lon: hit.longitude };
  geocoded.set(k, p);
  return p;
}

async function city(name, units, ctx) {
  const p = await place(name, ctx);
  const imperial = units === "imperial";
  const q = `latitude=${p.lat}&longitude=${p.lon}&timezone=auto`;
  const [fr, ar] = await Promise.all([
    ctx.fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day&hourly=precipitation_probability,temperature_2m&forecast_hours=24&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&forecast_days=7${imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : ""}`),
    ctx.fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi`).catch(() => null),
  ]);
  if (!fr.ok) throw new RoomError(502, `Open-Meteo answered ${fr.status} for ${p.name}`);
  const f = fr.json();
  const c = f.current ?? {};
  const d = f.daily ?? {};
  const [icon, desc] = sky(c.weather_code, c.is_day);
  const aqi = ar?.ok ? round(ar.json().current?.us_aqi) : null;
  const rainHours = (f.hourly?.precipitation_probability ?? []).map((v) => Number(v) || 0);
  const peak = Math.max(0, ...rainHours);
  const peakAt = rainHours.indexOf(peak);
  const peakTime = peakAt >= 0 && f.hourly?.time?.[peakAt] ? f.hourly.time[peakAt].slice(11, 16) : "";
  const deg = "°";
  const days = (d.time ?? []).map((t, i) => {
    const [di] = sky(d.weather_code?.[i]);
    const hi = round(d.temperature_2m_max?.[i]);
    const lo = round(d.temperature_2m_min?.[i]);
    const rain = round(d.precipitation_probability_max?.[i]) ?? 0;
    return {
      day: i === 0 ? "Today" : DAY(t),
      icon: di,
      range: `${hi}${deg} / ${lo}${deg}`,
      rain: `☂ ${rain}%`,
      // For the desktop's columns: each part on its own, today marked.
      hiText: `${hi}${deg}`,
      loText: `${lo}${deg}`,
      rainPct: `${rain}%`,
      today: i === 0 || null,
    };
  });
  // The next 24 hours for the desktop's chart: temperatures and chances of
  // rain, and a time every 6 hours to read them by.
  const hourTimes = f.hourly?.time ?? [];
  const tempHours = (f.hourly?.temperature_2m ?? []).map((v) => round(v));
  const at = (i) => (i === 0 ? "Now" : hourTimes[i]?.slice(11, 16) ?? "");
  const hourMarks = [0, 6, 12, 18].filter((i) => i < hourTimes.length).map(at);
  const known = tempHours.filter((v) => v != null);
  const hiAt = tempHours.indexOf(Math.max(...known));
  const loAt = tempHours.indexOf(Math.min(...known));
  // The high and low are marked on the chart; the line under it adds their
  // times and the rain.
  const hourLine = known.length
    ? [`high at ${at(hiAt)}`, `low at ${at(loAt)}`, peak ? `☂ ${peak}% at ${peakTime}` : "no rain"].join(" · ")
    : "";
  // The sun today: when it rises and sets, how far through the day it is
  // now (0-100, none at night), and the UV.
  const rise = d.sunrise?.[0] ?? "";
  const set = d.sunset?.[0] ?? "";
  const nowLocal = c.time ?? "";
  const mins = (iso) => (iso ? Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) : NaN);
  const [r0, s0, n0] = [mins(rise), mins(set), mins(nowLocal)];
  const daylight = s0 - r0;
  const sunPct = Number.isFinite(daylight) && daylight > 0 && n0 >= r0 && n0 <= s0 ? Math.round(((n0 - r0) / daylight) * 100) : null;
  const uv = round(d.uv_index_max?.[0]);
  const uvWord = uv == null ? "" : uv <= 2 ? "low" : uv <= 5 ? "moderate" : uv <= 7 ? "high" : uv <= 10 ? "very high" : "extreme";
  // What comes next: the sunset in the day, else the sunrise (tomorrow's
  // once the sun has set).
  const span = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  const riseNext = mins(d.sunrise?.[1] ?? "");
  let next = "";
  if (Number.isFinite(n0) && Number.isFinite(r0) && Number.isFinite(s0)) {
    if (n0 < r0) next = `sunrise in ${span(r0 - n0)}`;
    else if (n0 <= s0) next = `sunset in ${span(s0 - n0)}`;
    else if (Number.isFinite(riseNext)) next = `sunrise in ${span(24 * 60 - n0 + riseNext)}`;
  }
  const sun = rise && set ? {
    next,
    rise: rise.slice(11, 16),
    set: set.slice(11, 16),
    pct: sunPct,
    length: Number.isFinite(daylight) && daylight > 0 ? `${Math.floor(daylight / 60)}h ${daylight % 60}m of daylight` : "",
    uvText: uv == null ? "" : `UV ${uv} ${uvWord}`,
    uvTone: uv == null ? null : uv <= 2 ? "leaf" : uv <= 5 ? "amber" : uv <= 7 ? "coral" : "red",
  } : null;
  const temp = round(c.temperature_2m);
  return {
    name: p.name,
    country: p.country,
    // With its country, so a slip that's another real place shows: "Tokoyo CF".
    place: p.country ? `${p.name} ${p.country}` : p.name,
    icon,
    desc,
    temp,
    tempText: `${temp}${deg}`,
    feels: `feels ${round(c.apparent_temperature)}${deg}`,
    range: days[0]?.range ?? "",
    rain: round(d.precipitation_probability_max?.[0]) ?? 0,
    rainText: `☂ ${round(d.precipitation_probability_max?.[0]) ?? 0}%`,
    rangeRain: days[0] ? `${days[0].range} · ☂ ${round(d.precipitation_probability_max?.[0]) ?? 0}%` : "",
    humidity: `${round(c.relative_humidity_2m)}%`,
    wind: `${round(c.wind_speed_10m)} ${imperial ? "mph" : "km/h"}`,
    aqi,
    aqiText: aqi == null ? "" : `AQI ${aqi}`,
    aqiTone: aqi == null ? null : aqi <= 50 ? "leaf" : aqi <= 100 ? "amber" : "red",
    rainNext: rainHours.slice(0, 8),
    rainLine: rainHours.length ? `☂ ${spark(rainHours)}  ${peak ? `peak ${peak}% at ${peakTime}` : "no rain"}` : "",
    rainHours,
    tempHours,
    hourMarks,
    hourLine,
    sun,
    sunLine: sun ? `☀ ${sun.rise} → ${sun.set}${sun.length ? ` · ${sun.length}` : ""}${sun.uvText ? ` · ${sun.uvText}` : ""}` : "",
    days,
  };
}

export default {
  type: "open-meteo",
  hosts: ["api.open-meteo.com", "geocoding-api.open-meteo.com", "air-quality-api.open-meteo.com"],
  // Cities as they're added: each by the name the place search gives it,
  // and none that it can't find. A search that fails lets them through.
  check: {
    async cities(names, ctx) {
      const out = [];
      const missing = [];
      for (const n of names) {
        try { out.push((await place(n, ctx)).name); } catch (err) {
          if (err?.status === 404) missing.push(n);
          else out.push(n);
        }
      }
      if (missing.length) throw new RoomError(400, `No place called ${missing.join(" or ")}. Check the spelling, or try it in English.`);
      return out;
    },
  },
  async fetch(params, ctx) {
    const names = (Array.isArray(params.cities) ? params.cities : []).slice(0, MAX_CITIES);
    if (!names.length) return { cities: [], first: null, days: [] };
    const settled = await Promise.allSettled(names.map((n) => city(n, params.units, ctx)));
    // `query` is the city as the setting has it, for the row's ✕.
    const cities = settled.map((r, i) => (r.status === "fulfilled" ? { ...r.value, query: names[i] }
      : { name: names[i], place: names[i], query: names[i], icon: "?", tempText: "–", range: "", rainText: "", aqiText: r.reason?.message ?? "failed", days: [] }));
    if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
    const first = cities.find((c) => c.days?.length) ?? cities[0];
    return { cities, first, days: first.days ?? [], updated: new Date().toTimeString().slice(0, 5) };
  },
};
