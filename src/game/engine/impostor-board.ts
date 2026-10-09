import { ImpostorBoardBase } from './impostor-board-base.js';

export {
  ImpostorBoardBase,
  type IImpostorExit,
  type IImpostorGhostPickup,
  type IImpostorKey,
  type IImpostorShieldPickup,
  type IImpostorTeleport,
  type IImpostorTrap,
  type ImpostorTrapType
} from './impostor-board-base.js';

export class ImpostorBoard extends ImpostorBoardBase {}
