const API_BASE = ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `${res.status}`
    throw new Error(message)
  }
  return data as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPost<TInput, TOutput>(path: string, body: TInput): Promise<TOutput> {
  return request<TOutput>(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

export function apiPatch<TInput, TOutput>(path: string, body: TInput): Promise<TOutput> {
  return request<TOutput>(path, {
    method: 'PATCH',
    body: JSON.stringify(body ?? {}),
  })
}
