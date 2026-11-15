// The Backdrop room: a picture behind the conversation, picked from the
// ones drawn here. The desktop and mobile apps draw it (the desktop frosts
// its own panels over it), the terminal and VS Code don't, so there the room
// is only a list to pick from. Each backdrop is a vector scene, a few of them
// moving by CSS. The panels keep the app's own colors, so the words read the
// same in light and dark.
//
// There's one look per session, whichever plugin set it last, so a pick
// replaces another plugin's. A pick is kept for every project, for this
// project (a git worktree counts as its main checkout) or for this session
// alone, and set again at each start. A session shows its own pick, else
// its project's, else the one for every project. The frost is every
// session's. Fireworks are a short show laid over the scene.
//
// Plain logic and drawing: the mod sets the theme and draws the scene.

import { state } from "./state.mjs";
import { theme, palette } from "./theme.mjs";
import { card, stackCards, line } from "./widgets.mjs";
import { svg } from "./bandkit.mjs";
import { value, sub } from "./bands.mjs";
import * as art from "./scenes.mjs";
import { withFireworks, fireworksNight } from "./scenes.mjs";

export const BACKDROP_META = { icon: "☾", label: "Backdrop", color: palette.rose };
export const UNSUPPORTED = "Backdrops need Claude Code 2.1.319 or newer.";
// A Claude Code with no $.theme fails the call reading `set` off nothing
// ("Cannot read properties of undefined (reading 'set')", or "evaluating
// '$.theme.set'"). Only that marks the room as needing an update: a
// TypeError from a theme that was refused is something else.
export const NO_THEME = /undefined.*(reading 'set'|\$\.theme)|\$\.theme.*undefined/i;


// How much the desktop's panels blur and cover the backdrop behind them.
export const FROSTS = [
  { id: "light", label: "Light", blur: 8, opacity: 0.35 },
  { id: "medium", label: "Medium", blur: 16, opacity: 0.55 },
  { id: "strong", label: "Strong", blur: 28, opacity: 0.75 },
];

// A tile's copy says it's 1600 wide, so the pane scales it down to the
// tile's width and keeps its shape. It stands still: the pane draws every
// tile at once, and the desktop draws nothing of a pane whose drawing runs
// past its limit (21 moving tiles came to 266 KB and the pane went blank),
// so the tiles together are kept far under it (a test holds them to 128 KB).
// Made once, here.
const still = (art) => art.replace(/<animate(Transform|Motion)?\b[^>]*\/>/g, "");
const thumbOf = (art) => still(art).replace("<svg ", '<svg width="1600" height="1000" ');
// `draw(still)` makes the scene: the tile's copy asks for it at rest, with
// what moves only by its animation put where it rests.
const backdrop = (id, name, moving, mode, draw) => ({ id, name, moving, mode, art: draw(false), thumb: thumbOf(draw(true)) });

// `mode` is the app's mode it reads best in. The id is the scene's name.
// The dark ones first, then the light ones.
export const BACKDROPS = [
  backdrop("night-sky", "Night Sky", true, "dark", art.nightSky),
  backdrop("tide", "Tide", true, "dark", art.tide),
  backdrop("coral-glow", "Coral Glow", true, "dark", art.coralGlow),
  backdrop("aurora", "Aurora", true, "dark", art.aurora),
  backdrop("rain", "Rain", true, "dark", art.rain),
  backdrop("fireflies", "Fireflies", true, "dark", art.fireflies),
  backdrop("lanterns", "Lanterns", true, "dark", art.lanterns),
  backdrop("jellyfish", "Jellyfish", true, "dark", art.jellyfish),
  backdrop("city-night", "City Night", true, "dark", art.cityNight),
  backdrop("synthwave", "Synthwave", true, "dark", art.synthwave),
  backdrop("snowfall", "Snowfall", true, "dark", art.snowfall),
  backdrop("dusk-hills", "Dusk Hills", false, "dark", art.duskHills),
  backdrop("blueprint", "Blueprint", false, "dark", art.blueprint),
  backdrop("blossom", "Blossom", true, "light", art.blossom),
  backdrop("morning-sea", "Morning Sea", true, "light", art.morningSea),
  backdrop("clouds", "Clouds", true, "light", art.clouds),
  backdrop("paper", "Paper", false, "light", art.paper),
  backdrop("terrazzo", "Terrazzo", false, "light", art.terrazzo),
  backdrop("meadow", "Meadow", false, "light", art.meadow),
  backdrop("desert-noon", "Desert Noon", false, "light", art.desertNoon),
  backdrop("contours", "Contours", false, "light", art.contours),
];

