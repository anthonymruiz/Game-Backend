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
    public isHorizontal: boolean
  ) {}
}

export class Player {
  public startX: number;
  public startY: number;

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
    startY?: number
  ) {
    this.startX = startX ?? x;
    this.startY = startY ?? y;
  }
}

export class Boost {
  constructor(
    public id: string,
    public type: 'extra_wall' | 'extra_turn',
    public x: number,
    public y: number
  ) {}
}
