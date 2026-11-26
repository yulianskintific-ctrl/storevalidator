export interface StoreRecord {
  keterangan: string;
  distributor_code: string;
  customer_id: string;
  customer_name: string;
  distributor_branch: string;
  supervisor: string;
  address?: string;
  city?: string;
  picture: string;
  longitude: string;
  latitude: string;
  syncStatus?: 'pending' | 'synced';
}

export interface SessionInfo {
  token: string;
  supervisor: string;
  username: string;
  role: 'admin' | 'supervisor';
}

export interface CapturedEvidence {
  imageDataUrl: string;
  mimeType: 'image/jpeg' | 'image/png';
  longitude: number;
  latitude: number;
  capturedAt: string;
}

export type StatusFilter = 'all' | 'pending' | 'validated';

export interface LoginResponse {
  ok: boolean;
  token?: string;
  supervisor?: string;
  username?: string;
  role?: 'admin' | 'supervisor';
  error?: string;
  code?: string;
}

export interface StoresResponse {
  ok: boolean;
  supervisor?: string;
  stores?: StoreRecord[];
  error?: string;
  code?: string;
}

export interface SaveValidationPayload {
  customer_id: string;
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png';
  longitude: number;
  latitude: number;
}

export interface SaveValidationResponse {
  ok: boolean;
  store?: StoreRecord;
  error?: string;
  code?: string;
}
