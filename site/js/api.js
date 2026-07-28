// Thin fetch wrapper shared by every page/module.
// Always sends credentials so the httpOnly auth cookie is included.

const BASE = window.API_BASE_URL;

async function request(path, { method = 'GET', body = null, isForm = false } = {}) {
  const options = {
    method,
    credentials: 'include',
  };

  if (body !== null) {
    if (isForm) {
      options.body = body; // FormData - browser sets the multipart boundary itself
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
  }

  let res, data;
  try {
    res = await fetch(`${BASE}${path}`, options);
    data = await res.json().catch(() => ({}));
  } catch (err) {
    throw new Error('Network error - could not reach the server. Check your connection and try again.');
  }

  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status})`);
  }

  return data;
}

export const apiGet = (path) => request(path, { method: 'GET' });
export const apiPost = (path, body, isForm = false) => request(path, { method: 'POST', body, isForm });
export const apiPut = (path, body, isForm = false) => request(path, { method: 'PUT', body, isForm });
export const apiPatch = (path, body, isForm = false) => request(path, { method: 'PATCH', body, isForm });
export const apiDelete = (path) => request(path, { method: 'DELETE' });
