// What a function room's provider may fetch, and how what comes back is
// cleaned before it reaches the pane.
//
//   * Only hosts both the provider and the room's manifest name.
//   * A time limit, a size limit, no redirects to anywhere else.
//   * Strings lose terminal escapes and control characters (a news title
//     is drawn straight into the terminal), and are cut to a sane length.

export class RoomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
const MAX_STRING = 20_000;

// The hosts a room's provider may reach: both lists, lowercased. A provider
// that reads whatever the room points it at (a feed reader) says "*", and
// the manifest's list alone decides.
export function allowedHosts(providerHosts = [], manifestHosts = []) {
  const declared = manifestHosts.map((h) => String(h).toLowerCase());
  if (providerHosts === "*") return declared;
  return providerHosts.map((h) => String(h).toLowerCase()).filter((h) => declared.includes(h));
}

// fetch, held to `hosts`. Resolves { status, text, json() } or throws a RoomError.
export async function limitedFetch(url, { hosts, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, headers = {} } = {}) {
  let target;
  try { target = new URL(url); } catch { throw new RoomError(400, `not a URL: ${url}`); }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new RoomError(400, `not http(s): ${url}`);
  if (!hosts?.includes(target.hostname.toLowerCase())) throw new RoomError(403, `${target.hostname} isn't one of this room's hosts`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, { headers: { "user-agent": "squad-chat", ...headers }, redirect: "manual", signal: ctrl.signal });
    if (res.status >= 300 && res.status < 400) throw new RoomError(502, `${target.hostname} redirected elsewhere`);
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { await reader.cancel(); throw new RoomError(502, `${target.hostname} answered more than ${Math.round(maxBytes / 1024)} KB`); }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return {
      status: res.status,
      ok: res.ok,
      text,
      json() {
        try { return JSON.parse(text); } catch { throw new RoomError(502, `${target.hostname} didn't answer JSON`); }
      },
    };
  } catch (err) {
    if (err instanceof RoomError) throw err;
    if (err?.name === "AbortError") throw new RoomError(504, `${target.hostname} took longer than ${Math.round(timeoutMs / 1000)}s`);
    throw new RoomError(502, `couldn't reach ${target.hostname}: ${err?.cause?.code ?? err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
}

// ESC sequences (colors, cursor moves, OSC links and titles), then any
// control character but tab and newline.
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function cleanString(s) {
  const out = String(s).replace(ESCAPES, "").replace(CONTROLS, "");
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

// Every string in a provider's answer, cleaned. Depth- and size-bounded.
export function clean(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => clean(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[cleanString(k)] = clean(v, depth + 1);
    return out;
  }
  return typeof value === "number" || typeof value === "boolean" || value == null ? value : null;
}
