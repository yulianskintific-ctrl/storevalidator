/**
 * Store Location Validation - Google Apps Script Backend
 *
 * Spreadsheet:
 * - Sheet "Validasi Long Lad":
 *   keterangan | distributor_code | customer_id | customer_name | distributor_branch | supervisor | address | city | picture | longitude | latitude
 * - Sheet "Account":
 *   supervisor | username | password | role
 *
 * Konfigurasi Script Properties (Project Settings -> Script Properties):
 * - SPREADSHEET_ID  : ID Google Spreadsheet (opsional jika script terikat / container-bound ke spreadsheet)
 * - DRIVE_FOLDER_ID : ID Folder Google Drive tempat menyimpan foto validasi toko (WAJIB)
 * - TOKEN_SECRET    : Kunci rahasia acak minimal 32 karakter untuk menandatangani token sesi (WAJIB)
 */

var SHEET_STORES = 'Validasi Long Lad';
var SHEET_ACCOUNT = 'Account';
var SESSION_TTL_SECONDS = 21600; // 6 jam
var MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'Store Location Validation API',
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        ok: false,
        error: 'Permintaan kosong atau tidak valid.',
        code: 'BAD_REQUEST',
      });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({
        ok: false,
        error: 'Format JSON tidak valid.',
        code: 'BAD_REQUEST',
      });
    }

    var action = String(body.action || '').trim();

    if (action === 'login') {
      return jsonResponse(handleLogin(body));
    }
    if (action === 'logout') {
      return jsonResponse(handleLogout(body));
    }
    if (action === 'getStores') {
      return jsonResponse(handleGetStores(body));
    }
    if (action === 'saveValidation') {
      return jsonResponse(handleSaveValidation(body));
    }

    return jsonResponse({
      ok: false,
      error: 'Aksi tidak dikenali.',
      code: 'UNKNOWN_ACTION',
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'Terjadi kesalahan pada server: ' + (err && err.message ? err.message : String(err)),
      code: 'INTERNAL_ERROR',
    });
  }
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  var driveFolderId = String(props.getProperty('DRIVE_FOLDER_ID') || '').trim();
  var tokenSecret = String(props.getProperty('TOKEN_SECRET') || '').trim();

  if (!tokenSecret) {
    // Membuat secret otomatis sekali jika belum diisi manual di Script Properties
    tokenSecret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', tokenSecret);
  }

  return {
    spreadsheetId: spreadsheetId,
    driveFolderId: driveFolderId,
    tokenSecret: tokenSecret,
  };
}

function getSpreadsheet() {
  var cfg = getConfig();
  if (cfg.spreadsheetId) {
    return SpreadsheetApp.openById(cfg.spreadsheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('SPREADSHEET_ID belum dikonfigurasi pada Script Properties.');
  }
  return active;
}

function getHeaderMap(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('Sheet "' + sheet.getName() + '" tidak memiliki header kolom.');
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').trim().toLowerCase();
    if (key) {
      map[key] = i;
    }
  }
  return map;
}

function requireColumns(headerMap, requiredColumns, sheetName) {
  for (var i = 0; i < requiredColumns.length; i++) {
    var col = requiredColumns[i];
    if (typeof headerMap[col] !== 'number') {
      throw new Error('Kolom "' + col + '" tidak ditemukan pada sheet "' + sheetName + '".');
    }
  }
}

function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function constantTimeEquals(a, b) {
  var strA = String(a || '');
  var strB = String(b || '');
  var maxLen = Math.max(strA.length, strB.length);
  var diff = strA.length ^ strB.length;
  for (var i = 0; i < maxLen; i++) {
    var codeA = i < strA.length ? strA.charCodeAt(i) : 0;
    var codeB = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}

function signTokenData(encodedPayload, secret) {
  var rawSig = Utilities.computeHmacSha256Signature(encodedPayload, secret);
  return Utilities.base64EncodeWebSafe(rawSig);
}

function issueSessionToken(supervisor, username, role) {
  var cfg = getConfig();
  var sessionId = Utilities.getUuid();
  var expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  var payloadObj = {
    sid: sessionId,
    supervisor: supervisor,
    username: username,
    role: role || 'supervisor',
    exp: expiresAt,
  };
  var encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payloadObj));
  var sig = signTokenData(encoded, cfg.tokenSecret);
  var token = encoded + '.' + sig;

  var cache = CacheService.getScriptCache();
  cache.put('session:' + sessionId, JSON.stringify(payloadObj), SESSION_TTL_SECONDS);

  return token;
}

