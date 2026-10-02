import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  MARKER_PLACEHOLDER,
  supabase,
  TYPE_LABELS,
  formatDistance, timeAgo, markerSvg, loadYmaps,
  useAuth, useCreateMarker, confirmMarker, reportMarker, deleteMyMarker,
  type Marker, type MarkerType, type MarkerWithDistance, type Profile, type ReportReason
} from './lib'

/* ---------- GlassPanel ---------- */
export function Glass({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`glass ${className}`} {...rest}>{children}</div>
}

/* ---------- BottomSheet ---------- */
export function Sheet({ open, onClose, children, maxHeight = '80vh' }: {
  open: boolean; onClose: () => void; children: ReactNode; maxHeight?: string
}) {
  const [dragY, setDragY] = useState(0)
  const startY = useRef(0)
  const dragging = useRef(false)

  useEffect(() => { if (open) setDragY(0) }, [open])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  if (!open) return null

  const onDown = (e: React.PointerEvent) => {
    dragging.current = true; startY.current = e.clientY
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    setDragY(Math.max(0, e.clientY - startY.current))
  }
  const onUp = () => {
    dragging.current = false
    if (dragY > 120) onClose()
    setDragY(0)
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 fade-anim" onClick={onClose} />
      <div
        className="glass absolute left-0 right-0 bottom-0 rounded-t-[28px] rounded-b-none p-5 safe-bottom sheet-anim"
        style={{
          maxHeight,
          transform: `translateY(${dragY}px)`,
          transition: dragging.current ? 'none' : 'transform 320ms cubic-bezier(.2,.9,.3,1.15)'
        }}
      >
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          className="mx-auto h-6 w-full cursor-grab touch-none">
          <div className="mx-auto mt-1 h-1.5 w-12 rounded-full bg-white/30" />
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: `calc(${maxHeight} - 40px)` }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ---------- MapView ---------- */
export function MapView({
  markers, center, zoom, pickMode, onPickCoords, onMarkerClick
}: {
  markers: Marker[]
  center: { latitude: number; longitude: number }
  zoom: number
  pickMode: boolean
  onPickCoords: (lat: number, lon: number) => void
  onMarkerClick: (m: Marker) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadYmaps().then(async (ymaps3) => {
      if (cancelled || !ref.current) return
      const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer } = ymaps3
      const map = new YMap(ref.current, {
        location: { center: [center.longitude, center.latitude], zoom }
      })
      map.addChild(new YMapDefaultSchemeLayer({}))
      map.addChild(new YMapDefaultFeaturesLayer({}))
      mapRef.current = map
      if (pickMode) {
        map.addChild(new ymaps3.YMapListener({
          onActionEnd: () => {
            const c = mapRef.current?.center
            if (c) onPickCoords(c[1], c[0])
          }
        }))
      }
    }).catch(e => setErr(e.message))
    return () => {
      cancelled = true
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const ymaps3 = window.ymaps3
    if (!map || !ymaps3) return
    const seen = new Set<string>()
    const svg = encodeURIComponent(markerSvg())
    markers.forEach((m) => {
      seen.add(m.id)
      if (markersRef.current.has(m.id)) return
      const el = document.createElement('button')
      el.className = 'map-marker'
      el.style.cssText = 'background:transparent;border:0;padding:0;cursor:pointer;'
      el.innerHTML = `<img src="data:image/svg+xml;charset=utf-8,${svg}" width="36" height="46" alt=""/>`
      el.addEventListener('click', (e) => { e.stopPropagation(); onMarkerClick(m) })
      const marker = new ymaps3.YMapMarker(
        { coordinates: [m.longitude, m.latitude], anchor: [0.5, 1] }, el
      )
      map.addChild(marker)
      markersRef.current.set(m.id, marker)
    })
    for (const [id, obj] of markersRef.current) {
      if (!seen.has(id)) { map.removeChild(obj); markersRef.current.delete(id) }
    }
  }, [markers, onMarkerClick])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.update({
      location: { center: [center.longitude, center.latitude], zoom, duration: 600 }
    })
  }, [center, zoom])

  if (err) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6 text-center">
        <div className="glass max-w-sm p-6">
          <div className="text-lg font-semibold text-red-400">Не удалось загрузить карту</div>
          <p className="mt-2 text-sm text-neutral-400">Проверьте подключение или API-ключ.</p>
          <button onClick={() => location.reload()}
            className="mt-4 w-full rounded-2xl bg-red-600 px-4 py-3 font-medium">
            Повторить
          </button>
        </div>
      </div>
    )
  }
  return <div ref={ref} className="absolute inset-0" />
}

