import { injectable, container } from 'tsyringe';
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

    const expiresIn = user.role === UserRole.GUEST || user.role === 'guest' ? '24h' : '7d';
    return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn });
  }

  public async loginWithSocialProvider(provider: 'google' | 'facebook', token: string): Promise<{ user: User; jwtToken: string; isNewUser: boolean }> {
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
      if (avatarUrl) user.avatarUrl = avatarUrl;
      user.preferences = new Preferences();
      user.stats = new Stats();
      user = await this.userRepository.save(user);
    } else if (avatarUrl && (!user.avatarUrl || user.avatarUrl.includes('googleusercontent') || user.avatarUrl.includes('fbcdn'))) {
      user.avatarUrl = avatarUrl;
      await this.userRepository.save(user);
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned.');
    }

    const jwtToken = this.generateJwt(user);
    return { user, jwtToken, isNewUser };
  }

  public async handleGoogleCallback(code: string): Promise<{ user: User; jwtToken: string; isNewUser: boolean }> {
    const redirectUri = `${process.env.API_URL || 'http://localhost:3000'}/api/auth/google/callback`;
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
      if (avatarUrl) user.avatarUrl = avatarUrl;
      user.preferences = new Preferences();
      user.stats = new Stats();
      user = await this.userRepository.save(user);
    } else if (avatarUrl && (!user.avatarUrl || user.avatarUrl.includes('googleusercontent'))) {
      user.avatarUrl = avatarUrl;
      await this.userRepository.save(user);
    }

    if (user.role === UserRole.BANNED) {
      throw new Error('Your account has been banned.');
    }

    const jwtToken = this.generateJwt(user);
    return { user, jwtToken, isNewUser };
  }

  public async handleFacebookCallback(code: string): Promise<{ user: User; jwtToken: string; isNewUser: boolean }> {
    const redirectUri = `${process.env.API_URL || 'http://localhost:3000'}/api/auth/facebook/callback`;
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
