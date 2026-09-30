import { injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { UserService } from './user.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { User } from '../models/user.entity.js';
import { ENV } from '../config/env.config.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';

@injectable()
export class AuthService {
  private readonly SALT_ROUNDS = 10;
  private googleClient: OAuth2Client;

  constructor(
    private userService: UserService,
    private userRepository: UserRepository
  ) {
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '');
  }

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

  public async loginWithSocialProvider(provider: 'google' | 'facebook', token: string): Promise<{ user: User, jwtToken: string }> {
    let email: string;
    let username: string;

    if (provider === 'google') {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error('Invalid Google Token');
      email = payload.email;
      username = payload.name?.replace(/\s+/g, '_').toLowerCase() || email.split('@')[0];
    } else if (provider === 'facebook') {
      const { data } = await axios.get(`https://graph.facebook.com/me?fields=id,name,email&access_token=${token}`);
      if (!data || !data.email) throw new Error('Invalid Facebook Token');
      email = data.email;
      username = data.name.replace(/\s+/g, '_').toLowerCase();
    } else {
      throw new Error('Unsupported provider');
    }

    let user = await this.userRepository.findByEmail(email);
    if (!user) {
      user = new User();
      user.email = email;
      user.username = username + '_' + Math.floor(Math.random() * 1000);
      user.provider = provider;
      user.preferences = new Preferences();
      user.stats = new Stats();
      user = await this.userRepository.save(user);
    }

    const jwtToken = this.generateJwt(user);
    return { user, jwtToken };
  }
}
