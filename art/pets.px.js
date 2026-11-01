// Gloom's pets: small pixel characters that float over the desktop (main/pet.ts).
// Each has two loops: _idle (breathing room, a blink now and then) and _busy
// (hopping while thinking dots fill in), both outlined, 16 px wide before the
// outline. Build: npm run pets (art/build-pets.mjs), which copies the strips into
// src/renderer/src/features/pet/sprites/.
pal({
  k: "#1b1630", w: "#fff6e0", p: "#f28fae",
  b: "#4d8bff", B: "#2a5fcc", c: "#a8caff",                      // blob
  g: "#6fd16a", G: "#2f9a4e", l: "#a5e86a", L: "#4fae3a",        // sprout
  v: "#bba8ff", V: "#7b62d6", u: "#e6deff",                      // ghost
  o: "#ff9a3c", O: "#d4552b", y: "#ffd23f", Y: "#fff3a0", r: "#ff5a3a", // ember
  K: "#5a5380", q: "#857db0", e: "#f8d84a",                      // cat
  f: "#74c74a", F: "#3f8a2e", h: "#d9f29a",                      // frog
  s: "#c9d0de", S: "#7b8499", t: "#23304d", n: "#5ff0e0", a: "#ff5d5d", // bot
  m: "#b07a4c", M: "#6e4a2f", x: "#f3dfb8", j: "#ffb43b",        // owl
})

/** Rows above the pet where the thinking dots go. */
const HEAD = 6

/** The shared body, half width (mirrored): x body, X its shade. */
const body = (X, x) => [
  "....xxxx",
  "..xxxxxx",
  ".xxxxxxx",
  ".xxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "Xxxxxxxx",
  ".XXxxxxx",
  "..XXXXXX",
  "..XX....",
].map((r) => r.replaceAll("x", x).replaceAll("X", X))

const rows = (...parts) => parts.flat().join("\n")
/** A patch for the left eye and its mirror on the right of a 16 px pet. */
const both = (x, y, g) => {
  const lines = g.split("\n")
  const w = Math.max(...lines.map((l) => l.length))
  return [grid(x, y, g), grid(16 - x - w, y, lines.map((l) => [...l.padEnd(w, ".")].reverse().join("")).join("\n"))]
}

/** A pet's two loops, from its part sprite `_<name>` (h tall) and its blink patches. */
function pet(name, h, { blink = [], idle, busy = [] } = {}) {
  const at = (y) => stamp("_" + name, 0, y)
  const dots = (n) => [0, 1, 2].slice(0, n).map((i) => rect(3 + i * 4, 1, 2, 2, "w"))
  const shut = blink.map(([x, y, g]) => both(x, y + HEAD, g)).flat()
  anim(name + "_idle", { w: 16, h: h + HEAD, outline: "k" },
    at(HEAD),
    ...(idle ?? [frame({ ms: 2000 }), frame({ ms: 120 }, ...shut), frame({ ms: 240 }), frame({ ms: 120 }, ...shut)]))
  anim(name + "_busy", { w: 16, h: h + HEAD, outline: "k" },
    ...[1, 1, 2, 2, 3, 3].map((n, i) => frame({ ms: 180 }, at(i % 2 ? HEAD - 1 : HEAD), ...busy, ...dots(n))))
}

// Blob: Codex's cloud with a prompt for a face, `>_`; its cursor blinks.
sprite("_blob_shape", { mx: true }, rows(body("B", "b")), grid(2, 1, "cc\nc"))
sprite("_blob", { w: 16, h: 13 }, stamp("_blob_shape", 0, 0), grid(4, 4, "k..\n.k.\n..k\n.k.\nk.."))
const cursor = hline(8, 8 + HEAD, 4, "k")
pet("blob", 13, {
  idle: [frame({ ms: 530 }, cursor), frame({ ms: 530 })],
  busy: [hline(8, 8 + HEAD - 1, 4, "k")],
})

