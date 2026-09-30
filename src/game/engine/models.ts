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
  constructor(
    public id: string,
    public username: string,
    public x: number,
    public y: number,
    public targetY: number, // Target row to win
    public wallsLeft: number = 10,
    public strikes: number = 0,
    public color: string = 'red'
  ) {}
}

export class Boost {
  constructor(
    public id: string,
    public type: 'extra_wall' | 'extra_turn',
    public x: number,
    public y: number
  ) {}
}
