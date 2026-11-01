// Gloom's pets: small pixel characters that float over the desktop (main/pet.ts).
// Every pet has six loops, all the same size so swapping them never shifts it:
//   idle   its own little life: a flame that flickers, leaves that sway, a tail
//          that swishes, eyes that look around, a blink now and then
//   busy   working: hopping while thinking dots fill in (Blob types, Ember roars)
//   walk   carried sideways: a waddle, facing right (the app flips it for left)
//   fall   held in the air: feet dangling, mouth open, swaying
//   happy  under the pointer: ^^ eyes, bouncing
//   jump   clicked: a hop (played once)
// 16 px wide (the cat 22, for its tail) after the outline. Each pet is one draw
// function that takes a pose; the loops are built from it at the bottom.
// Build: npm run pets (art/build-pets.mjs), which copies the strips into
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

/** Rows above a pet: thinking dots, jumps, Ember's flame. */
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
/** Half rows (left side) to full 16 px rows, mirrored. */
const mirror = (half) => half.split("\n").map((r) => r + [...r].reverse().join("")).join("\n")
/** A patch on the left eye and its mirror on the right of a 16 px pet. */
const both = (c, x, y, g) => {
  const lines = g.split("\n")
  const w = Math.max(...lines.map((l) => l.length))
  c.grid(x, y, g)
  c.grid(16 - x - w, y, lines.map((l) => [...l.padEnd(w, ".")].reverse().join("")).join("\n"))
}

/**
 * Eyes in a pose, over the open ones the body already has. `e`: the left eye's box
 * { x, y, w, h }, the colour around it (`bg`) and its ink.
 *   shut   a line across the bottom      happy  ^ ^
 */
function eyes(c, y, e, state) {
  if (state === "open") return
  const fill = Array.from({ length: e.h }, () => e.bg.repeat(e.w)).join("\n")
  both(c, e.x, y + e.y, fill)
  if (state === "shut") both(c, e.x, y + e.y + e.h - 1, e.ink.repeat(e.w))
  if (state === "happy") both(c, e.x, y + e.y + e.h - 2, `.${e.ink}.\n${e.ink}.${e.ink}`)
}

/** Feet in a pose. `ft`: the feet's row in the body, their colour. Ghosts have none. */
function feet(c, y, ft, state) {
  if (!ft || state === "both") return
  c.hline(0, y + ft.row, 16, "_")
  const at = { left: [[2, 0]], right: [[12, 0]], dangle: [[1, 1], [13, 1]], kick: [[2, 1], [12, 1]] }[state]
  for (const [x, dy] of at) c.hline(x, y + ft.row + dy, 2, ft.color)
}

// ───────────────────────────────────────────────────────────── the pets
// Each: { w, h (body rows), top (rows above), feet, eye, mouth row, draw(c, y, o) }.
// draw paints the pet with its top at row y; o = { f, n, state: idle|busy|other,
// eyes, feet, gasp }. Pose overlays (eyes, feet, mouth) come after it.

const PETS = {}

// Blob: Codex's cloud with a prompt for a face, `>_`. Its cursor blinks; working, it types.
sprite("_blob_shape", { mx: true }, rows(body("B", "b")), grid(2, 1, "cc\nc"))
PETS.blob = {
  w: 16, h: 13, top: HEAD, feet: { row: 12, color: "B" },
  draw(c, y, o) {
    c.stamp("_blob_shape", 0, y)
    if (o.eyes === "happy") {
      both(c, 3, y + 5, ".k.\nk.k")
      c.hline(7, y + 8, 2, "k")
      return
    }
    if (o.gasp) {
      both(c, 4, y + 4, "kk\nkk")
      c.rect(7, y + 8, 2, 2, "k")
      return
    }
    c.grid(4, y + 4, "k..\n.k.\n..k\n.k.\nk..")
    if (o.state === "busy") {
      const typed = Math.min(Math.floor(o.f / 2), 3)
      for (let i = 0; i < typed; i++) c.px(8 + i * 2, y + 8, "k")
      if (o.f % 2 === 0) c.hline(8 + typed * 2, y + 8, 2, "k")
    } else if (o.f % 8 < 4) c.hline(8, y + 8, 4, "k")
  },
}

