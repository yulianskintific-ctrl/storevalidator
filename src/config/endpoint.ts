/**
 * Konfigurasi endpoint backend terpisah agar mudah diganti saat deployment.
 *
 * Cara mengganti ke Google Apps Script Web App produksi:
 * 1. Isi variabel lingkungan `VITE_GAS_ENDPOINT_URL` di file `.env` (atau hosting Anda),
 *    contoh: VITE_GAS_ENDPOINT_URL="https://script.google.com/macros/s/AKfycb.../exec"
 * 2. Atau ganti langsung nilai `DEFAULT_GAS_ENDPOINT_URL` di bawah ini jika tidak memakai `.env`.
 *
 * Jika kosong, aplikasi otomatis memakai endpoint lokal `/api/gas` untuk pengujian pratinjau.
 */

const DEFAULT_GAS_ENDPOINT_URL = '';

const rawEnvEndpoint =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.VITE_GAS_ENDPOINT_URL as string | undefined)
    : undefined;

const configuredGasUrl = (rawEnvEndpoint ?? DEFAULT_GAS_ENDPOINT_URL).trim();

export const ENDPOINT_CONFIG = {
  /** URL tujuan request backend (GAS Web App di produksi, atau /api/gas di mode pratinjau lokal). */
  apiUrl: configuredGasUrl || '/api/gas',
  /** True apabila menggunakan Google Apps Script Web App produksi. */
  isGoogleAppsScript: configuredGasUrl.length > 0,
  /** True apabila berjalan dengan backend pratinjau lokal karena endpoint GAS belum diisi. */
  isLocalPreview: configuredGasUrl.length === 0,
  /** Batas waktu request untuk login & ambil daftar toko (ms). */
  defaultTimeoutMs: 20_000,
  /** Batas waktu request untuk unggah foto & simpan validasi (ms). */
  saveTimeoutMs: 45_000,
} as const;