function verifySessionToken(token) {
  var rawToken = normalizeText(token);
  if (!rawToken) {
    return null;
  }

  var parts = rawToken.split('.');
  if (parts.length !== 2) {
    return null;
  }

  var cfg = getConfig();
  var encoded = parts[0];
  var providedSig = parts[1];
  var expectedSig = signTokenData(encoded, cfg.tokenSecret);

  if (!constantTimeEquals(providedSig, expectedSig)) {
    return null;
  }

  var decodedStr;
  var payload;
  try {
    decodedStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString();
    payload = JSON.parse(decodedStr);
  } catch (err) {
    return null;
  }

  if (!payload || !payload.sid || !payload.supervisor || !payload.exp) {
    return null;
  }
  if (Number(payload.exp) < Date.now()) {
    return null;
  }

  var cache = CacheService.getScriptCache();
  var cachedRaw = cache.get('session:' + payload.sid);
  if (!cachedRaw) {
    return null;
  }

  try {
    var cachedSession = JSON.parse(cachedRaw);
    if (normalizeKey(cachedSession.supervisor) !== normalizeKey(payload.supervisor)) {
      return null;
    }
    return cachedSession;
  } catch (err) {
    return null;
  }
}

function handleLogin(body) {
  var username = normalizeKey(body.username);
  var password = String(body.password === null || body.password === undefined ? '' : body.password);

  if (!username || !password) {
    return {
      ok: false,
      error: 'Username dan password wajib diisi.',
      code: 'INVALID_INPUT',
    };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ACCOUNT);
  if (!sheet) {
    return {
      ok: false,
      error: 'Sheet "' + SHEET_ACCOUNT + '" tidak ditemukan.',
      code: 'SHEET_NOT_FOUND',
    };
  }

  var headerMap = getHeaderMap(sheet);
  requireColumns(headerMap, ['supervisor', 'username', 'password', 'role'], SHEET_ACCOUNT);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      ok: false,
      error: 'Username atau password salah.',
      code: 'INVALID_CREDENTIALS',
    };
  }

  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var matchedAccount = null;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rowUser = normalizeKey(row[headerMap['username']]);
    var rowPass = String(row[headerMap['password']] === null || row[headerMap['password']] === undefined ? '' : row[headerMap['password']]);
    var rowSupervisor = normalizeText(row[headerMap['supervisor']]);
    var rowRole = normalizeKey(row[headerMap['role']]);

    if (rowUser === username && constantTimeEquals(password, rowPass) && (rowSupervisor || rowRole === 'admin')) {
      matchedAccount = {
        supervisor: rowSupervisor || 'Admin',
        username: normalizeText(row[headerMap['username']]),
        role: rowRole,
      };
      break;
    }
  }

  if (!matchedAccount) {
    return {
      ok: false,
      error: 'Username atau password salah.',
      code: 'INVALID_CREDENTIALS',
    };
  }

  if (matchedAccount.role !== 'admin' && matchedAccount.role !== 'supervisor') {
    return { ok: false, error: 'Role akun harus admin atau supervisor.', code: 'INVALID_ROLE' };
  }
  var token = issueSessionToken(matchedAccount.supervisor, matchedAccount.username, matchedAccount.role);

  // Hanya mengembalikan token, supervisor, dan username. Password & akun lain tidak pernah dikirim.
  return {
    ok: true,
    token: token,
    supervisor: matchedAccount.supervisor,
    username: matchedAccount.username,
    role: matchedAccount.role,
  };
}

function handleLogout(body) {
  var session = verifySessionToken(body.token);
  if (session && session.sid) {
    CacheService.getScriptCache().remove('session:' + session.sid);
  }
  return { ok: true };
}

