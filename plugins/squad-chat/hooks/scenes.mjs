// The backdrops' drawings: each a 1600 by 1000 SVG that fills any window,
// cropped to its shape. What stands out (a moon, a sun, a drawing) sits in a
// corner or low down, away from the words in the middle and the message box
// at the foot. Plain strings, no state: backdrop.mjs lists them and the
// Backdrop room picks among them. The fireworks drawn over a scene are here
// too.

import { palette } from "./theme.mjs";

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">';

// What moves, moves by SMIL (<animate>, <animateTransform>), and a scene
// has no <style>: the desktop drew a scene whose <style> held a media rule
// as a still picture, SMIL and CSS animation alike.

const f1 = (n) => n.toFixed(1);

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

// ---------------------------------------------------------------- the scenes

export function nightSky() {
  const r = seeded(7);
  // Six groups of stars, each on its own rhythm: one animation a group.
  const groups = TWINKLE.map(() => []);
  for (let i = 0; i < 140; i++) {
    const x = Math.round(r() * 1600), y = Math.round(r() * 640), size = (r() * 1.6 + 0.4).toFixed(1);
    groups[i % TWINKLE.length].push(`<circle cx="${x}" cy="${y}" r="${size}"/>`);
  }
  const stars = groups.map((g, i) => `<g fill="#fff" opacity=".2"><animate attributeName="opacity" values=".2;1;.2" dur="${TWINKLE[i][1]}s" begin="${TWINKLE[i][0]}s" repeatCount="indefinite"/>${g.join("")}</g>`).join("");
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

export function tide() {
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
export function coralGlow() {
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

export function duskHills() {
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2340"/><stop offset=".5" stop-color="#c8636a"/><stop offset=".8" stop-color="#eeb27a"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="1300" cy="640" r="110" fill="#f7d08a"/>'
    + '<path d="M0 640 C300 560 520 620 760 600 S1250 520 1600 600 V1000 H0Z" fill="#a24f5f"/>'
    + '<path d="M0 730 C260 660 600 720 900 690 S1400 640 1600 700 V1000 H0Z" fill="#7d3b52"/>'
    + '<path d="M0 820 C380 760 700 820 1040 790 S1450 760 1600 800 V1000 H0Z" fill="#552a44"/>'
    + '<path d="M0 900 C300 860 800 910 1600 880 V1000 H0Z" fill="#331a30"/></svg>';
}

export function blueprint() {
  return `${OPEN}<defs><pattern id="fine" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3f6a96" stroke-width=".6" opacity=".45"/></pattern>`
    + '<pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#fine)"/><path d="M100 0H0V100" fill="none" stroke="#5b8bbd" stroke-width="1.2" opacity=".55"/></pattern></defs>'
    + '<rect width="1600" height="1000" fill="#14304f"/><rect width="1600" height="1000" fill="url(#grid)"/>'
    + '<g fill="none" stroke="#a9cdf0" stroke-width="1.5" opacity=".6"><circle cx="1440" cy="840" r="120"/><circle cx="1440" cy="840" r="60" stroke-dasharray="6 6"/>'
    + '<path d="M1300 840H1580M1440 700V980"/><rect x="80" y="80" width="180" height="110"/><path d="M80 210h180M80 222h120" opacity=".7"/></g></svg>';
}

export function paper() {
  return `${OPEN}<defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .36  0 0 0 0 .25  0 0 0 .09 0"/></filter>`
    + '<radialGradient id="edge" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#6b4f2a" stop-opacity=".18"/></radialGradient></defs>'
    + '<rect width="1600" height="1000" fill="#efe6d3"/><rect width="1600" height="1000" filter="url(#grain)"/><rect width="1600" height="1000" fill="url(#edge)"/>'
    + '<g stroke="#c9a77a" stroke-width="1.2" fill="none" opacity=".5"><path d="M1380 80 l60 0 M1380 96 l40 0"/><circle cx="1490" cy="88" r="10"/></g></svg>';
}

export function aurora() {
  const r = seeded(11);
  let stars = "";
  for (let i = 0; i < 70; i++) stars += `<circle cx="${Math.round(r() * 1600)}" cy="${Math.round(r() * 520)}" r="${f1(r() * 1.2 + 0.4)}" fill="#fff" opacity="${f1(r() * 0.5 + 0.2)}"/>`;
  // A curtain is a row of thin vertical strokes, each fading from its lit
  // foot up into the dark, their feet on a slow curve: it sways and breathes.
  const curtain = (id, foot, amp, len, c1, c2, dur, dx, ph) => {
    let strokes = "";
    for (let x = -200; x <= 1800; x += 16) {
      const y = foot + Math.sin(x / 260 + ph) * amp + Math.sin(x / 90 + ph * 2) * amp * 0.25;
      const l = len * (0.7 + 0.3 * Math.sin(x / 140 + ph));
      strokes += `<path d="M${x} ${Math.round(y)}V${Math.round(y - l)}"/>`;
    }
    return { def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${foot + amp}" x2="0" y2="${foot - amp - len}"><stop offset="0" stop-color="${c1}" stop-opacity="0"/><stop offset=".12" stop-color="${c1}" stop-opacity=".7"/><stop offset=".45" stop-color="${c2}" stop-opacity=".3"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient>`,
      body: `<g stroke="url(#${id})" stroke-width="13"><animateTransform attributeName="transform" type="translate" values="0 0;${dx} 0;0 0" dur="${dur}s" calcMode="spline" keySplines=".42 0 .58 1;.42 0 .58 1" keyTimes="0;.5;1" repeatCount="indefinite"/>`
        + `<animate attributeName="opacity" values=".55;1;.55" dur="${f1(dur * 0.6)}s" repeatCount="indefinite"/>${strokes}</g>` };
  };
  const cs = [curtain("a1", 470, 70, 330, "#5ef2b0", "#3b7bd8", 18, -90, 0.3), curtain("a2", 400, 50, 260, "#a6f27a", "#8a4fd8", 24, 110, 2.1)];
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030a17"/><stop offset=".7" stop-color="#0a1f33"/><stop offset="1" stop-color="#12314a"/></linearGradient>${cs.map((c) => c.def).join("")}</defs>`
    + `<rect width="1600" height="1000" fill="url(#sky)"/>${stars}${cs.map((c) => c.body).join("")}`
    + '<path d="M0 820 L180 700 L300 760 L470 640 L640 780 L820 690 L1000 790 L1180 660 L1360 760 L1500 690 L1600 740 V1000 H0Z" fill="#0a1626"/>'
    + '<path d="M0 900 L240 830 L520 890 L800 840 L1100 900 L1400 850 L1600 880 V1000 H0Z" fill="#050c16"/></svg>';
}

export function rain() {
  const r = seeded(23);
  let bokeh = "";
  const hues = ["#f2b46b", "#e2786b", "#7fb6e2", "#f2e08b"];
  for (let i = 0; i < 26; i++) {
    const x = Math.round(r() * 1600), y = Math.round(600 + r() * 380), rad = Math.round(20 + r() * 50);
    bokeh += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${hues[i % 4]}" opacity="${f1(r() * 0.18 + 0.06)}"/>`;
  }
  let drops = "";
  for (let i = 0; i < 110; i++) {
    const x = Math.round(r() * 1800 - 100), y = Math.round(r() * 1000), len = Math.round(30 + r() * 50);
    drops += `<path d="M${x} ${y}l-8 ${len}"/>`;
  }
  const fall = (dur) => `<animateTransform attributeName="transform" type="translate" from="80 -1000" to="0 0" dur="${dur}s" repeatCount="indefinite"/>`;
  // The drops are drawn once and used four times: two sheets, each two screens tall to loop.
  const sheet = (op, w, dur) => `<g stroke="#bcd3ea" stroke-width="${w}" stroke-linecap="round" opacity="${op}">${fall(dur)}<use href="#drops"/><use href="#drops" transform="translate(-80 1000)"/></g>`;
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151c27"/><stop offset=".6" stop-color="#1e2836"/><stop offset="1" stop-color="#2a2a33"/></linearGradient><g id="drops">${drops}</g></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + '<path d="M0 760 V640 h70 v-60 h60 v90 h80 v-140 h90 v110 h50 v-40 h70 v80 h100 v-170 h80 v190 h60 v-60 h110 v90 h70 v-120 h90 v150 h80 v-80 h70 v60 h110 v-130 h90 v140 h60 V1000 H0Z" fill="#10151d"/>'
    + `${bokeh}${sheet(0.18, 1.2, 1.6)}${sheet(0.3, 1.6, 1.1)}</svg>`;
}

export function fireflies(still) {
  const r = seeded(31);
  let flies = "", defs = '<radialGradient id="glow"><stop offset="0" stop-color="#f4f08a"/><stop offset=".3" stop-color="#d8e86b" stop-opacity=".6"/><stop offset="1" stop-color="#b8d86b" stop-opacity="0"/></radialGradient>';
  for (let i = 0; i < 34; i++) {
    const left = i % 2 === 0;
    const x = Math.round(left ? r() * 520 : 1080 + r() * 520), y = Math.round(380 + r() * 560);
    const dx = Math.round(r() * 80 - 40), dy = Math.round(r() * 60 - 30), dur = f1(6 + r() * 8), blink = f1(2 + r() * 3), begin = f1(r() * 4);
    flies += `<g transform="translate(${x} ${y})"><circle r="16" fill="url(#glow)" opacity="${still ? ".9" : "0"}"><animate attributeName="opacity" values="0;1;0" dur="${blink}s" begin="${begin}s" repeatCount="indefinite"/>`
      + `<animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy};0 0" dur="${dur}s" repeatCount="indefinite"/></circle></g>`;
  }
  const tree = (x, h, w) => `<path d="M${x} 1000 V${1000 - h * 0.3} L${x - w} ${1000 - h * 0.3} L${x - 4} ${1000 - h} L${x + 4} ${1000 - h} L${x + w} ${1000 - h * 0.3} L${x} ${1000 - h * 0.3}Z"/>`;
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07101a"/><stop offset=".6" stop-color="#0d1d22"/><stop offset="1" stop-color="#14291f"/></linearGradient>${defs}</defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + `<g fill="#0b1712">${tree(60, 560, 110)}${tree(190, 420, 90)}${tree(320, 620, 120)}${tree(1290, 600, 120)}${tree(1420, 460, 95)}${tree(1550, 640, 120)}</g>`
    + '<path d="M0 930 Q400 880 800 920 T1600 900 V1000 H0Z" fill="#08120d"/>'
    + `${flies}</svg>`;
}

export function lanterns(still) {
  const r = seeded(47);
  let lamps = "";
  for (let i = 0; i < 18; i++) {
    const left = i % 2 === 0;
    const x = Math.round(left ? 40 + r() * 460 : 1100 + r() * 460), s = 0.5 + r() * 0.8, dur = Math.round(28 + r() * 22), begin = -Math.round(r() * dur);
    const sway = Math.round(r() * 60 - 30);
    // Where it is now, part way up its run: the place its tile shows it.
    const t = -begin / dur, at = t < 0.5 ? [x + sway * t * 2, 1080 - 1080 * t] : [x + sway - sway * 4 * (t - 0.5), 540 - 1280 * (t - 0.5)];
    lamps += `<g transform="translate(${Math.round(at[0])} ${Math.round(at[1])})"><animateTransform attributeName="transform" type="translate" values="${x} 1080;${x + sway} 540;${x - sway} -100" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`
      + `<g transform="scale(${f1(s)})"><circle r="60" fill="url(#lglow)"/><path d="M-18 -26 Q-24 0 -16 26 H16 Q24 0 18 -26Z" fill="#f29a4a"/><rect x="-14" y="-30" width="28" height="6" rx="2" fill="#a85a2e"/><path d="M-10 26 H10" stroke="#ffd98a" stroke-width="3"/></g></g>`;
  }
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120d26"/><stop offset=".6" stop-color="#2b1a3d"/><stop offset=".78" stop-color="#4a2a45"/></linearGradient>`
    + '<radialGradient id="lglow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".7"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient></defs>'
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + '<rect y="800" width="1600" height="200" fill="#1a1230"/>'
    + `<path d="${wave(820, 4, 400, 2400)}" fill="#221838">${slide(16)}</path>`
    + '<g fill="#f29a4a" opacity=".18"><rect x="120" y="840" width="90" height="3"/><rect x="1300" y="860" width="120" height="3"/><rect x="380" y="900" width="60" height="2"/><rect x="1120" y="930" width="80" height="2"/></g>'
    + `${lamps}</svg>`;
}

export function jellyfish() {
  const r = seeded(53);
  // Three drifts of motes, each rising at its own pace: one animation a drift.
  const drifts = [[], [], []];
  for (let i = 0; i < 60; i++) {
    const x = Math.round(r() * 1600), y = Math.round(r() * 1000);
    drifts[i % 3].push(`<circle cx="${x}" cy="${y}" r="${f1(r() * 1.6 + 0.6)}"/>`);
  }
  // A drift rises a whole screen with its copy a screen below, so it loops with no jump.
  const moteDefs = drifts.map((d, i) => `<g id="m${i}">${d.join("")}</g>`).join("");
  const motes = drifts.map((d, i) => `<g fill="#a8e6ff" opacity="${[0.3, 0.4, 0.25][i]}"><animateTransform attributeName="transform" type="translate" from="0 0" to="0 -1000" dur="${[130, 180, 230][i]}s" repeatCount="indefinite"/><use href="#m${i}"/><use href="#m${i}" y="1000"/></g>`).join("");
  const jelly = (x, y, s, hue, dur) => {
    const tent = [-22, -8, 8, 22].map((tx, i) => `<path d="M${tx} 0 Q${tx + (i % 2 ? 10 : -10)} 40 ${tx} 80 T${tx} 150" fill="none" stroke="hsl(${hue},90%,75%)" stroke-width="2.5" opacity=".6"><animate attributeName="d" values="M${tx} 0 Q${tx + (i % 2 ? 10 : -10)} 40 ${tx} 80 T${tx} 150;M${tx} 0 Q${tx + (i % 2 ? -10 : 10)} 40 ${tx} 80 T${tx} 150;M${tx} 0 Q${tx + (i % 2 ? 10 : -10)} 40 ${tx} 80 T${tx} 150" dur="${dur / 2}s" repeatCount="indefinite"/></path>`).join("");
    return `<g transform="translate(${x} ${y}) scale(${s})"><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -40;0 0" dur="${dur}s" calcMode="spline" keySplines=".42 0 .58 1;.42 0 .58 1" keyTimes="0;.5;1" repeatCount="indefinite"/>`
      + `<circle cx="0" cy="-10" r="90" fill="hsl(${hue},90%,70%)" opacity=".08"/>${tent}`
      + `<path d="M-40 0 Q-40 -55 0 -55 Q40 -55 40 0 Q20 -8 0 0 Q-20 -8 -40 0Z" fill="hsl(${hue},85%,72%)" opacity=".75"><animateTransform attributeName="transform" type="scale" values="1 1;1.08 .9;1 1" dur="${dur / 2}s" repeatCount="indefinite"/></path></g></g>`;
  };
  return `${OPEN}<defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b3352"/><stop offset=".5" stop-color="#071f36"/><stop offset="1" stop-color="#030e1c"/></linearGradient>`
    + '<linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe8ff" stop-opacity=".18"/><stop offset="1" stop-color="#bfe8ff" stop-opacity="0"/></linearGradient>'
    + `${moteDefs}</defs>`
    + '<rect width="1600" height="1000" fill="url(#sea)"/>'
    + '<g fill="url(#ray)"><path d="M300 0 H380 L620 700 H460Z"/><path d="M760 0 H800 L940 600 H840Z"/><path d="M1150 0 H1240 L1380 760 H1200Z"/></g>'
    + `${motes}${jelly(1380, 260, 1.1, 300, 9)}${jelly(220, 720, 0.9, 190, 11)}${jelly(1480, 760, 0.6, 330, 8)}${jelly(110, 220, 0.5, 260, 10)}</svg>`;
}

export function cityNight() {
  const r = seeded(61);
  let blocks = "", warm = "", cool = "", blink = "";
  let x = 0;
  while (x < 1600) {
    const w = Math.round(70 + r() * 90), h = Math.round(140 + r() * (x > 500 && x < 1100 ? 160 : 360));
    const shade = ["#121a2c", "#0f1626", "#151f33"][Math.floor(r() * 3)];
    blocks += `<rect x="${x}" y="${1000 - h}" width="${w}" height="${h}" fill="${shade}"/>`;
    for (let wy = 1000 - h + 20; wy < 980; wy += 26) {
      for (let wx = x + 10; wx < x + w - 14; wx += 20) {
        const v = r();
        if (v < 0.62) continue;
        if (v > 0.95) {
          blink += `<rect x="${wx}" y="${wy}" width="8" height="12"><animate attributeName="opacity" values="1;1;.1;.1;1" keyTimes="0;.4;.45;.8;1" dur="${Math.round(8 + r() * 14)}s" repeatCount="indefinite"/></rect>`;
        } else if (r() > 0.3) warm += `M${wx} ${wy}h8v12h-8z`;
        else cool += `M${wx} ${wy}h8v12h-8z`;
      }
    }
    x += w + Math.round(r() * 6);
  }
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090d1d"/><stop offset=".7" stop-color="#1b2140"/><stop offset="1" stop-color="#3a2f4f"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + `${blocks}<g opacity=".85"><g fill="#f2cf86"><path d="${warm}"/>${blink}</g><path fill="#9cc7ef" d="${cool}"/></g>`
    + '<rect x="1418" y="560" width="4" height="80" fill="#1a2238"/><circle cx="1420" cy="556" r="5" fill="#ff5a5a"><animate attributeName="opacity" values="1;.1;1" dur="2.4s" repeatCount="indefinite"/></circle></svg>';
}

export function synthwave() {
  let grid = "";
  for (let i = -16; i <= 16; i++) grid += `<line x1="800" y1="640" x2="${800 + i * 140}" y2="1000"/>`;
  let rows = "";
  // Rows bunch up toward the horizon. Each slides to where the next one
  // down starts, all in the same time, so the floor looks the same at the
  // end of a run as at its start and loops with no jump.
  const ys = [0, 18, 40, 68, 104, 150, 210, 290, 400, 560];
  for (let i = 0; i < ys.length - 1; i++) rows += `<line x1="0" y1="${640 + ys[i]}" x2="1600" y2="${640 + ys[i]}"><animateTransform attributeName="transform" type="translate" from="0 0" to="0 ${ys[i + 1] - ys[i]}" dur="1.4s" repeatCount="indefinite"/></line>`;
  let stripes = "";
  for (let i = 0; i < 6; i++) stripes += `<rect x="1080" y="${330 + i * 22 + i * i * 2}" width="440" height="${3 + i * 2}" fill="#2a0f3d"/>`;
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14062a"/><stop offset=".55" stop-color="#3d0f4a"/><stop offset=".64" stop-color="#7a1f5c"/></linearGradient>`
    + '<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd36b"/><stop offset="1" stop-color="#ff4f8b"/></linearGradient>'
    + '<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f3d"/><stop offset="1" stop-color="#12061f"/></linearGradient></defs>'
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + `<circle cx="1300" cy="420" r="200" fill="url(#sun)"/>${stripes}`
    + '<path d="M0 640 L120 560 L220 610 L340 520 L470 600 L560 640Z M1040 640 L1150 590 L1230 620 L1330 560 L1460 610 L1600 570 V640Z" fill="#1d0a33" stroke="#ff5fae" stroke-width="1.5" stroke-opacity=".6"/>'
    + '<rect y="640" width="1600" height="360" fill="url(#floor)"/>'
    + `<g stroke="#ff5fae" stroke-width="1.6" opacity=".55">${grid}</g>`
    + `<g stroke="#ff5fae" stroke-width="1.6" opacity=".55">${rows}</g>`
    + '<rect y="636" width="1600" height="8" fill="#ff8fc8" opacity=".35"/></svg>';
}

export function snowfall() {
  const r = seeded(71);
  let flakes = "";
  for (let i = 0; i < 120; i++) flakes += `<circle cx="${Math.round(r() * 1700 - 50)}" cy="${Math.round(r() * 1000)}" r="${f1(r() * 2.4 + 0.8)}"/>`;
  const fall = (dur, dx) => `<animateTransform attributeName="transform" type="translate" from="${-dx} -1000" to="0 0" dur="${dur}s" repeatCount="indefinite"/>`;
  const layer = (op, dur, dx) => `<g fill="#fff" opacity="${op}">${fall(dur, dx)}<use href="#flakes"/><use href="#flakes" transform="translate(${dx} 1000)"/></g>`;
  const pine = (x, h) => `<path d="M${x} ${1000 - h} L${x - h * 0.28} ${1000 - h * 0.45} L${x - h * 0.14} ${1000 - h * 0.45} L${x - h * 0.34} ${1000 - h * 0.05} L${x + h * 0.34} ${1000 - h * 0.05} L${x + h * 0.14} ${1000 - h * 0.45} L${x + h * 0.28} ${1000 - h * 0.45}Z"/>`;
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2438"/><stop offset=".7" stop-color="#3b4a66"/><stop offset="1" stop-color="#5b6a84"/></linearGradient><g id="flakes">${flakes}</g></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + '<path d="M0 820 Q400 760 800 800 T1600 780 V1000 H0Z" fill="#c9d3e2"/>'
    + `<g fill="#1c2638">${pine(90, 380)}${pine(210, 280)}${pine(1380, 340)}${pine(1500, 420)}${pine(1270, 240)}</g>`
    + '<path d="M0 900 Q500 860 1000 890 T1600 880 V1000 H0Z" fill="#e6ecf4"/>'
    + `${layer(0.45, 14, 120)}${layer(0.8, 9, 60)}</svg>`;
}

export function blossom(still) {
  const r = seeded(83);
  let petals = "";
  for (let i = 0; i < 26; i++) {
    const x0 = Math.round(900 + r() * 800), dur = Math.round(14 + r() * 12), begin = -Math.round(r() * dur);
    const path = `M${x0} -40 C${x0 - 200} 250 ${x0 - 100} 500 ${x0 - 420} 760 S${x0 - 600} 1000 ${x0 - 760} 1060`;
    const fill = r() > 0.5 ? "#f2a7bd" : "#f7c6d4";
    // At rest a petal lies somewhere on its way down, tilted.
    const t = -begin / dur;
    petals += still
      ? `<ellipse cx="${Math.round(x0 - 760 * t)}" cy="${Math.round(-40 + 1100 * t)}" rx="7" ry="4.5" fill="${fill}" opacity=".9" transform="rotate(${Math.round(120 + 40 * t)} ${Math.round(x0 - 760 * t)} ${Math.round(-40 + 1100 * t)})"/>`
      : `<ellipse rx="7" ry="4.5" fill="${fill}" opacity=".9"><animateMotion path="${path}" dur="${dur}s" begin="${begin}s" rotate="auto" repeatCount="indefinite"/></ellipse>`;
  }
  let blooms = "";
  const spots = [[1290, 120], [1360, 70], [1420, 160], [1480, 100], [1530, 200], [1210, 60], [1560, 60], [1450, 240], [1320, 200], [1580, 290]];
  for (const [x, y] of spots) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      blooms += `<circle cx="${f1(x + Math.cos(a) * 9)}" cy="${f1(y + Math.sin(a) * 9)}" r="8" fill="#f5b3c6"/>`;
    }
    blooms += `<circle cx="${x}" cy="${y}" r="4" fill="#e2788f"/>`;
  }
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbeff1"/><stop offset="1" stop-color="#f6f1ea"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + '<path d="M1600 40 C1500 80 1420 110 1300 130 M1440 104 C1400 160 1380 200 1330 220 M1520 70 C1540 140 1560 220 1590 300 M1360 122 C1300 90 1240 70 1180 56" fill="none" stroke="#7a5a4a" stroke-width="7" stroke-linecap="round"/>'
    + `${blooms}`
    + '<path d="M0 930 Q400 900 800 920 T1600 910 V1000 H0Z" fill="#f1dfe2"/>'
    + `${petals}</svg>`;
}

export function terrazzo() {
  const r = seeded(97);
  const colors = ["#d98b6a", "#e6c07a", "#8fb3a4", "#c9a7c7", "#7f9cc2", "#d3cbc0", "#b9b2a6"];
  let chips = "";
  for (let i = 0; i < 130; i++) {
    const cx = r() * 1600, cy = r() * 1000, s = 4 + r() * (r() > 0.9 ? 26 : 12);
    let d = "";
    const n = 4 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.6, rr = s * (0.6 + r() * 0.5);
      d += `${k ? "L" : "M"}${Math.round(cx + Math.cos(a) * rr)} ${Math.round(cy + Math.sin(a) * rr)}`;
    }
    chips += `<path d="${d}Z" fill="${colors[i % colors.length]}" opacity="${f1(0.45 + r() * 0.4)}"/>`;
  }
  return `${OPEN}<rect width="1600" height="1000" fill="#f3eee6"/>${chips}</svg>`;
}

