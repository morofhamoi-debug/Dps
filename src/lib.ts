import { createClient } from '@supabase/supabase-js'
import { useEffect, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/* ---------- Types ---------- */
export type MarkerType = 'traffic' | 'accident' | 'repair' | 'closure' | 'danger' | 'other'
export type MarkerStatus = 'active' | 'expired' | 'hidden'
export type ReportReason = 'false_info' | 'spam' | 'inappropriate' | 'other'

export interface Profile {
  id: string; username: string; avatar_url: string | null
  role: 'user' | 'admin'; is_blocked: boolean; created_at: string
}
export interface Marker {
  id: string; user_id: string
  latitude: number; longitude: number
  type: MarkerType; title: string; description: string | null
  status: MarkerStatus; created_at: string; expires_at: string
  confirmations_count: number
}
export interface MarkerWithDistance extends Marker { distance: number }

export const TYPE_LABELS: Record<MarkerType, string> = {
  traffic: 'Дорожная обстановка',
  accident: 'ДТП',
  repair: 'Ремонт',
  closure: 'Перекрытие',
  danger: 'Опасный участок',
  other: 'Другая информация'
}

/* ---------- Supabase ---------- */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
)

/* ---------- Yandex Maps loader ---------- */
declare global { interface Window { ymaps3?: any } }
let yPromise: Promise<any> | null = null
export function loadYmaps(): Promise<any> {
  if (window.ymaps3) return Promise.resolve(window.ymaps3)
  if (yPromise) return yPromise
  yPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_YANDEX_MAPS_API_KEY
    if (!key) return reject(new Error('Яндекс.Карты: отсутствует API-ключ'))
    const s = document.createElement('script')
    s.src = `https://api-maps.yandex.ru/v3/?apikey=${key}&lang=ru_RU`
    s.async = true
    s.onerror = () => { yPromise = null; reject(new Error('Не удалось загрузить Яндекс Карты')) }
    s.onload = async () => { try { await window.ymaps3.ready; resolve(window.ymaps3) } catch (e) { reject(e) } }
    document.head.appendChild(s)
  })
  return yPromise
}

/* ---------- Geo utils ---------- */
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
export function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(1)} км`
}
export function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (d < 60) return 'только что'
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`
  return `${Math.floor(d / 86400)} дн назад`
}

/* ---------- Custom marker SVG ---------- */
export function markerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
    <defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".35"/>
    </filter></defs>
    <path filter="url(#s)" fill="#E11D2E"
      d="M18 1C8.6 1 1 8.6 1 18c0 12.5 17 27 17 27s17-14.5 17-27C35 8.6 27.4 1 18 1z"/>
    <circle cx="18" cy="18" r="7.5" fill="#fff"/>
    <circle cx="18" cy="18" r="3.5" fill="#E11D2E"/>
  </svg>`
}

/* ---------- Auth hook ---------- */
import type { Session } from '@supabase/supabase-js'
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
      else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) loadProfile(s.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function loadProfile(id: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    setProfile(data as Profile | null)
    setLoading(false)
  }

  return {
    session, user: session?.user ?? null, profile, loading,
    signInEmail: async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signUpEmail: async (email: string, password: string, username: string) => {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { username } } })
      if (error) throw error
    },
    signInOAuth: async (p: 'google' | 'apple') => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: p, options: { redirectTo: window.location.origin }
      })
      if (error) throw error
    },
    signOut: () => supabase.auth.signOut()
  }
}

/* ---------- Geolocation hook ---------- */
export function useGeolocation() {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Геолокация не поддерживается')
      return Promise.reject(new Error('unsupported'))
    }
    setLoading(true); setError(null)
    return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
          setCoords(c); setLoading(false); resolve(c)
        },
        (err) => {
          const msg = err.code === err.PERMISSION_DENIED
            ? 'Разрешите доступ к геолокации'
            : 'Не удалось определить местоположение'
          setError(msg); setLoading(false); reject(new Error(msg))
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      )
    })
  }, [])

  return { coords, loading, error, request }
}

/* ---------- Markers query ---------- */
export interface MarkerFilters {
  types: MarkerType[]
  radiusKm: number | 'all'
  center: { latitude: number; longitude: number } | null
}

export function useMarkers(filters: MarkerFilters) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['markers', filters.types, filters.radiusKm, filters.center],
    queryFn: async (): Promise<Marker[]> => {
      let q = supabase.from('markers').select('*').eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
      if (filters.types.length) q = q.in('type', filters.types)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      let arr = (data ?? []) as Marker[]
      if (filters.center && filters.radiusKm !== 'all') {
        const r = filters.radiusKm
        arr = arr.filter(m => haversine(
          { lat: filters.center!.latitude, lon: filters.center!.longitude },
          { lat: m.latitude, lon: m.longitude }
        ) <= r)
      }
      return arr
    },
    staleTime: 30_000
  })

  useEffect(() => {
    const ch = supabase.channel('markers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'markers' }, (payload) => {
        qc.invalidateQueries({ queryKey: ['markers'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  return query
}

/* ---------- Marker mutations ---------- */
const RATE_KEY = 'dps_last_marker'
export async function createMarker(input: {
  latitude: number; longitude: number; type: MarkerType;
  title: string; description?: string
}) {
  const last = Number(sessionStorage.getItem(RATE_KEY) ?? 0)
  if (Date.now() - last < 30_000) throw new Error('Слишком часто. Подождите немного.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Требуется авторизация')
  const { data, error } = await supabase.from('markers').insert({
    user_id: user.id, latitude: input.latitude, longitude: input.longitude,
    type: input.type, title: input.title.trim(),
    description: input.description?.trim() || null
  }).select().single()
  if (error) throw error
  sessionStorage.setItem(RATE_KEY, String(Date.now()))
  return data as Marker
}

export function useCreateMarker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createMarker,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['markers'] })
  })
}

export async function confirmMarker(markerId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Требуется авторизация')
  const { error } = await supabase.from('confirmations').insert({ marker_id: markerId, user_id: user.id })
  if (error?.code === '23505') throw new Error('Вы уже подтверждали')
  if (error) throw error
}

export async function reportMarker(markerId: string, reason: ReportReason) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Требуется авторизация')
  const { error } = await supabase.from('reports').insert({ marker_id: markerId, user_id: user.id, reason })
  if (error) throw error
}

export async function deleteMyMarker(id: string) {
  const { error } = await supabase.from('markers').delete().eq('id', id)
  if (error) throw error
}
