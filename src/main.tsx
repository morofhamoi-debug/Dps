import { StrictMode, useMemo, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MapView, Sheet, MarkerForm, MarkerCard, MarkerList,
  AuthModal, ProfilePage, AdminPage
} from './ui'
import {
  useAuth, useMarkers, useGeolocation,
  TYPE_LABELS, haversine,
  type Marker, type MarkerType, type MarkerWithDistance
} from './lib'
import './styles.css'

const DEFAULT_CENTER = { latitude: 55.751244, longitude: 37.618423 }

function App() {
  const { user, profile, loading: authLoading } = useAuth()
  const [center, setCenter] = useState(DEFAULT_CENTER)
  const [zoom, setZoom] = useState(13)
  const [pickMode, setPickMode] = useState(false)
  const [picked, setPicked] = useState<{ latitude: number; longitude: number } | null>(null)
  const [selected, setSelected] = useState<Marker | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [types, setTypes] = useState<MarkerType[]>(Object.keys(TYPE_LABELS) as MarkerType[])
  const [radius, setRadius] = useState<number | 'all'>('all')
  const geo = useGeolocation()

  const filters = useMemo(
    () => ({ types, radiusKm: radius, center: geo.coords }),
    [types, radius, geo.coords]
  )
  const { data: markers = [], isLoading, isError, refetch } = useMarkers(filters)

  const markersWithDistance: MarkerWithDistance[] = useMemo(() => markers.map(m => {
    const base = geo.coords ?? center
    return {
      ...m,
      distance: haversine(
        { lat: base.latitude, lon: base.longitude },
        { lat: m.latitude, lon: m.longitude }
      )
    }
  }), [markers, geo.coords, center])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }, [])

  const handleLocate = useCallback(async () => {
    try {
      const c = await geo.request()
      setCenter({ latitude: c.latitude, longitude: c.longitude })
      setZoom(15)
    } catch { if (geo.error) showToast(geo.error) }
  }, [geo, showToast])

  const startPick = () => {
    if (!user) return setAuthOpen(true)
    setPickMode(true); setSelected(null); setListOpen(false)
  }

  const onPick = (lat: number, lon: number) => setPicked({ latitude: lat, longitude: lon })

  const onCreated = () => {
    const p = picked
    setPickMode(false); setPicked(null)
    if (p) { setCenter(p); setZoom(16); showToast('Метка добавлена') }
  }

  const selectMarker = (m: Marker | MarkerWithDistance) => {
    setSelected(m); setListOpen(false)
    setCenter({ latitude: m.latitude, longitude: m.longitude }); setZoom(16)
  }

  if (adminOpen) return <AdminPage onBack={() => setAdminOpen(false)} />

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-neutral-950 text-white">
      <MapView
        markers={markers} center={center} zoom={zoom}
        pickMode={pickMode} onPickCoords={onPick}
        onMarkerClick={(m) => selectMarker(m)}
      />

      {pickMode && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="relative -translate-y-3">
            <div className="h-10 w-10 rounded-full border-2 border-white/60 shadow-[0_0_0_4px_rgba(225,29,46,0.35)]" />
            <div className="absolute left-1/2 top-full h-4 w-0.5 -translate-x-1/2 bg-white/70" />
          </div>
        </div>
      )}

      {!pickMode && (
        <div className="absolute left-3 right-3 top-0 z-30 safe-top">
          <div className="glass mt-3 flex items-center gap-2 p-2">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-red-600 font-bold">Д</div>
            <button onClick={() => setListOpen(true)}
              className="flex-1 rounded-2xl px-3 py-2 text-left text-sm font-medium">
              Метки рядом
              <div className="text-xs text-neutral-400">{markers.length} активных</div>
            </button>
            <button onClick={startPick}
              className="shrink-0 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold">
              + Метка
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            <button onClick={handleLocate}
              className="glass shrink-0 rounded-full px-3 py-2 text-sm">
              {geo.loading ? 'Поиск…' : '◎ Я здесь'}
            </button>
            <input
              placeholder="Поиск адреса…"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const q = (e.target as HTMLInputElement).value.trim()
                if (!q || !window.ymaps3?.search) return
                window.ymaps3.search({ text: q }).then((res: any) => {
                  const first = res?.[0]
                  const coords = first?.geometry?.coordinates
                  if (coords) {
                    setCenter({ latitude: coords[1], longitude: coords[0] })
                    setZoom(15)
                  }
                }).catch(() => showToast('Ничего не найдено'))
              }}
              className="glass min-w-[160px] flex-1 rounded-full px-4 py-2 text-sm outline-none placeholder:text-neutral-500"
            />
            {profile?.role === 'admin' && (
              <button onClick={() => setAdminOpen(true)}
                className="glass shrink-0 rounded-full px-3 py-2 text-sm">Админ</button>
            )}
          </div>
        </div>
      )}

      {!pickMode && (
        <nav className="absolute left-0 right-0 bottom-0 z-30 safe-bottom px-3 pb-3">
          <div className="glass mx-auto flex max-w-md items-center justify-around p-2">
            <button className="flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2 text-red-500">
              <span className="text-lg">◉</span><span className="text-[10px]">Карта</span>
            </button>
            <button onClick={() => setListOpen(true)}
              className="flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2 text-neutral-300">
              <span className="text-lg">☰</span><span className="text-[10px]">Метки</span>
            </button>
            <button onClick={() => user ? setProfileOpen(true) : setAuthOpen(true)}
              className="flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2 text-neutral-300">
              <span className="text-lg">◐</span><span className="text-[10px]">Профиль</span>
            </button>
          </div>
        </nav>
      )}

      {pickMode && (
        <div className="absolute left-0 right-0 bottom-0 z-30 safe-bottom p-4">
          <div className="mx-auto flex max-w-md gap-2">
            <button onClick={() => { setPickMode(false); setPicked(null) }}
              className="glass flex-1 rounded-2xl py-4 font-medium">Отмена</button>
            <button disabled={!picked}
              onClick={() => picked && setPicked({ ...picked })}
              className="flex-1 rounded-2xl bg-red-600 py-4 font-semibold disabled:opacity-50">
              Поставить здесь
            </button>
          </div>
        </div>
      )}

      <Sheet
        open={!!picked && pickMode}
        onClose={() => { setPicked(null); setPickMode(false) }}
      >
        {picked && (
          <MarkerForm
            latitude={picked.latitude}
            longitude={picked.longitude}
            onSuccess={onCreated}
            onCancel={() => { setPicked(null); setPickMode(false) }}
          />
        )}
      </Sheet>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} maxHeight="85vh">
        <MarkerList
          markers={markersWithDistance}
          isLoading={isLoading} isError={isError}
          onRetry={() => refetch()}
          onSelect={selectMarker}
          types={types} setTypes={setTypes}
          radius={radius} setRadius={setRadius}
        />
      </Sheet>

      <Sheet open={!!selected && !pickMode} onClose={() => setSelected(null)}>
        {selected && (
          <MarkerCard
            marker={selected}
            distance={haversine(
              { lat: (geo.coords ?? center).latitude, lon: (geo.coords ?? center).longitude },
              { lat: selected.latitude, lon: selected.longitude }
            )}
            isOwner={user?.id === selected.user_id}
            onClose={() => setSelected(null)}
            onToast={showToast}
          />
        )}
      </Sheet>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {profileOpen && profile && <ProfilePage profile={profile} onClose={() => setProfileOpen(false)} />}

      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2 toast-anim">
          <div className="glass px-5 py-3 text-sm font-medium">{toast}</div>
        </div>
      )}
    </div>
  )
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