export function morningSea() {
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3f2"/><stop offset=".45" stop-color="#f6dcd3"/><stop offset=".6" stop-color="#fbe8cf"/></linearGradient>`
    + '<radialGradient id="sun"><stop offset="0" stop-color="#fff3d6"/><stop offset=".5" stop-color="#ffe2b0" stop-opacity=".6"/><stop offset="1" stop-color="#ffe2b0" stop-opacity="0"/></radialGradient></defs>'
    + '<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="1320" cy="590" r="170" fill="url(#sun)"/><circle cx="1320" cy="590" r="54" fill="#fff4dc"/>'
    + '<rect y="600" width="1600" height="400" fill="#bcd6e6"/>'
    + `<path d="${wave(630, 5, 400, 2400)}" fill="#b0cfe2">${slide(16)}</path>`
    + `<path d="${wave(710, 8, 400, 2400)}" fill="#a4c6dc">${slide(12)}</path>`
    + `<path d="${wave(810, 12, 400, 2400)}" fill="#96bbd4">${slide(9)}</path>`
    + `<path d="${wave(910, 16, 400, 2400)}" fill="#89b0cb">${slide(6)}</path>`
    + '<g fill="none" stroke="#6b7f94" stroke-width="2.5" stroke-linecap="round"><path d="M200 220 q14 -12 28 0 q14 -12 28 0"><animateTransform attributeName="transform" type="translate" values="0 0;30 -14;0 0" dur="9s" repeatCount="indefinite"/></path>'
    + '<path d="M270 270 q10 -9 20 0 q10 -9 20 0"><animateTransform attributeName="transform" type="translate" values="0 0;24 -10;0 0" dur="11s" repeatCount="indefinite"/></path></g>'
    + '<rect x="1240" y="612" width="160" height="3" fill="#fff4dc" opacity=".6"/><rect x="1270" y="634" width="100" height="2" fill="#fff4dc" opacity=".45"/></svg>';
}

