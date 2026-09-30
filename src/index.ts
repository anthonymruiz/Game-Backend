import 'reflect-metadata';
import { container } from 'tsyringe';
import { App } from './app.js';
import { AppDataSource } from './config/database.config.js';
import { ENV } from './config/env.config.js';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established successfully.');

    const appInstance = container.resolve(App);
    
    appInstance.expressApp.listen(ENV.PORT, () => {
      console.log(`Server is running on port ${ENV.PORT}`);
    });
  } catch (error) {
    console.error('Error during bootstrap:', error);
    process.exit(1);
  }
}

bootstrap();