// Sprout: a seedling; its two leaves sway at rest and flap while it works.
sprite("_sprout", { mx: true }, rows(["........", "........", "......GG"], body("G", "g")), grid(3, 8, "wk\nkk"), grid(2, 10, "p"))
const LEAVES = [mirror("..lll...\n.lLLll.G\n...llLGG"), mirror("........\nllLll..G\n.lllLLGG")]
PETS.sprout = {
  w: 16, h: 16, top: HEAD, feet: { row: 15, color: "G" }, mouth: 11,
  eye: { x: 3, y: 8, w: 2, h: 2, bg: "g", ink: "k" },
  draw(c, y, o) {
    c.stamp("_sprout", 0, y)
    const down = o.state === "busy" || o.state === "other" ? o.f % 2 === 1 : o.f % 8 >= 5
    c.grid(0, y, LEAVES[down ? 1 : 0])
  },
}

// Ghost: floats up and down, its hem rippling.
sprite("_ghost", { mx: true }, rows(Array.from({ length: 11 }, (_, i) => ["....vvvv", "..vvvvvv", ".vvvvvvv", ".vvvvvvv"][i] ?? (i === 10 ? "Vvvvvvvv" : "vvvvvvvv"))), grid(2, 1, "uu\nu"), grid(3, 5, "kk\nkk"), grid(2, 7, "p"))
const HEMS = [mirror("VVvVVvvV\nV.VV..VV"), mirror("VvVVvVVv\n.VV..VV.")]
PETS.ghost = {
  w: 16, h: 13, top: HEAD, mouth: 8,
  eye: { x: 3, y: 5, w: 2, h: 2, bg: "v", ink: "k" },
  draw(c, y, o) {
    c.stamp("_ghost", 0, y)
    c.grid(0, y + 11, HEMS[Math.floor(o.f / (o.state === "idle" ? 2 : 1)) % 2])
  },
}

// Ember: a fire spirit with a flame for hair that flickers and throws sparks;
// working, it roars up taller and faster.
sprite("_ember", { mx: true }, rows(body("O", "o")), grid(3, 5, "wk\nkk"), grid(2, 7, "r"))
const flame = (c, by, f, n, power) => {
  const profile = [2, 4, 6, 8, 8, 6, 4, 2]
  for (let i = 0; i < 8; i++) {
    const flicker = Math.round(Math.sin(((f * 3) / n) * Math.PI * 2 + i * 1.7) * 1.3)
    const h = Math.max(1, Math.round(profile[i] * power) + flicker)
    for (let j = 0; j < h; j++) {
      const t = j / h
      c.px(4 + i, by - j, t > 0.72 ? "r" : i >= 2 && i <= 5 && t < 0.4 ? "Y" : "y")
    }
  }
}
PETS.ember = {
  w: 16, h: 13, top: 11, feet: { row: 12, color: "O" }, mouth: 8,
  eye: { x: 3, y: 5, w: 2, h: 2, bg: "o", ink: "k" },
  draw(c, y, o) {
    c.stamp("_ember", 0, y)
    const busy = o.state === "busy"
    flame(c, y, busy ? o.f * 2 : o.f, busy ? 8 : o.n, busy ? 1.05 : o.state === "other" ? 0.9 : 0.75)
    const step = o.f % 8
    if (o.state === "idle" && step < 5) c.px(o.f % 16 < 8 ? 6 : 10, y - 9 - step, step < 3 ? "y" : "r")
  },
}

