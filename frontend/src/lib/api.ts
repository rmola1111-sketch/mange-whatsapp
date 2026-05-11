export type ApiError = { error?: string; message?: string }

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!res.ok) {
    let msg = 'Request failed'
    try {
      const data = (await res.json()) as ApiError
      msg = data.error || data.message || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }

  // Some endpoints might return empty bodies
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export type Business = {
  id: number
  name: string
  phone?: string
  price?: number
  location?: string
  is_active: number | boolean
  connection_status?: string
  opening_hour?: string
  closing_hour?: string
  appointment_duration?: number
  timezone?: string
}

export type Booking = {
  id: number
  business_id: number
  business_name?: string
  customer_phone: string
  datetime: string
  created_at: string
}

export function getBusinesses() {
  return apiFetch<Business[]>('/api/businesses')
}

export function createBusiness(payload: { name: string; phone: string }) {
  return apiFetch<Business>('/api/businesses', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateBusiness(id: number, payload: Partial<Business>) {
  return apiFetch<{ success: boolean; business?: Business }>(`/api/businesses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteBusiness(id: number) {
  return apiFetch<{ success: boolean }>(`/api/businesses/${id}`, {
    method: 'DELETE',
  })
}

export function toggleBusiness(id: number) {
  return apiFetch<{ success: boolean; is_active: number }>(`/api/businesses/toggle/${id}`, {
    method: 'POST',
  })
}

export function getBookings() {
  return apiFetch<Booking[]>('/api/bookings')
}
