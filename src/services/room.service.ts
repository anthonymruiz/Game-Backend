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
  '#FF9500'  // Orange
];

export interface IRoomPlayer {
  id: string;
  username: string;
  isGuest: boolean;
  isBot?: boolean;
  color: string;
  pawnColor?: string;
  pawnColorItemId?: string;
  skinItemId?: string;
  skinIcon?: string;
  skinName?: { en: string; es: string };
  skinAllowsColor?: boolean;
  movementTrailId?: string;
  movementTrailIcon?: string;
  wallEffectId?: string;
  wallEffectIcon?: string;
  team?: number;
  avatarUrl?: string;
  provider?: string;
  wins?: number;
}

export interface IRoom {
  id: string;
  code: string;
  name: string;
  mode: GameMode;
  isPrivate: boolean;
  isQuickMatch?: boolean;
  isRanked?: boolean;
  rankKey?: string;
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
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
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
      case 'labyrinth': return 6;
      default: return 2;
    }
  }

  public createRoom(
    hostId: string,
    hostUsername: string,
    isGuest: boolean,
    name: string,
    mode: GameMode,
    isPrivate: boolean = false,
    avatarUrl?: string,
    provider?: string,
    wins: number = 0,
    isQuickMatch: boolean = false,
    isRanked: boolean = false,
    rankKey?: string
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
      team: mode === '2v2' ? 1 : undefined,
      avatarUrl,
      provider,
      wins
    };

    const room: IRoom = {
      id: roomId,
      code,
      name: name || `${hostUsername}'s Room`,
      mode,
      isPrivate,
      isQuickMatch,
      isRanked,
      rankKey,
      hostId,
      players: [hostPlayer],
      maxPlayers,
      status: RoomStatus.WAITING,
      createdAt: new Date()
    };

    this.rooms.set(roomId, room);
    return room;
  }

  public recreatePrivateLobbyRoom(
    oldRoom: IRoom,
    endPlayers: IRoomPlayer[]
  ): IRoom | null {
    if (oldRoom && oldRoom.id) {
      this.rooms.delete(oldRoom.id);
    }

    if (!oldRoom || !oldRoom.isPrivate) {
      return null;
    }

    if (oldRoom.mode !== '2v2' && oldRoom.mode !== '4-FFA' && oldRoom.mode !== '6-FFA' && oldRoom.mode !== 'labyrinth') {
      return null;
    }

    const humanPlayers = (endPlayers || []).filter(p => p && p.id && !p.id.startsWith('bot_'));
    if (humanPlayers.length < 2) {
      return null;
    }

    const botPlayers = (endPlayers || []).filter(p => p && p.id && p.id.startsWith('bot_'));

    const host = humanPlayers.find(p => p.id === oldRoom?.hostId) || humanPlayers[0];
    const newRoom = this.createRoom(
      host.id,
      host.username,
      host.isGuest,
      oldRoom?.name || `Sala de ${host.username}`,
      oldRoom?.mode || '1v1',
      true,
      host.avatarUrl,
      host.provider
    );

    for (const p of humanPlayers) {
      if (p.id !== host.id) {
        this.joinRoom(newRoom.id, p.id, p.username, p.isGuest, p.avatarUrl, p.provider);
      }
    }

    // Re-add bots if any were present in the previous match and mode supports bots
    if (newRoom.mode === '4-FFA' || newRoom.mode === '6-FFA' || newRoom.mode === '2v2' || newRoom.mode === 'labyrinth') {
      for (const _ of botPlayers) {
        if (newRoom.players.length < newRoom.maxPlayers) {
          try {
            this.addBotToCustomRoom(newRoom.id, host.id);
          } catch (e) {}
        }
      }
    }

    return newRoom;
  }

  public getBotNameForColor(colorHex: string): string {
    if (!colorHex) return 'BOT';
    const c = colorHex.toUpperCase();
    let colorName = '';

    if (c === '#007AFF' || c === '#3B82F6') colorName = 'BLUE';
    else if (c === '#FF3B30' || c === '#EF4444') colorName = 'RED';
    else if (c === '#FFCC00' || c === '#F59E0B') colorName = 'YELLOW';
    else if (c === '#34C759' || c === '#10B981') colorName = 'GREEN';
    else if (c === '#AF52DE' || c === '#8B5CF6') colorName = 'PURPLE';
    else if (c === '#FF9500' || c === '#F97316') colorName = 'ORANGE';
    else if (c === '#5AC8FA' || c === '#06B6D4') colorName = 'CYAN';
    else if (c === '#FF2D55' || c === '#EC4899') colorName = 'PINK';
    else if (c === '#E5E5EA' || c === '#94A3B8') colorName = 'SILVER';
    else if (c === '#1C1C1E' || c === '#1E293B') colorName = 'BLACK';
    else colorName = c;

    return `BOT - ${colorName}`;
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
      username: this.getBotNameForColor(availableColor),
      isGuest: true,
      color: availableColor
    });

    return room;
  }

  public addBotToCustomRoom(roomId: string, hostId: string): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the room host can add bots.');
    if (room.mode !== '4-FFA' && room.mode !== '6-FFA' && room.mode !== '2v2' && room.mode !== 'labyrinth') {
      throw new Error('Bots are allowed in 2v2, 4-FFA, 6-FFA or Labyrinth modes.');
    }
    if (room.players.length >= room.maxPlayers) throw new Error('Room is full');

    const botId = `bot_${uuidv4().substring(0, 6)}`;

    let assignedColor = '';
    let team: number | undefined = undefined;

    if (room.mode === '2v2') {
      const redHex = AVAILABLE_COLORS[0];
      const blueHex = AVAILABLE_COLORS[1];
      const redCount = room.players.filter(p => p.color && p.color.toUpperCase() === redHex.toUpperCase()).length;
      const blueCount = room.players.filter(p => p.color && p.color.toUpperCase() === blueHex.toUpperCase()).length;

      if (redCount < 2) {
        assignedColor = redHex;
        team = 1;
      } else if (blueCount < 2) {
        assignedColor = blueHex;
        team = 2;
      } else {
        assignedColor = '';
        team = undefined;
      }
    } else {
      const usedColors = new Set(room.players.map(p => p.color ? p.color.toUpperCase() : ''));
      assignedColor = AVAILABLE_COLORS.find(c => !usedColors.has(c.toUpperCase())) || '';
    }

    room.players.push({
      id: botId,
      username: this.getBotNameForColor(assignedColor),
      isGuest: true,
      color: assignedColor,
      team
    });

    return room;
  }

  public removeBotFromCustomRoom(roomId: string, hostId: string, botId: string): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the room host can remove bots.');

    room.players = room.players.filter(p => p.id !== botId);
    return room;
  }

  public kickPlayerFromCustomRoom(roomId: string, hostId: string, targetPlayerId: string): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the room host can kick players.');
    if (targetPlayerId === hostId) throw new Error('Host cannot kick themselves.');

    const playerToKick = room.players.find(p => p.id === targetPlayerId);
    if (!playerToKick) throw new Error('Player not found in room.');

    room.players = room.players.filter(p => p.id !== targetPlayerId);
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

  public deleteRoom(roomId: string): boolean {
    if (!roomId) return false;
    return this.rooms.delete(roomId);
  }



  public getAllRooms(): IRoom[] {
    return Array.from(this.rooms.values());
  }

  public getPublicRooms(): IRoom[] {
    const list: IRoom[] = [];
    for (const r of this.rooms.values()) {
      if (!r.isPrivate && r.status === RoomStatus.WAITING && r.players.length < r.maxPlayers) {
        list.push(r);
      }
    }
    return list;
  }

  public getRoom(roomId: string): IRoom | null {
    return this.rooms.get(roomId) || null;
  }

  public findQuickMatchRoom(mode: GameMode, isRanked: boolean, rankKey?: string): IRoom | undefined {
    return this.getPublicRooms().find(room =>
      room.isQuickMatch === true &&
      room.mode === mode &&
      !!room.isRanked === isRanked &&
      (!isRanked || (!!rankKey && room.rankKey === rankKey))
    );
  }

  public joinRoom(
    roomId: string,
    userId: string,
    username: string,
    isGuest: boolean,
    avatarUrl?: string,
    provider?: string,
    wins: number = 0
  ): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.status !== RoomStatus.WAITING) throw new Error('Game already in progress');
    if (room.players.length >= room.maxPlayers) throw new Error('Room is full');

    if (!room.players.some(p => p.id === userId)) {
      let assignedColor = '';
      let team: number | undefined = undefined;

      if (room.mode === '2v2') {
        const redHex = AVAILABLE_COLORS[0];
        const blueHex = AVAILABLE_COLORS[1];
        const redCount = room.players.filter(p => p.color && p.color.toUpperCase() === redHex.toUpperCase()).length;
        const blueCount = room.players.filter(p => p.color && p.color.toUpperCase() === blueHex.toUpperCase()).length;

        if (redCount <= blueCount && redCount < 2) {
          assignedColor = redHex;
          team = 1;
        } else if (blueCount < 2) {
          assignedColor = blueHex;
          team = 2;
        } else if (redCount < 2) {
          assignedColor = redHex;
          team = 1;
        } else {
          assignedColor = '';
          team = undefined;
        }
      } else {
        const usedColors = new Set(room.players.map(p => p.color ? p.color.toUpperCase() : ''));
        assignedColor = AVAILABLE_COLORS.find(c => !usedColors.has(c.toUpperCase())) || '';
      }

      room.players.push({
        id: userId,
        username,
        isGuest,
        color: assignedColor,
        team,
        avatarUrl,
        provider,
        wins
      });
    }

    return room;
  }

  public selectPlayerColor(roomId: string, userId: string, newColor: string, targetUserId?: string): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    const effectiveUserId = (targetUserId && targetUserId.startsWith('bot_')) ? targetUserId : userId;
    if (effectiveUserId !== userId && room.hostId !== userId) {
      throw new Error('Only the room host can change a bot\'s color.');
    }

    const player = room.players.find(p => p.id === effectiveUserId);
    if (!player) throw new Error('Player not found in room');

    if (!newColor || typeof newColor !== 'string' || newColor.trim() === '' || newColor === 'null' || newColor === 'none') {
      player.color = '';
      player.team = undefined;
      return room;
    }

    const normalizedColor = newColor.trim().toUpperCase();
    const isValidColor = AVAILABLE_COLORS.some(c => c.toUpperCase() === normalizedColor);
    if (!isValidColor) {
      throw new Error('Invalid color selected');
    }

    const maxPlayersPerColor = (room.mode === '2v2') ? 2 : 1;
    const usersWithColor = room.players.filter(p => p.id !== effectiveUserId && p.color && p.color.toUpperCase() === normalizedColor).length;

    if (usersWithColor >= maxPlayersPerColor) {
      throw new Error('Color is already taken by the maximum number of participants');
    }

    player.color = newColor;

    if (player.id.startsWith('bot_')) {
      player.username = this.getBotNameForColor(newColor);
    }

    if (room.mode === '2v2') {
      const redHex = AVAILABLE_COLORS[0].toUpperCase();
      player.team = normalizedColor === redHex ? 1 : 2;
    }

    return room;
  }

  public setPlayerCosmetic(roomId: string, userId: string, category: string, itemId: string | null, value?: string, allowColor = false, name?: { en: string; es: string }): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.status !== RoomStatus.WAITING) throw new Error('Cosmetics can only be changed before the game starts');
    const player = room.players.find(p => p.id === userId);
    if (!player) throw new Error('Player not in room');

    switch (category) {
      case 'PAWN_COLOR':
        if (room.mode === '2v2' && itemId) {
          throw new Error('Premium pawn colors are not available in 2v2 mode');
        }
        player.pawnColorItemId = itemId || undefined;
        player.pawnColor = itemId ? value : undefined;
        break;
      case 'PAWN_SKIN':
        player.skinItemId = itemId || undefined;
        player.skinIcon = itemId ? value : undefined;
        player.skinName = itemId ? name : undefined;
        player.skinAllowsColor = itemId ? allowColor : undefined;
        break;
      default:
        throw new Error('Unsupported lobby cosmetic category');
    }
    return room;
  }

  public switchTeam(roomId: string, userId: string): IRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.mode !== '2v2') throw new Error('Team switching is only supported in team modes');

    const player = room.players.find(p => p.id === userId);
    if (!player) throw new Error('Player not in room');

    const currentTeam = player.team || 1;
    const targetTeam = currentTeam === 1 ? 2 : 1;
    const maxTeamSize = room.maxPlayers / 2;

    const targetTeamCount = room.players.filter(p => p.team === targetTeam).length;
    if (targetTeamCount >= maxTeamSize) {
      throw new Error('Target team is full');
    }

    player.team = targetTeam;

    // Sync color with new teammate if exists
    const teammate = room.players.find(p => p.id !== userId && p.team === targetTeam);
    if (teammate) {
      player.color = teammate.color;
    }

    return room;
  }

  constructor() {
    // Automatic Room Garbage Collection every 20 seconds
    const timer = setInterval(() => {
      this.cleanupAbandonedRooms();
    }, 20000);
    if (timer.unref) timer.unref();
  }

  public cleanupAbandonedRooms(): void {
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      const realHumans = room.players.filter(p => !p.id.startsWith('bot_'));
      if (room.players.length === 0 || realHumans.length === 0) {
        console.log(`[ROOM GC] Auto-deleting empty room ${roomId}`);
        this.rooms.delete(roomId);
        continue;
      }
      // Clean up rooms waiting for more than 20 minutes
      if (room.status === RoomStatus.WAITING && (now - new Date(room.createdAt).getTime()) > 20 * 60 * 1000) {
        console.log(`[ROOM GC] Auto-deleting stale unstarted room ${roomId}`);
        this.rooms.delete(roomId);
      }
    }
  }

  public leaveRoom(roomId: string, userId: string): IRoom | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.players = room.players.filter(p => p.id !== userId);
    const realHumans = room.players.filter(p => !p.id.startsWith('bot_'));

    if (room.players.length === 0 || realHumans.length === 0) {
      this.rooms.delete(roomId);
      return null;
    }

    // If host left, pass host status to next human player
    if (room.hostId === userId) {
      room.hostId = realHumans[0].id;
    }

    return room;
  }

  public getUserRoom(userId: string): IRoom | null {
    if (!userId) return null;
    let activeGameRoom: IRoom | null = null;
    let quickMatchRoom: IRoom | null = null;
    let fallbackRoom: IRoom | null = null;

    for (const room of this.rooms.values()) {
      if (!room.players.some(p => p.id === userId)) continue;
      if (room.status === RoomStatus.PLAYING) {
        if (!activeGameRoom || new Date(room.createdAt).getTime() > new Date(activeGameRoom.createdAt).getTime()) {
          activeGameRoom = room;
        }
      } else if (room.status === RoomStatus.WAITING) {
        if (room.isQuickMatch) {
          quickMatchRoom = room;
        } else {
          fallbackRoom = room;
        }
      }
    }

    return activeGameRoom || quickMatchRoom || fallbackRoom;
  }

  public findRoomByUserId(userId: string): IRoom | null {
    return this.getUserRoom(userId);
  }
}
