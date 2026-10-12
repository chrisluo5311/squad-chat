// Clawd as a vector drawing, for surfaces that draw SVG (the desktop): the
// pixel stickers' shape and colors, rounded, on the same 32-unit grid, so it
// stays sharp at any size. Each mood moves by CSS animations inside the
// drawing (a bob, a wave, notes floating up), so it moves with no redraws.

const C = {
  body: "#D97757",
  shade: "#B85E40",
  band: "#24408C",
  cup: "#1E3478",
  cupHi: "#7FA4E8",
  eye: "#141414",
  blush: "#F08C8C",
  gold: "#FABE28",
  note: "#7FA4E8",
  red: "#E6465A",
  z: "#8FA6E0",
  key: "#2C3040",
  keyHi: "#7FA4E8",
};

// Shared motions, in the drawing's own units. Only an animated part turns
// about its own box: a plain rotate="…" attribute keeps the drawing's frame.
const STYLE = `<style>
[class]{transform-box:fill-box}
.bob{animation:bob .9s ease-in-out infinite alternate}
@keyframes bob{to{transform:translateY(.9px)}}
.breathe{transform-origin:50% 100%;animation:breathe 3.2s ease-in-out infinite}
@keyframes breathe{50%{transform:scaleY(.95)}}
.jump{animation:jump .9s cubic-bezier(.3,.7,.4,1) infinite}
@keyframes jump{0%,100%{transform:translateY(0)}45%{transform:translateY(-3.5px)}}
.hop{animation:hop 1.4s ease-out infinite}
@keyframes hop{0%,30%,100%{transform:translate(0,0)}10%{transform:translate(.5px,-2px)}}
.blink{transform-origin:50% 50%;animation:blink 3.6s infinite}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.float{animation:float 2.4s ease-out infinite}
.float2{animation:float 2.4s ease-out 1.2s infinite}
@keyframes float{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-7px);opacity:0}}
.twinkle{transform-origin:50% 50%;animation:twinkle 1s ease-in-out infinite alternate}
.twinkle2{transform-origin:50% 50%;animation:twinkle 1s ease-in-out .5s infinite alternate}
@keyframes twinkle{from{transform:scale(.55);opacity:.5}to{transform:scale(1.1);opacity:1}}
.wave{transform-origin:85% 90%;animation:wave .5s ease-in-out infinite alternate}
@keyframes wave{from{transform:rotate(-8deg)}to{transform:rotate(28deg)}}
.tapL{animation:tap .24s steps(1) infinite}
.tapR{animation:tap .24s steps(1) .12s infinite}
@keyframes tap{50%{transform:translateY(-.8px)}}
.look{animation:look 2.4s steps(1) infinite}
@keyframes look{50%{transform:translateX(1px)}}
.lookStart{transform:translateX(-.5px)}
.scratch{transform-origin:15% 90%;animation:scratch .4s ease-in-out infinite alternate}
@keyframes scratch{from{transform:rotate(-6deg)}to{transform:rotate(6deg)}}
.bobQ{animation:bobQ 1.2s ease-in-out infinite alternate}
@keyframes bobQ{to{transform:translateY(-1.2px) rotate(8deg)}}
.wink{transform-origin:50% 50%;animation:winkOpen 2.6s steps(1) infinite}
.winkShut{animation:winkShut 2.6s steps(1) infinite}
@keyframes winkOpen{0%,100%{opacity:1}35%,80%{opacity:0}}
@keyframes winkShut{0%,100%{opacity:0}35%,80%{opacity:1}}
.heart{animation:heart 2.6s ease-out infinite}
@keyframes heart{0%,30%{transform:translateY(2px) scale(.4);opacity:0}45%{opacity:1;transform:translateY(0) scale(1)}100%{transform:translateY(-6px) scale(1);opacity:0}}
.flash{animation:flash .5s steps(1) infinite}
@keyframes flash{50%{opacity:.25}}
.shake{animation:shake .25s linear infinite}
@keyframes shake{25%{transform:translateX(-.35px)}75%{transform:translateX(.35px)}}
.stepA{animation:step .36s steps(1) infinite}
.stepB{animation:step .36s steps(1) .18s infinite}
@keyframes step{50%{transform:translateY(-1.2px)}}
.zz{animation:zz 3s ease-out infinite}
.zz2{animation:zz 3s ease-out 1.5s infinite}
@keyframes zz{0%{transform:translate(0,0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translate(2.5px,-7px) scale(1.1);opacity:0}}
</style>`;

// Four legs; walking, the outer pair and the inner pair step in turn.
let walking = false;
const legs = () => [10.3, 12.7, 19.3, 21.7].map((x, i) => `<rect${walking ? ` class="${i % 2 ? "stepB" : "stepA"}"` : ""} x="${x - 0.7}" y="20" width="1.4" height="7" rx="0.7" fill="${C.body}"/>`).join("");

