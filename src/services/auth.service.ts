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
import { UserRole } from '../models/user-role.enum.js';

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
    if (!email || !username || (!plainPassword && provider === 'local')) {
      throw new Error('Email, username, and password are required for registration.');
    }
    await this.userService.checkEmailAvailability(email);
    await this.userService.checkUsernameAvailability(username);

    const user = new User();
    user.email = email.trim().toLowerCase();
    user.username = username.trim();
    user.provider = provider;
    user.hasUsernameSet = true;
    
    if (plainPassword) {
      if (plainPassword.length < 6) {
        throw new Error('Password must be at least 6 characters long.');
      }
      user.password = await bcrypt.hash(plainPassword, this.SALT_ROUNDS);
    }

    user.preferences = new Preferences();
    user.stats = new Stats();

    return this.userRepository.save(user);
  }

  public async login(emailOrUsername: string, plainPassword?: string): Promise<{ user: User; token: string }> {
    let user = await this.userRepository.findByEmail(emailOrUsername.trim().toLowerCase());
    if (!user) {
      user = await this.userRepository.findByUsername(emailOrUsername.trim());
    }

    if (!user) {
      throw new Error('Invalid credentials.');
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned. Please contact support.');
    }

    if (user.provider === 'local' && plainPassword && user.password) {
      const isPasswordValid = await bcrypt.compare(plainPassword, user.password);
      if (!isPasswordValid) {
        throw new Error('Invalid credentials.');
      }
    } else if (user.provider === 'local' && !plainPassword) {
      throw new Error('Password is required for local login.');
    }

    const token = this.generateJwt(user);
    return { user, token };
  }

  public generateJwt(user: User): string {
    const payload = {
      id: user.id,
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      hasUsernameSet: user.hasUsernameSet
    };

    return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '7d' });
  }

  public async loginWithSocialProvider(provider: 'google' | 'facebook', token: string): Promise<{ user: User; jwtToken: string; isNewUser: boolean }> {
    let email: string;
    let socialName: string = '';

    if (provider === 'google') {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error('Invalid Google Token');
      email = payload.email;
      socialName = payload.name || '';
    } else if (provider === 'facebook') {
      const { data } = await axios.get(`https://graph.facebook.com/me?fields=id,name,email&access_token=${token}`);
      if (!data || !data.email) throw new Error('Invalid Facebook Token');
      email = data.email;
      socialName = data.name || '';
    } else {
      throw new Error('Unsupported provider');
    }

    let isNewUser = false;
    let user = await this.userRepository.findByEmail(email.toLowerCase());
    
    if (!user) {
      isNewUser = true;
      user = new User();
      user.email = email.toLowerCase();
      // Generate a temporary unique username if social user hasn't set one yet
      const tempSuffix = Math.floor(1000 + Math.random() * 9000);
      user.username = `user${tempSuffix}`;
      user.provider = provider;
      user.hasUsernameSet = false; // Mark that user must set their username
      user.preferences = new Preferences();
      user.stats = new Stats();
      user = await this.userRepository.save(user);
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned.');
    }

    const jwtToken = this.generateJwt(user);
    return { user, jwtToken, isNewUser };
  }
}
