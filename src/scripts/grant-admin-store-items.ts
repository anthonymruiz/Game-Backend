import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { StoreItem } from '../models/store-item.entity.js';
import { User } from '../models/user.entity.js';
import { UserStoreItem } from '../models/user-store-item.entity.js';
import { StoreItemService } from '../services/store-item.service.js';
import { container } from 'tsyringe';

async function grantAdminStoreItems(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await container.resolve(StoreItemService).seedDefaultItems();

    const result = await AppDataSource.transaction(async manager => {
      const admin = await manager.getRepository(User).findOneBy({ username: 'admin' });
      if (!admin) throw new Error('Admin user was not found.');

      const products = await manager.getRepository(StoreItem).find();
      const ownershipRepository = manager.getRepository(UserStoreItem);
      const existingOwnerships = await ownershipRepository.find({
        where: { userId: admin.id }
      });
      const ownedItemIds = new Set(existingOwnerships.map(ownership => ownership.storeItemId));
      const missingProducts = products.filter(product => !ownedItemIds.has(product.id));
      if (missingProducts.length === 0) return { createdCount: 0, totalProducts: products.length };

      await ownershipRepository.save(missingProducts.map(product => ownershipRepository.create({
        userId: admin.id,
        storeItemId: product.id,
        pricePointsPaid: 0
      })));
      return { createdCount: missingProducts.length, totalProducts: products.length };
    });

    console.log(`[ADMIN INVENTORY] Granted ${result.createdCount} product(s); admin now owns ${result.totalProducts}/${result.totalProducts} catalog products.`);
  } finally {
    await AppDataSource.destroy();
  }
}

grantAdminStoreItems().catch(error => {
  console.error('[ADMIN INVENTORY] Failed to grant store products:', error);
  process.exitCode = 1;
});
