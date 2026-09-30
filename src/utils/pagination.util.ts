import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';

export interface IPaginationOptions {
  page?: number;
  limit?: number;
  search?: string;
  searchFields?: string[];
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface IPaginatedResult<T> {
  data: T[];
  meta: {
    totalItems: number;
    itemCount: number;
    itemsPerPage: number;
    totalPages: number;
    currentPage: number;
  };
}

export async function paginateQueryBuilder<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  options: IPaginationOptions
): Promise<IPaginatedResult<T>> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  const skip = (page - 1) * limit;

  if (options.search && options.searchFields && options.searchFields.length > 0) {
    const searchTerm = `%${options.search.trim()}%`;
    const searchConditions = options.searchFields.map((field) => `${field} LIKE :search`);
    queryBuilder.andWhere(`(${searchConditions.join(' OR ')})`, { search: searchTerm });
  }

  if (options.sortBy) {
    const sortOrder = options.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    queryBuilder.orderBy(options.sortBy, sortOrder);
  }

  queryBuilder.skip(skip).take(limit);

  const [data, totalItems] = await queryBuilder.getManyAndCount();
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data,
    meta: {
      totalItems,
      itemCount: data.length,
      itemsPerPage: limit,
      totalPages,
      currentPage: page,
    },
  };
}
