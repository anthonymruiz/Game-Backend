import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
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