// An arm from the left (side -1) or right (side 1) shoulder: out to the
// side, raised, or forward onto a keyboard.
function arm(side, pose, cls = "") {
  const c = cls ? ` class="${cls}"` : "";
  if (pose === "up") {
    const x = side < 0 ? 4.6 : 24.4;
    return `<g${c}><rect x="${x}" y="9" width="3" height="8" rx="1.5" fill="${C.body}" transform="rotate(${side * 30} ${x + 1.5} 16)"/></g>`;
  }
  if (pose === "front") {
    // From the shoulder, down and in, to a hand on the keys.
    const [sx, hx] = side < 0 ? [7.4, 11.1] : [24.6, 20.9];
    return `<g${c}><path d="M${sx} 16.6 L${hx} 20.4" stroke="${C.body}" stroke-width="2.4" stroke-linecap="round"/></g>`;
  }
  const x = side < 0 ? 5 : 22;
  return `<g${c}><rect x="${x}" y="15.5" width="5" height="3" rx="1.5" fill="${C.body}"/></g>`;
}

function head() {
  return `<rect x="8.5" y="11.5" width="15" height="10.5" rx="2.6" fill="${C.body}"/>`
    + `<rect x="8.5" y="18.6" width="15" height="3.4" rx="2" fill="${C.shade}" opacity=".35"/>`
    + `<rect x="10.2" y="12.6" width="5" height="1" rx=".5" fill="#fff" opacity=".22"/>`
    + `<path d="M9.2 12.4 C9.2 5.8 22.8 5.8 22.8 12.4" stroke="${C.band}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
    + `<rect x="7.1" y="11.4" width="3" height="5.4" rx="1.2" fill="${C.cup}"/><rect x="21.9" y="11.4" width="3" height="5.4" rx="1.2" fill="${C.cup}"/>`
    + `<rect x="7.6" y="12.2" width=".9" height="1.8" rx=".45" fill="${C.cupHi}"/><rect x="23.5" y="12.2" width=".9" height="1.8" rx=".45" fill="${C.cupHi}"/>`;
}

const LX = 13.3, RX = 18.7;
function eye(kind, cx) {
  switch (kind) {
    case "happy": return `<path d="M${cx - 1.2} 16.4 L${cx} 15.1 L${cx + 1.2} 16.4" stroke="${C.eye}" stroke-width=".9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "closed": return `<path d="M${cx - 1.2} 16.2 q1.2 .9 2.4 0" stroke="${C.eye}" stroke-width=".8" fill="none" stroke-linecap="round"/>`;
    case "wide": return `<g><circle cx="${cx}" cy="15.8" r="1.35" fill="${C.eye}"/><circle cx="${cx - 0.45}" cy="15.3" r=".45" fill="#fff"/></g>`;
    case "shut": return `<path d="M${cx - 1.1} 14.9 L${cx + 0.4} 15.8 L${cx - 1.1} 16.7" stroke="${C.eye}" stroke-width=".8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    default: return `<rect x="${cx - 0.55}" y="14.6" width="1.1" height="2.2" rx=".55" fill="${C.eye}"/>`;
  }
}
const blush = () => `<ellipse cx="11.9" cy="18.3" rx="1" ry=".5" fill="${C.blush}" opacity=".8"/><ellipse cx="20.1" cy="18.3" rx="1" ry=".5" fill="${C.blush}" opacity=".8"/>`;

const note = (x, y, cls) => `<g class="${cls}"><g fill="${C.note}"><circle cx="${x}" cy="${y + 3}" r="1.1"/><rect x="${x + 0.6}" y="${y - 1}" width=".6" height="4"/></g><path d="M${x + 0.9} ${y - 1} q2 .5 2 2" stroke="${C.note}" stroke-width=".6" fill="none"/></g>`;
const spark = (x, y, cls, color = C.gold, r = 1.6) => `<g class="${cls}"><path d="M${x} ${y - r} L${x + r * 0.32} ${y - r * 0.32} L${x + r} ${y} L${x + r * 0.32} ${y + r * 0.32} L${x} ${y + r} L${x - r * 0.32} ${y + r * 0.32} L${x - r} ${y} L${x - r * 0.32} ${y - r * 0.32}Z" fill="${color}"/></g>`;
const heart = (x, y) => `<g class="heart"><path d="M${x} ${y + 2.2} C${x - 3} ${y} ${x - 1.8} ${y - 1.8} ${x} ${y - 0.4} C${x + 1.8} ${y - 1.8} ${x + 3} ${y} ${x} ${y + 2.2}Z" fill="${C.red}"/></g>`;
const zee = (x, y, cls) => `<g class="${cls}"><path d="M${x} ${y} h2 l-2 2.4 h2" stroke="${C.z}" stroke-width=".7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const bang = (x, y) => `<g class="flash" fill="${C.red}"><rect x="${x}" y="${y}" width="1" height="3.4" rx=".5"/><circle cx="${x + 0.5}" cy="${y + 4.5}" r=".55"/></g>`;
const qmark = (x, y) => `<g class="bobQ"><path d="M${x} ${y + 1} q0 -2 2 -2 q2 0 2 1.8 q0 1.2 -1.6 1.8 q-.5 .3 -.5 1.1" stroke="${C.band}" stroke-width=".9" fill="none" stroke-linecap="round"/><circle cx="${x + 1.9}" cy="${y + 5.1}" r=".55" fill="${C.band}"/></g>`;
const keyboard = () => `<rect x="7.5" y="21.2" width="17" height="3.2" rx="1" fill="${C.key}"/>`
  + [9.5, 12, 14.5, 17, 19.5, 22].map((x, i) => `<rect x="${x - 0.7}" y="22.2" width="1.4" height="1" rx=".3" fill="${i % 3 ? "#4A5068" : C.keyHi}"/>`).join("");

// Clawd in one mood: the inner markup on the 32-unit grid. `walk` sets
// the legs stepping.
function clawdBody(mood, { walk = false } = {}) {
  walking = walk;
  try { return bodyOf(mood); } finally { walking = false; }
}
function bodyOf(mood) {
  const eyes = (l, r = l, cls = "") => `<g${cls ? ` class="${cls}"` : ""}>${eye(l, LX)}${eye(r, RX)}</g>`;
  switch (mood) {
    case "typing":
      return `${legs()}<g>${head()}${eyes("open", "open", "blink")}</g>${keyboard()}${arm(-1, "front", "tapL")}${arm(1, "front", "tapR")}${spark(26.5, 19, "twinkle", C.gold, 1.1)}`;
    case "wave":
      return `${legs()}${arm(-1, "up", "wave")}${arm(1, "side")}${head()}${eyes("open", "open", "blink")}${blush()}${spark(4, 6, "twinkle", C.gold, 1)}${spark(7, 4, "twinkle2", C.gold, 0.8)}`;
    case "cheer":
      return `<g class="jump">${legs()}${arm(-1, "up")}${arm(1, "up")}${head()}${eyes("happy")}${blush()}</g>${spark(3.5, 5, "twinkle")}${spark(28, 4, "twinkle2")}${spark(27, 12, "twinkle", C.gold, 1.1)}`;
    case "confused":
      return `${legs()}${arm(-1, "side")}${arm(1, "up", "scratch")}${head()}<g class="lookStart"><g class="look">${eyes("open")}</g></g>${qmark(25, 3)}`;
    case "wink":
      return `${legs()}${arm(-1, "side")}${arm(1, "side")}${head()}${eye("open", LX)}<g class="wink">${eye("open", RX)}</g><g class="winkShut">${eye("shut", RX)}</g>${blush()}${heart(26, 9)}`;
    case "surprised":
      return `<g class="hop">${legs()}${arm(-1, "up")}${arm(1, "up")}<g class="shake">${head()}${eyes("wide")}</g></g>${bang(4.5, 3)}${bang(6.8, 3)}`;
    case "sleepy":
      return `${legs()}<g class="breathe">${arm(-1, "side")}${arm(1, "side")}${head()}${eyes("closed")}</g>${zee(23.5, 8, "zz")}${zee(26, 4, "zz2")}`;
    default:   // vibe
      return `${legs()}<g class="bob">${arm(-1, "side")}${arm(1, "side")}${head()}${eyes("happy")}${blush()}</g>${note(3, 7, "float")}${note(26, 5, "float2")}`;
  }
}

const cache = new Map();

// Clawd alone, `size` pixels square. `crop` trims the props' margin, for
// the small one beside the input box.
export function clawdSvg(mood, size, { crop = false } = {}) {
  const k = `${mood}:${size}:${crop}`;
  if (!cache.has(k)) {
    const vb = crop ? "3 3 26 26" : "0 0 32 32";
    cache.set(k, `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${STYLE}${clawdBody(mood)}</svg>`);
  }
  return cache.get(k);
}

// Clawd's corner: a floor, a soft shadow, and Clawd on it, `w` by `h`.
export function cornerSvg(mood, w = 320, h = 180) {
  const k = `corner:${mood}:${w}:${h}`;
  if (!cache.has(k)) {
    const floor = Math.round(h * 0.8);
    const s = (floor - 4) / 27;   // Clawd's scale: feet on the floor, ears at the top
    const x = (w - 32 * s) / 2, y = floor - 27.2 * s;
    cache.set(k, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}`
      + `<rect x="0" y="${floor}" width="${w}" height="${h - floor}" rx="6" fill="rgba(127,127,127,0.08)"/>`
      + `<rect x="0" y="${floor}" width="${w}" height="1" fill="rgba(127,127,127,0.25)"/>`
      + `<ellipse cx="${w / 2}" cy="${floor + 2}" rx="${8.5 * s}" ry="${1.3 * s}" fill="rgba(0,0,0,0.28)"/>`
      + `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(32 * s).toFixed(1)}" height="${(32 * s).toFixed(1)}" viewBox="0 0 32 32" overflow="visible">${clawdBody(mood)}</svg></svg>`);
  }
  return cache.get(k);
}

