import { ENDPOINT_CONFIG } from '../config/endpoint';
import type {
  LoginResponse,
  SaveValidationPayload,
  SaveValidationResponse,
  StoresResponse,
} from '../types/store';

export class ApiError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function postToBackend<T extends { ok: boolean; error?: string; code?: string }>(
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(
      'Tidak ada koneksi internet. Periksa jaringan Anda lalu coba lagi.',
      'OFFLINE'
    );
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Google Apps Script Web App tidak mendukung CORS preflight (OPTIONS) untuk application/json.
    // Mengirim JSON sebagai text/plain;charset=utf-8 menjaga request tetap "simple request"
    // yang dapat diproses langsung oleh doPost(e) pada Google Apps Script maupun server.ts lokal.
    const response = await fetch(ENDPOINT_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow',
    });

    const rawText = await response.text();
    let parsed: T;

    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      throw new ApiError(
        'Respons server tidak dapat dibaca. Pastikan URL Google Apps Script sudah benar dan di-deploy sebagai Web App.',
        'INVALID_RESPONSE'
      );
    }

    if (!parsed || typeof parsed.ok !== 'boolean') {
      throw new ApiError('Format respons backend tidak valid.', 'INVALID_RESPONSE');
    }

    if (!parsed.ok) {
      throw new ApiError(
        parsed.error || 'Permintaan gagal diproses oleh server.',
        parsed.code || 'BACKEND_ERROR'
      );
    }

    return parsed;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'Waktu koneksi habis. Periksa kestabilan jaringan internet Anda lalu coba kembali.',
        'TIMEOUT'
      );
    }
    throw new ApiError(
      'Gagal terhubung ke server. Periksa koneksi internet dan konfigurasi endpoint.',
      'NETWORK_ERROR'
    );
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loginWithAccount(
  username: string,
  password: string
): Promise<LoginResponse> {
  return postToBackend<LoginResponse>(
    {
      action: 'login',
      username: username.trim(),
      password,
    },
    ENDPOINT_CONFIG.defaultTimeoutMs
  );
}

export async function loginPreviewSupervisor(supervisor: string): Promise<LoginResponse> {
  return postToBackend<LoginResponse>(
    {
      action: 'previewLogin',
      supervisor,
    },
    ENDPOINT_CONFIG.defaultTimeoutMs
  );
}

export async function logoutSession(token: string): Promise<void> {
  try {
    await postToBackend<{ ok: boolean; error?: string; code?: string }>(
      {
        action: 'logout',
        token,
      },
      10_000
    );
  } catch {
    // Tetap bersihkan sesi lokal meskipun jaringan sedang terputus
  }
}

export async function fetchSupervisorStores(token: string): Promise<StoresResponse> {
  return postToBackend<StoresResponse>(
    {
      action: 'getStores',
      token,
    },
    ENDPOINT_CONFIG.defaultTimeoutMs
  );
}

export async function saveStoreValidation(
  token: string,
  data: SaveValidationPayload
): Promise<SaveValidationResponse> {
  return postToBackend<SaveValidationResponse>(
    {
      action: 'saveValidation',
      token,
      customer_id: data.customer_id,
      imageBase64: data.imageBase64,
      mimeType: data.mimeType,
      longitude: data.longitude,
      latitude: data.latitude,
    },
    ENDPOINT_CONFIG.saveTimeoutMs
  );
}
