import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Loader2, MapPin, RotateCcw, X } from 'lucide-react';
import type { CapturedEvidence } from '../types/store';
import { validateCoordinates } from '../utils/validation';

interface CameraCapturePanelProps {
  hasExistingValidation: boolean;
  disabled?: boolean;
  onCaptureComplete: (evidence: CapturedEvidence) => void;
}

type CaptureStage = 'idle' | 'starting_camera' | 'camera_live' | 'capturing_gps';

function mapCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'Izin kamera ditolak. Aktifkan izin kamera pada pengaturan browser HP Anda, lalu coba kembali.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'Kamera tidak ditemukan pada perangkat ini. Validasi memerlukan perangkat dengan kamera aktif.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.';
    }
    if (err.name === 'OverconstrainedError') {
      return 'Kamera perangkat tidak mendukung konfigurasi yang diminta.';
    }
    if (err.name === 'SecurityError') {
      return 'Akses kamera memerlukan koneksi HTTPS yang aman.';
    }
  }
  return 'Tidak dapat membuka kamera perangkat. Pastikan izin kamera diaktifkan dan coba lagi.';
}

function mapGpsError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Izin lokasi GPS ditolak. Aktifkan izin lokasi di browser HP Anda agar koordinat toko dapat diambil.';
    case err.POSITION_UNAVAILABLE:
      return 'Lokasi GPS tidak tersedia. Pastikan layanan lokasi (GPS) perangkat aktif dan sinyal memadai.';
    case err.TIMEOUT:
      return 'Pengambilan koordinat GPS melebihi batas waktu. Coba pindah ke area terbuka lalu ambil foto ulang.';
    default:
      return 'Gagal memperoleh koordinat GPS perangkat. Hasil validasi tidak dapat disimpan tanpa GPS.';
  }
}

