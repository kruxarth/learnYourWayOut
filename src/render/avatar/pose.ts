/** Mutable per-avatar animation state. The owner (Bean, a remote player, a ghost) writes it; `Avatar` reads it each frame. */
export interface AvatarPose {
  /** Spring offset: scale is (1 - s/2, 1 + s, 1 - s/2). */
  squash: number;
  /** Forward lean in radians (positive leans toward -Z). Also drives the stride length. */
  lean: number;
  /** Side-to-side waddle rotation about Z, radians. */
  waddle: number;
  /** Fake-ragdoll spin angle and the horizontal axis it spins about. */
  spinAngle: number;
  spinAxisX: number;
  spinAxisZ: number;
  /** Eye scale in Y: 1 open, 0.1 closed. */
  blink: number;
  /** Foot cycle phase in radians. */
  footPhase: number;
}

export const MAX_LEAN = 0.18;

export function makePose(): AvatarPose {
  return { squash: 0, lean: 0, waddle: 0, spinAngle: 0, spinAxisX: 1, spinAxisZ: 0, blink: 1, footPhase: 0 };
}
