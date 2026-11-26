import crypto from 'node:crypto';
import type { StoreRecord } from '../types/store';
import { validateCoordinates } from '../utils/validation';

export interface AccountRow {
  supervisor: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  role: 'admin' | 'supervisor';
}

export interface StoredPhoto {
  id: string;
  mimeType: 'image/jpeg' | 'image/png';
  buffer: Buffer;
}

interface SessionPayload {
  supervisor: string;
  username: string;
  role: 'admin' | 'supervisor';
  exp: number;
  nonce: string;
}

export interface PreviewAccountSeed {
  key: string;
  supervisor: string;
  username: string;
  areaLabel: string;
}

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actualBuf = Buffer.from(hashPassword(password, salt), 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function normalizeKey(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

export class StoreValidationBackend {
  private readonly accounts: AccountRow[] = [];
  private readonly stores: StoreRecord[] = [];
  private readonly photos = new Map<string, StoredPhoto>();
  private readonly activeTokens = new Map<string, SessionPayload>();
  private readonly signingSecret: Buffer;
  private lockTail: Promise<void> = Promise.resolve();

  constructor(options?: {
    signingSecret?: string;
    initialAccounts?: Array<{ supervisor: string; username: string; password: string; role?: 'admin' | 'supervisor' }>;
    initialStores?: StoreRecord[];
  }) {
    this.signingSecret = options?.signingSecret
      ? Buffer.from(options.signingSecret, 'utf8')
      : crypto.randomBytes(32);

    const accountsToSeed = options?.initialAccounts ?? [];
    for (const acc of accountsToSeed) {
      const salt = crypto.randomBytes(16).toString('hex');
      this.accounts.push({
        supervisor: acc.supervisor.trim(),
        username: acc.username.trim(),
        passwordSalt: salt,
        passwordHash: hashPassword(acc.password, salt),
        role: acc.role ?? 'supervisor',
      });
    }

    const storesToSeed = options?.initialStores ?? [];
    for (const store of storesToSeed) {
      this.stores.push({ ...store });
    }
  }

  /**
   * Mekanisme penguncian serial agar pembaruan bersamaan tidak merusak baris data.
   * Setara dengan `LockService.getScriptLock()` pada Google Apps Script.
   */
  private async withLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.lockTail;
    let release!: () => void;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private issueToken(supervisor: string, username: string, role: 'admin' | 'supervisor' = 'supervisor'): string {
    const payload: SessionPayload = {
      supervisor,
      username,
      role,
      exp: Date.now() + SESSION_TTL_MS,
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.signingSecret)
      .update(encoded)
      .digest('base64url');
    const token = `${encoded}.${signature}`;
    this.activeTokens.set(token, payload);
    return token;
  }

  public verifyToken(token: string): SessionPayload | null {
    const trimmed = String(token ?? '').trim();
    if (!trimmed) {
      return null;
    }

    const parts = trimmed.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const [encoded, providedSig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.signingSecret)
      .update(encoded)
      .digest('base64url');

    const providedBuf = Buffer.from(providedSig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return null;
    }

    const stored = this.activeTokens.get(trimmed);
    if (!stored || stored.exp < Date.now()) {
      this.activeTokens.delete(trimmed);
      return null;
    }

    return stored;
  }

  public login(username: string, password: string): {
    ok: boolean;
    token?: string;
    supervisor?: string;
    username?: string;
    role?: 'admin' | 'supervisor';
    error?: string;
    code?: string;
  } {
    const normalizedUser = normalizeKey(username);
    const rawPassword = String(password ?? '');

    if (!normalizedUser || !rawPassword) {
      return {
        ok: false,
        error: 'Username dan password wajib diisi.',
        code: 'INVALID_INPUT',
      };
    }

    const account = this.accounts.find((a) => normalizeKey(a.username) === normalizedUser);
    if (!account || !verifyPassword(rawPassword, account.passwordSalt, account.passwordHash)) {
      return {
        ok: false,
        error: 'Username atau password salah.',
        code: 'INVALID_CREDENTIALS',
      };
    }

    const token = this.issueToken(account.supervisor, account.username, account.role);
    return {
      ok: true,
      token,
      supervisor: account.supervisor,
      username: account.username,
      role: account.role,
    };
  }

  /**
   * Login cepat khusus mode pratinjau lokal (hanya berdasarkan username/supervisor non-rahasia
   * yang terdaftar di sandbox server tanpa pernah mengirim password ke frontend).
   */
  public previewLoginBySupervisor(supervisorName: string): {
    ok: boolean;
    token?: string;
    supervisor?: string;
    username?: string;
    role?: 'admin' | 'supervisor';
    error?: string;
    code?: string;
  } {
    const normalized = normalizeKey(supervisorName);
    const account = this.accounts.find((a) => normalizeKey(a.supervisor) === normalized);
    if (!account) {
      return {
        ok: false,
        error: 'Akun supervisor pratinjau tidak ditemukan.',
        code: 'NOT_FOUND',
      };
    }
    const token = this.issueToken(account.supervisor, account.username);
    return {
      ok: true,
      token,
      supervisor: account.supervisor,
      username: account.username,
      role: account.role,
    };
  }

  public logout(token: string): { ok: boolean } {
    this.activeTokens.delete(String(token ?? '').trim());
    return { ok: true };
  }

  public getStores(token: string): {
    ok: boolean;
    supervisor?: string;
    stores?: StoreRecord[];
    error?: string;
    code?: string;
  } {
    const session = this.verifyToken(token);
    if (!session) {
      return {
        ok: false,
        error: 'Sesi login telah berakhir. Silakan login kembali.',
        code: 'UNAUTHORIZED',
      };
    }

    const targetSupervisor = normalizeKey(session.supervisor);
    const scopedStores = this.stores
      .filter((row) => session.role === 'admin' || normalizeKey(row.supervisor) === targetSupervisor)
      .map((row) => ({ ...row }));

    return {
      ok: true,
      supervisor: session.supervisor,
      stores: scopedStores,
    };
  }

  public async saveValidation(
    token: string,
    input: {
      customer_id: string;
      imageBase64: string;
      mimeType: string;
      longitude: number;
      latitude: number;
    }
  ): Promise<{
    ok: boolean;
    store?: StoreRecord;
    error?: string;
    code?: string;
  }> {
    const session = this.verifyToken(token);
    if (!session) {
      return {
        ok: false,
        error: 'Sesi login telah berakhir. Silakan login kembali.',
        code: 'UNAUTHORIZED',
      };
    }
    if (session.role === 'admin') return { ok: false, error: 'Akun admin hanya dapat melihat status validasi.', code: 'FORBIDDEN' };

    const customerId = String(input.customer_id ?? '').trim();
    if (!customerId) {
      return { ok: false, error: 'Customer ID wajib diisi.', code: 'INVALID_INPUT' };
    }

    const coordCheck = validateCoordinates(Number(input.latitude), Number(input.longitude));
    if (!coordCheck.valid) {
      return {
        ok: false,
        error: coordCheck.error ?? 'Koordinat GPS tidak valid.',
        code: 'INVALID_COORDINATES',
      };
    }

    const mimeType = input.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const rawBase64 = String(input.imageBase64 ?? '').replace(
      /^data:image\/(jpeg|png);base64,/i,
      ''
    );
    if (!rawBase64 || !/^[A-Za-z0-9+/=\s]+$/.test(rawBase64)) {
      return { ok: false, error: 'Format foto tidak valid.', code: 'INVALID_IMAGE' };
    }

    const imageBuffer = Buffer.from(rawBase64, 'base64');
    if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: 'Ukuran foto tidak valid atau melebihi batas 8 MB.',
        code: 'INVALID_IMAGE',
      };
    }

    return this.withLock(() => {
      const targetIndex = this.stores.findIndex(
        (row) => normalizeKey(row.customer_id) === normalizeKey(customerId)
      );

      if (targetIndex === -1) {
        return {
          ok: false,
          error: 'Data toko tidak ditemukan pada sheet Validasi Long Lad.',
          code: 'STORE_NOT_FOUND',
        };
      }

      const existingRow = this.stores[targetIndex];
      if (normalizeKey(existingRow.supervisor) !== normalizeKey(session.supervisor)) {
        return {
          ok: false,
          error: 'Akses ditolak. Toko ini tidak berada dalam cakupan supervisor Anda.',
          code: 'FORBIDDEN',
        };
      }

      // Simpan foto dan dapatkan URL
      const photoId = `photo_${crypto.randomBytes(12).toString('hex')}`;
      this.photos.set(photoId, {
        id: photoId,
        mimeType,
        buffer: imageBuffer,
      });

      const pictureUrl = `/api/photos/${photoId}`;

      // Perbarui HANYA tiga kolom: picture, longitude, latitude pada baris yang sudah ada.
      // Jangan mengubah kolom lain dan jangan menambahkan baris baru.
      const updatedRow: StoreRecord = {
        ...existingRow,
        picture: pictureUrl,
        longitude: Number(input.longitude).toFixed(6),
        latitude: Number(input.latitude).toFixed(6),
      };

      this.stores[targetIndex] = updatedRow;

      return {
        ok: true,
        store: { ...updatedRow },
      };
    });
  }

  public getPhoto(photoId: string): StoredPhoto | null {
    if (!/^photo_[a-f0-9]{24}$/.test(photoId)) {
      return null;
    }
    return this.photos.get(photoId) ?? null;
  }

  /** Helper untuk pengujian unit agar dapat memverifikasi jumlah baris tidak pernah bertambah. */
  public getTotalRowCount(): number {
    return this.stores.length;
  }
}

