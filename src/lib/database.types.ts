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
          customer_user_id: string | null;
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
          customer_user_id?: string | null;
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
      payment_attempts: Table<
        {
          id: string;
          order_id: string;
          customer_user_id: string;
          provider: "esewa" | "khalti";
          provider_reference: string | null;
          provider_transaction_id: string | null;
          payment_url: string | null;
          amount_npr: number;
          verified_amount_npr: number | null;
          status: "initiating" | "pending" | "verified" | "failed" | "cancelled" | "expired" | "verification_unavailable" | "review";
          verified_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          order_id: string;
          customer_user_id: string;
          provider: "esewa" | "khalti";
          amount_npr: number;
          provider_reference?: string | null;
          provider_transaction_id?: string | null;
          payment_url?: string | null;
          verified_amount_npr?: number | null;
          status?: "initiating" | "pending" | "verified" | "failed" | "cancelled" | "expired" | "verification_unavailable" | "review";
          verified_at?: string | null;
          last_error?: string | null;
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
      contact_messages: Table<
        {
          id: string;
          submission_id: string;
          name: string;
          email: string;
          subject: string;
          message: string;
          status: "new" | "read" | "closed";
          notification_status: "not_configured" | "sent" | "failed";
          created_at: string;
        },
        {
          submission_id: string;
          name: string;
          email: string;
          subject: string;
          message: string;
          status?: "new" | "read" | "closed";
          notification_status?: "not_configured" | "sent" | "failed";
        }
      >;
      order_notification_attempts: Table<
        {
          id: string;
          order_id: string;
          notification_type: "order_confirmation" | "payment_confirmation";
          status: "sending" | "sent" | "failed";
          attempt_count: number;
          last_error: string | null;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          order_id: string;
          notification_type?: "order_confirmation" | "payment_confirmation";
          status?: "sending" | "sent" | "failed";
          attempt_count?: number;
          last_error?: string | null;
          sent_at?: string | null;
        }
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
      set_default_delivery_address: {
        Args: { p_address_id: string };
        Returns: undefined;
      };
      admin_set_order_status: { Args: { p_order_id: string; p_status: string }; Returns: undefined };
      record_verified_payment: {
        Args: { p_order_id: string; p_provider: string; p_provider_reference: string; p_verified_amount_npr: number; p_provider_payload?: Json };
        Returns: undefined;
      };
      create_payment_attempt: {
        Args: { p_order_id: string; p_provider: string };
        Returns: Array<{
          attempt_id: string;
          order_number: string;
          amount_npr: number;
          customer_email: string;
          customer_phone: string;
          attempt_status: string;
          provider_reference: string | null;
          payment_url: string | null;
          new_attempt: boolean;
        }>;
      };
      record_verified_payment_attempt: {
        Args: {
          p_attempt_id: string;
          p_provider_reference: string;
          p_provider_transaction_id: string;
          p_verified_amount_npr: number;
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
