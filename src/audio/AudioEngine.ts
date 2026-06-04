/**
 * Synthesized audio engine (combat-core SFX). Per CLAUDE.md, ALL sound is
 * generated with the Web Audio API — there are no audio files, ever.
 *
 * Lifecycle: the AudioContext is created lazily (`init`) and resumed on the
 * first user gesture (`resume`) per browser autoplay policy (wired in main.ts).
 * Until it's running, `play()` is a no-op.
 *
 * Voices are short synth one-shots routed through a master GainNode (the mute
 * switch). Two timbre families map to the verb language: bright square/triangle
 * BLIPS for player ACTIONS (shoot/swing/dash) and noise-burst + low-sine THUDS
 * for CONTACT (hit/death/hurt); the dodge-negate is an airy "whiff". Per-trigger
 * pitch/gain jitter keeps repeats from grating; a voice cap + same-type coalesce
 * keep a multi-kill frame from clipping. This layer reads nothing from the sim.
 */

import { AUDIO } from '../utils/constants';

/** The discrete SFX events the AudioManager can request (decoupling seam: the
 *  manager diffs game state and calls play(trigger); tests pass a mock sink). */
export type SfxTrigger = 'shoot' | 'swing' | 'dash' | 'hit' | 'death' | 'hurt' | 'dodge';

/** Minimal sink the AudioManager depends on — so it's unit-testable with a mock
 *  (assert the triggers, not the actual sound). */
export interface SfxSink {
  play(trigger: SfxTrigger): void;
}

/** Semitone ratio: multiply a frequency to shift it by `n` semitones. */
const semis = (n: number): number => Math.pow(2, n / 12);

export class AudioEngine implements SfxSink {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  /** Live one-shot voices (for the cap) + last-played time per type (coalesce). */
  private voices = 0;
  private readonly lastPlayed: Partial<Record<SfxTrigger, number>> = {};
  /** Output-layer jitter source (LCG). Math/random in the sim is forbidden; this
   *  lives in the OUTPUT layer and never touches game state, so it's fine. */
  private seed = 0x9e3779b9;

  /** Create (or reuse) the AudioContext + master gain. Safe before any gesture. */
  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : AUDIO.master;
    this.master.connect(this.ctx.destination);
  }

  /** Resume the context after a user gesture (required by autoplay policy). */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** Flip mute on the master bus (voices keep routing; they're silenced). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : AUDIO.master;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Cheap LCG jitter in [-1, 1) — output-layer only (not the sim RNG). */
  private jitter(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return (this.seed / 0xffffffff) * 2 - 1;
  }

  /** Play one SFX. No-op before the context is running, when muted, when the
   *  voice cap is hit, or when the same type just played (coalesce). */
  play(trigger: SfxTrigger): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.muted) return;

    const now = ctx.currentTime;
    const last = this.lastPlayed[trigger];
    if (last !== undefined && now - last < AUDIO.coalesceSec) return; // coalesce
    if (this.voices >= AUDIO.voiceCap) return; // burst safety
    this.lastPlayed[trigger] = now;

    switch (trigger) {
      case 'shoot':
        this.blip(AUDIO.blip.shoot, now);
        break;
      case 'swing':
        this.blip(AUDIO.blip.swing, now);
        break;
      case 'dash':
        this.blip(AUDIO.blip.dash, now);
        break;
      case 'hit':
        this.impact(AUDIO.impact.hit.sineFreq, AUDIO.impact.hit.noiseGain, AUDIO.impact.hit.sineGain, AUDIO.impact.decay, now);
        break;
      case 'death':
        this.impact(AUDIO.impact.death.sineFreq, AUDIO.impact.death.noiseGain, AUDIO.impact.death.sineGain, AUDIO.impact.death.decay, now);
        break;
      case 'hurt':
        this.impact(AUDIO.impact.hurt.sineFreq, AUDIO.impact.hurt.noiseGain, AUDIO.impact.hurt.sineGain, AUDIO.impact.hurt.decay, now);
        break;
      case 'dodge':
        this.whiff(now);
        break;
    }
  }

  /** Track a voice against the cap, and stop it at `stopAt`. */
  private spend(node: AudioScheduledSourceNode, stopAt: number): void {
    this.voices++;
    node.addEventListener('ended', () => {
      this.voices--;
    });
    node.stop(stopAt);
  }

  /** A bright square/triangle action blip with a short AD envelope + jitter. An
   *  optional `cutoff` inserts a low-pass (used by SHOOT to tame its harsh upper
   *  harmonics); voices without it route straight to master, unchanged. */
  private blip(
    cfg: { freq: number; type: OscillatorType; gain: number; cutoff?: number },
    now: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = cfg.type;
    osc.frequency.value = cfg.freq * semis(this.jitter() * AUDIO.pitchJitterSemis);
    const g = ctx.createGain();
    const peak = cfg.gain * (1 + this.jitter() * AUDIO.gainJitter);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + AUDIO.blip.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + AUDIO.blip.attack + AUDIO.blip.decay);
    if (cfg.cutoff !== undefined) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cfg.cutoff;
      osc.connect(lp).connect(g).connect(this.master!);
    } else {
      osc.connect(g).connect(this.master!);
    }
    osc.start(now);
    this.spend(osc, now + AUDIO.blip.attack + AUDIO.blip.decay + AUDIO.voiceStopPad);
  }

  /** A contact thud: white-noise burst + low sine body, fast decay. */
  private impact(sineFreq: number, noiseGain: number, sineGain: number, decay: number, now: number): void {
    const ctx = this.ctx!;
    const end = now + AUDIO.impact.attack + decay;
    const pitch = semis(this.jitter() * AUDIO.pitchJitterSemis);
    const gainVar = 1 + this.jitter() * AUDIO.gainJitter;

    // Noise burst (short white-noise buffer).
    const frames = Math.max(1, Math.floor(ctx.sampleRate * decay));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = this.jitter();
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(noiseGain * gainVar, now + AUDIO.impact.attack);
    ng.gain.exponentialRampToValueAtTime(0.0001, end);
    noise.connect(ng).connect(this.master!);
    noise.start(now);
    this.spend(noise, end + AUDIO.voiceStopPad);

    // Low sine body.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = sineFreq * pitch;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.linearRampToValueAtTime(sineGain * gainVar, now + AUDIO.impact.attack);
    sg.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(sg).connect(this.master!);
    osc.start(now);
    this.spend(osc, end + AUDIO.voiceStopPad);
  }

  /** Dodge-negate: an airy low-passed down-chirp (you AVOIDED the hit). */
  private whiff(now: number): void {
    const ctx = this.ctx!;
    const w = AUDIO.whiff;
    const end = now + w.decay;
    const osc = ctx.createOscillator();
    osc.type = w.type;
    osc.frequency.setValueAtTime(w.freqStart * semis(this.jitter() * AUDIO.pitchJitterSemis), now);
    osc.frequency.exponentialRampToValueAtTime(w.freqEnd, end);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = w.cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(w.gain * (1 + this.jitter() * AUDIO.gainJitter), now);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(now);
    this.spend(osc, end + AUDIO.voiceStopPad);
  }
}
