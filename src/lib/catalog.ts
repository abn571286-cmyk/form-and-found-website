import type { Product } from "../data/products";
import { products as demoProducts } from "../data/products";
import { supabase } from "./supabase";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  collection: string | null;
  price_npr: number;
  compare_at_price_npr: number | null;
  image_url: string;
  gallery: unknown;
  status: Product["status"];
  publication_status: "draft" | "published" | "archived";
  sku: string | null;
  materials: string | null;
  care: string | null;
  featured: boolean;
  is_new_arrival: boolean;
  created_at: string;
};

type VariantRow = {
  id: string;
  product_id: string;
  size: string;
  color: string;
  available: boolean;
};

export type CatalogState = "demo" | "loading" | "ready" | "error";

export async function loadPublishedProducts(): Promise<Product[]> {
  if (!supabase) return demoProducts;

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("publication_status", "published")
    .order("created_at", { ascending: false });
  if (productError) throw productError;
  const rows = productRows as ProductRow[];
  if (rows.length === 0) return [];

  const { data: variantRows, error: variantError } = await supabase
    .from("public_product_variants")
    .select("id,product_id,size,color,available")
    .in("product_id", rows.map(({ id }) => id));
  if (variantError) throw variantError;

  const variants = variantRows as VariantRow[];
  return rows.map((row) => {
    const productVariants = variants.filter((variant) => variant.product_id === row.id);
    const gallery = Array.isArray(row.gallery)
      ? row.gallery.filter((image): image is string => typeof image === "string" && image.length > 0)
      : [];
    const stockByVariant = Object.fromEntries(
      productVariants.filter((variant) => !variant.available).map((variant) => [`${variant.size}|${variant.color}`, 0]),
    );
    const variantIds = Object.fromEntries(
      productVariants.map((variant) => [`${variant.size}|${variant.color}`, variant.id]),
    );

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.collection ? `${row.category} / ${row.collection}` : row.category,
      price: row.price_npr,
      createdAt: row.created_at,
      image: row.image_url,
      images: gallery,
      status: row.status,
      sizes: [...new Set(productVariants.map(({ size }) => size))],
      colors: [...new Set(productVariants.map(({ color }) => color))],
      sku: row.sku ?? undefined,
      compareAtPrice: row.compare_at_price_npr ?? undefined,
      materials: row.materials ?? undefined,
      care: row.care ?? undefined,
      featured: row.featured,
      isNewArrival: row.is_new_arrival,
      stockByVariant,
      variantIds,
    };
  });
}
