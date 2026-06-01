/**
 * Synthesized audio engine — STUB for Phase 0.
 *
 * Per CLAUDE.md, all sound is generated with the Web Audio API; there are no
 * audio files, ever. This phase only wires up the AudioContext lifecycle
 * (lazily created, resumed on first user gesture per browser autoplay policy).
 * The actual synth voices (footsteps, hits, ambience) arrive in a later phase.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;

  /** Create (or reuse) the AudioContext. Safe to call before any gesture. */
  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
  }

  /** Resume the context after a user gesture (required by autoplay policy). */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }
}