function buildStoreObject(row, headerMap) {
  return {
    keterangan: normalizeText(row[headerMap['keterangan']]),
    distributor_code: normalizeText(row[headerMap['distributor_code']]),
    customer_id: normalizeText(row[headerMap['customer_id']]),
    customer_name: normalizeText(row[headerMap['customer_name']]),
    distributor_branch: normalizeText(row[headerMap['distributor_branch']]),
    supervisor: normalizeText(row[headerMap['supervisor']]),
    address: typeof headerMap['address'] === 'number' ? normalizeText(row[headerMap['address']]) : '',
    city: typeof headerMap['city'] === 'number' ? normalizeText(row[headerMap['city']]) : '',
    picture: normalizeText(row[headerMap['picture']]),
    longitude: normalizeText(row[headerMap['longitude']]),
    latitude: normalizeText(row[headerMap['latitude']]),
  };
}

function handleGetStores(body) {
  var session = verifySessionToken(body.token);
  if (!session) {
    return {
      ok: false,
      error: 'Sesi login telah berakhir. Silakan login kembali.',
      code: 'UNAUTHORIZED',
    };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STORES);
  if (!sheet) {
    return {
      ok: false,
      error: 'Sheet "' + SHEET_STORES + '" tidak ditemukan.',
      code: 'SHEET_NOT_FOUND',
    };
  }

  var headerMap = getHeaderMap(sheet);
  requireColumns(
    headerMap,
    [
      'keterangan',
      'distributor_code',
      'customer_id',
      'customer_name',
      'distributor_branch',
      'supervisor',
      'address', 'city', 'picture',
      'longitude',
      'latitude',
    ],
    SHEET_STORES
  );

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      ok: true,
      supervisor: session.supervisor,
      stores: [],
    };
  }

  var targetSupervisorKey = normalizeKey(session.supervisor);
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var stores = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rowSupervisorKey = normalizeKey(row[headerMap['supervisor']]);
    var customerId = normalizeText(row[headerMap['customer_id']]);

    if (customerId && (session.role === 'admin' || rowSupervisorKey === targetSupervisorKey)) {
      stores.push(buildStoreObject(row, headerMap));
    }
  }

  return {
    ok: true,
    supervisor: session.supervisor,
    stores: stores,
  };
}

