import { supabase } from "./supabase";
import type { Json } from "./database.types";
import type { Product } from "../data/products";

export type OrderDraft = {
  customerEmail: string;
  customerPhone: string;
  shippingAddress: {
    full_name: string;
    address: string;
    city: string;
    postal_code: string;
    country: string;
  };
  items: Array<{
    product: Product;
    size: string;
    color: string;
    quantity: number;
  }>;
};

export async function createAuthenticatedOrder(
  draft: OrderDraft,
  idempotencyKey = crypto.randomUUID(),
) {
  if (!supabase) throw new Error("Supabase is not configured. This storefront remains in demo checkout mode.");

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) throw new Error("A signed-in customer account is required by the current order schema.");

  const items = draft.items.map(({ product, size, color, quantity }) => {
    const variantId = product.variantIds?.[`${size}|${color}`];
    if (!variantId) throw new Error(`${product.name}: selected size and colour do not map to a published stock variant.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("Each item quantity must be between 1 and 99.");
    }
    return { variant_id: variantId, quantity };
  });

  const shippingAddress: Json = {
    full_name: draft.shippingAddress.full_name,
    address: draft.shippingAddress.address,
    city: draft.shippingAddress.city,
    postal_code: draft.shippingAddress.postal_code,
    country: draft.shippingAddress.country,
  };
  const orderItems: Json = items.map((item) => ({ ...item }));
  const { data: orderId, error } = await supabase.rpc("create_authenticated_order", {
    p_idempotency_key: idempotencyKey,
    p_customer_email: draft.customerEmail,
    p_customer_phone: draft.customerPhone,
    p_shipping_address: shippingAddress,
    p_items: orderItems,
  });
  if (error) throw error;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,order_number,order_status,payment_status,subtotal_npr,delivery_fee_npr,total_npr")
    .eq("id", orderId)
    .single();
  if (orderError) throw orderError;
  return order;
}
