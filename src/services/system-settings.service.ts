import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { SystemSettings } from '../models/system-settings.entity.js';

export interface ISystemSettings {
  maintenanceMode: boolean;
  turnTimeLimitSeconds: number;
  maxStrikesBeforeKick: number;
  allowNewRegistrations: boolean;
  announcementBanner?: string;
}

export const DEFAULT_SYSTEM_SETTINGS: ISystemSettings = {
  maintenanceMode: false,
  turnTimeLimitSeconds: 30,
  maxStrikesBeforeKick: 3,
  allowNewRegistrations: true,
  announcementBanner: ''
};

@singleton()
export class SystemSettingsService {
  private get repository() {
    return AppDataSource.getRepository(SystemSettings);
  }

  public async getSettings(): Promise<ISystemSettings> {
    let record = await this.repository.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!record) {
      record = await this.repository.save(this.repository.create(DEFAULT_SYSTEM_SETTINGS));
    }
    return this.toSettings(record);
  }

  public async updateSettings(partial: Partial<ISystemSettings>): Promise<ISystemSettings> {
    let record = await this.repository.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!record) {
      record = this.repository.create(DEFAULT_SYSTEM_SETTINGS);
    }

    if (partial.turnTimeLimitSeconds !== undefined) {
      const val = Number(partial.turnTimeLimitSeconds);
      if (!Number.isInteger(val) || val < 10 || val > 60) {
        throw new Error('turnTimeLimitSeconds must be between 10 and 60 seconds.');
      }
      record.turnTimeLimitSeconds = val;
    }

    if (partial.maxStrikesBeforeKick !== undefined) {
      const val = Number(partial.maxStrikesBeforeKick);
      if (!Number.isInteger(val) || val < 1) {
        throw new Error('maxStrikesBeforeKick must be at least 1.');
      }
      record.maxStrikesBeforeKick = val;
    }

    if (partial.maintenanceMode !== undefined) {
      record.maintenanceMode = Boolean(partial.maintenanceMode);
    }

    if (partial.allowNewRegistrations !== undefined) {
      record.allowNewRegistrations = Boolean(partial.allowNewRegistrations);
    }

    if (partial.announcementBanner !== undefined) {
      record.announcementBanner = String(partial.announcementBanner);
    }

    record = await this.repository.save(record);
    return this.toSettings(record);
  }

  private toSettings(record: SystemSettings): ISystemSettings {
    if (!Number.isInteger(record.turnTimeLimitSeconds) ||
        record.turnTimeLimitSeconds < 10 || record.turnTimeLimitSeconds > 60) {
      throw new Error('Stored turnTimeLimitSeconds is invalid.');
    }
    if (!Number.isInteger(record.maxStrikesBeforeKick) || record.maxStrikesBeforeKick < 1) {
      throw new Error('Stored maxStrikesBeforeKick is invalid.');
    }
    return {
      maintenanceMode: !!record.maintenanceMode,
      turnTimeLimitSeconds: record.turnTimeLimitSeconds,
      maxStrikesBeforeKick: record.maxStrikesBeforeKick,
      allowNewRegistrations: record.allowNewRegistrations !== false,
      announcementBanner: record.announcementBanner || ''
    };
  }
}
