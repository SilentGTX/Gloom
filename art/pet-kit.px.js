// Gloom's pet kit, for pxl (github.com/crsolver/claude-pxl): what every Gloom pet
// is built from. A pet is one draw function that paints it in a pose; the kit
// turns it into the six loops Gloom plays, all the same size so swapping them
// never shifts the pet:
//   idle   its own little life (a flicker, a sway, a glance), a blink now and then
//   busy   working: at a desk, typing on a laptop (desk: its row; paw: colour)
//   walk   carried sideways: a waddle, facing right (Gloom flips it for left)
//   fall   held in the air: feet kicking, mouth open
//   happy  under the pointer: ^^ eyes, bouncing
//   jump   clicked: crouch, spring up, land (played once)
//
// Use it from a pet's file:
//   include("pet-kit.px.js")
//   pal({ ...your colours })            // k (outline), w (white) and p (pink) are here already
//   sprite("_mypet", { mx: true }, ...) // the pet at rest, eyes open, 16 px wide
//   definePet("mypet", { w: 16, h: 13, top: HEAD, feet: { row: 12, color: "X" },
//     eye: { x: 3, y: 5, w: 2, h: 2, bg: "x", ink: "k" }, mouth: 8,
//     draw(c, y, o) { c.stamp("_mypet", 0, y) /* plus its own idle life from o.f */ } })
//
// Keys k, w, p, D, d, Q and z are the kit's (outline, white, pink, desk, laptop).
// draw(c, y, o) paints the pet with its top at row y. o.f is the frame, o.n the
// loop's length, o.state "idle" | "busy" | "other", o.eyes "open" | "shut" |
// "happy", o.gasp true when its mouth should be open. The kit then draws the
// eyes (from `eye`), the feet (from `feet`) and the open mouth (at `mouth`)
// for the pose, unless the pet sets ownEyes and draws them itself.
pal({
  k: "#1b1630", w: "#fff6e0", p: "#f28fae",
  D: "#c98a4b", d: "#8a5330", Q: "#c9ccd6", z: "#9aa0b4",   // the desk and laptop the pet works at
})

/** Rows above a pet: thinking dots, jumps, a flame. */
var HEAD = 6

