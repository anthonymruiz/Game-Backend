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

@singleton()
export class SystemSettingsService {
  private defaultSettings: ISystemSettings = {
    maintenanceMode: false,
    turnTimeLimitSeconds: 30,
    maxStrikesBeforeKick: 3,
    allowNewRegistrations: true,
    announcementBanner: ''
  };

  private get repository() {
    return AppDataSource.getRepository(SystemSettings);
  }

  public async getSettings(): Promise<ISystemSettings> {
    try {
      let record = await this.repository.findOne({ where: {}, order: { createdAt: 'ASC' } });
      if (!record) {
        record = this.repository.create(this.defaultSettings);
        record = await this.repository.save(record);
      }
      return {
        maintenanceMode: !!record.maintenanceMode,
        turnTimeLimitSeconds: record.turnTimeLimitSeconds || 30,
        maxStrikesBeforeKick: record.maxStrikesBeforeKick || 3,
        allowNewRegistrations: record.allowNewRegistrations !== false,
        announcementBanner: record.announcementBanner || ''
      };
    } catch {
      return { ...this.defaultSettings };
    }
  }

  public async updateSettings(partial: Partial<ISystemSettings>): Promise<ISystemSettings> {
    let record: SystemSettings | null = null;
    try {
      record = await this.repository.findOne({ where: {}, order: { createdAt: 'ASC' } });
    } catch (err) {
      console.error('[SystemSettingsService] Error finding settings record:', err);
    }

    if (!record) {
      record = this.repository.create(this.defaultSettings);
    }

    if (partial.turnTimeLimitSeconds !== undefined) {
      const val = Number(partial.turnTimeLimitSeconds);
      if (isNaN(val) || val < 10 || val > 60) {
        throw new Error('turnTimeLimitSeconds must be between 10 and 60 seconds.');
      }
      record.turnTimeLimitSeconds = val;
    }

    if (partial.maxStrikesBeforeKick !== undefined) {
      const val = Number(partial.maxStrikesBeforeKick);
      if (isNaN(val) || val < 1) {
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

    return {
      maintenanceMode: !!record.maintenanceMode,
      turnTimeLimitSeconds: record.turnTimeLimitSeconds,
      maxStrikesBeforeKick: record.maxStrikesBeforeKick,
      allowNewRegistrations: record.allowNewRegistrations !== false,
      announcementBanner: record.announcementBanner || ''
    };
  }
}
