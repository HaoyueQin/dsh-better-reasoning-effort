/**
 * Shared vitest setup, applied to every test file after its environment is
 * established.
 *
 * jsdom implements no canvas: every `getContext('2d')` call prints a
 * "Not implemented" error to the console before answering null. The
 * ComposerSlider's radiation effect already treats a null context as "draw
 * nothing" (the reduced-motion degradation path), so stubbing the method to
 * answer null up front keeps that exact path under test without one noise
 * line per mounted slider.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
}
