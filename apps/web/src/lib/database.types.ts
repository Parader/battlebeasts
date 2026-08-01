export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
    public: {
        Tables: {
            profiles: {
                Row: {
                    id: string;
                    display_name: string;
                    avatar_url: string | null;
                    color: string;
                    pattern: string;
                    pattern_color: string;
                    name_confirmed: boolean;
                    name_changed_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id: string;
                    display_name?: string;
                    avatar_url?: string | null;
                    color?: string;
                    pattern?: string;
                    pattern_color?: string;
                    name_confirmed?: boolean;
                    name_changed_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    display_name?: string;
                    avatar_url?: string | null;
                    color?: string;
                    pattern?: string;
                    pattern_color?: string;
                    name_confirmed?: boolean;
                    name_changed_at?: string | null;
                    updated_at?: string;
                };
            };
            inventory: {
                Row: {
                    user_id: string;
                    resource_id: string;
                    quantity: number;
                };
                Insert: {
                    user_id: string;
                    resource_id: string;
                    quantity?: number;
                };
                Update: {
                    quantity?: number;
                };
            };
            loadouts: {
                Row: {
                    user_id: string;
                    ability_ids: string[];
                    updated_at: string;
                };
                Insert: {
                    user_id: string;
                    ability_ids?: string[];
                    updated_at?: string;
                };
                Update: {
                    ability_ids?: string[];
                    updated_at?: string;
                };
            };
            talents: {
                Row: {
                    user_id: string;
                    talent_ids: string[];
                    updated_at: string;
                };
                Insert: {
                    user_id: string;
                    talent_ids?: string[];
                    updated_at?: string;
                };
                Update: {
                    talent_ids?: string[];
                    updated_at?: string;
                };
            };
        };
        Functions: {
            claim_display_name: {
                Args: { desired_name: string };
                Returns: Database["public"]["Tables"]["profiles"]["Row"];
            };
        };
    };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
