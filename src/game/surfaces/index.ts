import type { WorldId } from '../themes';
import { BubbleSurface } from './bubble';
import { GrassSurface } from './grass';
import { IceSurface } from './ice';
import { JellySurface } from './jelly';
import { KalimbaSurface } from './kalimba';
import { KeyboardSurface } from './keyboard';
import { LeavesSurface } from './leaves';
import { PopitSurface } from './popit';
import { SandSurface } from './sand';
import { SnowSurface } from './snow';
import type { Surface, SurfaceCtx } from './Surface';

export type { HitEvent, Surface } from './Surface';

const CTORS: Record<WorldId, new (ctx: SurfaceCtx) => Surface> = {
  bubble: BubbleSurface,
  grass: GrassSurface,
  snow: SnowSurface,
  leaves: LeavesSurface,
  sand: SandSurface,
  jelly: JellySurface,
  popit: PopitSurface,
  ice: IceSurface,
  kalimba: KalimbaSurface,
  keyboard: KeyboardSurface,
};

export function createSurface(world: WorldId, ctx: SurfaceCtx): Surface {
  return new CTORS[world](ctx).init();
}
