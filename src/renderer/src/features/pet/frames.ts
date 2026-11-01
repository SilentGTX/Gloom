// Which frame of a pet's loop comes next. A loop may have an intro that plays
// once (a laptop appearing, say): after the last frame it starts again from
// loopFrom, not from the first.

/** The frame after `at` in a loop of `length` frames, going back to `loopFrom` (else 0) after the last. */
export function nextFrame(at: number, length: number, loopFrom?: number): number {
  if (at + 1 < length) return at + 1
  return loopFrom !== undefined && loopFrom > 0 && loopFrom < length ? loopFrom : 0
}
