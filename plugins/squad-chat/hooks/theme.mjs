// squad-chat's look: a warm "classic" palette (coral accent, amber, sky, leaf
// green on the terminal's own background), with grey card borders and meta
// text from the person's theme. Fixed hex colors, so the accents read the
// same in every theme.

export const theme = {
  accent: "#D97757",       // coral: title, active tab, you, focused input, "new"
  onAccent: "#1F1E1D",     // text drawn on the accent
  amber: "#E2B86B",        // secondary highlight: unread badges, the band's "new"
  sky: "#7FB6E2",          // informational dots
  you: "#7FB6E2",          // your name: set apart from your coral bubbles
  online: "#6CC070",       // online, live
  // Message bubbles: fixed text and fill, so they read in light and dark themes.
  mineBubble: "#D97757",
  mineText: "#1F1E1D",
  theirBubble: "#3A3836",
  theirText: "#ECE7E1",
  border: "inactive",      // card borders
  muted: "subtle",         // meta text: times, counts, hints
  warn: "#E2B86B",
  error: "#E06C75",
};

// Warm, distinct name colors for friends. Sky blue is kept for "you", and
// coral for your bubbles, so neither appears here.
const NAME_COLORS = ["#E2B86B", "#6CC070", "#C8A2E0", "#E58FA8", "#6FC2B5", "#D9A877", "#B8C46A", "#D4A5A5"];

// The same person always gets the same color, in every pane.
export function nameColor(userId = "") {
  let h = 0;
  for (const ch of String(userId)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

export const glyph = {
  brand: "◆",
  on: "●",
  off: "○",
  busy: "◐",
  quiet: "🔕",
  prompt: "›",
  rule: "─",
  bar: "│",
  typing: "✎",
};
