import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { PointPackage } from '../models/point-package.entity.js';
import type { PointPackageConfiguration } from '../models/point-package.entity.js';
import { User } from '../models/user.entity.js';
import { UserRole } from '../models/user-role.enum.js';
import { Stats } from '../models/stats.entity.js';

export interface IPointPackage {
  id: string;
  configuration: PointPackageConfiguration;
  points: number;
  priceUsd: number;
  stripePriceUrl: string;
  isActive: boolean;
  sortOrder: number;
}

interface IPointPackageInput {
  id?: string;
  configuration: PointPackageConfiguration;
  points: number;
  priceUsd: number;
  stripePriceUrl: string;
  isActive: boolean;
  sortOrder: number;
}

const DEFAULT_POINT_PACKAGES: Omit<IPointPackageInput, 'id'>[] = [
  {
    configuration: {
      es: {
        name: 'Paquete Básico',
        description: 'Recarga inicial de 150 puntos para canjear tu primer objeto en la tienda.'
      },
      en: {
        name: 'Basic Package',
        description: 'A starter pack of 150 points to redeem your first item in the store.'
      }
    },
    points: 150,
    priceUsd: 0.99,
    stripePriceUrl: '',
    isActive: true,
    sortOrder: 0
  },
  {
    configuration: {
      es: {
        name: 'Combo Táctico',
        description: 'Paquete especial de 500 puntos para obtener muros y fichas de categoría Rara.'
      },
      en: {
        name: 'Tactical Combo',
        description: 'A special pack of 500 points to get walls and Rare tokens.'
      }
    },
    points: 500,
    priceUsd: 2.49,
    stripePriceUrl: '',
    isActive: true,
    sortOrder: 1
  },
  {
    configuration: {
      es: {
        name: 'Combo Maestro',
        description: 'Gran recarga de 1,000 puntos para adquirir objetos de alta rareza.'
      },
      en: {
        name: 'Master Combo',
        description: 'A large 1,000-point pack for acquiring high-rarity items.'
      }
    },
    points: 1000,
    priceUsd: 4.99,
    stripePriceUrl: '',
    isActive: true,
    sortOrder: 2
  }
];

@singleton()
export class PointPackageService {
  private get repository() {
    return AppDataSource.getRepository(PointPackage);
  }

  public async getPackages(includeInactive = false): Promise<IPointPackage[]> {
    let packages = await this.repository.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    if (packages.length === 0) {
      packages = await this.repository.save(DEFAULT_POINT_PACKAGES.map(item => this.repository.create(item)));
    }
    return packages
      .filter(item => includeInactive || item.isActive)
      .map(item => ({
        id: item.id,
        configuration: item.configuration,
        points: item.points,
        priceUsd: Number(item.priceUsd),
        stripePriceUrl: item.stripePriceUrl,
        isActive: item.isActive,
        sortOrder: item.sortOrder
      }));
  }

  public async giftPackagePoints(
    recipientUserId: string,
    packageId: string
  ): Promise<{ recipient: { id: string; username: string }; points: number; balancePoints: number }> {
    return AppDataSource.transaction(async manager => {
      const pointPackage = await manager.getRepository(PointPackage).findOneBy({ id: packageId });
      if (!pointPackage) throw new Error('POINT_PACKAGE_NOT_FOUND');
      if (!Number.isInteger(pointPackage.points) || pointPackage.points < 1) {
        throw new Error('POINT_PACKAGE_INVALID');
      }

      const userRepository = manager.getRepository(User);
      const recipient = await userRepository.findOne({
        where: { id: recipientUserId },
        relations: { stats: true }
      });
      if (!recipient) throw new Error('GIFT_RECIPIENT_NOT_FOUND');
      if (recipient.role === UserRole.GUEST || recipient.role === UserRole.BANNED || recipient.provider === 'guest') {
        throw new Error('GIFT_RECIPIENT_UNAVAILABLE');
      }

      if (!recipient.stats) {
        recipient.stats = manager.getRepository(Stats).create();
      }
      recipient.stats.points = (Number(recipient.stats.points) || 0) + pointPackage.points;
      await manager.getRepository(Stats).save(recipient.stats);
      await userRepository.save(recipient);

      return {
        recipient: { id: recipient.id, username: recipient.username },
        points: pointPackage.points,
        balancePoints: recipient.stats.points
      };
    });
  }

