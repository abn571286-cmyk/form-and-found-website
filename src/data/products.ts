
export type ProductStatus = "In stock" | "Low stock" | "Sold out" | "Coming soon";

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  createdAt?: string;
  image: string;
  images?: string[];
  status: ProductStatus;
  description: string;
  sizes: string[];
  colors: string[];
  sku?: string;
  compareAtPrice?: number;
  materials?: string;
  care?: string;
  featured?: boolean;
  isNewArrival?: boolean;
  stockByVariant?: Record<string, number>;
  variantIds?: Record<string, string>;
};

export function getVariantStock(product: Product, size: string, color: string): number | undefined {
  return product.stockByVariant?.[`${size}|${color}`];
}

export function isPurchasableVariant(product: Product, size: string, color: string): boolean {
  if (
    product.status === "Sold out" ||
    product.status === "Coming soon" ||
    !product.sizes.includes(size) ||
    !product.colors.includes(color)
  ) {
    return false;
  }

  const stock = getVariantStock(product, size, color);
  return stock === undefined || (Number.isInteger(stock) && stock > 0);
}

export function sortNewestFirst(catalog: readonly Product[]): Product[] {
  return catalog
    .map((product, index) => ({ product, index, timestamp: Date.parse(product.createdAt ?? "") }))
    .sort((first, second) => {
      const firstHasDate = Number.isFinite(first.timestamp);
      const secondHasDate = Number.isFinite(second.timestamp);
      if (firstHasDate && secondHasDate) {
        return second.timestamp - first.timestamp || first.index - second.index;
      }
      if (firstHasDate !== secondHasDate) return firstHasDate ? -1 : 1;

      return Number(Boolean(second.product.isNewArrival)) - Number(Boolean(first.product.isNewArrival)) ||
        first.index - second.index;
    })
    .map(({ product }) => product);
}

export const products: Product[] = [
  {
    id: "heavyweight-tee",
    slug: "heavyweight-tee",
    name: "Heavyweight Tee",
    category: "Tops",
    price: 2490,
    image:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=85",
    status: "In stock",
    description:
      "An everyday essential with a clean silhouette and a streetwear-inspired fit.",
    sizes: ["S", "M", "L", "XL"],
    colors: ["Black", "White"],
    featured: true,
    isNewArrival: true,
  },
  {
    id: "washed-hoodie",
    slug: "washed-hoodie",
    name: "Washed Hoodie",
    category: "Hoodies",
    price: 5490,
    image:
      "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=85",
    status: "Coming soon",
    description:
      "A relaxed hoodie concept designed for layering and everyday wear.",
    sizes: ["S", "M", "L", "XL"],
    colors: ["Black", "Grey"],
    isNewArrival: true,
  },
  {
    id: "wide-cargo",
    slug: "wide-cargo",
    name: "Wide Cargo",
    category: "Bottoms",
    price: 4990,
    image:
      "https://images.unsplash.com/photo-1517438476312-10d79c077509?auto=format&fit=crop&w=800&q=85",
    status: "In stock",
    description:
      "Utility-inspired bottoms with a relaxed streetwear look.",
    sizes: ["S", "M", "L", "XL"],
    colors: ["Black", "Olive"],
  },
];

export function getProductCatalogIssues(catalog: readonly Product[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const product of catalog) {
    for (const [field, value] of Object.entries({
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      image: product.image,
      description: product.description,
    })) {
      if (!value.trim()) issues.push(`Product ${field} must not be empty.`);
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)) {
      issues.push(`${product.name || product.id}: slug must contain lowercase letters, numbers, and single hyphens only.`);
    }
    if (ids.has(product.id)) issues.push(`Duplicate product id "${product.id}".`);
    if (slugs.has(product.slug)) issues.push(`Duplicate product slug "${product.slug}".`);
    ids.add(product.id);
    slugs.add(product.slug);

    if (!Number.isSafeInteger(product.price) || product.price <= 0) {
      issues.push(`${product.name || product.id}: price must be a positive integer amount in NPR.`);
    }
    if (
      product.compareAtPrice !== undefined &&
      (!Number.isSafeInteger(product.compareAtPrice) || product.compareAtPrice <= product.price)
    ) {
      issues.push(`${product.name || product.id}: compare-at price must be an integer NPR amount higher than the selling price.`);
    }

    for (const [variant, stock] of Object.entries(product.stockByVariant ?? {})) {
      const [size, color, ...extra] = variant.split("|");
      if (
        extra.length > 0 ||
        !product.sizes.includes(size) ||
        !product.colors.includes(color) ||
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        issues.push(`${product.name || product.id}: invalid stock entry "${variant}". Use a configured SIZE|Colour and a non-negative whole number.`);
      }
    }
  }

  return issues;
}

const catalogIssues = getProductCatalogIssues(products);
if (catalogIssues.length > 0) {
  throw new Error(`Invalid FORM & FOUND product catalogue:\n${catalogIssues.join("\n")}`);
}

export function formatPrice(price: number): string {
  return `NPR ${price.toLocaleString("en-NP")}`;
}