export function clouds(still) {
  const cloud = (s) => `<g transform="scale(${s})" fill="#fff"><circle cx="0" cy="0" r="60"/><circle cx="70" cy="-20" r="75"/><circle cx="150" cy="0" r="58"/><circle cx="90" cy="25" r="55"/><circle cx="30" cy="30" r="45"/></g>`;
  // Each cloud is part way across (`begin` is negative): its resting place is there too.
  const drift = (y, s, dur, begin, op) => `<g opacity="${op}" transform="translate(${Math.round(1750 - 2150 * (-begin / dur))} ${y})"><animateTransform attributeName="transform" type="translate" from="1750 ${y}" to="-400 ${y}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${cloud(s)}</g>`;
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ccbec"/><stop offset=".7" stop-color="#d4eaf8"/><stop offset="1" stop-color="#eef6fb"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/>'
    + drift(150, 1.1, 120, -20, 0.95) + drift(90, 0.7, 150, -90, 0.8) + drift(260, 0.55, 170, -140, 0.7)
    + drift(820, 1.3, 110, -60, 0.9) + drift(900, 0.9, 140, -10, 0.85) + drift(760, 0.6, 160, -110, 0.7)
    + '</svg>';
}

export function meadow() {
  const r = seeded(107);
  let flowers = "";
  const hues = ["#f2a7bd", "#f7d36b", "#ffffff", "#c9a7e6"];
  for (let i = 0; i < 90; i++) {
    const x = Math.round(r() * 1600), y = Math.round(880 + r() * 110);
    flowers += `<circle cx="${x}" cy="${y}" r="${f1(2.5 + r() * 3)}" fill="${hues[i % 4]}"/>`;
  }
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7ebf5"/><stop offset="1" stop-color="#f4f4e6"/></linearGradient></defs>`
    + '<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="190" cy="160" r="60" fill="#fff6d8"/><circle cx="190" cy="160" r="100" fill="#fff6d8" opacity=".35"/>'
    + '<path d="M0 700 C300 620 560 680 800 660 S1300 600 1600 670 V1000 H0Z" fill="#c6dfa8"/>'
    + '<path d="M0 790 C360 720 700 790 1000 760 S1440 720 1600 760 V1000 H0Z" fill="#a9cf86"/>'
    + '<path d="M0 870 C300 830 800 880 1600 850 V1000 H0Z" fill="#8bbd6b"/>'
    + '<g fill="#6f9a52"><circle cx="1380" cy="610" r="40"/><circle cx="1410" cy="590" r="34"/><rect x="1392" y="620" width="8" height="60" fill="#6b5a44"/></g>'
    + `${flowers}</svg>`;
}

