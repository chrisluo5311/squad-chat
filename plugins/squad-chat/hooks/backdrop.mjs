// The Backdrop room: a picture behind the conversation, picked from the
// ones drawn here. The desktop and mobile apps draw it (the desktop frosts
// its own panels over it), the terminal and VS Code don't, so there the room
// is only a list to pick from. Each backdrop is a vector scene, a few of them
// moving by CSS. The panels keep the app's own colors, so the words read the
// same in light and dark.
//
// There's one look per session, whichever plugin set it last, so a pick
// replaces another plugin's. The pick and the frost are kept for every
// session on this computer and set again at each start.
//
// Plain logic and drawing: the mod sets the theme and draws the scene.

import { state } from "./state.mjs";
import { theme, palette } from "./theme.mjs";
import { card, stackCards, line } from "./widgets.mjs";
import { svg } from "./bandkit.mjs";
import { value, sub } from "./bands.mjs";

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

// ---------------------------------------------------------------- the scenes
// Each fills any window: a 1600 by 1000 drawing, cropped to the window's
// shape. What stands out (a moon, a sun, a drawing) sits in a corner or low
// down, away from the words in the middle and the message box at the foot.

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">';

// What moves, moves by SMIL (<animate>, <animateTransform>), and a scene
// has no <style>: the desktop drew a scene whose <style> held a media rule
// as a still picture, SMIL and CSS animation alike.

// The same stars every time: a small seeded random.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// A band of sea from y down, its top a sine wave, wide enough to slide by a
// period and loop.
function wave(y, amp, period, width) {
  let d = `M0 ${y}`;
  for (let x = 0; x <= width; x += 20) d += ` L${x} ${(y + Math.sin((x / period) * Math.PI * 2) * amp).toFixed(1)}`;
  return `${d} L${width} 1000 L0 1000Z`;
}

// When each star starts and how long it takes to brighten and fade, in
// seconds: six rhythms, so the sky never pulses as one.
const TWINKLE = [[0, 3.2], [0.8, 4.6], [1.7, 3.8], [2.5, 5.4], [3.3, 4.2], [4.1, 6.1]];

// A wave slides a period to the left and starts over, seamless.
const slide = (dur) => `<animateTransform attributeName="transform" type="translate" from="0 0" to="-400 0" dur="${dur}s" repeatCount="indefinite"/>`;

