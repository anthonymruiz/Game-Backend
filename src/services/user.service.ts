import { injectable } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository.js';
import { isValidUsernameFormat } from '../utils/regex.util.js';

@injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  public async checkUsernameAvailability(username: string): Promise<boolean> {
    if (!isValidUsernameFormat(username)) {
      throw new Error('Invalid username format. Must be 3-20 alphanumeric characters or underscores.');
    }

    const existingUser = await this.userRepository.findByUsername(username);
    if (existingUser) {
      throw new Error('Username is already taken.');
    }

    return true;
  }
}