// Cat: its tail swishes behind it and an ear flicks; working, the tail lashes.
sprite("_cat", { mx: true }, rows(["..K.....", "..qK...."], ["..KqKKKK", ...body("K", "K").slice(1)]), grid(3, 7, "ee\nek"), grid(7, 9, "p"))
const SWAY = [0, 1, 1, 1, 0, -1, -1, -1]
PETS.cat = {
  w: 20, h: 15, top: HEAD, feet: { row: 14, color: "K" }, mouth: 10,
  eye: { x: 3, y: 7, w: 2, h: 2, bg: "K", ink: "e" },
  draw(c, y, o) {
    const sway = SWAY[(o.state === "idle" ? Math.floor(o.f / 2) : o.f) % 8]
    for (const [x, ty] of [[15, 12], [16, 11], [17, 10], [17, 9], [17 + Math.sign(sway), 8], [17 + sway, 7]]) c.px(x, y + ty, "K")
    c.px(17 + sway, y + 6, "q")
    c.stamp("_cat", 0, y)
    if (o.state === "idle" && (o.f === 6 || o.f === 7)) c.grid(2, y, "_\nK")
  },
}

// Frog: its throat puffs as it breathes and its tongue flicks out; working, it hops high.
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
PETS.frog = {
  w: 16, h: 13, top: HEAD, feet: { row: 12, color: "F" },
  eye: { x: 1, y: 1, w: 3, h: 2, bg: "w", ink: "k" },
  draw(c, y, o) {
    c.stamp("_frog", 0, y)
    if (o.state !== "idle") return
    if (o.f % 8 >= 4) c.grid(0, y + 8, mirror("fhhhhhhh\nFhhhhhhh\n.Fhhhhhh"))
    if (o.f === 9 || o.f === 10) c.grid(7, y + 7, "pp\npp\n.p")
  },
  gasp: (c, y) => c.grid(5, y + 7, "kkkkkk\n.kppk."),
}

// Bot: its antenna light blinks and its eyes scan the room; working, a loading bar runs.
sprite("_bot", { mx: true }, rows([
  "........",
  ".......S",
  "..ssssss",
  ".sssssss",
  "sstttttt",
  "sttttttt",
  "sttttttt",
  "sttttttt",
  "sstttttt",
  "ssssssss",
  "Ssssssss",
  ".SSSSSSS",
  "..SS....",
]))
PETS.bot = {
  w: 16, h: 13, top: HEAD, feet: { row: 12, color: "S" },
  draw(c, y, o) {
    c.stamp("_bot", 0, y)
    const busy = o.state === "busy"
    c.hline(7, y, 2, (busy ? o.f % 2 === 0 : o.f % 4 < 2) ? "a" : "S")
    if (o.eyes === "happy") return both(c, 2, y + 5, ".n.\nn.n")
    if (o.eyes === "shut") return both(c, 3, y + 6, "nn")
    if (busy) {
      c.rect(3, y + 5, 2, 1, "n")
      c.rect(11, y + 5, 2, 1, "n")
      c.hline(2, y + 7, 12, "S")
      c.hline(2 + ((o.f * 2) % 10), y + 7, 3, "n")
      return
    }
    const look = o.state === "idle" ? (o.f >= 4 && o.f < 8 ? -1 : o.f >= 8 && o.f < 11 ? 1 : 0) : 0
    c.rect(3 + look, y + 5, 2, 2, "n")
    c.rect(11 + look, y + 5, 2, 2, "n")
    if (o.gasp) c.rect(7, y + 7, 2, 1, "n")
  },
  ownEyes: true,
}

// Owl: its pupils look one way, then the other; working, they dart about.
sprite("_owl", { mx: true }, rows([".M......", ".MM....."], ["..MmMmmm", ...body("M", "m").slice(1)]), grid(2, 4, "xxx\nxxx\nxxx"), grid(7, 7, "j"))
const DART = [0, 1, 1, -1, -1, 0, 1, -1]
PETS.owl = {
  w: 16, h: 15, top: HEAD, feet: { row: 14, color: "M" },
  eye: { x: 2, y: 4, w: 3, h: 3, bg: "x", ink: "k" },
  draw(c, y, o) {
    c.stamp("_owl", 0, y)
    if (o.eyes !== "open") return
    const dx = o.state === "busy" ? DART[o.f] : o.state === "idle" ? (o.f >= 5 && o.f < 8 ? -1 : o.f >= 8 && o.f < 11 ? 1 : 0) : 0
    c.px(3 + dx, y + 5, "k")
    c.px(12 + dx, y + 5, "k")
  },
  gasp: (c, y) => c.grid(7, y + 7, "jj\njj"),
}