// Drawn at 1600 by 1000 so a tile can scale it down to its width.
const OFF_ART = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 160 100">' + ('<rect x="1" y="1" width="158" height="98" rx="6" fill="none" stroke="#8a817a" stroke-width="1.2" stroke-dasharray="5 4"/>'
  + '<text x="80" y="55" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" fill="#8a817a">No backdrop</text>') + "</svg>";

export function backdropById(id) {
  return BACKDROPS.find((x) => x.id === id) ?? null;
}

// ---------------------------------------------------------------- state

// Where a pick goes. The room keeps the one chosen for the next pick.
export const SCOPES = [
  { id: "everywhere", label: "Every project" },
  { id: "project", label: "This project" },
  { id: "session", label: "This session" },
];
// How many sessions' own picks are kept: past it, the one picked longest ago goes.
export const SESSIONS_KEPT = 200;

export function createBackdrop() {
  return {
    pick: null,           // the pick for every project, or null for none
    frost: "medium",
    scope: "everywhere",  // where the next pick goes
    // This project's and this session's own picks: undefined follows the
    // layer under it, null is "none here", an id is a backdrop.
    project: undefined,
    session: undefined,
    projectKey: null,     // the project's folder, a worktree's main checkout
    sessionKey: null,
    auto: true,           // fireworks when Claude says "merged"
    show: 0,              // fireworks going now: which show (two ids, so a second starts afresh)
    supported: true,      // false once a set shows this Claude Code has no $.theme
  };
}

export function backdropSaved(b) {
  return { pick: b.pick, frost: b.frost, scope: b.scope, auto: b.auto };
}

// An id this version doesn't draw (a newer one picked it) is kept as it
// is, shows nothing here, and is saved back unchanged.
const keptId = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

export function restoreBackdrop(b, saved) {
  if (!saved || typeof saved !== "object") return;
  b.pick = keptId(saved.pick);
  if (FROSTS.some((f) => f.id === saved.frost)) b.frost = saved.frost;
  if (SCOPES.some((x) => x.id === saved.scope)) b.scope = saved.scope;
  if (typeof saved.auto === "boolean") b.auto = saved.auto;
}

// A layer's pick as kept: an id, null, or undefined (none kept).
const layerPick = (v) => (v === null ? null : keptId(v) ?? undefined);

// This project's and this session's picks, out of the two kept maps:
// projects { folder: id|null }, sessions { key: { pick, at } }.
export function restoreLayers(b, projects, sessions) {
  b.project = b.projectKey && projects && typeof projects === "object" ? layerPick(projects[b.projectKey]) : undefined;
  const mine = b.sessionKey && sessions && typeof sessions === "object" ? sessions[b.sessionKey] : undefined;
  b.session = mine && typeof mine === "object" ? layerPick(mine.pick) : undefined;
}

// The maps with this project's and this session's picks written in. A
// session's goes in last, so the oldest go first past the cap.
export function layersSaved(b, projects, sessions, now) {
  const p = { ...(projects && typeof projects === "object" ? projects : {}) };
  if (b.projectKey) { if (b.project === undefined) delete p[b.projectKey]; else p[b.projectKey] = b.project; }
  let s = { ...(sessions && typeof sessions === "object" ? sessions : {}) };
  if (b.sessionKey) {
    delete s[b.sessionKey];
    if (b.session !== undefined) s[b.sessionKey] = { pick: b.session, at: now };
  }
  const keys = Object.keys(s);
  if (keys.length > SESSIONS_KEPT) {
    const old = keys.sort((x, y) => (s[x]?.at ?? 0) - (s[y]?.at ?? 0)).slice(0, keys.length - SESSIONS_KEPT);
    s = Object.fromEntries(Object.entries(s).filter(([k]) => !old.includes(k)));
  }
  return { projects: p, sessions: s };
}

// Which layer this session's backdrop comes from, and the backdrop it shows.
export function shownFrom(b) {
  if (b.session !== undefined) return "session";
  if (b.project !== undefined) return "project";
  return "everywhere";
}
export function shownPick(b) {
  const from = shownFrom(b);
  return from === "session" ? b.session : from === "project" ? b.project : b.pick;
}
// The backdrop drawn here, or null: none picked, or one this version doesn't draw.
export const shownScene = (b) => backdropById(shownPick(b));

