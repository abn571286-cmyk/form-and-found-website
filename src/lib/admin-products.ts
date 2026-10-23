import type { ProductStatus } from "../data/products";
import type { Database, Json } from "./database.types";
import { supabase } from "./supabase";

export type AdminProduct = Database["public"]["Tables"]["products"]["Row"];
export type AdminVariant = Database["public"]["Tables"]["product_variants"]["Row"];
export type AdminOrder = Database["public"]["Tables"]["orders"]["Row"];
export type AdminOrderItem = Database["public"]["Tables"]["order_items"]["Row"];
export type AdminPaymentTransaction = Database["public"]["Tables"]["payment_transactions"]["Row"];

export type AdminProductInput = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  collection: string | null;
  price_npr: number;
  compare_at_price_npr: number | null;
  image_url: string;
  gallery: string[];
  status: ProductStatus;
  publication_status: "draft" | "published" | "archived";
  sku: string | null;
  materials: string | null;
  care: string | null;
  featured: boolean;
  is_new_arrival: boolean;
};

export type AdminVariantInput = {
  size: string;
  color: string;
  sku: string | null;
  stock: number;
};

function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Add the public project URL and anon key.");
  return supabase;
}

export async function loadAdminProducts() {
  const client = requireSupabase();
  const [productResult, variantResult] = await Promise.all([
    client.from("products").select("*").order("updated_at", { ascending: false }),
    client.from("product_variants").select("*").order("size"),
  ]);

  if (productResult.error) throw productResult.error;
  if (variantResult.error) throw variantResult.error;
  return {
    products: productResult.data as AdminProduct[],
    variants: variantResult.data as AdminVariant[],
  };
}

export async function loadAdminOrders() {
  const client = requireSupabase();
  const [orderResult, itemResult, paymentResult] = await Promise.all([
    client.from("orders").select("*").order("created_at", { ascending: false }),
    client.from("order_items").select("*").order("created_at"),
    client.from("payment_transactions").select("*").order("created_at", { ascending: false }),
  ]);
  if (orderResult.error) throw orderResult.error;
  if (itemResult.error) throw itemResult.error;
  if (paymentResult.error) throw paymentResult.error;
  return {
    orders: orderResult.data as AdminOrder[],
    items: itemResult.data as AdminOrderItem[],
    payments: paymentResult.data as AdminPaymentTransaction[],
  };
}

export async function setAdminOrderStatus(orderId: string, status: AdminOrder["order_status"]) {
  const client = requireSupabase();
  const { error } = await client.rpc("admin_set_order_status", {
    p_order_id: orderId,
    p_status: status,
  });
  if (error) throw error;
}

export async function saveAdminProduct(product: AdminProductInput, variants: AdminVariantInput[]) {
  const client = requireSupabase();
  const productJson: Json = { ...product };
  const variantsJson: Json = variants.map((variant) => ({ ...variant }));
  const { data, error } = await client.rpc("admin_save_product", {
    p_product: productJson,
    p_variants: variantsJson,
  });
  if (error) throw error;
  return data;
}

export async function uploadProductImage(file: File) {
  const client = requireSupabase();
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Choose a JPG, PNG, WebP, or AVIF image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image must be 8 MB or smaller.");

  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from("product-images").upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = client.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}
