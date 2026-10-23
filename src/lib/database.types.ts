export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      products: Table<
        {
          id: string;
          slug: string;
          name: string;
          description: string;
          category: string;
          collection: string | null;
          price_npr: number;
          compare_at_price_npr: number | null;
          image_url: string;
          gallery: Json;
          status: "In stock" | "Low stock" | "Sold out" | "Coming soon";
          publication_status: "draft" | "published" | "archived";
          sku: string | null;
          materials: string | null;
          care: string | null;
          featured: boolean;
          is_new_arrival: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          slug: string;
          name: string;
          description: string;
          category: string;
          collection?: string | null;
          price_npr: number;
          compare_at_price_npr?: number | null;
          image_url: string;
          gallery?: Json;
          status: "In stock" | "Low stock" | "Sold out" | "Coming soon";
          publication_status?: "draft" | "published" | "archived";
          sku?: string | null;
          materials?: string | null;
          care?: string | null;
          featured?: boolean;
          is_new_arrival?: boolean;
        }
      >;
      product_variants: Table<
        {
          id: string;
          product_id: string;
          size: string;
          color: string;
          sku: string | null;
          stock: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          product_id: string;
          size: string;
          color: string;
          sku?: string | null;
          stock: number;
        }
      >;
      admin_users: Table<
        { user_id: string; created_at: string },
        { user_id: string }
      >;
      store_settings: Table<
        { key: string; value: Json; updated_at: string },
        { key: string; value: Json }
      >;
      orders: Table<
        {
          id: string;
          order_number: string;
          idempotency_key: string;
          customer_email: string;
          customer_phone: string;
          shipping_address: Json;
          subtotal_npr: number;
          delivery_fee_npr: number;
          total_npr: number;
          order_status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
          payment_status: "pending" | "paid" | "failed" | "refunded";
          payment_method: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          order_number?: string;
          idempotency_key: string;
          customer_email: string;
          customer_phone: string;
          shipping_address: Json;
          subtotal_npr: number;
          delivery_fee_npr: number;
          total_npr: number;
          order_status?: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
          payment_status?: "pending" | "paid" | "failed" | "refunded";
          payment_method?: string | null;
        }
      >;
      order_items: Table<
        {
          id: string;
          order_id: string;
          product_id: string | null;
          variant_id: string | null;
          product_name: string;
          variant_label: string;
          unit_price_npr: number;
          quantity: number;
          line_total_npr: number;
          created_at: string;
        },
        {
          order_id: string;
          product_id?: string | null;
          variant_id?: string | null;
          product_name: string;
          variant_label: string;
          unit_price_npr: number;
          quantity: number;
          line_total_npr: number;
        }
      >;
      payment_transactions: Table<
        {
          id: string;
          order_id: string;
          provider: string;
          provider_reference: string | null;
          amount_npr: number;
          status: "pending" | "verified" | "failed" | "refunded";
          provider_payload: Json;
          created_at: string;
        },
        {
          order_id: string;
          provider: string;
          provider_reference?: string | null;
          amount_npr: number;
          status?: "pending" | "verified" | "failed" | "refunded";
          provider_payload?: Json;
        }
      >;
      customer_profiles: Table<
        { user_id: string; full_name: string | null; phone: string | null; created_at: string; updated_at: string },
        { user_id: string; full_name?: string | null; phone?: string | null }
      >;
      delivery_addresses: Table<
        { id: string; user_id: string; label: string; address: Json; created_at: string; updated_at: string },
        { user_id: string; label: string; address: Json }
      >;
      admin_audit_events: Table<
        { id: string; actor_user_id: string | null; action: string; entity_type: string; entity_id: string | null; details: Json; created_at: string },
        { actor_user_id?: string | null; action: string; entity_type: string; entity_id?: string | null; details?: Json }
      >;
    };
    Views: {
      public_product_variants: {
        Row: { id: string; product_id: string; size: string; color: string; available: boolean };
        Relationships: [];
      };
    };
    Functions: {
      is_store_admin: { Args: Record<string, never>; Returns: boolean };
      admin_save_product: { Args: { p_product: Json; p_variants: Json }; Returns: string };
      create_authenticated_order: {
        Args: { p_idempotency_key: string; p_customer_email: string; p_customer_phone: string; p_shipping_address: Json; p_items: Json };
        Returns: string;
      };
      admin_set_order_status: { Args: { p_order_id: string; p_status: string }; Returns: undefined };
      record_verified_payment: {
        Args: { p_order_id: string; p_provider: string; p_provider_reference: string; p_verified_amount_npr: number; p_provider_payload?: Json };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