// ───────────────────────────────────────────────────────────── the loops
/** Draws a pet at row y in a pose: its own draw, then eyes, feet and mouth. */
function pose(pet, c, y, o) {
  pet.draw(c, y, o)
  if (pet.eye && !pet.ownEyes) eyes(c, y, pet.eye, o.eyes)
  feet(c, y, pet.feet, o.feet ?? "both")
  if (o.gasp && !pet.ownEyes) pet.gasp ? pet.gasp(c, y) : pet.mouth !== undefined && c.rect(7, y + pet.mouth, 2, 2, "k")
}
const dots = (c, f) => {
  for (let i = 0; i < Math.floor(f / 2) % 4; i++) c.rect(3 + i * 4, 1, 2, 2, "w")
}
const hop = (f) => (f % 2 ? -1 : 0)
const blinking = (f) => f === 12 || f === 14
const float = (f, n) => Math.round(Math.sin((f / n) * Math.PI * 2))

for (const [name, pet] of Object.entries(PETS)) {
  const size = { w: pet.w, h: pet.top + pet.h + 1, outline: "k" }
  const at = pet.top
  const ghostly = name === "ghost"
  anim(name + "_idle", { ...size, frames: 16, fps: 8 }, (c) => {
    const f = c.frame
    const y = at + (ghostly ? float(f, 16) : name === "blob" && f >= 4 && f < 8 ? -1 : 0)
    pose(pet, c, y, { f, n: 16, state: "idle", eyes: blinking(f) ? "shut" : "open" })
  })
  anim(name + "_busy", { ...size, frames: 8, fps: 10 }, (c) => {
    const f = c.frame
    const y = at + (ghostly ? float(f, 8) : name === "frog" ? [0, -1, -2, -2, -1, 0, 0, 0][f] : hop(f))
    pose(pet, c, y, { f, n: 8, state: "busy", eyes: "open" })
    if (name !== "ember") dots(c, f)
  })
  // Carried sideways: a waddle, a foot at a time, bobbing (ghosts lean and float).
  anim(name + "_walk", { ...size, frames: 4, fps: 8 }, (c) => {
    const f = c.frame
    pose(pet, c, at + (f % 2 ? -1 : 0), { f, n: 4, state: "other", eyes: "open", feet: ["both", "left", "both", "right"][f] })
  })
  // Held in the air: feet kicking below it, mouth open, jiggling.
  anim(name + "_fall", { ...size, frames: 4, fps: 8 }, (c) => {
    const f = c.frame
    pose(pet, c, at + (f % 2), { f, n: 4, state: "other", eyes: "open", feet: f < 2 ? "dangle" : "kick", gasp: true })
  })
  // Under the pointer: ^^ and a bounce.
  anim(name + "_happy", { ...size, frames: 6, fps: 8 }, (c) => {
    const f = c.frame
    pose(pet, c, at + [0, -1, -2, -1, 0, 0][f], { f, n: 6, state: "other", eyes: "happy" })
  })
  // Clicked: crouch, spring up, land.
  anim(name + "_jump", { ...size, frames: 6, fps: 12, loop: false }, (c) => {
    const f = c.frame
    pose(pet, c, at + [1, -2, -4, -4, -2, 0][f], { f, n: 6, state: "other", eyes: f === 0 ? "shut" : "happy", feet: f === 0 || f === 5 ? "both" : "dangle" })
  })
}

// Review sheet (not shipped): every frame of every loop, one pet a row.
const LOOPS = [["idle", 16], ["busy", 8], ["walk", 4], ["fall", 4], ["happy", 6], ["jump", 6]]
const NAMES = Object.keys(PETS)
for (const [loop, n] of LOOPS)
  scene("lineup_" + loop, { w: n * 25 + 2, h: NAMES.length * 30 + 2, bg: "#8a8f9c" },
    ...NAMES.flatMap((name, i) => Array.from({ length: n }, (_, f) => stamp(name + "_" + loop, 2 + f * 25, 2 + i * 30, { frame: f }))))