export function desertNoon() {
  return `${OPEN}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe4ef"/><stop offset=".7" stop-color="#f6ead8"/></linearGradient>`
    + '<radialGradient id="sun"><stop offset="0" stop-color="#fffaf0"/><stop offset=".4" stop-color="#fff2d6" stop-opacity=".7"/><stop offset="1" stop-color="#fff2d6" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="d1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d2a6"/><stop offset="1" stop-color="#e0b27e"/></linearGradient>'
    + '<linearGradient id="d2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ebc08a"/><stop offset="1" stop-color="#d49a62"/></linearGradient></defs>'
    + '<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="1380" cy="170" r="190" fill="url(#sun)"/><circle cx="1380" cy="170" r="50" fill="#fffaf0"/>'
    + '<path d="M0 700 C260 620 480 640 700 700 S1200 640 1600 690 V1000 H0Z" fill="url(#d1)"/>'
    + '<path d="M0 820 C300 760 560 800 840 760 C1100 720 1340 800 1600 770 V1000 H0Z" fill="url(#d2)"/>'
    + '<path d="M840 760 C1100 720 1340 800 1600 770" fill="none" stroke="#f7dcb4" stroke-width="3" opacity=".7"/>'
    + '<g fill="#7f9a6a"><rect x="190" y="700" width="18" height="110" rx="9"/><rect x="160" y="730" width="14" height="44" rx="7"/><rect x="160" y="762" width="34" height="12" rx="6"/><rect x="222" y="716" width="14" height="40" rx="7"/><rect x="200" y="748" width="36" height="12" rx="6"/></g></svg>';
}