// A pick (an id or null) for a layer, or the layer taken away so it follows the one under it.
export function setLayer(b, scope, pick) {
  if (scope === "session") b.session = pick;
  else if (scope === "project") b.project = pick;
  else b.pick = pick;
}
export function clearLayer(b, scope) {
  if (scope === "session") b.session = undefined;
  else if (scope === "project") b.project = undefined;
}

// The project a session belongs to: the main checkout's folder, so every
// git worktree of a repository shares it. Out of git, the folder it runs in.
// `run` runs git there. `sure` is false when git didn't answer at all (no
// git, a time-out): the folder is a stand-in, to ask again later.
export async function projectFolder(run, fallback) {
  let answered = false;
  try {
    const r = await run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    answered = true;
    const dir = r.exitCode === 0 ? r.stdout.trim().replace(/[\\/]+$/, "") : "";
    if (/[\\/]\.git$/.test(dir)) return { folder: dir.slice(0, -5), sure: true };
  } catch { /* no git, or too slow: the next try */ }
  try {
    const r = await run(["git", "rev-parse", "--show-toplevel"]);
    answered = true;
    if (r.exitCode === 0 && r.stdout.trim()) return { folder: r.stdout.trim(), sure: true };
  } catch { /* no git */ }
  return { folder: fallback, sure: answered };
}
export const folderName = (path) => String(path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

// What $.theme.set is given for the backdrop shown here and the frost.
export function themeArgs(b) {
  const it = shownScene(b);
  if (!it) return null;
  const f = FROSTS.find((x) => x.id === b.frost) ?? FROSTS[1];
  return { backdrop: { scene: it.id, glass: { blur: f.blur, opacity: f.opacity } }, overrideColorScheme: it.mode };
}

// ---------------------------------------------------------------- fireworks

export const SHOW_MS = 7000;
// Whole, in any case: "merged", not "unmerged" or "emerged".
export const MERGED = /\bmerged\b/i;
// A sentence about a merge that hasn't happened, or a merge of something else.
const NOT_YET = /\b(not|never|no|cannot|can't|won't|isn't|wasn't|aren't|hasn't|haven't|hadn't|don't|doesn't|didn't|couldn't|wouldn't|shouldn't|yet|once|if|when|until|unless|before|after|will|would|could|should|can|may|might|ready to|needs? to|about to)\b/i;
const A_MERGE = /\b(PR|pull request|merge request|MR)\b|#\d+|\binto (main|master|next|develop|dev|trunk|release)\b|\b(branch|main|master)\b/i;
// Whether a reply's text says a pull request or branch was merged: a
// sentence with the word, about a merge, that doesn't put it off or deny it.
export function saysMerged(content) {
  if (!Array.isArray(content)) return false;
  return content.some((x) => x?.type === "text" && typeof x.text === "string"
    && x.text.split(/(?<=[.!?\n])\s+/).some((s) => MERGED.test(s) && A_MERGE.test(s) && !NOT_YET.test(s)));
}
const SHOWS = ["--fireworks-a", "--fireworks-b"];
export const NIGHT = "fireworks-night";
const NIGHT_GLASS = { blur: 10, opacity: 0.45 };

// The look for a show: the scene shown here with the bursts over it, or a
// night sky of their own where none is.
export function showArgs(b, n) {
  const base = themeArgs(b);
  if (!base) return { backdrop: { scene: NIGHT, glass: NIGHT_GLASS }, overrideColorScheme: "dark" };
  return { ...base, backdrop: { ...base.backdrop, scene: base.backdrop.scene + SHOWS[n % 2] } };
}

// The drawing for a scene name the desktop asks for: a backdrop, or a show over one.
const shows = new Map();
export function sceneFor(id) {
  const it = backdropById(id);
  if (it) return { art: it.art, alt: `${it.name} backdrop` };
  if (id === NIGHT) return { art: shows.get(NIGHT) ?? shows.set(NIGHT, fireworksNight()).get(NIGHT), alt: "Fireworks" };
  const suffix = SHOWS.find((x) => String(id).endsWith(x));
  const under = suffix && backdropById(String(id).slice(0, -suffix.length));
  if (!under) return null;
  if (!shows.has(under.id)) shows.set(under.id, withFireworks(under.art, under.mode));
  return { art: shows.get(under.id), alt: `Fireworks over ${under.name}` };
}

// ---------------------------------------------------------------- words

const SCOPE_WORDS = { everywhere: "everywhere", all: "everywhere", global: "everywhere", project: "project", session: "session" };

// Words typed in the room: a backdrop's name or "off", either with where it
// goes after it ("aurora project"); "clear project" or "clear session"; a
// scope alone; a frost; "fireworks", "fireworks on" or "fireworks off".
export function backdropWords(text) {
  let word = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!word) return null;
  if (word === "fireworks") return { fireworks: true };
  const fw = /^fireworks (on|off)$/.exec(word);
  if (fw) return { auto: fw[1] === "on" };
  const clear = /^clear (project|session)$/.exec(word);
  if (clear) return { clear: clear[1] };
  if (Object.hasOwn(SCOPE_WORDS, word)) return { scope: SCOPE_WORDS[word] };
  const frost = FROSTS.find((f) => f.id === word);
  if (frost) return { frost: frost.id };
  let scope;
  const tail = / (everywhere|all|global|project|session)$/.exec(word);
  if (tail) { scope = SCOPE_WORDS[tail[1]]; word = word.slice(0, -tail[0].length); }
  const withScope = (x) => (scope ? { ...x, scope } : x);
  if (word === "off" || word === "none") return withScope({ pick: null });
  const it = BACKDROPS.find((x) => x.name.toLowerCase() === word || x.id === word.replace(/ /g, "-"));
  return it ? withScope({ pick: it.id }) : null;
}

