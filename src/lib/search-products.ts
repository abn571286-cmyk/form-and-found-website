import type { Product } from "../data/products";

export function searchProducts(products: readonly Product[], query: string): Product[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  return products.filter((product) =>
    [
      product.name,
      product.description,
      product.category,
      ...product.colors,
    ].join(" ").toLocaleLowerCase().includes(normalizedQuery),
  );
}
