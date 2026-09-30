import { injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserService } from './user.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { User } from '../models/user.entity.js';
import { ENV } from '../config/env.config.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';

@injectable()
export class AuthService {
  private readonly SALT_ROUNDS = 10;

  constructor(
    private userService: UserService,
    private userRepository: UserRepository
  ) {}

  public async register(email: string, username: string, plainPassword?: string, provider: string = 'local'): Promise<User> {
    await this.userService.checkUsernameAvailability(username);

    const existingEmail = await this.userRepository.findByEmail(email);
    if (existingEmail) {
      throw new Error('Email is already in use.');
    }

    const user = new User();
    user.email = email;
    user.username = username;
    user.provider = provider;
    
    if (plainPassword) {
      user.password = await bcrypt.hash(plainPassword, this.SALT_ROUNDS);
    }

    user.preferences = new Preferences();
    user.stats = new Stats();

    return this.userRepository.save(user);
  }

  public async login(email: string, plainPassword?: string): Promise<{ user: User, token: string }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    if (user.provider === 'local' && plainPassword && user.password) {
      const isPasswordValid = await bcrypt.compare(plainPassword, user.password);
      if (!isPasswordValid) {
        throw new Error('Invalid email or password.');
      }
    } else if (user.provider === 'local' && !plainPassword) {
        throw new Error('Password is required for local login.');
    }

    const token = this.generateJwt(user);
    return { user, token };
  }

  private generateJwt(user: User): string {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role
    };

    return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '7d' });
  }
}