/* ---------- MarkerForm ---------- */
export function MarkerForm({ latitude, longitude, onSuccess, onCancel }: {
  latitude: number; longitude: number; onSuccess: () => void; onCancel: () => void
}) {
  const [type, setType] = useState<MarkerType>('traffic')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { mutate, isPending } = useCreateMarker()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 3) return setError('Название минимум 3 символа')
    if (title.length > 120) return setError('Название слишком длинное')
    if (description.length > 1000) return setError('Описание слишком длинное')
    mutate({ latitude, longitude, type, title, description }, {
      onSuccess: () => onSuccess(),
      onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Ошибка')
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-semibold">Новая метка</h2>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-wider text-neutral-400">Тип</label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TYPE_LABELS) as MarkerType[]).map((t) => (
            <button type="button" key={t} onClick={() => setType(t)}
              className={`rounded-2xl border px-3 py-2.5 text-left text-sm transition ${
                type === t ? 'border-red-500 bg-red-500/15' : 'border-white/10 bg-white/5 text-neutral-300'
              }`}>
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-wider text-neutral-400">Название</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
          placeholder="Например: экипаж ДПС на мосту"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-red-500/60" />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-wider text-neutral-400">Описание</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          rows={3} maxLength={1000} placeholder="Дополнительные детали (необязательно)"
          className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-red-500/60" />
      </div>
      <div className="text-xs text-neutral-500">Координаты: {latitude.toFixed(5)}, {longitude.toFixed(5)}</div>
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      <div className="flex gap-2 pb-2">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-2xl border border-white/10 bg-white/5 py-3.5 font-medium">Отмена</button>
        <button type="submit" disabled={isPending}
          className="flex-1 rounded-2xl bg-red-600 py-3.5 font-semibold disabled:opacity-60">
          {isPending ? 'Добавляем…' : 'Добавить'}
        </button>
      </div>
    </form>
  )
}

