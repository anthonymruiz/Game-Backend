import { injectable, container } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository.js';
import { User } from '../models/user.entity.js';
import { isValidUsernameFormat, isValidEmailFormat } from '../utils/regex.util.js';

@injectable()
export class UserService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = container.resolve(UserRepository);
  }

  public async checkUsernameAvailability(username: string): Promise<boolean> {
    if (!username || !isValidUsernameFormat(username)) {
      throw new Error('Username must be 3 to 20 alphanumeric characters with no spaces or special characters.');
    }

    const existingUser = await this.userRepository.findByUsername(username);
    if (existingUser) {
      throw new Error('Username is already taken.');
    }

    return true;
  }

  public async checkEmailAvailability(email: string): Promise<boolean> {
    if (!email || !isValidEmailFormat(email)) {
      throw new Error('Invalid email format.');
    }

    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new Error('Email is already in use.');
    }

    return true;
  }

  public async setUsername(userId: string, username: string): Promise<User> {
    await this.checkUsernameAvailability(username);

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.username = username.trim();
    user.hasUsernameSet = true;
    return this.userRepository.save(user);
  }

  public async getLeaderboard(limit: number = 100) {
    const users = await this.userRepository.getTopPlayers(limit);
    return users.map((user, index) => {
      const stats = user.stats || { wins: 0, losses: 0, draws: 0, elo: 1000 };
      const wins = stats.wins || 0;
      const losses = stats.losses || 0;
      const draws = stats.draws || 0;
      const totalGames = wins + losses + draws;
      const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

      let tier = 'BRONZE';
      if (winRate >= 75 && totalGames >= 5) tier = 'DIAMOND';
      else if (winRate >= 60) tier = 'GOLD';
      else if (winRate >= 40) tier = 'SILVER';

      let level = 'Principiante';
      if (totalGames >= 50) level = 'Avanzado';
      else if (totalGames >= 10) level = 'Intermedio';

      return {
        rank: index + 1,
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        wins,
        losses,
        draws,
        totalGames,
        winRate,
        elo: stats.elo || 1000,
        tier,
        level
      };
    });
  }
}
