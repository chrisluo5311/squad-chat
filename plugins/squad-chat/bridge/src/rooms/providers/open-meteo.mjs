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

function aqiWord(aqi) {
  if (aqi == null) return "";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy for some";
  if (aqi <= 200) return "unhealthy";
  return "very unhealthy";
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
    ctx.fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day&hourly=precipitation_probability&forecast_hours=24&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7${imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : ""}`),
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
    return {
      day: i === 0 ? "Today" : DAY(t),
      icon: di,
      range: `${round(d.temperature_2m_max?.[i])}${deg} / ${round(d.temperature_2m_min?.[i])}${deg}`,
      rain: `☂ ${round(d.precipitation_probability_max?.[i]) ?? 0}%`,
    };
  });
  const temp = round(c.temperature_2m);
  return {
    name: p.name,
    country: p.country,
    icon,
    desc,
    temp,
    tempText: `${temp}${deg}`,
    feels: `feels ${round(c.apparent_temperature)}${deg}`,
    range: days[0]?.range ?? "",
    rain: round(d.precipitation_probability_max?.[0]) ?? 0,
    rainText: `☂ ${round(d.precipitation_probability_max?.[0]) ?? 0}%`,
    humidity: `${round(c.relative_humidity_2m)}%`,
    wind: `${round(c.wind_speed_10m)} ${imperial ? "mph" : "km/h"}`,
    aqi,
    aqiText: aqi == null ? "" : `AQI ${aqi} ${aqiWord(aqi)}`,
    rainLine: rainHours.length ? `☂ ${spark(rainHours)}  ${peak ? `peak ${peak}% at ${peakTime}` : "no rain"}` : "",
    days,
  };
}

export default {
  type: "open-meteo",
  hosts: ["api.open-meteo.com", "geocoding-api.open-meteo.com", "air-quality-api.open-meteo.com"],
  async fetch(params, ctx) {
    const names = (Array.isArray(params.cities) ? params.cities : []).slice(0, MAX_CITIES);
    if (!names.length) return { cities: [], first: null, days: [] };
    const settled = await Promise.allSettled(names.map((n) => city(n, params.units, ctx)));
    const cities = settled.map((r, i) => (r.status === "fulfilled" ? r.value
      : { name: names[i], icon: "?", tempText: "–", range: "", rainText: "", aqiText: r.reason?.message ?? "failed", days: [] }));
    if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
    const first = cities.find((c) => c.days?.length) ?? cities[0];
    return { cities, first, days: first.days ?? [], updated: new Date().toTimeString().slice(0, 5) };
  },
};