export function createDefaultPreviewStores(): StoreRecord[] {
  return [
    {
      keterangan: 'Outlet Utama',
      distributor_code: 'DIST-JKT-01',
      customer_id: 'CUST-1001',
      customer_name: 'Toko Sinar Jaya Makmur',
      distributor_branch: 'Jakarta Selatan',
      supervisor: 'Budi Santoso',
      address: 'Jl. Melati No. 10',
      city: 'Jakarta Selatan',
      picture: '',
      longitude: '',
      latitude: '',
    },
    {
      keterangan: 'Perlu Pembaruan Titik',
      distributor_code: 'DIST-JKT-01',
      customer_id: 'CUST-1002',
      customer_name: 'Warung Berkah Mandiri',
      distributor_branch: 'Jakarta Selatan',
      supervisor: 'Budi Santoso',
      address: 'Jl. Mawar No. 21',
      city: 'Jakarta Selatan',
      picture: '',
      longitude: '',
      latitude: '',
    },
    {
      keterangan: 'Sudah Survei Kuartal 1',
      distributor_code: 'DIST-JKT-02',
      customer_id: 'CUST-1003',
      customer_name: 'Toko Sejahtera',
      distributor_branch: 'Jakarta Barat',
      supervisor: 'Budi Santoso',
      address: 'Jl. Anggrek No. 5',
      city: 'Jakarta Barat',
      picture: '/src/assets/images/demo_storefront_preview_1795516225785.jpg',
      longitude: '106.789120',
      latitude: '-6.178450',
    },
    {
      keterangan: 'Outlet Grosir',
      distributor_code: 'DIST-JKT-02',
      customer_id: 'CUST-1004',
      customer_name: 'UD Sumber Rejeki Abadi',
      distributor_branch: 'Jakarta Timur',
      supervisor: 'Budi Santoso',
      address: 'Jl. Kenanga No. 9',
      city: 'Jakarta Timur',
      picture: '',
      longitude: '',
      latitude: '',
    },
    {
      keterangan: 'Toko Langganan',
      distributor_code: 'DIST-JKT-03',
      customer_id: 'CUST-1005',
      customer_name: 'Kios Harapan Baru',
      distributor_branch: 'Jakarta Pusat',
      supervisor: 'Budi Santoso',
      address: 'Jl. Kamboja No. 2',
      city: 'Jakarta Pusat',
      picture: '',
      longitude: '',
      latitude: '',
    },
    {
      keterangan: 'Outlet Utama',
      distributor_code: 'DIST-BDG-01',
      customer_id: 'CUST-2001',
      customer_name: 'Toko Parahyangan Sejahtera',
      distributor_branch: 'Bandung Kota',
      supervisor: 'Siti Rahayu',
      address: 'Jl. Asia Afrika No. 1',
      city: 'Bandung',
      picture: '',
      longitude: '',
      latitude: '',
    },
    {
      keterangan: 'Outlet Semi Grosir',
      distributor_code: 'DIST-BDG-01',
      customer_id: 'CUST-2002',
      customer_name: 'Minimarket Cihampelas Jaya',
      distributor_branch: 'Bandung Utara',
      supervisor: 'Siti Rahayu',
      address: 'Jl. Cihampelas No. 8',
      city: 'Bandung',
      picture: '',
      longitude: '',
      latitude: '',
    },
    {
      keterangan: 'Cabang Baru',
      distributor_code: 'DIST-BDG-02',
      customer_id: 'CUST-2003',
      customer_name: 'Warung Sunda Lestari',
      distributor_branch: 'Cimahi',
      supervisor: 'Siti Rahayu',
      address: 'Jl. Gatot Subroto No. 3',
      city: 'Cimahi',
      picture: '',
      longitude: '',
      latitude: '',
    },
  ];
}
