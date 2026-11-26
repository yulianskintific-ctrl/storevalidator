/**
 * Fallback backend for /api/gas on Netlify.
 * Used ONLY when VITE_GAS_ENDPOINT_URL is not set at build time (the frontend then calls /api/gas).
 * Serves DEMO data (in-memory, not persistent). Set VITE_GAS_ENDPOINT_URL to your Google Apps
 * Script Web App URL and redeploy to use the real Google Sheets/Drive backend instead.
 */
import crypto from 'node:crypto';
import { StoreValidationBackend, createDefaultPreviewStores } from '../../src/server/storeLogic';

const backend = new StoreValidationBackend({
  signingSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  initialAccounts: [
    { supervisor: 'Budi Santoso', username: 'budi.spv', password: process.env.PREVIEW_BUDI_PASSWORD || crypto.randomBytes(16).toString('hex') },
    { supervisor: 'Siti Rahayu', username: 'siti.spv', password: process.env.PREVIEW_SITI_PASSWORD || crypto.randomBytes(16).toString('hex') },
  ],
  initialStores: createDefaultPreviewStores(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req: Request) => {
  const url = new URL(req.url);

  const photoMatch = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
  if (photoMatch) {
    const photo = backend.getPhoto(decodeURIComponent(photoMatch[1]));
    if (!photo) return json({ ok: false, error: 'Foto tidak ditemukan.' }, 404);
    return new Response(new Uint8Array(photo.buffer), {
      headers: { 'Content-Type': photo.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' },
    });
  }

  if (req.method !== 'POST') return json({ ok: true, service: 'Store Location Validation API (demo)' });

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await req.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed;
  } catch {
    return json({ ok: false, error: 'Format permintaan tidak valid.', code: 'BAD_REQUEST' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  try {
    switch (action) {
      case 'login': {
        const r = backend.login(String(body.username ?? ''), String(body.password ?? ''));
        return json(r, r.ok ? 200 : 401);
      }
      case 'previewLogin': {
        const r = backend.previewLoginBySupervisor(String(body.supervisor ?? ''));
        return json(r, r.ok ? 200 : 404);
      }
      case 'logout':
        return json(backend.logout(token));
      case 'getStores': {
        const r = backend.getStores(token);
        return json(r, r.ok ? 200 : 401);
      }
      case 'saveValidation': {
        const r = await backend.saveValidation(token, {
          customer_id: String(body.customer_id ?? ''),
          imageBase64: String(body.imageBase64 ?? ''),
          mimeType: String(body.mimeType ?? 'image/jpeg'),
          longitude: Number(body.longitude),
          latitude: Number(body.latitude),
        });
        return json(r, r.ok ? 200 : r.code === 'UNAUTHORIZED' ? 401 : r.code === 'FORBIDDEN' ? 403 : r.code === 'STORE_NOT_FOUND' ? 404 : 400);
      }
      default:
        return json({ ok: false, error: 'Aksi tidak dikenali.', code: 'UNKNOWN_ACTION' }, 400);
    }
  } catch {
    return json({ ok: false, error: 'Terjadi kesalahan internal pada server.', code: 'INTERNAL_ERROR' }, 500);
  }
};

export const config = { path: ['/api/gas', '/api/photos/:id'] };
