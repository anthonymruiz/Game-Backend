import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';

@injectable()
export class AuthController {
  private authService: AuthService;
  private userService: UserService;

  constructor() {
    this.authService = container.resolve(AuthService);
    this.userService = container.resolve(UserService);
  }

  public register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, username, password } = req.body;
      const user = await this.authService.register(email, username, password, 'local');
      const token = this.authService.generateJwt(user);
      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          hasUsernameSet: user.hasUsernameSet
        }
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, login, username, password } = req.body;
      const identifier = login || email || username;
      const result = await this.authService.login(identifier, password);
      res.status(200).json({ 
        message: 'Login successful', 
        token: result.token, 
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          role: result.user.role,
          hasUsernameSet: result.user.hasUsernameSet
        }
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  };

  public socialLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider, token } = req.body;
      const result = await this.authService.loginWithSocialProvider(provider, token);
      res.status(200).json({ 
        message: 'Social login successful', 
        token: result.jwtToken, 
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          role: result.user.role,
          hasUsernameSet: result.user.hasUsernameSet
        },
        isNewUser: result.isNewUser
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  };

  public setUsername = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { username } = req.body;
      const updatedUser = await this.userService.setUsername(userId, username);
      const newToken = this.authService.generateJwt(updatedUser);

      res.status(200).json({
        message: 'Username updated successfully',
        token: newToken,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          role: updatedUser.role,
          hasUsernameSet: updatedUser.hasUsernameSet
        }
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public guestLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const guestNum = Math.floor(1000 + Math.random() * 9000);
      const username = req.body?.username || `Guest_${guestNum}`;
      const guestId = `guest_${Date.now()}_${guestNum}`;
      const guestUser = {
        id: guestId,
        username,
        email: `${guestId}@game.local`,
        role: 'guest',
        hasUsernameSet: true
      };
      const token = this.authService.generateJwt(guestUser as any);
      res.status(200).json({ 
        message: 'Guest login successful', 
        token, 
        user: guestUser 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public redirectToGoogle = async (req: Request, res: Response): Promise<void> => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId || googleClientId === '1082736192847-demo.apps.googleusercontent.com') {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Configuración de OAuth requerida</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 420px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
              h2 { color: #f43f5e; margin-top: 0; }
              code { background: #0f172a; padding: 0.2rem 0.5rem; border-radius: 0.25rem; color: #38bdf8; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>Google OAuth no configurado</h2>
              <p>Para habilitar el inicio de sesión con Google, debes colocar tus credenciales reales (<code>GOOGLE_CLIENT_ID</code>) en el archivo <code>backend/.env</code>.</p>
            </div>
          </body>
        </html>
      `);
      return;
    }
    const redirectUri = `${process.env.API_URL || 'http://localhost:3000'}/api/auth/google/callback`;
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20email&prompt=select_account`;
    res.redirect(googleAuthUrl);
  };

  public redirectToFacebook = async (req: Request, res: Response): Promise<void> => {
    const facebookAppId = process.env.FACEBOOK_APP_ID;
    if (!facebookAppId || facebookAppId === '123456789012345') {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Configuración de OAuth requerida</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 420px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
              h2 { color: #f43f5e; margin-top: 0; }
              code { background: #0f172a; padding: 0.2rem 0.5rem; border-radius: 0.25rem; color: #38bdf8; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>Facebook OAuth no configurado</h2>
              <p>Para habilitar el inicio de sesión con Facebook, debes colocar tus credenciales reales (<code>FACEBOOK_APP_ID</code>) en el archivo <code>backend/.env</code>.</p>
            </div>
          </body>
        </html>
      `);
      return;
    }
    const redirectUri = `${process.env.API_URL || 'http://localhost:3000'}/api/auth/facebook/callback`;
    const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${facebookAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=email,public_profile`;
    res.redirect(facebookAuthUrl);
  };

  public googleCallback = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code, error } = req.query;
      if (error || !code) {
        res.status(400).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Acceso Denegado</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 420px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
                h3 { color: #f43f5e; margin-top: 0; }
                p { font-size: 0.95rem; color: #cbd5e1; line-height: 1.5; }
              </style>
            </head>
            <body>
              <div class="card">
                <h3>Inicio de sesión cancelado</h3>
                <p>${error === 'access_denied' ? 'Se canceló la autorización o tu correo de Google no está añadido en <b>"Usuarios de prueba"</b> en Google Cloud Console.' : 'No se pudo obtener el código de autorización.'}</p>
                <script>
                  setTimeout(() => { if (window.opener) window.close(); }, 5000);
                </script>
              </div>
            </body>
          </html>
        `);
        return;
      }
      const result = await this.authService.handleGoogleCallback(code as string);
      this.sendOAuthResponse(res, result);
    } catch (error: any) {
      res.status(500).send(`Authentication error: ${error.message}`);
    }
  };

  public facebookCallback = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code, error } = req.query;
      if (error || !code) {
        res.status(400).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Acceso Denegado</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 420px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
                h3 { color: #f43f5e; margin-top: 0; }
                p { font-size: 0.95rem; color: #cbd5e1; line-height: 1.5; }
              </style>
            </head>
            <body>
              <div class="card">
                <h3>Inicio de sesión cancelado</h3>
                <p>Se canceló la autorización de Facebook o no se pudo obtener el código.</p>
                <script>
                  setTimeout(() => { if (window.opener) window.close(); }, 5000);
                </script>
              </div>
            </body>
          </html>
        `);
        return;
      }
      const result = await this.authService.handleFacebookCallback(code as string);
      this.sendOAuthResponse(res, result);
    } catch (error: any) {
      res.status(500).send(`Authentication error: ${error.message}`);
    }
  };

  public checkUsernameAvailability = async (req: Request, res: Response): Promise<void> => {
    try {
      const username = (req.query.username as string || '').trim();
      if (!username || username.length < 3) {
        res.status(400).json({ available: false, error: 'Username must be at least 3 characters' });
        return;
      }
      await this.userService.checkUsernameAvailability(username);
      res.status(200).json({ available: true, message: 'Username is available' });
    } catch (error: any) {
      res.status(200).json({ available: false, error: error.message || 'Username is already taken' });
    }
  };

  private sendOAuthResponse(res: Response, result: { user: any; jwtToken: string; isNewUser: boolean }) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const userPayload = encodeURIComponent(JSON.stringify({
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      role: result.user.role,
      hasUsernameSet: result.user.hasUsernameSet
    }));
    const redirectUrl = `${frontendUrl}/auth/callback?token=${result.jwtToken}&user=${userPayload}`;
    res.redirect(redirectUrl);
  }
}
