import { useCallback, useEffect, useState } from 'react';
import { LoginView } from './components/LoginView';
import { StoreDetailView } from './components/StoreDetailView';
import { StoreListView } from './components/StoreListView';
import { ApiError, fetchSupervisorStores, logoutSession, saveStoreValidation } from './services/api';
import { localCache } from './services/localCache';
import type { CapturedEvidence, SessionInfo, StoreRecord } from './types/store';

export default function App() {
  // Token sesi disimpan hanya di memori React (tidak pernah di localStorage/sessionStorage)
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const handleSessionExpired = useCallback((message: string) => {
    setSession(null);
    setStores([]);
    setSelectedCustomerId(null);
    setStoresError(null);
    setSessionNotice(message);
  }, []);

  const loadStores = useCallback(
    async (activeSession: SessionInfo) => {
      setIsLoadingStores(true);
      setStoresError(null);
      try {
      const result = await fetchSupervisorStores(activeSession.token);
      const pulled = result.stores ?? [];
      const pending = await localCache.getPending();
      const merged = pulled.map((store) => {
        const queued = pending.find((p) => p.customer_id === store.customer_id);
        return queued ? { ...store, picture: queued.evidence.imageDataUrl, longitude: String(queued.evidence.longitude), latitude: String(queued.evidence.latitude), syncStatus: 'pending' as const } : store;
      });
      await localCache.replaceStores(merged);
      setStores(merged);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'UNAUTHORIZED') {
            handleSessionExpired(err.message);
            return;
          }
          setStoresError(err.message);
        } else {
          setStoresError('Gagal memuat daftar toko. Periksa koneksi internet Anda.');
        }
      } finally {
        setIsLoadingStores(false);
      }
    },
    [handleSessionExpired]
  );

  async function handleLoginSuccess(newSession: SessionInfo) {
    setSessionNotice(null);
    setStoresError(null);
    setSelectedCustomerId(null);
    setSession(newSession);
    const [cachedStores, pending] = await Promise.all([localCache.getStores(), localCache.getPending()]);
    const visibleCache = newSession.role === 'admin'
      ? cachedStores
      : cachedStores.filter((store) => store.supervisor.trim().toLowerCase() === newSession.supervisor.trim().toLowerCase());
    const visibleIds = new Set(visibleCache.map((store) => store.customer_id));
    setStores(visibleCache);
    setPendingIds(pending.map((item) => item.customer_id).filter((id) => visibleIds.has(id)));
  }

  async function handleLogout() {
    const token = session?.token;
    setSession(null);
    setStores([]);
    setSelectedCustomerId(null);
    setStoresError(null);
    setSessionNotice(null);
    if (token) {
      await logoutSession(token);
    }
  }

  async function queueValidation(store: StoreRecord, evidence: CapturedEvidence) {
    await localCache.putPending(store.customer_id, evidence);
    const updated = { ...store, picture: evidence.imageDataUrl, longitude: String(evidence.longitude), latitude: String(evidence.latitude), syncStatus: 'pending' as const };
    setStores((prev) => prev.map((item) => item.customer_id === store.customer_id ? updated : item));
    await localCache.replaceStores(stores.map((item) => item.customer_id === store.customer_id ? updated : item));
    setPendingIds((prev) => prev.includes(store.customer_id) ? prev : [...prev, store.customer_id]);
    setSelectedCustomerId(null);
  }

  async function sendPending() {
    if (!session || isSending) return;
    setIsSending(true);
    try {
      const pending = await localCache.getPending();
      for (const item of pending) {
        const result = await saveStoreValidation(session.token, { customer_id: item.customer_id, imageBase64: item.evidence.imageDataUrl, mimeType: item.evidence.mimeType, longitude: item.evidence.longitude, latitude: item.evidence.latitude });
        if (!result.store) throw new Error('Server tidak mengembalikan data toko setelah sinkronisasi.');
        await localCache.removePending(item.customer_id);
        const synced = { ...result.store, syncStatus: 'synced' as const };
        setStores((prev) => prev.map((row) => row.customer_id === item.customer_id ? synced : row));
        const cached = await localCache.getStores();
        await localCache.replaceStores(cached.map((row) => row.customer_id === item.customer_id ? synced : row));
        setPendingIds((prev) => prev.filter((id) => id !== item.customer_id));
      }
    } catch (err) { setStoresError(err instanceof Error ? err.message : 'Gagal mengirim data pending.'); }
    finally { setIsSending(false); }
  }

  if (!session) {
    return <LoginView onLoginSuccess={handleLoginSuccess} sessionNotice={sessionNotice} />;
  }

  const selectedStore = selectedCustomerId
    ? stores.find((item) => item.customer_id === selectedCustomerId) ?? null
    : null;

  if (selectedStore) {
    return (
      <StoreDetailView
        store={selectedStore}
        onBack={() => setSelectedCustomerId(null)}
        onQueueValidation={queueValidation}
      />
    );
  }

  return (
    <StoreListView
      session={session}
      stores={stores}
      isLoading={isLoadingStores}
      errorMessage={storesError}
      onRefresh={() => void loadStores(session)}
      onSelectStore={(store) => setSelectedCustomerId(store.customer_id)}
      onLogout={() => void handleLogout()}
      pendingCount={pendingIds.length}
      onSendPending={() => void sendPending()}
      isSending={isSending}
    />
  );
}
