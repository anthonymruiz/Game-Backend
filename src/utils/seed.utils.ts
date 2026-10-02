import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Report } from '../models/report.entity.js';
import { UserRole } from '../models/user-role.enum.js';

export async function seedSuperAdmin(): Promise<void> {
  try {
    const userRepo = AppDataSource.getRepository(User);
    
    // Check if superAdmin user "admin" already exists
    const existingAdmin = await userRepo.findOne({
      where: [{ username: 'admin' }, { role: UserRole.SUPERADMIN }]
    });

    if (!existingAdmin) {
      console.log('[SEED] Creating default superAdmin user ("admin" / "admin")...');
      
      const hashedPassword = await bcrypt.hash('admin', 10);
      
      const superAdmin = new User();
      superAdmin.username = 'admin';
      superAdmin.email = 'admin@gamename.com';
      superAdmin.password = hashedPassword;
      superAdmin.role = UserRole.SUPERADMIN;
      superAdmin.provider = 'local';
      superAdmin.hasUsernameSet = true;
      superAdmin.preferences = new Preferences();
      superAdmin.stats = new Stats();

      await userRepo.save(superAdmin);
      console.log('[SEED] Default SuperAdmin created successfully!');
    } else {
      console.log('[SEED] SuperAdmin already exists.');
    }
  } catch (error) {
    console.error('[SEED] Error seeding SuperAdmin:', error);
  }
}

