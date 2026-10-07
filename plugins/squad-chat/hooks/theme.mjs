// squad-chat's look: one accent, the person's own theme for everything else
// (theme keys follow light and dark themes), and a fixed set of name colors
// picked to read on both.

export const theme = {
  accent: "#A78BFA",       // brand violet: title, active tab, you, focused input, "new"
  onAccent: "#1C1730",     // text drawn on the accent
  border: "inactive",      // card borders
  muted: "subtle",         // meta text: times, counts, hints
  online: "success",
  warn: "warning",
  error: "error",
};

const NAME_COLORS = ["#38BDF8", "#F472B6", "#34D399", "#F59E0B", "#FB923C", "#60A5FA", "#E879F9", "#2DD4BF"];

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
  prompt: "›",
  rule: "─",
  bar: "│",
};
