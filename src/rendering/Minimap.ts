/**
 * Minimap overlay — a small top-right canvas schematic so the player can orient
 * on the big BSP floor. PURE RENDER: reads game state, mutates nothing, adds no
 * game state.
 *
 * The floor layout is static per floor, so the schematic (corridors + rooms) is
 * drawn ONCE into an offscreen canvas on floor-change (detected by a seed change
 * — covers ?debug G-regenerate and, later, descent). Per frame the visible
 * canvas just blits that cached layer and stamps the current-room highlight +
 * the player dot — no per-frame layout work or allocation.
 *
 * The footprint is read from the live `room.solid` (always the actual floor);
 * the room RECTS (for the brighter room fills + current-room highlight) come from
 * the pure, deterministic `generateDungeon(seed)` — the same seed the floor was
 * built from, so it matches exactly. Nothing here writes game state.
 */

import { generateDungeon, type Rect } from '../game/Dungeon';
import type { GameState } from '../game/GameState';
import { MINIMAP } from '../utils/constants';
import { lerp } from '../utils/math';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D;
  private readonly dpr: number;

  private builtSeed = Number.NaN;
  private rooms: Rect[] = [];
  private tileSize = 1;
  private scale = 1; // CSS px per tile
  private originX = 0; // centring offset, CSS px
  private originY = 0;

  constructor(container: HTMLElement) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = this.makeCanvas();
    this.canvas.className = 'minimap';
    container.appendChild(this.canvas);
    this.ctx = get2d(this.canvas);
    this.ctx.scale(this.dpr, this.dpr);

    this.staticCanvas = this.makeCanvas();
    this.staticCtx = get2d(this.staticCanvas);
    this.staticCtx.scale(this.dpr, this.dpr);
  }

  private makeCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = MINIMAP.size * this.dpr;
    c.height = MINIMAP.size * this.dpr;
    c.style.width = `${MINIMAP.size}px`;
    c.style.height = `${MINIMAP.size}px`;
    return c;
  }

  /** Draw the minimap for this frame. `alpha` interpolates the player dot like
   *  the rest of the renderers. Rebuilds the static layer when the floor changes. */
  update(state: GameState, alpha: number): void {
    if (state.seed !== this.builtSeed) this.rebuild(state);
    this.draw(state, alpha);
  }

  /** Redraw the static floor layer (corridors + rooms). Floor-change only. */
  private rebuild(state: GameState): void {
    const room = state.room;
    this.tileSize = room.tileSize;
    const inner = MINIMAP.size - MINIMAP.padding * 2;
    this.scale = Math.min(inner / room.tilesX, inner / room.tilesY);
    this.originX = (MINIMAP.size - room.tilesX * this.scale) / 2;
    this.originY = (MINIMAP.size - room.tilesY * this.scale) / 2;
    // Deterministic regeneration of the same seed yields the same rooms as the
    // live floor — read-only, used only for the rect metadata.
    this.rooms = generateDungeon(state.seed).rooms;

    const g = this.staticCtx;
    const s = this.scale;
    g.clearRect(0, 0, MINIMAP.size, MINIMAP.size);
    g.fillStyle = MINIMAP.colors.bg;
    g.fillRect(0, 0, MINIMAP.size, MINIMAP.size);

    // Walkable footprint (rooms + corridors) from the ACTUAL floor grid.
    g.fillStyle = MINIMAP.colors.corridor;
    for (let ty = 0; ty < room.tilesY; ty++) {
      for (let tx = 0; tx < room.tilesX; tx++) {
        if (!room.solid[ty * room.tilesX + tx]) {
          g.fillRect(this.originX + tx * s, this.originY + ty * s, s + 0.5, s + 0.5);
        }
      }
    }
    // Rooms brighter on top.
    g.fillStyle = MINIMAP.colors.room;
    for (const r of this.rooms) {
      g.fillRect(this.originX + r.x * s, this.originY + r.y * s, r.w * s, r.h * s);
    }

    // Border (painted from the constant so CSS stays colour-literal-free).
    g.strokeStyle = MINIMAP.colors.border;
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, MINIMAP.size - 1, MINIMAP.size - 1);

    this.builtSeed = state.seed;
  }

  /** Per-frame: blit the cached floor, highlight the current room, stamp the dot. */
  private draw(state: GameState, alpha: number): void {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.clearRect(0, 0, MINIMAP.size, MINIMAP.size);
    ctx.drawImage(this.staticCanvas, 0, 0, MINIMAP.size, MINIMAP.size);

    const p = state.player;
    const wx = lerp(p.prevX, p.x, alpha);
    const wy = lerp(p.prevY, p.y, alpha);
    const tx = wx / this.tileSize;
    const ty = wy / this.tileSize;

    // Current-room highlight (read-only containment test).
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    for (const r of this.rooms) {
      if (tileX >= r.x && tileX < r.x + r.w && tileY >= r.y && tileY < r.y + r.h) {
        ctx.fillStyle = MINIMAP.colors.currentRoom;
        ctx.fillRect(this.originX + r.x * s, this.originY + r.y * s, r.w * s, r.h * s);
        break;
      }
    }

    // Player dot.
    ctx.fillStyle = MINIMAP.colors.player;
    ctx.beginPath();
    ctx.arc(this.originX + tx * s, this.originY + ty * s, MINIMAP.dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('minimap: 2D canvas context unavailable');
  return ctx;
}