export async function seedLeaderboardUsers(): Promise<void> {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const testUserExists = await userRepo.findOne({ where: { username: 'VortexMaster' } });

    if (!testUserExists) {
      console.log('[SEED] Seeding 15 leaderboard test users...');
      const hashedPassword = await bcrypt.hash('password123', 10);

      const mockUsers = [
        { username: 'VortexMaster', wins: 142, losses: 18, draws: 5, elo: 2450, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Vortex' },
        { username: 'ShadowStriker', wins: 128, losses: 22, draws: 3, elo: 2310, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Shadow' },
        { username: 'ApexLegend', wins: 115, losses: 30, draws: 8, elo: 2180, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Apex' },
        { username: 'CyberKnight', wins: 98, losses: 25, draws: 4, elo: 2050, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Cyber' },
        { username: 'NeonSpectre', wins: 87, losses: 35, draws: 6, elo: 1940, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Neon' },
        { username: 'PixelKing', wins: 76, losses: 29, draws: 2, elo: 1860, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Pixel' },
        { username: 'TitanBrawler', wins: 69, losses: 41, draws: 7, elo: 1750, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Titan' },
        { username: 'QuantumGhost', wins: 58, losses: 33, draws: 4, elo: 1680, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Quantum' },
        { username: 'EchoSniper', wins: 50, losses: 40, draws: 1, elo: 1590, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Echo' },
        { username: 'ZeroAbsolute', wins: 44, losses: 38, draws: 5, elo: 1510, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zero' },
        { username: 'NovaBlade', wins: 38, losses: 42, draws: 3, elo: 1420, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nova' },
        { username: 'StormRider', wins: 29, losses: 35, draws: 2, elo: 1350, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Storm' },
        { username: 'AlphaOmega', wins: 22, losses: 28, draws: 4, elo: 1280, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alpha' },
        { username: 'BlazeInferno', wins: 15, losses: 20, draws: 1, elo: 1190, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Blaze' },
        { username: 'RookieChamp', wins: 8, losses: 12, draws: 0, elo: 1080, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Rookie' }
      ];

      for (const m of mockUsers) {
        const u = new User();
        u.username = m.username;
        u.email = `${m.username.toLowerCase()}@gamename.com`;
        u.password = hashedPassword;
        u.role = UserRole.USER;
        u.provider = 'local';
        u.hasUsernameSet = true;
        u.avatarUrl = m.avatarUrl;
        u.preferences = new Preferences();

        const stats = new Stats();
        stats.wins = m.wins;
        stats.losses = m.losses;
        stats.draws = m.draws;
        stats.elo = m.elo;
        u.stats = stats;

        await userRepo.save(u);
      }
      console.log('[SEED] ✅ 15 Leaderboard test users created successfully!');
    }
  } catch (error) {
    console.error('[SEED] Error seeding leaderboard users:', error);
  }
}

export async function seedSystemSettings(): Promise<void> {
  try {
    const { SystemSettings } = await import('../models/system-settings.entity.js');
    const settingsRepo = AppDataSource.getRepository(SystemSettings);
    const existing = await settingsRepo.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!existing) {
      console.log('[SEED] Creating default SystemSettings record...');
      const s = new SystemSettings();
      s.maintenanceMode = false;
      s.turnTimeLimitSeconds = 30;
      s.maxStrikesBeforeKick = 3;
      s.allowNewRegistrations = true;
      s.announcementBanner = '';
      await settingsRepo.save(s);
      console.log('[SEED] ✅ Default SystemSettings created successfully!');
    }
  } catch (error) {
    console.error('[SEED] Error seeding SystemSettings:', error);
  }
}

export async function seedReports(): Promise<void> {
  try {
    const { Report } = await import('../models/report.entity.js');
    const reportRepo = AppDataSource.getRepository(Report);
    const userRepo = AppDataSource.getRepository(User);

    const existingCount = await reportRepo.count();
    if (existingCount < 5) {
      console.log('[SEED] Seeding realistic test reports...');
      const users = await userRepo.find({ take: 15 });
      if (users.length >= 2) {
        const u1 = users[0];
        const u2 = users[1];
        const u3 = users[2] || users[0];
        const u4 = users[3] || users[1];
        const u5 = users[4] || users[0];
        const u6 = users[5] || users[1];

        const mockReports = [
          {
            category: 'griefing',
            details: 'Bloqueó intencionalmente el paso con muros infinitos durante la partida clasificatoria.',
            status: 'pending',
            reporter: u1,
            reportedUser: u2
          },
          {
            category: 'afk',
            details: 'Se desconectó a la mitad del turno impidiendo continuar el juego por más de 5 minutos.',
            status: 'pending',
            reporter: u3,
            reportedUser: u4
          },
          {
            category: 'macro',
            details: 'Movimientos instantáneos sospechosos en menos de 10ms por turno (posible bot/macro).',
            status: 'pending',
            reporter: u5,
            reportedUser: u2
          },
          {
            category: 'chat',
            details: 'Uso de lenguaje inapropiado y ofensas en el chat global del lobby.',
            status: 'resolved',
            reporter: u1,
            reportedUser: u6
          },
          {
            category: 'timer',
            details: 'Retención constante de turnos consumiendo hasta el último segundo del temporizador.',
            status: 'pending',
            reporter: u4,
            reportedUser: u3
          },
          {
            category: 'griefing',
            details: 'Intento de encerrar al rival en una esquina rompiendo las reglas del camino mínimo.',
            status: 'pending',
            reporter: u2,
            reportedUser: u5
          },
          {
            category: 'afk',
            details: 'Inactividad prolongada en partida de 4 jugadores sin ceder el turno.',
            status: 'pending',
            reporter: u6,
            reportedUser: u4
          },
          {
            category: 'chat',
            details: 'Comentarios antideportivos repetidos tras finalizar el juego.',
            status: 'resolved',
            reporter: u3,
            reportedUser: u1
          }
        ];

        for (const rData of mockReports) {
          const r = new Report();
          r.category = rData.category as any;
          r.details = rData.details;
          r.status = rData.status as any;
          r.reporter = rData.reporter;
          r.reportedUser = rData.reportedUser;
          r.reporterId = rData.reporter.id;
          r.reportedUserId = rData.reportedUser.id;
          await reportRepo.save(r);
        }
        console.log('[SEED] ✅ 8 Realistic test reports created successfully!');
      }
    }
  } catch (error) {
    console.error('[SEED] Error seeding test reports:', error);
  }
}

export async function seedMatchHistory(): Promise<void> {
  try {
    const matchHistoryRepo = AppDataSource.getRepository(MatchHistory);
    const userRepo = AppDataSource.getRepository(User);

    const existingCount = await matchHistoryRepo.count();
    if (existingCount < 5) {
      console.log('[SEED] Seeding realistic match history...');
      const users = await userRepo.find({ take: 10 });
      if (users.length >= 2) {
        const mockMatches = [
          { mode: '1v1', result: 'win', opp: users[1].username, elo: 15, duration: 185 },
          { mode: '1v1', result: 'loss', opp: users[0].username, elo: -10, duration: 240 },
          { mode: '4way', result: 'win', opp: 'Arena Global 4P', elo: 25, duration: 420 },
          { mode: '2v2', result: 'win', opp: 'Equipo Rojo', elo: 18, duration: 310 },
          { mode: '1v1', result: 'win', opp: users[2]?.username || 'ShadowStriker', elo: 15, duration: 150 },
          { mode: 'vs_ai', result: 'win', opp: 'Bot Entrenador', elo: 0, duration: 95 },
          { mode: '4way', result: 'loss', opp: 'Arena Global 4P', elo: -8, duration: 380 },
          { mode: '1v1', result: 'draw', opp: users[3]?.username || 'ApexLegend', elo: 0, duration: 300 }
        ];

        let index = 1000;
        for (const m of mockMatches) {
          index++;
          const history = new MatchHistory();
          history.user = users[index % users.length];
          history.userId = users[index % users.length].id;
          history.matchId = `MATCH_${index}_${Date.now()}`;
          history.mode = m.mode;
          history.result = m.result;
          history.opponentUsername = m.opp;
          history.eloChange = m.elo;
          history.durationSeconds = m.duration;
          await matchHistoryRepo.save(history);
        }
        console.log('[SEED] ✅ Match history seeded successfully!');
      }
    }
  } catch (error) {
    console.error('[SEED] Error seeding match history:', error);
  }
}