function handleSaveValidation(body) {
  var session = verifySessionToken(body.token);
  if (!session) {
    return {
      ok: false,
      error: 'Sesi login telah berakhir. Silakan login kembali.',
      code: 'UNAUTHORIZED',
    };
  }
  if (session.role === 'admin') {
    return { ok: false, error: 'Akun admin hanya dapat melihat status validasi.', code: 'FORBIDDEN' };
  }

  var customerId = normalizeText(body.customer_id);
  if (!customerId) {
    return {
      ok: false,
      error: 'Customer ID wajib diisi.',
      code: 'INVALID_INPUT',
    };
  }

  var longitude = Number(body.longitude);
  var latitude = Number(body.latitude);
  if (
    !isFinite(longitude) ||
    !isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return {
      ok: false,
      error: 'Koordinat GPS longitude atau latitude tidak valid.',
      code: 'INVALID_COORDINATES',
    };
  }

  var mimeType = body.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  var rawBase64 = String(body.imageBase64 || '').replace(/^data:image\/(jpeg|png);base64,/i, '');
  if (!rawBase64) {
    return {
      ok: false,
      error: 'Foto wajib diambil melalui kamera sebelum menyimpan.',
      code: 'INVALID_IMAGE',
    };
  }

  var decodedBytes;
  try {
    decodedBytes = Utilities.base64Decode(rawBase64);
  } catch (err) {
    return {
      ok: false,
      error: 'Data foto tidak valid.',
      code: 'INVALID_IMAGE',
    };
  }

  if (!decodedBytes || decodedBytes.length === 0 || decodedBytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'Ukuran foto tidak valid atau melebihi batas 8 MB.',
      code: 'INVALID_IMAGE',
    };
  }

  var cfg = getConfig();
  if (!cfg.driveFolderId) {
    return {
      ok: false,
      error: 'DRIVE_FOLDER_ID belum dikonfigurasi pada Script Properties.',
      code: 'CONFIG_ERROR',
    };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    return {
      ok: false,
      error: 'Sistem sedang memproses pembaruan lain. Silakan coba beberapa saat lagi.',
      code: 'LOCK_TIMEOUT',
    };
  }

  var createdFile = null;
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_STORES);
    if (!sheet) {
      return {
        ok: false,
        error: 'Sheet "' + SHEET_STORES + '" tidak ditemukan.',
        code: 'SHEET_NOT_FOUND',
      };
    }

    var headerMap = getHeaderMap(sheet);
    requireColumns(
      headerMap,
      [
        'keterangan',
        'distributor_code',
        'customer_id',
        'customer_name',
        'distributor_branch',
        'supervisor',
        'address', 'city', 'picture',
        'longitude',
        'latitude',
      ],
      SHEET_STORES
    );

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {
        ok: false,
        error: 'Data toko tidak ditemukan pada sheet.',
        code: 'STORE_NOT_FOUND',
      };
    }

    var totalCols = sheet.getLastColumn();
    var values = sheet.getRange(2, 1, lastRow - 1, totalCols).getValues();
    var targetRowNumber = -1;
    var existingRowValues = null;
    var targetCustomerKey = normalizeKey(customerId);

    for (var i = 0; i < values.length; i++) {
      if (normalizeKey(values[i][headerMap['customer_id']]) === targetCustomerKey) {
        targetRowNumber = i + 2;
        existingRowValues = values[i];
        break;
      }
    }

    if (targetRowNumber === -1 || !existingRowValues) {
      return {
        ok: false,
        error: 'Customer ID tidak ditemukan pada sheet Validasi Long Lad.',
        code: 'STORE_NOT_FOUND',
      };
    }

    // Verifikasi ulang di backend bahwa toko berada dalam cakupan supervisor yang login
    var rowSupervisorKey = normalizeKey(existingRowValues[headerMap['supervisor']]);
    if (rowSupervisorKey !== normalizeKey(session.supervisor)) {
      return {
        ok: false,
        error: 'Akses ditolak. Toko ini tidak berada dalam cakupan supervisor Anda.',
        code: 'FORBIDDEN',
      };
    }

    // 1. Simpan foto ke Google Drive
    var folder = DriveApp.getFolderById(cfg.driveFolderId);
    var safeId = customerId.replace(/[^A-Za-z0-9_-]/g, '_');
    var ext = mimeType === 'image/png' ? 'png' : 'jpg';
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var fileName = safeId + '_' + timestamp + '.' + ext;
    var blob = Utilities.newBlob(decodedBytes, mimeType, fileName);

    createdFile = folder.createFile(blob);
    // Agar pratinjau foto dapat dibuka oleh pengguna dengan tautan (sesuaikan bila organisasi membatasi akses domain)
    try {
      createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Tetap lanjutkan jika kebijakan Google Workspace membatasi sharing publik
    }

    var fileUrl = createdFile.getUrl();
    var formattedLng = longitude.toFixed(6);
    var formattedLat = latitude.toFixed(6);

    // 2-5. Perbarui HANYA 3 kolom (picture, longitude, latitude) pada baris yang sudah ada.
    // Jangan mengubah kolom lain dan jangan menambahkan baris baru.
    sheet.getRange(targetRowNumber, headerMap['picture'] + 1).setValue(fileUrl);
    sheet.getRange(targetRowNumber, headerMap['longitude'] + 1).setValue(formattedLng);
    sheet.getRange(targetRowNumber, headerMap['latitude'] + 1).setValue(formattedLat);
    SpreadsheetApp.flush();

    // Bangun objek toko terbaru tanpa mengubah kolom lain
    var updatedStore = buildStoreObject(existingRowValues, headerMap);
    updatedStore.picture = fileUrl;
    updatedStore.longitude = formattedLng;
    updatedStore.latitude = formattedLat;

    return {
      ok: true,
      store: updatedStore,
    };
  } catch (err) {
    // Jika gagal memperbarui spreadsheet setelah file terbuat, hapus file orphan agar Drive tetap bersih
    if (createdFile) {
      try {
        createdFile.setTrashed(true);
      } catch (cleanupErr) {
        // Abaikan error pembersihan
      }
    }
    return {
      ok: false,
      error: 'Gagal menyimpan validasi: ' + (err && err.message ? err.message : String(err)),
      code: 'SAVE_FAILED',
    };
  } finally {
    lock.releaseLock();
  }
}
