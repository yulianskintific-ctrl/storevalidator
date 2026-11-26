import type { StatusFilter, StoreRecord } from '../types/store';

/**
 * Toko dianggap sudah divalidasi jika kolom `picture`, `longitude`, dan `latitude`
 * seluruhnya telah terisi dengan nilai yang valid.
 */
export function isStoreValidated(store: Pick<StoreRecord, 'picture' | 'longitude' | 'latitude'>): boolean {
  if ('syncStatus' in store && store.syncStatus === 'pending') return false;
  const picture = String(store.picture ?? '').trim();
  const longitude = String(store.longitude ?? '').trim();
  const latitude = String(store.latitude ?? '').trim();

  if (!picture || !longitude || !latitude) {
    return false;
  }

  const parsedLng = Number(longitude);
  const parsedLat = Number(latitude);

  return validateCoordinates(parsedLat, parsedLng).valid;
}

export interface CoordinateValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCoordinates(latitude: number, longitude: number): CoordinateValidationResult {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, error: 'Koordinat GPS tidak valid.' };
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { valid: false, error: 'Koordinat GPS tidak valid.' };
  }
  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: 'Nilai latitude berada di luar rentang yang valid (-90 sampai 90).' };
  }
  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: 'Nilai longitude berada di luar rentang yang valid (-180 sampai 180).' };
  }
  return { valid: true };
}

export function formatCoordinate(value: string | number): string {
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num)) {
    return '-';
  }
  return num.toFixed(6);
}

/**
 * Menyaring daftar toko berdasarkan pencarian nama toko (`customer_name`) atau `customer_id`,
 * serta filter status validasi.
 */
export function filterStores(
  stores: StoreRecord[],
  searchQuery: string,
  statusFilter: StatusFilter = 'all'
): StoreRecord[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return stores.filter((store) => {
    const validated = isStoreValidated(store);
    if (statusFilter === 'validated' && !validated) {
      return false;
    }
    if (statusFilter === 'pending' && validated) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const nameMatch = store.customer_name.toLowerCase().includes(normalizedQuery);
    const idMatch = store.customer_id.toLowerCase().includes(normalizedQuery);
    return nameMatch || idMatch;
  });
}

export interface ValidationStats {
  total: number;
  validated: number;
  pending: number;
}

export function summarizeValidationStats(stores: StoreRecord[]): ValidationStats {
  let validated = 0;
  for (const store of stores) {
    if (isStoreValidated(store)) {
      validated += 1;
    }
  }
  return {
    total: stores.length,
    validated,
    pending: stores.length - validated,
  };
}

const SAFE_DATA_IMAGE_PREFIX = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const DRIVE_FILE_REGEX = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/;

/**
 * Memastikan URL gambar aman untuk ditampilkan di atribut `src` dan mengonversi
 * tautan berbagi Google Drive menjadi URL pratinjau yang dapat dirender oleh `<img>`.
 */
export function getSafeImageUrl(rawUrl: string): string | null {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    return null;
  }

  if (SAFE_DATA_IMAGE_PREFIX.test(trimmed)) {
    return trimmed;
  }

  if (
    (trimmed.startsWith('/api/photos/') && /^\/api\/photos\/[A-Za-z0-9_-]+$/.test(trimmed)) ||
    (trimmed.startsWith('/src/assets/images/') &&
      /^\/src\/assets\/images\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/i.test(trimmed))
  ) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    const driveMatch = trimmed.match(DRIVE_FILE_REGEX);
    if (driveMatch && driveMatch[1]) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveMatch[1])}&sz=w1200`;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function getSafeExternalLink(rawUrl: string): string | null {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}
