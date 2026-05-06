const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function buildUrl(path) {
  if (!path.startsWith('/')) return `${API_BASE_URL}/${path}`;
  return `${API_BASE_URL}${path}`;
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(buildUrl(path), options);
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const rawBody = await response.text();
    const preview = rawBody.replace(/\s+/g, ' ').slice(0, 140);

    throw new Error(
      `API endpoint returned non-JSON response (${response.status}). ` +
      `Set VITE_API_BASE_URL to your backend URL. Response preview: ${preview}`
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}
