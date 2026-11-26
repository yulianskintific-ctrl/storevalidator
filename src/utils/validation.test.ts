import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterStores,
  formatCoordinate,
  getSafeExternalLink,
  getSafeImageUrl,
  isStoreValidated,
  summarizeValidationStats,
  validateCoordinates,
} from './validation';
import type { StoreRecord } from '../types/store';

const sampleStores: StoreRecord[] = [
  {
    keterangan: 'Toko Aktif',
    distributor_code: 'DIST-01',
    customer_id: 'CUST-1001',
    customer_name: 'Toko Sinar Jaya',
    distributor_branch: 'Jakarta Selatan',
    supervisor: 'Budi Santoso',
    picture: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view',
    longitude: '106.827153',
    latitude: '-6.175392',
  },
  {
    keterangan: 'Prioritas',
    distributor_code: 'DIST-01',
    customer_id: 'CUST-1002',
    customer_name: 'Warung Berkah Mandiri',
    distributor_branch: 'Jakarta Barat',
    supervisor: 'Budi Santoso',
    picture: '',
    longitude: '',
    latitude: '',
  },
  {
    keterangan: 'Perlu Foto Ulang',
    distributor_code: 'DIST-02',
    customer_id: 'CUST-1003',
    customer_name: 'Minimarket Maju Bersama',
    distributor_branch: 'Jakarta Timur',
    supervisor: 'Budi Santoso',
    picture: 'https://drive.google.com/file/d/1XyZaBcDeFgHiJkLmNo/view',
    longitude: '106.900100',
    latitude: '',
  },
];

test('isStoreValidated returns true only when picture, longitude, and latitude are all filled and valid', () => {
  assert.equal(isStoreValidated(sampleStores[0]), true);
  assert.equal(isStoreValidated(sampleStores[1]), false);
  assert.equal(isStoreValidated(sampleStores[2]), false);
  assert.equal(
    isStoreValidated({ picture: '   ', longitude: '106.8', latitude: '-6.2' }),
    false
  );
  assert.equal(
    isStoreValidated({ picture: 'https://example.com/a.jpg', longitude: '999', latitude: '-6.2' }),
    false
  );
});

test('validateCoordinates enforces finite latitude and longitude bounds', () => {
  assert.equal(validateCoordinates(-6.2088, 106.8456).valid, true);
  assert.equal(validateCoordinates(90, -180).valid, true);
  assert.equal(validateCoordinates(91, 106.8).valid, false);
  assert.equal(validateCoordinates(-6.2, 181).valid, false);
  assert.equal(validateCoordinates(Number.NaN, 106.8).valid, false);
});

test('formatCoordinate renders fixed 6 decimal digits or dash for invalid input', () => {
  assert.equal(formatCoordinate(-6.1753924), '-6.175392');
  assert.equal(formatCoordinate('106.8271'), '106.827100');
  assert.equal(formatCoordinate('invalid'), '-');
});

test('filterStores searches by customer_name or customer_id and filters by validation status', () => {
  assert.equal(filterStores(sampleStores, '', 'all').length, 3);
  assert.equal(filterStores(sampleStores, '', 'validated').length, 1);
  assert.equal(filterStores(sampleStores, '', 'pending').length, 2);

  const byName = filterStores(sampleStores, 'berkah', 'all');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].customer_id, 'CUST-1002');

  const byId = filterStores(sampleStores, 'cust-1003', 'all');
  assert.equal(byId.length, 1);
  assert.equal(byId[0].customer_name, 'Minimarket Maju Bersama');

  const combined = filterStores(sampleStores, 'sinar', 'pending');
  assert.equal(combined.length, 0);
});

test('summarizeValidationStats computes accurate counts', () => {
  assert.deepEqual(summarizeValidationStats(sampleStores), {
    total: 3,
    validated: 1,
    pending: 2,
  });
});

test('getSafeImageUrl converts Google Drive links and blocks unsafe schemes', () => {
  assert.equal(
    getSafeImageUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view'),
    'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQr&sz=w1200'
  );
  assert.equal(getSafeImageUrl('/api/photos/photo_12345'), '/api/photos/photo_12345');
  assert.equal(getSafeImageUrl('javascript:alert(1)'), null);
  assert.equal(getSafeImageUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(getSafeExternalLink('javascript:alert(1)'), null);
  assert.equal(
    getSafeExternalLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view'),
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view'
  );
});