const kind = (it) => `${it.moving ? "Moving" : "Still"} · ${it.mode === "light" ? "Light" : "Dark"}`;
const frostLabel = (b) => (FROSTS.find((f) => f.id === b.frost) ?? FROSTS[1]).label;
const nameOf = (id) => (id ? backdropById(id)?.name ?? id : "Off");
// Where the backdrop shown here comes from, in a few words, for a meta or a band.
const fromLabel = (b) => ({ session: "this session", project: "this project", everywhere: "every project" })[shownFrom(b)];

// ---------------------------------------------------------------- drawing

// The desktop's tiles, two to a row, each half the card wide: the
// backdrop's own drawing scaled to that width, its name a button under it.
// Off is a tile too. A drawing takes no press, so the name under it is the
// button, the tile's full width. The pointer anywhere on the tile, the
// drawing too, lights its frame and its name (the tile is the one keyed Box
// around them, so it's their hover scope), and the one on now keeps a rose
// frame.
function tile(els, key, art, alt, name, note, on, press) {
  const { Box, Text, Button } = els;
  return Box({ key, flexDirection: "column", width: "50%", flexShrink: 1, minWidth: 0,
    borderStyle: "round", borderColor: on ? BACKDROP_META.color : theme.border, hover: { borderColor: BACKDROP_META.color }, children: [
      els.Svg({ key: "art", source: art, alt }),
      Box({ flexDirection: "column", alignItems: "stretch", children: [
        Button({ key: `pick-${key}`, plain: true, dimColor: !on, label: on ? `● ${name}` : name, hover: { dimColor: false, color: BACKDROP_META.color }, onPress: press }),
      ] }),
      note ? Text({ key: "note", color: theme.muted, children: note }) : null,
    ].filter(Boolean) });
}