/* ---------- MarkerCard ---------- */
export function MarkerCard({ marker, distance, isOwner, onClose, onToast }: {
  marker: Marker; distance: number; isOwner: boolean; onClose: () => void; onToast: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try { await confirmMarker(marker.id); onToast('Спасибо за подтверждение') }
    catch (e) { onToast(e instanceof Error ? e.message : 'Ошибка') }
    finally { setBusy(false) }
  }
  const report = async (r: ReportReason) => {
    setBusy(true)
    try { await reportMarker(marker.id, r); onToast('Жалоба отправлена'); onClose() }
    catch (e) { onToast(e instanceof Error ? e.message : 'Ошибка') }
    finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('Удалить вашу метку?')) return
    setBusy(true)
    try { await deleteMyMarker(marker.id); onToast('Метка удалена'); onClose() }
    catch (e) { onToast(e instanceof Error ? e.message : 'Ошибка') }
    finally { setBusy(false) }
  }

  const expired = new Date(marker.expires_at) < new Date()

  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wider text-red-400">{TYPE_LABELS[marker.type]}</div>
      <h2 className="text-xl font-semibold">{marker.title}</h2>
      {marker.description && <p className="text-neutral-300">{marker.description}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
        <span>{formatDistance(distance)}</span><span>·</span>
        <span>{timeAgo(marker.created_at)}</span><span>·</span>
        <span className={expired ? 'text-neutral-500' : 'text-emerald-400'}>
          {expired ? 'Неактуально' : 'Актуально'}
        </span>
      </div>
      <div className="text-sm text-neutral-300">✓ {marker.confirmations_count} подтверждений</div>

      {!reportOpen ? (
        <div className="flex flex-wrap gap-2">
          {!isOwner ? (
            <>
              <button disabled={busy} onClick={confirm}
                className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-medium disabled:opacity-60">
                Подтвердить
              </button>
              <button disabled={busy} onClick={() => report('false_info')}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm disabled:opacity-60">
                Неактуально
              </button>
              <button disabled={busy} onClick={() => setReportOpen(true)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm disabled:opacity-60">
                Пожаловаться
              </button>
            </>
          ) : (
            <button disabled={busy} onClick={del}
              className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
              Удалить метку
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-neutral-400">Причина жалобы:</div>
          {([
            ['false_info', 'Неверная информация'],
            ['spam', 'Спам'],
            ['inappropriate', 'Неподходящий контент'],
            ['other', 'Другое']
          ] as [ReportReason, string][]).map(([r, label]) => (
            <button key={r} disabled={busy} onClick={() => report(r)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm disabled:opacity-60">
              {label}
            </button>
          ))}
          <button onClick={() => setReportOpen(false)} className="text-xs text-neutral-500">Отмена</button>
        </div>
      )}
    </div>
  )
}

/* ---------- MarkerList ---------- */
export function MarkerList({
  markers, isLoading, isError, onRetry, onSelect,
  types, setTypes, radius, setRadius
}: {
  markers: MarkerWithDistance[]
  isLoading: boolean; isError: boolean; onRetry: () => void
  onSelect: (m: MarkerWithDistance) => void
  types: MarkerType[]; setTypes: (t: MarkerType[]) => void
  radius: number | 'all'; setRadius: (r: number | 'all') => void
}) {
  const [sort, setSort] = useState<'near' | 'new' | 'actual'>('near')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const sorted = [...markers]
  if (sort === 'near') sorted.sort((a, b) => a.distance - b.distance)
  if (sort === 'new') sorted.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  if (sort === 'actual') sorted.sort((a, b) => b.confirmations_count - a.confirmations_count)

  const toggleType = (t: MarkerType) =>
    setTypes(types.includes(t) ? types.filter(x => x !== t) : [...types, t])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Метки рядом</h2>
        <button onClick={() => setFiltersOpen(v => !v)}
          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs">
          {filtersOpen ? 'Скрыть фильтры' : 'Фильтры'}
        </button>
      </div>

      {filtersOpen && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs uppercase tracking-wider text-neutral-400">Типы</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_LABELS) as MarkerType[]).map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)}
                  className="h-4 w-4 accent-red-600" />
                {TYPE_LABELS[t]}
              </label>
            ))}
          </div>
          <div className="text-xs uppercase tracking-wider text-neutral-400">Радиус</div>
          <div className="flex flex-wrap gap-2">
            {(['all', 1, 3, 5, 10] as const).map((r) => (
              <button key={String(r)} onClick={() => setRadius(r)}
                className={`rounded-full px-3 py-1.5 text-xs ${
                  radius === r ? 'bg-red-600 font-semibold' : 'border border-white/10 bg-white/5'
                }`}>
                {r === 'all' ? 'Все' : `${r} км`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {(['near', 'new', 'actual'] as const).map((s) => (
          <button key={s} onClick={() => setSort(s)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              sort === s ? 'bg-white/15 font-semibold' : 'text-neutral-400'
            }`}>
            {s === 'near' ? 'Рядом' : s === 'new' ? 'Новые' : 'Актуальные'}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-16" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center">
          <div className="text-sm">Не удалось загрузить метки</div>
          <button onClick={onRetry} className="mt-2 rounded-xl bg-red-600 px-4 py-2 text-sm">Повторить</button>
        </div>
      )}

      {!isLoading && !isError && sorted.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
          <div className="text-lg font-semibold">Здесь пока тихо</div>
          <p className="mt-1 text-sm text-neutral-400">
            Если знаете о дорожной ситуации, добавьте метку на карту.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {sorted.map((m) => (
          <li key={m.id}>
            <button onClick={() => onSelect(m)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-left">
              <div className="text-xs text-red-400">{TYPE_LABELS[m.type]}</div>
              <div className="mt-0.5 truncate text-sm font-medium">{m.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                <span>{formatDistance(m.distance)}</span><span>·</span>
                <span>{timeAgo(m.created_at)}</span><span>·</span>
                <span>{m.confirmations_count} ✓</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- AuthModal ---------- */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { signInEmail, signUpEmail, signInOAuth } = useAuth()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      if (mode === 'signin') await signInEmail(email, password)
      else {
        if (username.trim().length < 2) throw new Error('Введите имя')
        await signUpEmail(email, password, username.trim())
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2 rounded-2xl bg-white/5 p-1">
          <button onClick={() => setMode('signin')}
            className={`flex-1 rounded-xl py-2 text-sm ${mode === 'signin' ? 'bg-white/10 font-semibold' : 'text-neutral-400'}`}>
            Вход
          </button>
          <button onClick={() => setMode('signup')}
            className={`flex-1 rounded-xl py-2 text-sm ${mode === 'signup' ? 'bg-white/10 font-semibold' : 'text-neutral-400'}`}>
            Регистрация
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="Имя" required
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-red-500/60" />
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
            placeholder="Email"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-red-500/60" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
            required minLength={6} placeholder="Пароль"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-red-500/60" />
          {error && <div className="rounded-2xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          <button type="submit" disabled={busy}
            className="w-full rounded-2xl bg-red-600 py-3.5 font-semibold disabled:opacity-60">
            {busy ? 'Подождите…' : mode === 'signin' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <div className="h-px flex-1 bg-white/10" />или<div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="grid grid-cols-2 gap-2 pb-2">
          <button onClick={() => signInOAuth('google')}
            className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm">Google</button>
          <button onClick={() => signInOAuth('apple')}
            className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm">Apple</button>
        </div>
      </div>
    </Sheet>
  )
}

/* ---------- ProfilePage ---------- */
export function ProfilePage({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { signOut } = useAuth()
  const [myMarkers, setMyMarkers] = useState<Marker[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('markers').select('*').eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setMyMarkers((data ?? []) as Marker[]); setLoading(false) })
  }, [profile.id])

  const remove = async (id: string) => {
    if (!confirm('Удалить?')) return
    await deleteMyMarker(id)
    setMyMarkers(prev => prev.filter(m => m.id !== id))
  }

  const total = myMarkers.reduce((s, m) => s + m.confirmations_count, 0)

  return (
    <Sheet open onClose={onClose} maxHeight="90vh">
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-2xl font-bold">
            {profile.username[0]?.toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-semibold">{profile.username}</div>
            <div className="text-xs text-neutral-400">
              С нами с {new Date(profile.created_at).toLocaleDateString('ru-RU')}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="glass p-4">
            <div className="text-2xl font-bold">{myMarkers.length}</div>
            <div className="text-xs text-neutral-400">меток добавлено</div>
          </div>
          <div className="glass p-4">
            <div className="text-2xl font-bold">{total}</div>
            <div className="text-xs text-neutral-400">подтверждений</div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-300">Мои метки</h3>
          {loading ? <div className="skeleton h-16" /> :
            myMarkers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-neutral-500">
                Вы ещё не добавляли меток
              </div>
            ) : (
              <ul className="space-y-2">
                {myMarkers.map(m => (
                  <li key={m.id} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{m.title}</div>
                      <div className="text-xs text-neutral-400">{TYPE_LABELS[m.type]}</div>
                    </div>
                    <button onClick={() => remove(m.id)}
                      className="rounded-xl border border-red-500/40 px-3 py-1.5 text-xs text-red-300">
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <button onClick={() => { signOut(); onClose() }}
          className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm">
          Выйти
        </button>
      </div>
    </Sheet>
  )
}

/* ---------- AdminPage ---------- */
export function AdminPage({ onBack }: { onBack: () => void }) {
  const [stats, setStats] = useState({ users: 0, markers: 0, active: 0, reports: 0 })
  const [markers, setMarkers] = useState<Marker[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [users, setUsers] = useState<Profile[]>([])

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('markers').select('*', { count: 'exact', head: true }),
      supabase.from('markers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('reports').select('*', { count: 'exact', head: true })
    ]).then(([u, m, a, r]) =>
      setStats({ users: u.count ?? 0, markers: m.count ?? 0, active: a.count ?? 0, reports: r.count ?? 0 }))

    supabase.from('markers').select('*').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setMarkers((data ?? []) as Marker[]))
    supabase.from('reports').select('*, markers(title)').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setReports(data ?? []))
    supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setUsers((data ?? []) as Profile[]))
  }, [])

  const hide = async (id: string) => {
    await supabase.from('markers').update({ status: 'hidden' }).eq('id', id)
    setMarkers(prev => prev.map(m => m.id === id ? { ...m, status: 'hidden' } : m))
  }
  const del = async (id: string) => {
    if (!confirm('Удалить метку?')) return
    await supabase.from('markers').delete().eq('id', id)
    setMarkers(prev => prev.filter(m => m.id !== id))
  }
  const toggleBlock = async (u: Profile) => {
    await supabase.from('profiles').update({ is_blocked: !u.is_blocked }).eq('id', u.id)
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_blocked: !x.is_blocked } : x))
  }

  return (
    <div className="min-h-[100dvh] overflow-y-auto bg-neutral-950 p-5 space-y-6 safe-top">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">← Назад</button>
        <h1 className="text-2xl font-bold">Админ-панель</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Пользователи', stats.users],
          ['Метки', stats.markers],
          ['Активные', stats.active],
          ['Жалобы', stats.reports]
        ].map(([label, value]) => (
          <div key={label as string} className="glass p-4">
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Новые метки</h2>
        <div className="space-y-2">
          {markers.slice(0, 20).map(m => (
            <div key={m.id} className="glass flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.title}</div>
                <div className="text-xs text-neutral-400">
                  {TYPE_LABELS[m.type]} · {m.status}
                </div>
              </div>
              <button onClick={() => hide(m.id)} className="rounded-xl border border-white/10 px-3 py-1.5 text-xs">Скрыть</button>
              <button onClick={() => del(m.id)} className="rounded-xl border border-red-500/40 px-3 py-1.5 text-xs text-red-300">Удалить</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Жалобы</h2>
        <div className="space-y-2">
          {reports.map(r => (
            <div key={r.id} className="glass p-3 text-sm">
              <div className="font-medium">{r.markers?.title ?? '—'}</div>
              <div className="text-xs text-neutral-400">
                {r.reason} · {new Date(r.created_at).toLocaleString('ru-RU')}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Пользователи</h2>
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="glass flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{u.username}</div>
                <div className="text-xs text-neutral-400">
                  {u.role}{u.is_blocked && ' · заблокирован'}
                </div>
              </div>
              <button onClick={() => toggleBlock(u)} className="rounded-xl border border-white/10 px-3 py-1.5 text-xs">
                {u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export { MARKER_PLACEHOLDER }