  public async replacePackages(value: unknown): Promise<IPointPackage[]> {
    if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
      throw new Error('packages must be an array with between 1 and 30 entries.');
    }

    const inputs = value.map((item, index) => this.validatePackage(item, index));
    const ids = inputs.flatMap(item => item.id ? [item.id] : []);
    if (new Set(ids).size !== ids.length) throw new Error('Package ids must be unique.');
    return AppDataSource.transaction(async manager => {
      const repository = manager.getRepository(PointPackage);
      await repository.save(inputs.map(item => repository.create(item)));
      const saved = await repository.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
      return saved
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(item => ({
          id: item.id,
          configuration: item.configuration,
          points: item.points,
          priceUsd: Number(item.priceUsd),
          stripePriceUrl: item.stripePriceUrl,
          isActive: item.isActive,
          sortOrder: item.sortOrder
        }));
    });
  }

  private validatePackage(value: unknown, index: number): IPointPackageInput {
    if (!value || typeof value !== 'object') throw new Error(`Package ${index + 1} is invalid.`);
    const item = value as Partial<IPointPackageInput>;
    const points = Number(item.points);
    const priceUsd = Number(item.priceUsd);
    const stripePriceUrl = item.stripePriceUrl;
    const configuration = this.validateConfiguration(item.configuration, index);

    if (!Number.isInteger(points) || points < 1 || points > 1_000_000) throw new Error(`Package ${index + 1} points must be an integer between 1 and 1000000.`);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 1_000_000 || Math.round(priceUsd * 100) !== priceUsd * 100) {
      throw new Error(`Package ${index + 1} price must be a positive amount with at most two decimal places.`);
    }
    if (item.id !== undefined && (typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))) {
      throw new Error(`Package ${index + 1} id is invalid.`);
    }
    if (item.isActive !== undefined && typeof item.isActive !== 'boolean') {
      throw new Error(`Package ${index + 1} availability must be a boolean.`);
    }
    if (typeof stripePriceUrl !== 'string' || stripePriceUrl.trim().length > 255 ||
      !/^price_[A-Za-z0-9]+$/.test(stripePriceUrl.trim())) {
      throw new Error(`Package ${index + 1} StripePriceUrl must be a valid Stripe Price ID.`);
    }

    return {
      ...(item.id ? { id: item.id } : {}),
      configuration,
      points,
      priceUsd,
      stripePriceUrl: stripePriceUrl.trim(),
      isActive: item.isActive !== false,
      sortOrder: Number.isInteger(item.sortOrder) && Number(item.sortOrder) >= 0 ? Number(item.sortOrder) : index
    };
  }

  private validateConfiguration(value: unknown, index: number): PointPackageConfiguration {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Package ${index + 1} configuration is invalid.`);
    }
    const configuration = value as PointPackageConfiguration;
    const validated: PointPackageConfiguration = {};
    for (const language of ['es', 'en'] as const) {
      const entry = configuration[language];
      if (!entry || typeof entry.name !== 'string' || typeof entry.description !== 'string') {
        throw new Error(`Package ${index + 1} must have a name and description in ${language}.`);
      }
      const name = entry.name.trim();
      const description = entry.description.trim();
      if (!name || name.length > 80) {
        throw new Error(`Package ${index + 1} ${language} name is required and must be at most 80 characters.`);
      }
      if (!description || description.length > 255) {
        throw new Error(`Package ${index + 1} ${language} description is required and must be at most 255 characters.`);
      }
      validated[language] = { name, description };
    }
    return validated;
  }
}
