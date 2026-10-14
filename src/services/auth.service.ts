import { injectable, container } from 'tsyringe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { UserService } from './user.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { User } from '../models/user.entity.js';
import { ENV } from '../config/env.config.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
import { UserRole } from '../models/user-role.enum.js';
import { isValidEmailFormat, isValidUsernameFormat } from '../utils/regex.util.js';

@injectable()
export class AuthService {
  private readonly SALT_ROUNDS = 10;
  private googleClient: OAuth2Client;
  private userService: UserService;
  private userRepository: UserRepository;

  constructor() {
    this.userService = container.resolve(UserService);
    this.userRepository = container.resolve(UserRepository);
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '');
  }

  public async register(email: string, username: string, plainPassword?: string, provider: string = 'local'): Promise<User> {
    const { SystemSettingsService } = await import('./system-settings.service.js');
    const settingsService = container.resolve(SystemSettingsService);
    const settings = await settingsService.getSettings();
    if (!settings.allowNewRegistrations) {
      throw new Error('New registrations are currently disabled by system administrator.');
    }

    if (!email || !username || (!plainPassword && provider === 'local')) {
      throw new Error('Email, username, and password are required for registration.');
    }
    if (!isValidEmailFormat(email)) {
      throw new Error('Invalid email format.');
    }
    if (!isValidUsernameFormat(username)) {
      throw new Error('Username must be 3 to 20 alphanumeric characters with no spaces or special characters.');
    }
    if (provider === 'local' && (!plainPassword || plainPassword.length < 5 || /\s/.test(plainPassword))) {
      throw new Error('Password must be at least 5 characters long and contain no spaces.');
    }

    await this.userService.checkEmailAvailability(email);
    await this.userService.checkUsernameAvailability(username);

    const user = new User();
    user.email = email.trim().toLowerCase();
    user.username = username.trim();
    user.provider = provider;
    user.hasUsernameSet = true;
    
    if (plainPassword) {
      user.password = await bcrypt.hash(plainPassword, this.SALT_ROUNDS);
    }

    user.preferences = new Preferences();
    user.stats = new Stats();

    return this.userRepository.save(user);
  }

  public async login(emailOrUsername: string, plainPassword?: string): Promise<{ user: User; token: string; refreshToken: string }> {
    const isEmail = typeof emailOrUsername === 'string' && emailOrUsername.includes('@');
    if (
      typeof emailOrUsername !== 'string' ||
      !(isEmail ? isValidEmailFormat(emailOrUsername) : isValidUsernameFormat(emailOrUsername)) ||
      typeof plainPassword !== 'string' ||
      plainPassword.length < 5 ||
      /\s/.test(plainPassword)
    ) {
      throw new Error('Invalid credentials.');
    }

    const identifier = isEmail ? emailOrUsername.toLowerCase() : emailOrUsername;
    const user = await this.userRepository.findByEmailOrUsernameWithPassword(identifier);

    if (!user) {
      throw new Error('Invalid credentials.');
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned. Please contact support.');
    }

    if (user.provider === 'local') {
      if (!user.password) {
        throw new Error('Invalid credentials.');
      }
      const isPasswordValid = await bcrypt.compare(plainPassword, user.password);
      if (!isPasswordValid) {
        throw new Error('Invalid credentials.');
      }
    }

    const token = this.generateJwt(user);
    const refreshToken = this.generateRefreshToken(user);
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);

    delete user.password;
    delete user.refreshToken;

    return { user, token, refreshToken };
  }

  public generateJwt(user: User | any): string {
    const payload = {
      id: user.id,
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      hasUsernameSet: user.hasUsernameSet,
      avatarUrl: user.avatarUrl,
      provider: user.provider
    };

    const expiresIn = user.role === UserRole.GUEST || user.role === 'guest' ? '24h' : '1h';
    return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn });
  }

  public generateRefreshToken(user: User | any): string {
    const payload = {
      id: user.id,
      sub: user.id,
      jti: crypto.randomUUID()
    };
    return jwt.sign(payload, ENV.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  }

  public async generateTokens(user: User): Promise<{ token: string; refreshToken: string }> {
    const token = this.generateJwt(user);
    const refreshToken = this.generateRefreshToken(user);
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);
    return { token, refreshToken };
  }

  public async refreshToken(tokenStr: string): Promise<{ token: string; refreshToken: string; user: User }> {
    try {
      const decoded: any = jwt.verify(tokenStr, ENV.JWT_REFRESH_SECRET);
      const userId = decoded.id || decoded.sub;
      if (!userId) {
        throw new Error('Invalid token payload.');
      }

      const user = await this.userRepository.findByIdWithRefreshToken(userId);
      if (!user) {
        throw new Error('User not found.');
      }
      if (user.role === UserRole.BANNED) {
        throw new Error('Your account has been banned.');
      }
      if (!user.refreshToken || user.refreshToken !== tokenStr) {
        throw new Error('Invalid or revoked refresh token.');
      }

      const newAccessToken = this.generateJwt(user);
      const newRefreshToken = this.generateRefreshToken(user);
      user.refreshToken = newRefreshToken;
      await this.userRepository.save(user);

      delete user.password;
      delete user.refreshToken;

      return { token: newAccessToken, refreshToken: newRefreshToken, user };
    } catch (err: any) {
      throw new Error(err.message || 'Invalid or expired refresh token.');
    }
  }

  private syncSocialAvatar(user: User, avatarUrl?: string): boolean {
    if (!avatarUrl) return false;

    const hasSocialAvatar = user.avatarUrl?.includes('googleusercontent') ||
      user.avatarUrl?.includes('fbcdn');
    if (user.avatarUrl && !hasSocialAvatar) return false;
    if (user.avatarUrl === avatarUrl) return false;

    user.avatarUrl = avatarUrl;
    return true;
  }

  public async loginWithSocialProvider(provider: 'google' | 'facebook', token: string): Promise<{ user: User; jwtToken: string; refreshToken: string; isNewUser: boolean }> {
    let email: string;
    let socialName: string = '';
    let avatarUrl: string | undefined = undefined;

    if (provider === 'google') {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error('Invalid Google Token');
      email = payload.email;
      socialName = payload.name || '';
      avatarUrl = payload.picture;
    } else if (provider === 'facebook') {
      const { data } = await axios.get(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${token}`);
      if (!data || !data.email) throw new Error('Invalid Facebook Token');
      email = data.email;
      socialName = data.name || '';
      avatarUrl = data.picture?.data?.url;
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
      user.avatarUrl = avatarUrl;
      user.preferences = new Preferences();
      user.stats = new Stats();
      user = await this.userRepository.save(user);
    } else if (this.syncSocialAvatar(user, avatarUrl)) {
      await this.userRepository.save(user);
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned.');
    }

    const jwtToken = this.generateJwt(user);
    const refreshToken = this.generateRefreshToken(user);
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);
    delete user.password;
    delete user.refreshToken;

    return { user, jwtToken, refreshToken, isNewUser };
  }

  public async handleGoogleCallback(code: string, customRedirectUri?: string): Promise<{ user: User; jwtToken: string; refreshToken: string; isNewUser: boolean }> {
    const redirectUri = customRedirectUri || `${process.env.API_URL || 'http://localhost:3000'}/api/auth/google/callback`;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const client = new OAuth2Client(clientId, clientSecret, redirectUri);
    
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new Error('Failed to obtain Google ID token');
    
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid Google Token payload');

    const email = payload.email;
    const socialName = payload.name || '';
    const avatarUrl = payload.picture;

    let isNewUser = false;
    let user = await this.userRepository.findByEmail(email.toLowerCase());

    if (!user) {
      isNewUser = true;
      const tempSuffix = Math.floor(1000 + Math.random() * 9000);
      user = new User();
      user.email = email.toLowerCase();
      let cleanUsername = socialName ? socialName.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 15) : '';
      if (!cleanUsername || cleanUsername.length < 3) {
        cleanUsername = `user${tempSuffix}`;
      }
      const existingUser = await this.userRepository.findByUsername(cleanUsername);
      user.username = existingUser ? `user${tempSuffix}` : cleanUsername;
      user.provider = 'google';
      user.hasUsernameSet = false;
      user.avatarUrl = avatarUrl;
      user.preferences = new Preferences();
      user.stats = new Stats();
      user = await this.userRepository.save(user);
    } else if (this.syncSocialAvatar(user, avatarUrl)) {
      await this.userRepository.save(user);
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned.');
    }

    const jwtToken = this.generateJwt(user);
    const refreshToken = this.generateRefreshToken(user);
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);
    delete user.password;
    delete user.refreshToken;

    return { user, jwtToken, refreshToken, isNewUser };
  }

  public async handleFacebookCallback(code: string, customRedirectUri?: string): Promise<{ user: User; jwtToken: string; refreshToken?: string; isNewUser: boolean }> {
    const redirectUri = customRedirectUri || `${process.env.API_URL || 'http://localhost:3000'}/api/auth/facebook/callback`;
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const { data } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code
      }
    });
    if (!data.access_token) throw new Error('Failed to obtain Facebook access token');
    return this.loginWithSocialProvider('facebook', data.access_token);
  }
}