/** The shared round body, half width (mirror it with mx): x body, X its shade. 13 rows; feet on row 12. */
function body(X, x) {
  return [
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
}

function rows(...parts) {
  return parts.flat().join("\n")
}
/** Half rows (left side) to full 16 px rows, mirrored. */
function mirror(half) {
  return half.split("\n").map((r) => r + [...r].reverse().join("")).join("\n")
}
/** A patch on the left eye and its mirror on the right of a 16 px pet. */
function both(c, x, y, g) {
  const lines = g.split("\n")
  const w = Math.max(...lines.map((l) => l.length))
  c.grid(x, y, g)
  c.grid(16 - x - w, y, lines.map((l) => [...l.padEnd(w, ".")].reverse().join("")).join("\n"))
}

/** Eyes in a pose over the open ones: shut is a line across the bottom, happy is ^ ^. */
function petEyes(c, y, e, state) {
  if (state === "open") return
  both(c, e.x, y + e.y, Array.from({ length: e.h }, () => e.bg.repeat(e.w)).join("\n"))
  if (state === "shut") both(c, e.x, y + e.y + e.h - 1, e.ink.repeat(e.w))
  if (state === "happy") both(c, e.x, y + e.y + e.h - 2, `.${e.ink}.\n${e.ink}.${e.ink}`)
}

/** Feet in a pose: both down, one at a time (walking), dangling or kicking (held up). */
function petFeet(c, y, ft, state) {
  if (!ft || state === "both") return
  c.hline(0, y + ft.row, 16, "_")
  const at = { left: [[2, 0]], right: [[12, 0]], dangle: [[1, 1], [13, 1]], kick: [[2, 1], [12, 1]] }[state]
  for (const [x, dy] of at) c.hline(x, y + ft.row + dy, 2, ft.color)
}

/** A pet in a pose: its own draw, then eyes, feet and mouth. */
function petPose(pet, c, y, o) {
  pet.draw(c, y, o)
  if (pet.eye && !pet.ownEyes) petEyes(c, y, pet.eye, o.eyes)
  petFeet(c, y, pet.feet, o.feet ?? "both")
  if (o.gasp && !pet.ownEyes) {
    if (pet.gasp) pet.gasp(c, y)
    else if (pet.mouth !== undefined) c.rect(7, y + pet.mouth, 2, 2, "k")
  }
}

/** Thinking dots above the head, filling in over the working loop: none, one, two, three. */
function thinkingDots(c, f) {
  for (let i = 0; i < Math.floor(f / 2) % 4; i++) c.rect(3 + i * 4, 1, 2, 2, "w")
}

/**
 * The desk a pet works at, in front of it (row `top` of the canvas is the desk's
 * surface): a laptop seen from behind, its logo glowing, and the pet's paws
 * typing on the desk, one then the other.
 */
function desk(c, top, f, paw) {
  c.rect(0, top + 1, 16, c.h - top - 1, "d")
  c.hline(0, top, 16, "D")
  c.rect(5, top - 4, 6, 4, "Q")
  c.hline(5, top - 1, 6, "z")
  c.px(7 + (f % 4 < 2 ? 0 : 1), top - 3, "w")
  c.hline(2, top - (f % 2 ? 1 : 0), 2, paw)
  c.hline(12, top - (f % 2 ? 0 : 1), 2, paw)
}

/**
 * The six loops of a pet, as anims `<name>_idle`, `_busy`, `_walk`, `_fall`,
 * `_happy`, `_jump`, and a review scene `<name>_sheet` with every frame.
 * pet: { w (16, or wider for a tail), h (body rows), top (rows above, HEAD or
 * more), feet?, eye?, mouth?, ownEyes?, gasp?(c, y), draw(c, y, o),
 * bob?(f, n, state) → extra rows down (negative: up), dots?: false }.
 */
function definePet(name, pet) {
  const size = { w: pet.w, h: pet.top + pet.h + 1, outline: "k" }
  const at = pet.top
  const bob = pet.bob ?? (() => 0)
  const blinking = (f) => f === 12 || f === 14
  anim(name + "_idle", { ...size, frames: 16, fps: 8 }, (c) => {
    const f = c.frame
    petPose(pet, c, at + bob(f, 16, "idle"), { f, n: 16, state: "idle", eyes: blinking(f) ? "shut" : "open" })
  })
  // Working, as Codex's pets do: at a desk, typing on a laptop.
  anim(name + "_busy", { ...size, frames: 8, fps: 10 }, (c) => {
    const f = c.frame
    // Sitting up behind the desk, so its face shows over the laptop.
    petPose(pet, c, at - 4, { f, n: 8, state: "busy", eyes: "open" })
    desk(c, at + (pet.desk ?? pet.h - 2), f, pet.paw ?? pet.feet?.color ?? "k")
  })
  anim(name + "_walk", { ...size, frames: 4, fps: 8 }, (c) => {
    const f = c.frame
    petPose(pet, c, at + (f % 2 ? -1 : 0), { f, n: 4, state: "other", eyes: "open", feet: ["both", "left", "both", "right"][f] })
  })
  anim(name + "_fall", { ...size, frames: 4, fps: 8 }, (c) => {
    const f = c.frame
    petPose(pet, c, at + (f % 2), { f, n: 4, state: "other", eyes: "open", feet: f < 2 ? "dangle" : "kick", gasp: true })
  })
  anim(name + "_happy", { ...size, frames: 6, fps: 8 }, (c) => {
    const f = c.frame
    petPose(pet, c, at + [0, -1, -2, -1, 0, 0][f], { f, n: 6, state: "other", eyes: "happy" })
  })
  anim(name + "_jump", { ...size, frames: 6, fps: 12, loop: false }, (c) => {
    const f = c.frame
    petPose(pet, c, at + [1, -2, -4, -4, -2, 0][f], { f, n: 6, state: "other", eyes: f === 0 ? "shut" : "happy", feet: f === 0 || f === 5 ? "both" : "dangle" })
  })
  const loops = [["idle", 16], ["busy", 8], ["walk", 4], ["fall", 4], ["happy", 6], ["jump", 6]]
  const cw = size.w + 4, ch = size.h + 4
  scene(name + "_sheet", { w: 16 * cw + 2, h: loops.length * ch + 2, bg: "#8a8f9c" },
    ...loops.flatMap(([loop, n], r) => Array.from({ length: n }, (_, f) => stamp(name + "_" + loop, 2 + f * cw, 2 + r * ch, { frame: f }))))
}
