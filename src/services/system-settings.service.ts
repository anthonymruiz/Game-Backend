import { singleton } from 'tsyringe';

export interface ISystemSettings {
  maintenanceMode: boolean;
  turnTimeLimitSeconds: number;
  maxStrikesBeforeKick: number;
  allowNewRegistrations: boolean;
  announcementBanner?: string;
}

@singleton()
export class SystemSettingsService {
  private settings: ISystemSettings = {
    maintenanceMode: false,
    turnTimeLimitSeconds: 30,
    maxStrikesBeforeKick: 3,
    allowNewRegistrations: true,
    announcementBanner: ''
  };

  public getSettings(): ISystemSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<ISystemSettings>): ISystemSettings {
    this.settings = {
      ...this.settings,
      ...partial
    };
    return { ...this.settings };
  }
}