function nightSky() {
  const r = seeded(7);
  let stars = "";
  for (let i = 0; i < 140; i++) {
    const x = Math.round(r() * 1600), y = Math.round(r() * 640), size = (r() * 1.6 + 0.4).toFixed(1);
    const [begin, dur] = TWINKLE[i % TWINKLE.length];
    stars += `<circle cx="${x}" cy="${y}" r="${size}" fill="#fff" opacity=".2"><animate attributeName="opacity" values=".2;1;.2" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0f24"/><stop offset=".65" stop-color="#1b2042"/><stop offset="1" stop-color="#3b2d4b"/></linearGradient>`
    + '<radialGradient id="halo"><stop offset="0" stop-color="#f6ecd4" stop-opacity=".55"/><stop offset="1" stop-color="#f6ecd4" stop-opacity="0"/></radialGradient></defs>'
    + `<rect width="1600" height="1000" fill="url(#sky)"/>${stars}`
    + '<g><circle cx="1420" cy="150" r="140" fill="url(#halo)"/><circle cx="1420" cy="150" r="44" fill="#f3e7cc"/><circle cx="1438" cy="138" r="40" fill="#1b2042" opacity=".35"/>'
    + '<g opacity="0"><animate attributeName="opacity" values="0;0;.9;0;0" keyTimes="0;.7;.72;.8;1" dur="11s" repeatCount="indefinite"/>'
    + '<animateTransform attributeName="transform" type="translate" values="0 0;0 0;-520 260;-520 260" keyTimes="0;.7;.8;1" dur="11s" repeatCount="indefinite"/>'
    + '<line x1="1250" y1="90" x2="1330" y2="50" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g></g>'
    + '<path d="M0 860 Q200 800 420 850 T860 830 T1300 860 T1600 820 V1000 H0Z" fill="#161229"/>'
    + '<path d="M0 920 Q260 870 560 910 T1120 900 T1600 930 V1000 H0Z" fill="#0d0a1c"/></svg>';
}

function tide() {
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2b45"/><stop offset=".45" stop-color="#6b5a78"/><stop offset=".62" stop-color="#e09a7a"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="230" cy="600" r="70" fill="#f4c27f" opacity=".9"/>'
    + '<rect y="600" width="1600" height="400" fill="#24324d"/>'
    + `<path d="${wave(640, 6, 400, 2400)}" fill="#2d3d5c">${slide(14)}</path>`
    + `<path d="${wave(720, 10, 400, 2400)}" fill="#22304b">${slide(10)}</path>`
    + `<path d="${wave(820, 14, 400, 2400)}" fill="#1a253c">${slide(7)}</path>`
    + `<path d="${wave(920, 18, 400, 2400)}" fill="#121b2d">${slide(5)}</path>`
    + '<rect x="150" y="610" width="160" height="3" fill="#f4c27f" opacity=".35"/><rect x="180" y="630" width="100" height="2" fill="#f4c27f" opacity=".25"/></svg>';
}

// Four soft lights drifting in the corners: each a circle filled with a
// gradient that fades to nothing, so no blur is worked out frame by frame.
function coralGlow() {
  // `s` is one trip out and back, in seconds; `b` how long a breath takes.
  const lights = [
    { id: "g1", dx: -340, dy: 200, s: 18, b: 7, cx: 1350, cy: 180, r: 420, fill: palette.coral, op: 0.85 },
    { id: "g2", dx: 360, dy: -180, s: 22, b: 9, cx: 200, cy: 860, r: 450, fill: palette.amber, op: 0.6 },
    { id: "g3", dx: -300, dy: -240, s: 20, b: 8, cx: 1450, cy: 900, r: 360, fill: palette.lilac, op: 0.6 },
    { id: "g4", dx: 320, dy: 260, s: 16, b: 6, cx: 150, cy: 120, r: 330, fill: palette.rose, op: 0.5 },
  ];
  const defs = lights.map((l) => `<radialGradient id="${l.id}"><stop offset="0" stop-color="${l.fill}" stop-opacity="${l.op}"/><stop offset=".45" stop-color="${l.fill}" stop-opacity="${(l.op * 0.45).toFixed(2)}"/><stop offset="1" stop-color="${l.fill}" stop-opacity="0"/></radialGradient>`).join("");
  const ease = 'calcMode="spline" keySplines=".42 0 .58 1;.42 0 .58 1" keyTimes="0;.5;1" repeatCount="indefinite"';
  // Each light drifts out and back, eased at both ends, and breathes: a
  // fifth larger and back, on a rhythm of its own.
  const move = (l) => `<animateTransform attributeName="transform" type="translate" values="0 0;${l.dx} ${l.dy};0 0" dur="${l.s}s" ${ease}/>`
    + `<animate attributeName="r" values="${l.r};${Math.round(l.r * 1.2)};${l.r}" dur="${l.b}s" ${ease}/>`;
  const drawn = lights.map((l) => `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r}" fill="url(#${l.id})">${move(l)}</circle>`).join("");
  return `${OPEN}<defs>${defs}</defs>`
    + `<rect width="1600" height="1000" fill="#1d1715"/>${drawn}</svg>`;
}

function duskHills() {
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2340"/><stop offset=".5" stop-color="#c8636a"/><stop offset=".8" stop-color="#eeb27a"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="1300" cy="640" r="110" fill="#f7d08a"/>'
    + '<path d="M0 640 C300 560 520 620 760 600 S1250 520 1600 600 V1000 H0Z" fill="#a24f5f"/>'
    + '<path d="M0 730 C260 660 600 720 900 690 S1400 640 1600 700 V1000 H0Z" fill="#7d3b52"/>'
    + '<path d="M0 820 C380 760 700 820 1040 790 S1450 760 1600 800 V1000 H0Z" fill="#552a44"/>'
    + '<path d="M0 900 C300 860 800 910 1600 880 V1000 H0Z" fill="#331a30"/></svg>';
}

function blueprint() {
  return `${OPEN}<defs><pattern id="fine" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3f6a96" stroke-width=".6" opacity=".45"/></pattern>`
    + '<pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#fine)"/><path d="M100 0H0V100" fill="none" stroke="#5b8bbd" stroke-width="1.2" opacity=".55"/></pattern></defs>'
    + '<rect width="1600" height="1000" fill="#14304f"/><rect width="1600" height="1000" fill="url(#grid)"/>'
    + '<g fill="none" stroke="#a9cdf0" stroke-width="1.5" opacity=".6"><circle cx="1440" cy="840" r="120"/><circle cx="1440" cy="840" r="60" stroke-dasharray="6 6"/>'
    + '<path d="M1300 840H1580M1440 700V980"/><rect x="80" y="80" width="180" height="110"/><path d="M80 210h180M80 222h120" opacity=".7"/></g></svg>';
}

function paper() {
  return `${OPEN}<defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .36  0 0 0 0 .25  0 0 0 .09 0"/></filter>`
    + '<radialGradient id="edge" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#6b4f2a" stop-opacity=".18"/></radialGradient></defs>'
    + '<rect width="1600" height="1000" fill="#efe6d3"/><rect width="1600" height="1000" filter="url(#grain)"/><rect width="1600" height="1000" fill="url(#edge)"/>'
    + '<g stroke="#c9a77a" stroke-width="1.2" fill="none" opacity=".5"><path d="M1380 80 l60 0 M1380 96 l40 0"/><circle cx="1490" cy="88" r="10"/></g></svg>';
}

// A tile's copy says it's 1600 wide, so the pane scales it down to the
// tile's width and keeps its shape. Made once, here.
const thumbOf = (art) => art.replace("<svg ", '<svg width="1600" height="1000" ');
const backdrop = (id, name, moving, mode, art) => ({ id, name, moving, mode, art, thumb: thumbOf(art) });

// `mode` is the app's mode it reads best in. The id is the scene's name.
export const BACKDROPS = [
  backdrop("night-sky", "Night Sky", true, "dark", nightSky()),
  backdrop("tide", "Tide", true, "dark", tide()),
  backdrop("coral-glow", "Coral Glow", true, "dark", coralGlow()),
  backdrop("dusk-hills", "Dusk Hills", false, "dark", duskHills()),
  backdrop("blueprint", "Blueprint", false, "dark", blueprint()),
  backdrop("paper", "Paper", false, "light", paper()),
];

// Drawn at 1600 by 1000 so a tile can scale it down to its width.
const OFF_ART = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 160 100">' + ('<rect x="1" y="1" width="158" height="98" rx="6" fill="none" stroke="#8a817a" stroke-width="1.2" stroke-dasharray="5 4"/>'
  + '<text x="80" y="55" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" fill="#8a817a">No backdrop</text>') + "</svg>";

