export interface CreateAccountDto {
  handle: string;
  label?: string;
  weight?: number;
}

export interface UpsertCredentialsDto {
  auth_token: string;
  ct0: string;
}

export interface AccountResponse {
  id: string;
  handle: string;
  label: string | null;
  weight: number;
  is_default: boolean;
  is_active: boolean;
  last_fetch_at: Date | null;
  created_at: Date;
}

export interface CredentialsStatusResponse {
  connected: boolean;
  twitter_handle: string | null;
  is_valid: boolean;
  last_checked_at: Date | null;
}

export interface BirdCheckResult {
  ok: boolean;
  handle?: string;
  error?: string;
}
