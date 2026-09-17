export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bot_users: {
        Row: {
          balance: number
          created_at: string
          first_name: string | null
          id: string
          is_blocked: boolean
          last_seen_at: string
          referral_code: string | null
          referral_earned: number
          referred_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          telegram_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          balance?: number
          created_at?: string
          first_name?: string | null
          id?: string
          is_blocked?: boolean
          last_seen_at?: string
          referral_code?: string | null
          referral_earned?: number
          referred_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          telegram_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          balance?: number
          created_at?: string
          first_name?: string | null
          id?: string
          is_blocked?: boolean
          last_seen_at?: string
          referral_code?: string | null
          referral_earned?: number
          referred_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          telegram_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_users_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "bot_users"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          admin_note: string | null
          bot_user_id: string
          created_at: string
          delivered_at: string | null
          id: string
          paid_at: string | null
          payment_method: string | null
          payment_reference: string | null
          product_id: string | null
          quantity: number
          status: string
          total_price: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          bot_user_id: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          product_id?: string | null
          quantity?: number
          status?: string
          total_price?: number
          unit_price?: number
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          bot_user_id?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          product_id?: string | null
          quantity?: number
          status?: string
          total_price?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_bot_user_id_fkey"
            columns: ["bot_user_id"]
            isOneToOne: false
            referencedRelation: "bot_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string
          created_at: string
          delivery_note: string | null
          description: string | null
          emoji: string | null
          id: string
          name: string
          price: number
          sale_ends_at: string | null
          sale_price: number | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          delivery_note?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          name: string
          price?: number
          sale_ends_at?: string | null
          sale_price?: number | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          delivery_note?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          name?: string
          price?: number
          sale_ends_at?: string | null
          sale_price?: number | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      referral_earnings: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_id: string | null
          referrer_id: string
          source_user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          order_id?: string | null
          referrer_id: string
          source_user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_id?: string | null
          referrer_id?: string
          source_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_earnings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_earnings_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "bot_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_earnings_source_user_id_fkey"
            columns: ["source_user_id"]
            isOneToOne: false
            referencedRelation: "bot_users"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          created_at: string
          delivered_at: string | null
          id: string
          order_id: string | null
          payload: string
          product_id: string
          status: Database["public"]["Enums"]["stock_status"]
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          id?: string
          order_id?: string | null
          payload: string
          product_id: string
          status?: Database["public"]["Enums"]["stock_status"]
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          id?: string
          order_id?: string | null
          payload?: string
          product_id?: string
          status?: Database["public"]["Enums"]["stock_status"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_updates: {
        Row: {
          chat_id: number | null
          created_at: string
          id: string
          payload: Json
          telegram_user_id: number | null
          text: string | null
          update_id: number | null
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          id?: string
          payload: Json
          telegram_user_id?: number | null
          text?: string | null
          update_id?: number | null
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          id?: string
          payload?: Json
          telegram_user_id?: number | null
          text?: string | null
          update_id?: number | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          bot_user_id: string
          created_at: string
          id: string
          order_id: string | null
          reason: string
        }
        Insert: {
          amount: number
          balance_after: number
          bot_user_id: string
          created_at?: string
          id?: string
          order_id?: string | null
          reason: string
        }
        Update: {
          amount?: number
          balance_after?: number
          bot_user_id?: string
          created_at?: string
          id?: string
          order_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_bot_user_id_fkey"
            columns: ["bot_user_id"]
            isOneToOne: false
            referencedRelation: "bot_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          address: string
          admin_note: string | null
          amount: number
          bot_user_id: string
          created_at: string
          decided_at: string | null
          id: string
          method: string
          status: string
          updated_at: string
        }
        Insert: {
          address: string
          admin_note?: string | null
          amount: number
          bot_user_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          method: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          admin_note?: string | null
          amount?: number
          bot_user_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          method?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_bot_user_id_fkey"
            columns: ["bot_user_id"]
            isOneToOne: false
            referencedRelation: "bot_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decide_withdrawal: {
        Args: { p_approve: boolean; p_note: string; p_withdrawal: string }
        Returns: undefined
      }
      deliver_order: {
        Args: { p_order: string }
        Returns: {
          payload: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      pay_referral_commission: {
        Args: { p_order: string; p_percent: number }
        Returns: number
      }
      place_order: {
        Args: { p_bot_user: string; p_product: string; p_qty?: number }
        Returns: string
      }
      release_order: {
        Args: { p_order: string; p_status: string }
        Returns: undefined
      }
      request_withdrawal: {
        Args: {
          p_address: string
          p_amount: number
          p_bot_user: string
          p_method: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "customer"
      stock_status: "available" | "reserved" | "delivered"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "customer"],
      stock_status: ["available", "reserved", "delivered"],
    },
  },
} as const
