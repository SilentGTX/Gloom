// The composer's height: the transcript keeps that much clear under its last
// row. The composer sets it on the chat as --composer-space for CSS, and here
// for the transcript's scroll handler, which would otherwise ask for computed
// styles on every scroll event.
let space = 0

export const composerSpace = (): number => space

export function setComposerSpace(px: number): void {
  space = px
}
