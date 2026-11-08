export interface Tournament {
  id: string;
  title: string;
  description: string | null;
  location: string;
  court_count: number;
  start_date: string;
  end_date: string;
  created_at: string;
  status: string;
}

export interface Category {
  id: string;
  tournament_id: string;
  name: string;
  max_capacity: number;
  group_count: number;
  qualifiers_per_group: number;
  format: string;
  status: string;
  created_at: string;
  current_registered_count?: number;
  participation_format?: "SINGLES" | "DOUBLES";
  current_waitlisted_count?: number;
  draw_format?: "ROUND_ROBIN" | "SINGLE_ELIMINATION";
  target_group_size?: number;
}

export interface Registration {
  id: string;
  category_id: string;
  player_id: string;
  partner_id?: string | null;
  status: string;
  seed_number?: number | null;
  created_at: string;
}

export interface UserRegistration extends Registration {
  category_id: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  matric_number: string | null;
  is_admin: boolean;
  is_community_member: boolean;
  created_at: string;
}

export interface Match {
  id: string;
  tournament_id?: string;
  category_id: string;
  group_id: string | null;
  group_round?: number | null;
  knockout_round: number | null;
  knockout_stage: string | null;
  player_a_id: string;
  player_b_id: string;
  player_a_partner_id?: string | null;
  player_b_partner_id?: string | null;
  status: string;
  court_number: number | null;
  scheduled_time: string | null;
  estimated_start_time: string | null;
  umpire_id: string | null;
  linesman_id: string | null;
  winner_id: string | null;
  created_at: string;
  player_a_name?: string;
  player_b_name?: string;
  umpire_name?: string;
  linesman_name?: string;
  category_name?: string;
  category_status?: string;
  tournament_title?: string;
  tournament_location?: string;
  tournament_status?: string;
}
