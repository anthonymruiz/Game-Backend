import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { User } from '../models/user.entity.js';
import { AppDataSource } from '../config/database.config.js';

@injectable()
export class UserRepository {
  private ormRepository: Repository<User>;

  constructor() {
    this.ormRepository = AppDataSource.getRepository(User);
  }

  public async findByUsername(username: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { username } });
  }

  public async findByEmail(email: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { email } });
  }

  public async save(user: User): Promise<User> {
    return this.ormRepository.save(user);
  }
}
