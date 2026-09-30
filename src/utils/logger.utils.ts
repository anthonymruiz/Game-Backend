import winston from 'winston';
import { SocketManager } from '../socket/socket.manager.js';
import { container } from 'tsyringe';

const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

export function broadcastLog(level: string, message: string) {
  logger.log(level, message);
  try {
    const sm = container.resolve(SocketManager);
    sm.io.of('/matchmaking').to('admin_room').emit('serverLog', {
      level, message, timestamp: new Date()
    });
  } catch (e) {
    // Ignore if SocketManager is not fully initialized yet
  }
}