// Sprout: a seedling, two leaves on its head.
sprite("_sprout", { mx: true }, rows([
  "..lll...",
  ".lLLll.G",
  "...llLGG",
], body("G", "g")), grid(3, 8, "wk\nkk"), grid(2, 10, "p"))
pet("sprout", 16, { blink: [[3, 8, "gg\nkk"]] })

// Ghost: a soft violet one, wavy at the hem.
sprite("_ghost", { mx: true }, rows([
  "....vvvv",
  "..vvvvvv",
  ".vvvvvvv",
  ".vvvvvvv",
  "vvvvvvvv",
  "vvvvvvvv",
  "vvvvvvvv",
  "vvvvvvvv",
  "vvvvvvvv",
  "vvvvvvvv",
  "Vvvvvvvv",
  "VVvVVvvV",
  "V.VV..VV",
]), grid(2, 1, "uu\nu"), grid(3, 5, "kk\nkk"), grid(2, 7, "p"))
pet("ghost", 13, { blink: [[3, 5, "vv\nkk"]] })

// Ember: a fire spirit with a flame for hair.
sprite("_ember", { mx: true }, rows([
  ".......Y",
  "......yY",
  "....r.oy",
  "....royy",
], body("O", "o")), grid(3, 9, "wk\nkk"), grid(2, 11, "r"))
pet("ember", 17, { blink: [[3, 9, "oo\nkk"]] })

// Cat: dark, ears up, yellow eyes.
sprite("_cat", { mx: true }, rows([
  "..K.....",
  "..qK....",
], ["..KqKKKK", ...body("K", "K").slice(1)]), grid(3, 7, "ee\nek"), grid(7, 9, "p"))
pet("cat", 15, { blink: [[3, 7, "KK\nee"]] })

// Frog: eyes on top, a wide smile, a pale belly.
sprite("_frog", { mx: true }, rows([
  ".FFF....",
  "FwwkF...",
  "FwkkFfff",
  ".FFfffff",
  "ffffffff",
  "ffffffff",
  "ffkfffff",
  "fffkkkkk",
  "ffhhhhhh",
  "Ffhhhhhh",
  ".FFhhhhh",
  "..FFFFFF",
  "..FF....",
]))
pet("frog", 13, { blink: [[1, 1, "FFF\nkkk"]] })

// Bot: a little screen-faced robot with an antenna.
sprite("_bot", { mx: true }, rows([
  ".......a",
  ".......S",
  "..ssssss",
  ".sssssss",
  "ssttttt t".replace(" ", ""),
  "sttttttt",
  "sttttttt",
  "sttttttt",
  "sstttttt",
  "ssssssss",
  "Ssssssss",
  ".SSSSSSS",
  "..SS....",
]), grid(3, 5, "nn\nnn"))
pet("bot", 13, { blink: [[3, 5, "tt\nnn"]] })

// Owl: ear tufts, big eyes, a little beak.
sprite("_owl", { mx: true }, rows([
  ".M......",
  ".MM.....",
], ["..MmMmmm", ...body("M", "m").slice(1)]), grid(2, 4, "xxx\nxkx\nxxx"), grid(7, 7, "j"))
pet("owl", 15, { blink: [[2, 4, "mmm\nkkk\nmmm"]] })

// Review sheet (not shipped): every pet resting (top) and busy (bottom).
const PETS = ["blob", "sprout", "ghost", "ember", "cat", "frog", "bot", "owl"]
scene("_lineup", { w: 8 * 21 + 2, h: 58, bg: "#8a8f9c" },
  ...PETS.map((n, i) => stamp(n + "_idle", 2 + i * 21, 2, { frame: 0 })),
  ...PETS.map((n, i) => stamp(n + "_busy", 2 + i * 21, 30, { frame: 5 })))
scene("lineup", { w: 8 * 21 + 2, h: 58 }, stamp("_lineup", 0, 0))
