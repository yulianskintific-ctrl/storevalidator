import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  StoreValidationBackend,
  createDefaultPreviewStores,
} from './src/server/storeLogic';

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Inisialisasi backend pratinjau lokal.
 * Akun contoh hanya tersimpan di sisi server (password di-hash dengan scrypt dan
 * tidak pernah dikirim ke frontend).
 * Di produksi dengan Google Apps Script, frontend mengarah langsung ke VITE_GAS_ENDPOINT_URL.
 */
const previewBackend = new StoreValidationBackend({
  signingSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  initialAccounts: [
    {
      supervisor: 'Budi Santoso',
      username: 'budi.spv',
      password: process.env.PREVIEW_BUDI_PASSWORD || crypto.randomBytes(16).toString('hex'),
    },
    {
      supervisor: 'Siti Rahayu',
      username: 'siti.spv',
      password: process.env.PREVIEW_SITI_PASSWORD || crypto.randomBytes(16).toString('hex'),
    },
  ],
  initialStores: createDefaultPreviewStores(),
});

function parseRequestBody(rawBody: unknown): Record<string, unknown> | null {
  if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    return rawBody as Record<string, unknown>;
  }
  if (typeof rawBody === 'string' && rawBody.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function extractToken(req: express.Request, body: Record<string, unknown>): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return typeof body.token === 'string' ? body.token.trim() : '';
}

async function startServer() {
  const app = express();

  app.disable('x-powered-by');
  // Mendukung text/plain (sama seperti request ke Google Apps Script) dan application/json
  app.use(express.text({ type: 'text/plain', limit: '12mb' }));
  app.use(express.json({ limit: '12mb' }));

  app.post('/api/gas', async (req, res) => {
    const body = parseRequestBody(req.body);
    if (!body) {
      res.status(400).json({ ok: false, error: 'Format permintaan tidak valid.', code: 'BAD_REQUEST' });
      return;
    }

    const action = typeof body.action === 'string' ? body.action.trim() : '';

    try {
      if (action === 'login') {
        const result = previewBackend.login(
          String(body.username ?? ''),
          String(body.password ?? '')
        );
        res.status(result.ok ? 200 : 401).json(result);
        return;
      }

      if (action === 'previewLogin') {
        const result = previewBackend.previewLoginBySupervisor(String(body.supervisor ?? ''));
        res.status(result.ok ? 200 : 404).json(result);
        return;
      }

      if (action === 'logout') {
        const token = extractToken(req, body);
        res.json(previewBackend.logout(token));
        return;
      }

      if (action === 'getStores') {
        const token = extractToken(req, body);
        const result = previewBackend.getStores(token);
        res.status(result.ok ? 200 : 401).json(result);
        return;
      }

      if (action === 'saveValidation') {
        const token = extractToken(req, body);
        const result = await previewBackend.saveValidation(token, {
          customer_id: String(body.customer_id ?? ''),
          imageBase64: String(body.imageBase64 ?? ''),
          mimeType: String(body.mimeType ?? 'image/jpeg'),
          longitude: Number(body.longitude),
          latitude: Number(body.latitude),
        });
        const statusCode = result.ok
          ? 200
          : result.code === 'UNAUTHORIZED'
            ? 401
            : result.code === 'FORBIDDEN'
              ? 403
              : result.code === 'STORE_NOT_FOUND'
                ? 404
                : 400;
        res.status(statusCode).json(result);
        return;
      }

      res.status(400).json({ ok: false, error: 'Aksi tidak dikenali.', code: 'UNKNOWN_ACTION' });
    } catch {
      res.status(500).json({
        ok: false,
        error: 'Terjadi kesalahan internal pada server.',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  app.get('/api/photos/:id', (req, res) => {
    const photo = previewBackend.getPhoto(req.params.id);
    if (!photo) {
      res.status(404).json({ ok: false, error: 'Foto tidak ditemukan.' });
      return;
    }
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(photo.buffer);
  });

  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build belum tersedia. Jalankan npm run build terlebih dahulu.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Store Location Validation server berjalan di http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
