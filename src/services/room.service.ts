import { singleton } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { GameMode } from './matchmaking.service.js';
import { RoomStatus } from '../models/room-status.enum.js';

export const AVAILABLE_COLORS: string[] = [
  '#FF3B30', // Red
  '#007AFF', // Blue
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#AF52DE', // Purple
  '#FF9500', // Orange
  '#5AC8FA', // Cyan
  '#FF2D55', // Pink
  '#E5E5EA', // Silver
  '#1C1C1E'  // Midnight
];

export interface IRoomPlayer {
  id: string;
  username: string;
  isGuest: boolean;
  color: string;
  team?: number; // For 2v2 or 6-3v3
}

export interface IRoom {
  id: string;
  code: string;
  name: string;
  mode: GameMode;
  isPrivate: boolean;
  hostId: string;
  players: IRoomPlayer[];
  maxPlayers: number;
  status: RoomStatus;
  createdAt: Date;
}

@singleton()
export class RoomService {
  private rooms: Map<string, IRoom> = new Map();

  public generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  public getMaxPlayersForMode(mode: GameMode): number {
    switch (mode) {
      case '1v1': return 2;
      case '2v2': return 4;
      case '4-FFA': return 4;
      case '6-FFA': return 6;
      case '6-3v3': return 6;
      default: return 2;
    }
  }

  public createRoom(
    hostId: string,
    hostUsername: string,
    isGuest: boolean,
    name: string,
    mode: GameMode,
    isPrivate: boolean = false
  ): IRoom {
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    const code = this.generateRoomCode();
    const maxPlayers = this.getMaxPlayersForMode(mode);
    const initialColor = AVAILABLE_COLORS[0];

    const hostPlayer: IRoomPlayer = {
      id: hostId,
      username: hostUsername,
      isGuest,
      color: initialColor,
      team: mode === '2v2' || mode === '6-3v3' ? 1 : undefined
    };

    const room: IRoom = {
      id: roomId,
      code,
      name: name || `${hostUsername}'s Room`,
      mode,
      isPrivate,
      hostId,
      players: [hostPlayer],
      maxPlayers,
      status: RoomStatus.WAITING,
      createdAt: new Date()
    };

    this.rooms.set(roomId, room);
    return room;
  }

  public createVsAiRoom(
    hostId: string,
    hostUsername: string,
    isGuest: boolean
  ): IRoom {
    const room = this.createRoom(
      hostId,
      hostUsername,
      isGuest,
      `${hostUsername}'s Training Match`,
      '1v1' as GameMode,
      true
    );

    const botId = `bot_${uuidv4().substring(0, 6)}`;
    const usedColors = new Set(room.players.map(p => p.color));
    const availableColor = AVAILABLE_COLORS.find(c => !usedColors.has(c)) || AVAILABLE_COLORS[1];

    room.players.push({
      id: botId,
      username: '🤖 Bot AI (Training)',
      isGuest: true,
      color: availableColor
    });

    return room;
  }

  public getRoomByCode(code: string): IRoom | null {
    const cleanCode = code.trim().toUpperCase();
    for (const room of this.rooms.values()) {
      if (room.code === cleanCode) return room;
    }
    return null;
  }

  public toggleRoomPrivacy(roomId: string, hostId: string, isPrivate: boolean): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the room host can change privacy settings.');

    room.isPrivate = isPrivate;
    return room;
  }

  public cancelRoom(roomId: string, hostId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the room host can cancel the lobby.');

    this.rooms.delete(roomId);
    return true;
  }

  public getPublicRooms(): IRoom[] {
    const list: IRoom[] = [];
    for (const r of this.rooms.values()) {
      if (!r.isPrivate && r.status === RoomStatus.WAITING) {
        list.push(r);
      }
    }
    return list;
  }

  public getRoom(roomId: string): IRoom | null {
    return this.rooms.get(roomId) || null;
  }

  public joinRoom(roomId: string, userId: string, username: string, isGuest: boolean): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.status !== RoomStatus.WAITING) throw new Error('Game already in progress');
    if (room.players.length >= room.maxPlayers) throw new Error('Room is full');

    if (!room.players.some(p => p.id === userId)) {
      // Pick first available unused color
      const usedColors = new Set(room.players.map(p => p.color));
      const availableColor = AVAILABLE_COLORS.find(c => !usedColors.has(c)) || AVAILABLE_COLORS[room.players.length % AVAILABLE_COLORS.length];

      // Assign team if team mode
      let team: number | undefined;
      if (room.mode === '2v2') {
        team = room.players.length % 2 === 0 ? 1 : 2;
      } else if (room.mode === '6-3v3') {
        team = room.players.length < 3 ? 1 : 2;
      }

      room.players.push({
        id: userId,
        username,
        isGuest,
        color: availableColor,
        team
      });
    }

    return room;
  }

  public selectPlayerColor(roomId: string, userId: string, newColor: string): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    if (!AVAILABLE_COLORS.includes(newColor)) {
      throw new Error('Invalid color selected');
    }

    const isColorTaken = room.players.some(p => p.id !== userId && p.color === newColor);
    if (isColorTaken) {
      throw new Error('Color is already taken by another participant');
    }

    const player = room.players.find(p => p.id === userId);
    if (player) {
      player.color = newColor;
    }

    return room;
  }

  public leaveRoom(roomId: string, userId: string): IRoom | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.players = room.players.filter(p => p.id !== userId);

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return null;
    }

    // If host left, pass host status to next player
    if (room.hostId === userId) {
      room.hostId = room.players[0].id;
    }

    return room;
  }
}