export function backdropById(id) {
  return BACKDROPS.find((x) => x.id === id) ?? null;
}

// ---------------------------------------------------------------- state

export function createBackdrop() {
  return {
    pick: null,        // the backdrop set, or null for none
    frost: "medium",
    supported: true,   // false once a set shows this Claude Code has no $.theme
  };
}

export function backdropSaved(b) {
  return { pick: b.pick, frost: b.frost };
}

export function restoreBackdrop(b, saved) {
  if (!saved || typeof saved !== "object") return;
  b.pick = backdropById(saved.pick) ? saved.pick : null;
  if (FROSTS.some((f) => f.id === saved.frost)) b.frost = saved.frost;
}

// What $.theme.set is given for the backdrop and frost picked.
export function themeArgs(b) {
  const it = backdropById(b.pick);
  if (!it) return null;
  const f = FROSTS.find((x) => x.id === b.frost) ?? FROSTS[1];
  return { backdrop: { scene: it.id, glass: { blur: f.blur, opacity: f.opacity } }, overrideColorScheme: it.mode };
}

// Words typed in the room: a backdrop's name, "off", or a frost.
export function backdropWords(text) {
  const word = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!word) return null;
  if (word === "off" || word === "none") return { pick: null };
  const frost = FROSTS.find((f) => f.id === word);
  if (frost) return { frost: frost.id };
  const it = BACKDROPS.find((x) => x.name.toLowerCase() === word || x.id === word.replace(/ /g, "-"));
  return it ? { pick: it.id } : null;
}