function listCard(els, handlers) {
  const { Box, Text, Button } = els;
  const b = state.backdrop;
  const press = (id) => () => handlers.onBackdropPick?.(id);
  const shown = shownPick(b);
  const current = backdropById(shown);
  let rows, height;
  // VS Code draws pictures in the pane but no backdrop: a list there, as in the terminal.
  if (els.Svg && !els.ide) {
    const all = [
      ...BACKDROPS.map((it) => tile(els, it.id, it.thumb, `${it.name} backdrop`, it.name, kind(it), shown === it.id, press(it.id))),
      tile(els, "off", OFF_ART, "No backdrop", "Off", "", !shown, press(null)),
    ];
    // How to pick, a few pixels clear of the frames under it (a Box is a
    // row tall, so the gap is an empty drawing). An odd one out keeps its
    // half: an empty Box beside it.
    rows = [
      Text({ key: "how", color: theme.muted, wrap: "wrap", children: "Press a backdrop's name to switch to it" }),
      els.Svg({ key: "how-gap", source: svg(1, 10, ""), alt: "gap", width: 1, height: 10 }),
    ];
    for (let i = 0; i < all.length; i += 2) {
      rows.push(Box({ key: `row-${i}`, flexDirection: "row", flexWrap: "nowrap", columnGap: 2, marginBottom: 1, children: [
        all[i], all[i + 1] ?? Box({ key: "half", width: "50%", flexShrink: 1 }),
      ] }));
    }
    height = 3 + 2 + Math.ceil((BACKDROPS.length + 1) / 2) * 9;
  } else {
    const row = (key, name, note, on, onPress) => Box({ key, flexDirection: "row", flexWrap: "nowrap", columnGap: 1, children: [
      Button({ key: `pick-${key}`, plain: true, dimColor: !on, label: `${on ? "●" : "○"} ${name}`, onPress }),
      Box({ key: "gap", flexGrow: 1 }),
      note ? Text({ key: "note", color: theme.muted, children: note }) : null,
    ].filter(Boolean) });
    rows = [
      ...BACKDROPS.map((it) => row(it.id, it.name, kind(it).toLowerCase().replace(" · ", "  "), shown === it.id, press(it.id))),
      row("off", "Off", "", !shown, press(null)),
    ];
    height = 3 + rows.length;
  }
  return { name: "Backdrops", node: card(els, { key: "backdrops", title: "BACKDROPS", color: BACKDROP_META.color, meta: `${current?.name ?? "Off"} · ${fromLabel(b)}`, rows }), height };
}

// Where a pick goes, and what each layer holds: every project's, this
// project's and this session's, each that's set with a Clear that hands it
// back to the layer under it.
// How many rows a wrapping row of buttons takes in `inner` columns, two
// columns between them.
function wrapRows(labels, inner) {
  let rows = 1, used = 0;
  for (const label of labels) {
    const n = label.length;
    if (used && used + 2 + n > inner) { rows++; used = n; } else used += (used ? 2 : 0) + n;
  }
  return rows;
}
// A card's inside: its border and padding taken off.
const innerOf = (w) => Math.max(10, (w ?? 60) - 4);

function scopeCard(els, w, handlers) {
  const { Box, Text, Button } = els;
  const b = state.backdrop;
  const project = folderName(b.projectKey) || "This project";
  const layer = (key, name, v, follows) => Box({ key, flexDirection: "row", flexWrap: "nowrap", columnGap: 1, children: [
    Text({ key: "where", color: theme.muted, children: name }),
    Box({ key: "gap", flexGrow: 1 }),
    Text({ key: "pick", color: v === undefined ? theme.muted : BACKDROP_META.color, children: v === undefined ? follows : nameOf(v) }),
    v === undefined || key === "layer-everywhere" ? null
      : Button({ key: `clear-${key.slice(6)}`, plain: true, dimColor: true, label: "Clear", onPress: () => handlers.onBackdropClear?.(key.slice(6)) }),
  ].filter(Boolean) });
  const rows = [
    Box({ key: "scopes", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: SCOPES.map((x) => {
      const on = b.scope === x.id;
      return Button({ key: `scope-${x.id}`, plain: true, dimColor: !on, label: `${on ? "●" : "○"} ${x.label}`, onPress: () => handlers.onBackdropScope?.(x.id) });
    }) }),
    layer("layer-everywhere", "Every project", b.pick ?? null, ""),
    layer("layer-project", project, b.project, "follows every project"),
    layer("layer-session", "This session", b.session, "follows the project"),
  ];
  const radios = wrapRows(SCOPES.map((x) => `● ${x.label}`), innerOf(w));
  return { name: "Apply to", node: card(els, { key: "scope", title: "APPLY TO", color: BACKDROP_META.color, rows }), height: 3 + radios + 3 };
}

function fireworksCard(els, w, handlers) {
  const { Box, Button } = els;
  const b = state.backdrop;
  const rows = [
    Box({ key: "go", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
      Button({ key: "fireworks", plain: true, label: b.show ? "Going…" : "Set them off", color: BACKDROP_META.color, onPress: () => handlers.onFireworks?.() }),
    ] }),
    Box({ key: "auto", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
      Button({ key: "auto-on", plain: true, dimColor: !b.auto, label: `${b.auto ? "●" : "○"} When Claude says "merged"`, onPress: () => handlers.onFireworksAuto?.(true) }),
      Button({ key: "auto-off", plain: true, dimColor: b.auto, label: `${b.auto ? "○" : "●"} Only by hand`, onPress: () => handlers.onFireworksAuto?.(false) }),
    ] }),
  ];
  const auto = wrapRows(['● When Claude says "merged"', "○ Only by hand"], innerOf(w));
  return { name: "Fireworks", node: card(els, { key: "fireworks", title: "FIREWORKS", color: BACKDROP_META.color, rows }), height: 3 + 1 + auto };
}