// ---------------------------------------------------------------- walking

// How Clawd gets about by the input box, for each mood: how long one way
// takes (seconds), or null to stay put at the right end (asleep, cheering).
const PACE = { vibe: 11, typing: 4, wave: 9, wink: 10, confused: 14, cheer: null, surprised: null, sleepy: null };

// One Clawd, `size` px, its feet at the bottom, facing right; `flip` animates
// it turning around (SMIL values for a scale on the x axis).
function walkerAt(mood, size, { walk = true, flip = null, show = null, y = 0 } = {}) {
  const h = size / 2;
  const turn = flip ? `<animateTransform attributeName="transform" type="scale" ${flip}/>` : "";
  const fade = show ? `<animate attributeName="opacity" ${show}/>` : "";
  return `<g>${fade}<g transform="translate(${h} 0)"><g>${turn}<svg x="${-h}" y="${y.toFixed(1)}" width="${size}" height="${size}" viewBox="3 3 26 26" overflow="visible">${clawdBody(mood, { walk })}</svg></g></g></g>`;
}

// Clawd walking a track as wide as the slot it's drawn in: the drawing has
// no width of its own (100%), so it never scales. x runs 0% → 100% while a
// translate runs 0 → -size, so Clawd goes edge to edge exactly at any width.
//   stroll: back and forth, turning at each end, at the mood's pace
//   stopgo: a few steps, a stop to wave, on to the end, back, a rest
// A mood that stays put stands at the right end.
export function walkSvg(mood, style = "stroll", size = 40, { height = size } = {}) {
  const k = `walk:${mood}:${style}:${size}:${height}`;
  if (cache.has(k)) return cache.get(k);
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}">${STYLE}`;
  const at = (opts = {}) => opts;
  const pace = PACE[mood];
  let body;
  if (pace == null) {
    body = `<svg x="100%" width="${size}" height="${height}" overflow="visible"><g transform="translate(${-size} 0)">${walkerAt(mood, size, at({ walk: false }))}</g></svg>`;
  } else if (style === "stopgo") {
    // Out to 40% (0-.25), stop and wave (.25-.4), on to the end (.4-.55),
    // turn, back to the start (.55-.85), rest there (.85-1).
    const d = `dur="${(pace * 2.6).toFixed(1)}s" repeatCount="indefinite"`;
    const kt = `keyTimes="0;.25;.4;.55;.85;1"`;
    const x = `<animate attributeName="x" values="0%;40%;40%;100%;0%;0%" ${kt} ${d}/>`;
    const tx = `<animateTransform attributeName="transform" type="translate" values="0 0;${-size * 0.4} 0;${-size * 0.4} 0;${-size} 0;0 0;0 0" ${kt} ${d}/>`;
    const flip = `values="1 1;1 1;-1 1;-1 1;1 1" keyTimes="0;.55;.5501;.85;.8501" calcMode="discrete" ${d}`;
    const walkShow = `values="1;0;1" keyTimes="0;.25;.4" calcMode="discrete" ${d}`;
    const waveShow = `values="0;1;0" keyTimes="0;.25;.4" calcMode="discrete" ${d}`;
    body = `<svg width="${size}" height="${height}" overflow="visible">${x}<g>${tx}`
      + walkerAt(mood, size, at({ flip, show: walkShow }))
      + walkerAt("wave", size, at({ walk: false, show: waveShow }))
      + `</g></svg>`;
  } else {
    const d = `dur="${pace * 2}s" repeatCount="indefinite"`;
    const kt = `keyTimes="0;.5;1"`;
    body = `<svg width="${size}" height="${height}" overflow="visible"><animate attributeName="x" values="0%;100%;0%" ${kt} ${d}/>`
      + `<g><animateTransform attributeName="transform" type="translate" values="0 0;${-size} 0;0 0" ${kt} ${d}/>`
      + walkerAt(mood, size, at({ flip: `values="1 1;-1 1" keyTimes="0;.5" calcMode="discrete" ${d}` }))
      + `</g></svg>`;
  }
  const source = `${open}${body}</svg>`;
  cache.set(k, source);
  return source;
}