const kind = (it) => `${it.moving ? "Moving" : "Still"} · ${it.mode === "light" ? "Light" : "Dark"}`;
const frostLabel = (b) => (FROSTS.find((f) => f.id === b.frost) ?? FROSTS[1]).label;

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
  const current = backdropById(b.pick);
  let rows, height;
  // VS Code draws pictures in the pane but no backdrop: a list there, as in the terminal.
  if (els.Svg && !els.ide) {
    const all = [
      ...BACKDROPS.map((it) => tile(els, it.id, it.thumb, `${it.name} backdrop`, it.name, kind(it), b.pick === it.id, press(it.id))),
      tile(els, "off", OFF_ART, "No backdrop", "Off", "", !b.pick, press(null)),
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
      ...BACKDROPS.map((it) => row(it.id, it.name, kind(it).toLowerCase().replace(" · ", "  "), b.pick === it.id, press(it.id))),
      row("off", "Off", "", !b.pick, press(null)),
    ];
    height = 3 + rows.length;
  }
  return { name: "Backdrops", node: card(els, { key: "backdrops", title: "BACKDROPS", color: BACKDROP_META.color, meta: current?.name ?? "Off", rows }), height };
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
  return stackCards(els, [unsupportedCard(els), listCard(els, handlers), frostCard(els, handlers)], capacity, handlers.scroll);
}

// The inline pane: the backdrop on now, then each one's name to pick.
export function backdropInline(els, w, handlers) {
  const { Box, Text, Button } = els;
  const b = state.backdrop;
  const current = backdropById(b.pick);
  const head = line(els, "head", [
    { text: `${BACKDROP_META.icon} ${BACKDROP_META.label}`, bold: true, color: BACKDROP_META.color },
    { text: `  ${current ? `${current.name} · ${frostLabel(b)} frost` : "Off"}`, color: theme.muted, grow: true },
  ]);
  if (!b.supported) return [head, Text({ key: "old", color: theme.warn, wrap: "wrap", children: UNSUPPORTED })];
  return [head, Box({ key: "names", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: [
    ...BACKDROPS.map((it) => Button({ key: `pick-${it.id}`, plain: true, dimColor: b.pick !== it.id, label: `${b.pick === it.id ? "●" : "○"} ${it.name}`, onPress: () => handlers.onBackdropPick?.(it.id) })),
    Button({ key: "pick-off", plain: true, dimColor: !!b.pick, label: `${b.pick ? "○" : "●"} Off`, onPress: () => handlers.onBackdropPick?.(null) }),
  ] })];
}

export function backdropBandPieces() {
  const b = state.backdrop;
  const current = backdropById(b.pick);
  if (!current) return [{ text: "no backdrop", color: theme.muted }];
  return [
    { text: current.name, color: BACKDROP_META.color, bold: true },
    { text: ` · ${frostLabel(b)} frost`, color: theme.muted },
  ];
}

export function backdropBandDesk() {
  const b = state.backdrop;
  const color = BACKDROP_META.color;
  const current = backdropById(b.pick);
  if (!current) return { color, sections: [{ key: "none", color, parts: [sub("no backdrop")] }] };
  return { color, sections: [
    { key: "pick", color, parts: [value(current.name, color)] },
    { key: "frost", color, grow: true, parts: [sub(`${frostLabel(b)} frost`)] },
  ] };
}
