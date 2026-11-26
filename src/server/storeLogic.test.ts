import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreValidationBackend, createDefaultPreviewStores } from './storeLogic';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function createTestBackend() {
  const stores = createDefaultPreviewStores();
  // Kosongkan gambar invalid agar baris awal konsisten
  stores[2] = { ...stores[2], picture: '', longitude: '', latitude: '' };
  return new StoreValidationBackend({
    signingSecret: 'unit-test-secret-key',
    initialAccounts: [
      { supervisor: 'Budi Santoso', username: 'budi.spv', password: 'secret-budi-pass' },
      { supervisor: 'Siti Rahayu', username: 'siti.spv', password: 'secret-siti-pass' },
    ],
    initialStores: stores,
  });
}

test('login verifies credentials and never exposes passwords or other accounts', () => {
  const backend = createTestBackend();

  const badLogin = backend.login('budi.spv', 'wrong-password');
  assert.equal(badLogin.ok, false);
  assert.equal(badLogin.token, undefined);

  const emptyLogin = backend.login('', '');
  assert.equal(emptyLogin.ok, false);

  const goodLogin = backend.login('BUDI.SPV', 'secret-budi-pass');
  assert.equal(goodLogin.ok, true);
  assert.equal(goodLogin.supervisor, 'Budi Santoso');
  assert.ok(goodLogin.token);
  assert.equal('password' in goodLogin, false);
});

test('getStores enforces backend supervisor isolation and rejects unauthenticated requests', () => {
  const backend = createTestBackend();

  const unauth = backend.getStores('invalid.token');
  assert.equal(unauth.ok, false);
  assert.equal(unauth.code, 'UNAUTHORIZED');

  const budiAuth = backend.login('budi.spv', 'secret-budi-pass');
  const budiStores = backend.getStores(budiAuth.token!);
  assert.equal(budiStores.ok, true);
  assert.equal(budiStores.stores?.length, 5);
  assert.ok(budiStores.stores?.every((s) => s.supervisor === 'Budi Santoso'));

  const sitiAuth = backend.login('siti.spv', 'secret-siti-pass');
  const sitiStores = backend.getStores(sitiAuth.token!);
  assert.equal(sitiStores.ok, true);
  assert.equal(sitiStores.stores?.length, 3);
  assert.ok(sitiStores.stores?.every((s) => s.supervisor === 'Siti Rahayu'));
});

test('saveValidation rejects cross-supervisor update attempts', async () => {
  const backend = createTestBackend();
  const budiAuth = backend.login('budi.spv', 'secret-budi-pass');

  // CUST-2001 adalah milik Siti Rahayu, bukan Budi Santoso
  const forbidden = await backend.saveValidation(budiAuth.token!, {
    customer_id: 'CUST-2001',
    imageBase64: TINY_PNG_BASE64,
    mimeType: 'image/png',
    longitude: 107.619123,
    latitude: -6.917464,
  });

  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.code, 'FORBIDDEN');
});

test('saveValidation updates ONLY picture, longitude, and latitude on existing row without adding rows', async () => {
  const backend = createTestBackend();
  const initialRowCount = backend.getTotalRowCount();
  const budiAuth = backend.login('budi.spv', 'secret-budi-pass');

  const firstSave = await backend.saveValidation(budiAuth.token!, {
    customer_id: 'CUST-1001',
    imageBase64: TINY_PNG_BASE64,
    mimeType: 'image/png',
    longitude: 106.827153,
    latitude: -6.175392,
  });

  assert.equal(firstSave.ok, true);
  assert.equal(backend.getTotalRowCount(), initialRowCount);
  assert.equal(firstSave.store?.keterangan, 'Outlet Utama');
  assert.equal(firstSave.store?.distributor_code, 'DIST-JKT-01');
  assert.equal(firstSave.store?.customer_name, 'Toko Sinar Jaya Makmur');
  assert.equal(firstSave.store?.distributor_branch, 'Jakarta Selatan');
  assert.equal(firstSave.store?.supervisor, 'Budi Santoso');
  assert.equal(firstSave.store?.longitude, '106.827153');
  assert.equal(firstSave.store?.latitude, '-6.175392');
  assert.match(firstSave.store?.picture ?? '', /^\/api\/photos\/photo_/);

  // Validasi ulang harus menimpa baris yang sama, bukan menambah baris baru
  const secondSave = await backend.saveValidation(budiAuth.token!, {
    customer_id: 'CUST-1001',
    imageBase64: TINY_PNG_BASE64,
    mimeType: 'image/png',
    longitude: 106.830001,
    latitude: -6.180002,
  });

  assert.equal(secondSave.ok, true);
  assert.equal(backend.getTotalRowCount(), initialRowCount);
  assert.equal(secondSave.store?.longitude, '106.830001');
  assert.equal(secondSave.store?.latitude, '-6.180002');
  assert.notEqual(secondSave.store?.picture, firstSave.store?.picture);
});

test('saveValidation rejects invalid coordinates and preserves concurrency via lock', async () => {
  const backend = createTestBackend();
  const budiAuth = backend.login('budi.spv', 'secret-budi-pass');

  const badCoord = await backend.saveValidation(budiAuth.token!, {
    customer_id: 'CUST-1002',
    imageBase64: TINY_PNG_BASE64,
    mimeType: 'image/png',
    longitude: 240,
    latitude: -6.2,
  });
  assert.equal(badCoord.ok, false);
  assert.equal(badCoord.code, 'INVALID_COORDINATES');

  // Uji dua penyimpanan bersamaan terhadap dua toko milik supervisor yang sama
  const [resA, resB] = await Promise.all([
    backend.saveValidation(budiAuth.token!, {
      customer_id: 'CUST-1002',
      imageBase64: TINY_PNG_BASE64,
      mimeType: 'image/png',
      longitude: 106.811111,
      latitude: -6.211111,
    }),
    backend.saveValidation(budiAuth.token!, {
      customer_id: 'CUST-1004',
      imageBase64: TINY_PNG_BASE64,
      mimeType: 'image/png',
      longitude: 106.844444,
      latitude: -6.244444,
    }),
  ]);

  assert.equal(resA.ok, true);
  assert.equal(resB.ok, true);
  assert.equal(resA.store?.customer_id, 'CUST-1002');
  assert.equal(resB.store?.customer_id, 'CUST-1004');
});
