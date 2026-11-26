import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  ImageOff,
  Loader2,
  MapPin,
  RotateCcw,
  Save,
} from 'lucide-react';
import type { CapturedEvidence, StoreRecord } from '../types/store';
import {
  formatCoordinate,
  getSafeExternalLink,
  getSafeImageUrl,
  isStoreValidated,
} from '../utils/validation';
import { CameraCapturePanel } from './CameraCapturePanel';

interface StoreDetailViewProps {
  store: StoreRecord;
  onBack: () => void;
  onQueueValidation: (store: StoreRecord, evidence: CapturedEvidence) => Promise<void>;
}

export function StoreDetailView({
  store,
  onBack,
  onQueueValidation,
}: StoreDetailViewProps) {
  const [captured, setCaptured] = useState<CapturedEvidence | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [existingImgFailed, setExistingImgFailed] = useState(false);
  const previewSectionRef = useRef<HTMLElement | null>(null);

  const alreadyValidated = isStoreValidated(store);
  const safeExistingImageUrl = getSafeImageUrl(store.picture);
  const safeExternalPhotoLink = getSafeExternalLink(store.picture);

  useEffect(() => {
    if (captured && previewSectionRef.current) {
      previewSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [captured]);

  function handleCaptureComplete(evidence: CapturedEvidence) {
    setSaveError(null);
    setSaveSuccessMessage(null);
    setCaptured(evidence);
  }

  function handleRetake() {
    if (isSaving) return;
    setCaptured(null);
    setSaveError(null);
  }

  async function handleSave() {
    if (!captured || isSaving) {
      return;
    }

    setSaveError(null);
    setSaveSuccessMessage(null);
    setIsSaving(true);

    try {
      await onQueueValidation(store, captured);
      setExistingImgFailed(false);
      setCaptured(null);
      setSaveSuccessMessage(
        'Validasi tersimpan di cache perangkat dengan status Pending. Gunakan tombol Kirim Data untuk mengunggahnya ke spreadsheet.'
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan validasi ke cache perangkat.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] flex flex-col">
      {/* Sticky Top App Bar (56px) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/90">
        <div className="max-w-5xl mx-auto h-full px-3 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onBack}
              disabled={isSaving}
              className="min-h-[44px] px-2.5 rounded-xl text-sm font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-100 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Daftar Toko</span>
            </button>
            <span aria-hidden="true" className="text-slate-300 shrink-0">
              /
            </span>
            <span className="text-sm font-semibold text-slate-900 truncate">
              {store.customer_name}
            </span>
          </div>

          <span className="hidden sm:inline font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap shrink-0">
            {store.customer_id}
          </span>
        </div>
      </header>

      <main
        className={`flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 ${
          captured ? 'pb-28 sm:pb-10' : 'pb-10'
        }`}
      >
        {saveSuccessMessage && (
          <div
            role="status"
            className="mb-5 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-emerald-950">{saveSuccessMessage}</p>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              Kembali ke Daftar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start">
          {/* Kolom Kiri: Informasi Toko & Data Tersimpan Saat Ini */}
          <div className="lg:col-span-5 space-y-5">
            <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {alreadyValidated ? (
                    <>
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-700 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="text-emerald-700">Sudah divalidasi</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                      <span className="text-amber-700">Belum divalidasi</span>
                    </>
                  )}
                </div>

                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {store.customer_name}
                </h1>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-slate-100 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Customer ID</dt>
                  <dd className="mt-0.5 font-mono tabular-nums font-medium text-slate-900">
                    {store.customer_id}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-slate-500">Distributor Branch</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{store.distributor_branch}</dd>
                </div>

                <div>
                  <dt className="text-xs text-slate-500">Distributor Code</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-slate-700">
                    {store.distributor_code || '-'}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-slate-500">Supervisor</dt>
                  <dd className="mt-0.5 text-slate-700">{store.supervisor}</dd>
                </div>

                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Alamat</dt>
                  <dd className="mt-0.5 text-slate-700">{store.address || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Kota</dt>
                  <dd className="mt-0.5 text-slate-700">{store.city || '-'}</dd>
                </div>

                {store.keterangan && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Keterangan</dt>
                    <dd className="mt-0.5 text-slate-700">{store.keterangan}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* Hasil Validasi Tersimpan di Spreadsheet (jika sudah ada) */}
            {alreadyValidated && (
              <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Data Tersimpan Saat Ini
                  </h2>
                  {safeExternalPhotoLink && (
                    <a
                      href={safeExternalPhotoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <span>Buka di Drive</span>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>

                <div className="rounded-xl overflow-hidden bg-slate-100 aspect-[4/3] border border-slate-200/80">
                  {safeExistingImageUrl && !existingImgFailed ? (
                    <img
                      src={safeExistingImageUrl}
                      alt={`Foto tersimpan untuk ${store.customer_name}`}
                      referrerPolicy="no-referrer"
                      onError={() => setExistingImgFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center text-slate-500">
                      <ImageOff className="w-6 h-6" aria-hidden="true" />
                      <span className="text-xs">
                        Pratinjau foto tersimpan tidak dapat ditampilkan langsung.
                      </span>
                    </div>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 border border-slate-200/70">
                    <dt className="text-xs text-slate-500">Longitude</dt>
                    <dd className="mt-0.5 font-mono tabular-nums font-medium text-slate-900">
                      {formatCoordinate(store.longitude)}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 border border-slate-200/70">
                    <dt className="text-xs text-slate-500">Latitude</dt>
                    <dd className="mt-0.5 font-mono tabular-nums font-medium text-slate-900">
                      {formatCoordinate(store.latitude)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}
          </div>

          {/* Kolom Kanan: Pengambilan Foto & GPS Baru + Pratinjau & Simpan */}
          <section
            ref={previewSectionRef}
            className="lg:col-span-7 scroll-mt-16 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-5"
          >
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                {captured
                  ? 'Pratinjau Hasil Validasi'
                  : alreadyValidated
                    ? 'Perbarui Validasi Lokasi'
                    : 'Ambil Foto & Koordinat GPS'}
              </h2>
              {captured && (
                <p className="text-sm text-slate-600">
                  Periksa foto serta koordinat longitude dan latitude di bawah ini sebelum
                  menyimpan.
                </p>
              )}
            </div>

            {!captured ? (
              <CameraCapturePanel
                hasExistingValidation={alreadyValidated}
                disabled={isSaving}
                onCaptureComplete={handleCaptureComplete}
              />
            ) : (
              <div className="space-y-4 sm:space-y-5">
                {/* Pratinjau Foto Baru */}
                <div className="rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] border border-slate-200">
                  <img
                    src={captured.imageDataUrl}
                    alt={`Pratinjau foto validasi ${store.customer_name}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Informasi Koordinat GPS Baru */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <MapPin className="w-4 h-4 text-blue-700" aria-hidden="true" />
                    <span>Koordinat GPS Terkunci</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 sm:px-4 sm:py-3 border border-slate-200/80">
                      <dt className="text-xs text-slate-500">Longitude</dt>
                      <dd
                        className="mt-0.5 text-sm sm:text-base font-mono tabular-nums font-semibold text-slate-900"
                        data-testid="captured-longitude"
                      >
                        {formatCoordinate(captured.longitude)}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 sm:px-4 sm:py-3 border border-slate-200/80">
                      <dt className="text-xs text-slate-500">Latitude</dt>
                      <dd
                        className="mt-0.5 text-sm sm:text-base font-mono tabular-nums font-semibold text-slate-900"
                        data-testid="captured-latitude"
                      >
                        {formatCoordinate(captured.latitude)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Indikator Proses Penyimpanan */}
                {isSaving && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3.5 flex items-center gap-3 text-sm text-blue-950"
                  >
                    <Loader2
                      className="w-5 h-5 text-blue-700 animate-spin shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Menyimpan foto dan koordinat ke cache perangkat...
                    </span>
                  </div>
                )}

                {/* Pesan Error Penyimpanan */}
                {saveError && (
                  <div
                    role="alert"
                    className="rounded-xl bg-red-50 border border-red-200 px-4 py-3.5 flex items-start gap-3 text-sm text-red-900"
                  >
                    <AlertCircle
                      className="w-5 h-5 text-red-700 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="space-y-0.5">
                      <p className="font-semibold">Penyimpanan gagal</p>
                      <p>{saveError}</p>
                    </div>
                  </div>
                )}

                {/* Tombol Aksi (Desktop inline; di HP tombol Simpan juga tersedia pada bilah bawah) */}
                <div className="hidden sm:grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleRetake}
                    disabled={isSaving}
                    className="min-h-[48px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    <span>Ambil Ulang</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="min-h-[48px] px-5 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-semibold text-base inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-700"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-5 h-5" aria-hidden="true" />
                        <span>Simpan Validasi</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Tombol Ambil Ulang untuk layar HP */}
                <div className="sm:hidden">
                  <button
                    type="button"
                    onClick={handleRetake}
                    disabled={isSaving}
                    className="w-full min-h-[48px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    <span>Ambil Foto Ulang</span>
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Sticky Bottom CTA Bar khusus layar HP saat pratinjau siap disimpan (height ~68px -> total sticky <= 15%) */}
      {captured && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-semibold text-base inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <Save className="w-5 h-5" aria-hidden="true" />
                <span>Simpan Validasi</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
