import { supabase } from "./supabase";
import type { Json } from "./database.types";
import type { Product } from "../data/products";

export type OrderDraft = {
  customerEmail: string;
  customerPhone: string;
  shippingAddress: {
    full_name: string;
    recipient_phone: string;
    province: string;
    district: string;
    municipality: string;
    ward: string;
    street: string;
    postal_code: string;
    delivery_instructions: string;
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
  idempotencyKey: string = crypto.randomUUID(),
) {
  if (!supabase) throw new Error("Order services are not configured. Please try again later.");

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

  const shippingAddress: Json = { ...draft.shippingAddress };
  const rpcItems: Json = items.map((item) => ({ ...item }));
  const { data: orderId, error } = await supabase.rpc("create_authenticated_order", {
    p_idempotency_key: idempotencyKey,
    p_customer_email: draft.customerEmail,
    p_customer_phone: draft.customerPhone,
    p_shipping_address: shippingAddress,
    p_items: rpcItems,
  });
  if (error) throw error;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,order_number,order_status,payment_status,payment_method,subtotal_npr,delivery_fee_npr,total_npr,customer_email,customer_phone,shipping_address,created_at")
    .eq("id", orderId)
    .single();
  if (orderError) throw orderError;
  const { data: orderItems, error: itemsError } = await supabase
    .from("order_items")
    .select("id,product_name,variant_label,quantity,unit_price_npr,line_total_npr")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;
  return { ...order, items: orderItems };
}
