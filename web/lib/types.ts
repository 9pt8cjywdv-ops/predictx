export type Side = "home" | "draw" | "away";
export type Probs = { home: number; away: number; draw?: number };

export interface EventInfo {
  id: string;
  sport: string;
  sport_name: string;
  league: string;
  league_name: string;
  competition: string;
  start_time: string;
  home: string;
  away: string;
  neutral: boolean;
  draw_possible: boolean;
  status: string;
}

export interface PredictionInfo {
  status: "ok" | "insufficient_data";
  predicted: Side | null;
  predicted_name: string | null;
  win_prob: number | null;
  probs: Probs | null;
  model_probs: Probs | null;
  market_probs: Probs | null;
  confidence: number;
  confidence_label: "High" | "Medium" | "Low";
  factors: Record<string, any>;
  missing: string[];
  model_version: string;
  updated_at: string;
}

export interface Item {
  event: EventInfo;
  prediction: PredictionInfo | null;
  freshness: { is_current: boolean; data_checked_at: string | null; reason: string | null };
}

export interface PredictionsResponse {
  generated_at: string;
  window: { start: string; end: string };
  top: Item[];
  ranked: Item[];
  insufficient: Item[];
  not_current: Item[];
  disclaimer: string;
}

export interface Meta {
  sports: { key: string; name: string; three_way: boolean }[];
  leagues: { key: string; sport: string; name: string; upcoming: number }[];
  odds_configured: boolean;
  sources: { source: string; scope: string; last_success: string | null; last_attempt: string | null; last_error: string | null }[];
  stale_after_hours: number;
  disclaimer: string;
}