export function contours() {
  const hills = [{ cx: 1360, cy: 200, n: 11, base: 30, step: 26, seed: 3 }, { cx: 180, cy: 840, n: 12, base: 26, step: 28, seed: 9 }, { cx: 1480, cy: 900, n: 6, base: 20, step: 24, seed: 5 }];
  let lines = "";
  for (const h of hills) {
    const r = seeded(h.seed * 101);
    const ph = [r() * 6.3, r() * 6.3, r() * 6.3];
    for (let i = 0; i < h.n; i++) {
      const rad = h.base + i * h.step;
      let d = "";
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const rr = rad * (1 + 0.12 * Math.sin(2 * a + ph[0]) + 0.08 * Math.sin(3 * a + ph[1] + i * 0.15) + 0.05 * Math.sin(5 * a + ph[2]));
        d += `${k ? "L" : "M"}${Math.round(h.cx + Math.cos(a) * rr * 1.25)} ${Math.round(h.cy + Math.sin(a) * rr)}`;
      }
      lines += `<path d="${d}Z" stroke-width="${i % 4 === 3 ? 1.8 : 1}"/>`;
    }
  }
  return `${OPEN}<rect width="1600" height="1000" fill="#f4f0e7"/><g fill="none" stroke="#b9a58a" opacity=".7">${lines}</g>`
    + '<g fill="#a08a6c" font-family="-apple-system, sans-serif" font-size="13" opacity=".6"><text x="1440" y="96">1240</text><text x="330" y="640">860</text></g></svg>';
}

