import { describe, expect, it } from 'vitest';
import { AudioManager, type AudioView } from '../AudioManager';
import type { SfxSink, SfxTrigger } from '../AudioEngine';

/** Records the triggers requested — asserts the DIFF logic, not the sound. */
class MockSink implements SfxSink {
  readonly calls: SfxTrigger[] = [];
  play(t: SfxTrigger): void {
    this.calls.push(t);
  }
}

type PlayerPart = Partial<AudioView['player']>;
const player = (o: PlayerPart = {}): AudioView['player'] => ({
  meleeAnimTimer: 0,
  dashTimer: 0,
  hitFlashTimer: 0,
  dodgeFxTimer: 0,
  ...o,
});
/** Build a one-enemy, one-projectile view (the common case for these tests). */
const view = (o: {
  seed?: number;
  player?: PlayerPart;
  enemyActive?: boolean;
  enemyFlash?: number;
  projActive?: boolean;
}): AudioView => ({
  seed: o.seed ?? 1,
  player: player(o.player),
  enemies: [{ active: o.enemyActive ?? true, flashTimer: o.enemyFlash ?? 0 }],
  projectiles: [{ active: o.projActive ?? false }],
});

describe('AudioManager — rising-edge detection', () => {
  it('fires each event ONCE on its rising edge, not on steady state', () => {
    const sink = new MockSink();
    const mgr = new AudioManager(sink, view({})); // enemy active, all timers 0

    // enemy hit: flash 0 -> >0 fires once; staying >0 does NOT re-fire.
    mgr.sync(view({ enemyFlash: 0.08 }));
    mgr.sync(view({ enemyFlash: 0.05 }));
    expect(sink.calls.filter((c) => c === 'hit')).toHaveLength(1);

    // swing / dash / dodge / hurt: 0 -> >0 each fire once.
    sink.calls.length = 0;
    mgr.sync(view({ player: { meleeAnimTimer: 0.1 } }));
    mgr.sync(view({ player: { dashTimer: 0.2 } }));
    mgr.sync(view({ player: { dodgeFxTimer: 0.2 } }));
    mgr.sync(view({ player: { hitFlashTimer: 0.1 } }));
    expect(sink.calls).toEqual(['swing', 'dash', 'dodge', 'hurt']);
  });

  it('fires shoot on a projectile going active, and death on active->false', () => {
    const sink = new MockSink();
    const mgr = new AudioManager(sink, view({ enemyActive: true, projActive: false }));
    mgr.sync(view({ projActive: true })); // shot fired
    expect(sink.calls).toContain('shoot');

    sink.calls.length = 0;
    mgr.sync(view({ enemyActive: false, projActive: true })); // enemy died
    expect(sink.calls).toContain('death');
    mgr.sync(view({ enemyActive: false, projActive: true })); // steady — no repeat
    expect(sink.calls.filter((c) => c === 'death')).toHaveLength(1);
  });
});

describe('AudioManager — FLOOR-RESET GUARD (the key regression)', () => {
  it('suppresses hit/death/hurt on the seed-change frame, and the NEXT frame fires no phantom', () => {
    const sink = new MockSink();
    const mgr = new AudioManager(sink, view({ enemyActive: true, enemyFlash: 0 }));

    // Floor reset: seed changes AND loadFloor deactivates the enemy + a flash edge.
    mgr.sync(view({ seed: 2, enemyActive: false, enemyFlash: 0.08 }));
    expect(sink.calls).toEqual([]); // NO death/hit burst on the reset frame

    // Next frame, same (new) seed, enemy still inactive -> prev was refreshed, so
    // NO phantom one-frame-late death.
    mgr.sync(view({ seed: 2, enemyActive: false, enemyFlash: 0 }));
    expect(sink.calls).toEqual([]);

    // ...and normal detection is RESTORED after the reset: a fresh enemy that
    // spawns then takes a hit fires normally.
    mgr.sync(view({ seed: 2, enemyActive: true, enemyFlash: 0 })); // spawn (no contact edge)
    mgr.sync(view({ seed: 2, enemyActive: true, enemyFlash: 0.08 })); // real hit
    expect(sink.calls).toEqual(['hit']);
  });
});

describe('AudioManager — mute', () => {
  it('stops all triggers while muted, and resumes after unmute', () => {
    const sink = new MockSink();
    const mgr = new AudioManager(sink, view({ enemyActive: true, enemyFlash: 0 }));

    mgr.setMuted(true);
    mgr.sync(view({ enemyFlash: 0.08 })); // would be a hit
    expect(sink.calls).toEqual([]);

    // Unmute, then a fresh rising edge fires again (prev was kept up to date
    // while muted, so we need a genuine 0->>0 edge).
    mgr.setMuted(false);
    mgr.sync(view({ enemyFlash: 0 })); // reset the flash baseline (no edge)
    mgr.sync(view({ enemyFlash: 0.08 })); // real edge
    expect(sink.calls).toEqual(['hit']);
  });
});