export function CameraCapturePanel({
  hasExistingValidation,
  disabled = false,
  onCaptureComplete,
}: CameraCapturePanelProps) {
  const [stage, setStage] = useState<CaptureStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCameraStream();
    };
  }, [stopCameraStream]);

  // Lampirkan stream ke elemen <video> begitu viewfinder siap di DOM
  useEffect(() => {
    if (stage === 'camera_live' && videoRef.current && streamRef.current) {
      const videoEl = videoRef.current;
      videoEl.srcObject = streamRef.current;
      videoEl.play().catch(() => {
        // Beberapa browser menunggu interaksi pengguna; playsInline + muted mencegah blokir autoplay
      });
    }
  }, [stage]);

  async function openLiveCamera() {
    setErrorMessage(null);
    setPendingPreviewUrl(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(
        'Perangkat atau browser ini tidak mendukung akses kamera langsung. Gunakan browser HP terbaru melalui HTTPS.'
      );
      return;
    }

    if (!navigator.geolocation) {
      setErrorMessage(
        'Perangkat atau browser ini tidak mendukung GPS (Geolocation). Hasil validasi tidak dapat disimpan.'
      );
      return;
    }

    stopCameraStream();
    setStage('starting_camera');

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
      } catch (primaryErr) {
        // Jika constraint kamera belakang ditolak oleh perangkat desktop/single-camera, coba kamera default
        if (
          primaryErr instanceof DOMException &&
          (primaryErr.name === 'OverconstrainedError' || primaryErr.name === 'NotFoundError')
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw primaryErr;
        }
      }

      if (!mountedRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;
      setStage('camera_live');
    } catch (err) {
      stopCameraStream();
      if (mountedRef.current) {
        setStage('idle');
        setErrorMessage(mapCameraError(err));
      }
    }
  }

  function handleCancelCamera() {
    stopCameraStream();
    setPendingPreviewUrl(null);
    setStage('idle');
  }

  function handleCapturePhotoAndGps() {
    setErrorMessage(null);
    const videoEl = videoRef.current;

    if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      setErrorMessage('Tampilan kamera belum siap. Tunggu sebentar lalu tekan tombol ambil foto.');
      return;
    }

    if (!navigator.geolocation) {
      stopCameraStream();
      setStage('idle');
      setErrorMessage(
        'Perangkat tidak mendukung GPS (Geolocation). Hasil validasi tidak dapat disimpan.'
      );
      return;
    }

    // Tangkap frame kamera langsung ke canvas terkompresi
    const maxDimension = 1280;
    let targetWidth = videoEl.videoWidth;
    let targetHeight = videoEl.videoHeight;
    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      const scale = maxDimension / Math.max(targetWidth, targetHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      stopCameraStream();
      setStage('idle');
      setErrorMessage('Gagal memproses gambar dari kamera. Silakan coba lagi.');
      return;
    }

    ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.82);

    stopCameraStream();
    setPendingPreviewUrl(imageDataUrl);
    setStage('capturing_gps');

    // Ambil koordinat GPS perangkat tepat saat proses pengambilan foto
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mountedRef.current) {
          return;
        }
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const coordValidation = validateCoordinates(latitude, longitude);

        if (!coordValidation.valid) {
          setPendingPreviewUrl(null);
          setStage('idle');
          setErrorMessage(
            coordValidation.error ??
              'Koordinat GPS yang diterima tidak valid. Silakan ambil foto ulang.'
          );
          return;
        }

        setPendingPreviewUrl(null);
        setStage('idle');
        onCaptureComplete({
          imageDataUrl,
          mimeType: 'image/jpeg',
          longitude,
          latitude,
          capturedAt: new Date().toISOString(),
        });
      },
      (geoError) => {
        if (!mountedRef.current) {
          return;
        }
        // GPS gagal: jangan izinkan menyimpan hasil tanpa koordinat
        setPendingPreviewUrl(null);
        setStage('idle');
        setErrorMessage(mapGpsError(geoError));
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      }
    );
  }

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1 text-sm text-red-900">
            <p className="font-semibold">Pengambilan foto atau GPS gagal</p>
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {stage === 'idle' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 leading-relaxed">
            Foto wajib diambil langsung melalui kamera HP. Koordinat GPS perangkat akan diambil
            otomatis saat Anda menekan tombol ambil foto.
          </p>

          <button
            type="button"
            onClick={openLiveCamera}
            disabled={disabled}
            className="w-full min-h-[52px] px-5 py-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-semibold text-base flex items-center justify-center gap-2.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-700 whitespace-nowrap"
          >
            <Camera className="w-5 h-5" aria-hidden="true" />
            <span>
              {errorMessage
                ? 'Coba Buka Kamera Lagi'
                : hasExistingValidation
                  ? 'Perbarui Foto & Koordinat'
                  : 'Buka Kamera'}
            </span>
          </button>
        </div>
      )}

      {stage === 'starting_camera' && (
        <div className="rounded-2xl bg-slate-900 text-white aspect-[4/3] flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="w-7 h-7 animate-spin text-blue-300" aria-hidden="true" />
          <p className="text-sm font-medium">Menyiapkan kamera perangkat...</p>
          <button
            type="button"
            onClick={handleCancelCamera}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm text-white transition-colors"
          >
            Batal
          </button>
        </div>
      )}

      {stage === 'camera_live' && (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              aria-label="Pratinjau kamera langsung"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-4 py-3">
              <p className="text-xs text-white/95 font-medium">
                Arahkan kamera ke bagian depan toko, lalu tekan Ambil Foto.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={handleCapturePhotoAndGps}
              className="sm:col-span-2 min-h-[52px] px-5 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-semibold text-base flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-700 whitespace-nowrap"
            >
              <Camera className="w-5 h-5" aria-hidden="true" />
              <span>Ambil Foto & Kunci GPS</span>
            </button>

            <button
              type="button"
              onClick={handleCancelCamera}
              className="min-h-[52px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium text-sm flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              <span>Batal</span>
            </button>
          </div>
        </div>
      )}

      {stage === 'capturing_gps' && (
        <div className="space-y-3">
          {pendingPreviewUrl && (
            <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3]">
              <img
                src={pendingPreviewUrl}
                alt="Foto sedang menunggu koordinat GPS"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-75"
              />
              <div className="absolute inset-0 bg-slate-950/55 flex flex-col items-center justify-center gap-2.5 p-5 text-center text-white">
                <Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" />
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  <span>Mengambil koordinat GPS perangkat...</span>
                </div>
                <p className="text-xs text-slate-200 max-w-xs">
                  Mohon tunggu sebentar. Hasil baru dapat disimpan setelah koordinat GPS berhasil
                  diperoleh.
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={openLiveCamera}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 inline-flex items-center justify-center gap-2 transition-colors"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>Batalkan & Ambil Ulang</span>
          </button>
        </div>
      )}
    </div>
  );
}
