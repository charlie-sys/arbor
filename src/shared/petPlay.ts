import type { PetWindowBounds } from './pet'

export type PetSkillId = 'zoomies' | 'fetch' | 'dash'

export const PET_ACTOR_WIDTH = 200
export const PET_ACTOR_HEIGHT = 230

export interface PetStageState {
  bounds: PetWindowBounds
  xRatio: number
  yRatio: number
  actorWidth: number
  actorHeight: number
}
