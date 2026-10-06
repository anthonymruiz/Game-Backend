export interface Coordinate {
  x: number;
  y: number;
}

export class Cell {
  constructor(
    public x: number,
    public y: number,
    public hasPlayer: string | null = null,
    public hasBoost: string | null = null
  ) {}
}

export class Wall {
  constructor(
    public id: string,
    public ownerId: string,
    public x: number,
    public y: number,
    public isHorizontal: boolean,
    public wallEffectId?: string,
    public wallEffectIcon?: string,
    public isPrisonBlock: boolean = false,
    public isSabotageWall: boolean = false,
    public isRescueWall: boolean = false
  ) {}
}

export class Player {
  public startX: number;
  public startY: number;
  public isDead: boolean = false;
  public hasReachedGoal: boolean = false;
  public hasKillerItem: boolean = false;
  public hasExchangeItem: boolean = false;
  public ghostTurnsRemaining: number = 0;
  public ghostModeExpiresAt: number = 0;
  public isInPrison: boolean = false;
  public hasMazeKey: boolean = false;
  public hasMazeKeyDelivered: boolean = false;
  public hasMazeEscaped: boolean = false;
  public mazeFrozenUntil: number = 0;
  public mazeShieldExpiresAt: number = 0;

  constructor(
    public id: string,
    public username: string,
    public isGuest: boolean = false,
    public x: number,
    public y: number,
    public targetY?: number, // Target row to win (if vertical goal)
    public targetX?: number, // Target column to win (if horizontal goal)
    public wallsLeft: number = 10,
    public strikes: number = 0,
    public color: string = '#3b82f6',
    public team?: number,
    startX?: number,
    startY?: number,
    public avatarUrl?: string,
    public provider?: string,
    public pawnColor?: string,
    public pawnColorItemId?: string,
    public skinItemId?: string,
    public skinIcon?: string,
    public skinAllowsColor?: boolean,
    public movementTrailId?: string,
    public movementTrailIcon?: string,
    public wallEffectId?: string,
    public wallEffectIcon?: string
  ) {
    this.startX = startX ?? x;
    this.startY = startY ?? y;
  }
}

export class Boost {
  constructor(
    public id: string,
    public type: 'wall_pickup' | 'portal' | 'extra_wall' | 'killer_item' | 'exchange_item' | 'ghost',
    public x: number,
    public y: number,
    public targetX?: number,
    public targetY?: number
  ) {}
}