// ---------------------------------------------------------------- fireworks
// Bursts laid over a scene, by SMIL like the rest. Each plays once, their
// starts a second apart, along the top above the words and at the sides.
// The scene is cropped to the window's shape about its middle, so the
// first, third and fifth sit near the middle of the top (x 600 to 1000),
// seen in a narrow window and a phone held upright. The rest are for wide
// windows. `loop` repeats it, for the preview only.
const BURSTS = [
  { x: 800, y: 80, hue: 190, at: 0, size: 120 },
  { x: 1380, y: 200, hue: 330, at: 1, size: 170 },
  { x: 640, y: 130, hue: 48, at: 2, size: 110 },
  { x: 220, y: 230, hue: 280, at: 3, size: 150 },
  { x: 960, y: 110, hue: 20, at: 4, size: 115 },
  { x: 1460, y: 540, hue: 300, at: 5, size: 130 },
];
export function fireworksLayer(mode, { loop = false } = {}) {
  const light = mode === "dark" ? 68 : 42;
  const cycle = 7;
  return BURSTS.map((b) => {
    let spokes = "";
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2, out = k % 2 ? 0.72 : 1;
      const p = (n) => n.toFixed(3);
      spokes += `<line x1="${p(Math.cos(a) * 0.18)}" y1="${p(Math.sin(a) * 0.18)}" x2="${p(Math.cos(a) * out)}" y2="${p(Math.sin(a) * out)}"/>`;
    }
    // One clock for the whole show when looping: each burst's 1.7 s sits at its own place in it.
    const t0 = b.at / cycle, t1 = (b.at + 0.2) / cycle, t2 = (b.at + 1.1) / cycle, t3 = (b.at + 1.7) / cycle;
    const timing = loop
      ? `dur="${cycle}s" repeatCount="indefinite"`
      : `dur="${cycle}s" fill="freeze"`;
    const kt = `keyTimes="0;${t0.toFixed(3)};${t1.toFixed(3)};${t2.toFixed(3)};${t3.toFixed(3)};1"`;
    return `<g transform="translate(${b.x} ${b.y}) scale(${b.size})"><g opacity="0" stroke="hsl(${b.hue},95%,${light}%)" stroke-width="${(3 / b.size).toFixed(3)}" stroke-linecap="round">`
      + `<animate attributeName="opacity" values="0;0;1;1;0;0" ${kt} ${timing}/>`
      + `<animateTransform attributeName="transform" type="scale" values="0;0;.4;1;1.12;1.12" ${kt} ${timing}/>`
      + `<circle r=".12" fill="hsl(${b.hue},100%,${light + 17}%)" stroke="none"/>${spokes}</g></g>`;
  }).join("");
}
export function withFireworks(art, mode, opts) {
  const end = art.lastIndexOf("</svg>");
  return art.slice(0, end) + fireworksLayer(mode, opts) + "</svg>";
}
export function fireworksNight(opts) {
  return `${OPEN}<defs><linearGradient id="fwsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b1c"/><stop offset="1" stop-color="#1a1436"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#fwsky)"/>${fireworksLayer("dark", opts)}</svg>`;
}