function frostCard(els, handlers) {
  const { Box, Text, Button } = els;
  const b = state.backdrop;
  const rows = [
    Box({ key: "frosts", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: FROSTS.map((f) => {
      const on = b.frost === f.id;
      return Button({ key: `frost-${f.id}`, plain: true, dimColor: !on, label: `${on ? "●" : "○"} ${f.label}`, onPress: () => handlers.onBackdropFrost?.(f.id) });
    }) }),
    Text({ key: "what", color: theme.muted, wrap: "wrap", children: "How much the panels blur the backdrop behind them" }),
  ];
  return { name: "Frost", node: card(els, { key: "frost", title: "FROST", color: BACKDROP_META.color, rows }), height: 3 + 3 };
}

function unsupportedCard(els) {
  if (state.backdrop.supported) return null;
  const rows = [els.Text({ key: "old", color: theme.warn, wrap: "wrap", children: UNSUPPORTED })];
  return { name: "Update", node: card(els, { key: "old", title: "BACKDROP", color: BACKDROP_META.color, rows }), height: 3 + 2 };
}

export function backdropDock(els, w, capacity, handlers) {
  return stackCards(els, [unsupportedCard(els), listCard(els, handlers), scopeCard(els, w, handlers), frostCard(els, handlers), fireworksCard(els, w, handlers)], capacity, handlers.scroll);
}

// The inline pane: the backdrop on now, then each one's name to pick.
export function backdropInline(els, w, handlers) {
  const { Box, Text, Button } = els;
  const b = state.backdrop;
  const shown = shownPick(b);
  const current = backdropById(shown);
  const head = line(els, "head", [
    { text: `${BACKDROP_META.icon} ${BACKDROP_META.label}`, bold: true, color: BACKDROP_META.color },
    { text: `  ${current ? `${current.name} · ${frostLabel(b)} frost` : "Off"} · ${fromLabel(b)}`, color: theme.muted, grow: true },
  ]);
  if (!b.supported) return [head, Text({ key: "old", color: theme.warn, wrap: "wrap", children: UNSUPPORTED })];
  return [head, Box({ key: "names", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
    ...BACKDROPS.map((it) => Button({ key: `pick-${it.id}`, plain: true, dimColor: shown !== it.id, label: `${shown === it.id ? "●" : "○"} ${it.name}`, onPress: () => handlers.onBackdropPick?.(it.id) })),
    Button({ key: "pick-off", plain: true, dimColor: !!shown, label: `${shown ? "○" : "●"} Off`, onPress: () => handlers.onBackdropPick?.(null) }),
  ] }), Box({ key: "scopes", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
    Text({ key: "to", color: theme.muted, children: "Apply to" }),
    ...SCOPES.map((x) => Button({ key: `scope-${x.id}`, plain: true, dimColor: b.scope !== x.id, label: `${b.scope === x.id ? "●" : "○"} ${x.label}`, onPress: () => handlers.onBackdropScope?.(x.id) })),
    Button({ key: "fireworks", plain: true, label: "Fireworks", color: BACKDROP_META.color, onPress: () => handlers.onFireworks?.() }),
  ] })];
}

export function backdropBandPieces() {
  const b = state.backdrop;
  const current = backdropById(shownPick(b));
  if (!current) return [{ text: "no backdrop", color: theme.muted }];
  return [
    { text: current.name, color: BACKDROP_META.color, bold: true },
    { text: ` · ${frostLabel(b)} frost · ${fromLabel(b)}`, color: theme.muted },
  ];
}

export function backdropBandDesk() {
  const b = state.backdrop;
  const color = BACKDROP_META.color;
  const current = backdropById(shownPick(b));
  if (!current) return { color, sections: [{ key: "none", color, parts: [sub("no backdrop")] }] };
  return { color, sections: [
    { key: "pick", color, parts: [value(current.name, color)] },
    { key: "frost", color, grow: true, parts: [sub(`${frostLabel(b)} frost · ${fromLabel(b)}`)] },
  ] };
}
