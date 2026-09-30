import 'reflect-metadata';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { injectable } from 'tsyringe';

@injectable()
export class App {
  public expressApp: Application;

  constructor() {
    this.expressApp = express();
    this.initializeMiddlewares();
    this.initializeRoutes();
  }

  private initializeMiddlewares(): void {
    this.expressApp.use(cors());
    this.expressApp.use(helmet());
    this.expressApp.use(express.json());
  }

  private initializeRoutes(): void {
    this.expressApp.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK' });
    });
  }
}
