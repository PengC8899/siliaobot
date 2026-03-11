const apiBase =
  import.meta.env.VITE_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:8005`;

export async function apiGet(path) {
  const res = await fetch(`${apiBase}${path}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function apiPost(path, payload) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function apiUpload(path, formData) {
  // Do NOT set Content-Type header manually for FormData, 
  // browser will set it with boundary automatically.
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export const getSessions = () => apiGet("/sessions");
export const getSessionOtp = (id) => apiGet(`/sessions/${id}/otp`);
export const checkSession = (id) => apiPost(`/sessions/check/${id}`);
export const batchCheckSessions = (ids) => apiPost("/sessions/batch_check", { ids });
export const batchDeleteSessions = (ids) => apiPost("/sessions/batch_delete", { ids });
export const updateProfile = (formData) => {
  return fetch(`${apiBase}/sessions/update_profile`, {
    method: "POST",
    body: formData
  }).then(res => {
    if (!res.ok) return res.text().then(t => { throw new Error(t) });
    return res.json();
  });
};

export const uploadSession = (formData) => apiUpload("/sessions/upload", formData);
export const sendCode = (phone) => apiPost("/auth/send_code", { phone });
export const login = (phone, code, phone_code_hash) => apiPost("/auth/login", { phone, code, phone_code_hash });
export const createTask = (payload) => apiPost("/tasks/create", payload);
export const getTasks = () => apiGet("/tasks");
export const getTaskTargets = (taskId) => apiGet(`/tasks/${taskId}/targets`);
export const stopTask = (taskId) => apiPost(`/tasks/${taskId}/stop`);
export const deleteTask = async (taskId) => {
  const res = await fetch(`${apiBase}/tasks/${taskId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export const getLogs = (taskId) => apiGet(taskId ? `/logs?task_id=${taskId}` : "/logs");
export const getLogStats = (taskId) => apiGet(taskId ? `/logs/stats?task_id=${taskId}` : "/logs/stats");

export function getWsUrl(taskId) {
  const wsBase = apiBase.replace(/^http/, "ws");
  if (taskId) {
    return `${wsBase}/ws/logs?task_id=${taskId}`;
  }
  return `${wsBase}/ws/logs`;
}

// Blacklist
export const getBlacklist = () => apiGet("/blacklist/list");

export const addToBlacklist = (username, reason) =>
  apiPost("/blacklist/add", { username, reason });

export const removeFromBlacklist = async (username) => {
  const res = await fetch(`${apiBase}/blacklist/remove/${username}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

// Proxies
export const getProxies = () => apiGet("/proxies/list");
export const addProxies = (urls) => apiPost("/proxies/add", { urls });
export const removeProxy = async (id) => {
  const res = await fetch(`${apiBase}/proxies/remove/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

// Api Keys
export const getApiKeys = () => apiGet("/apikeys");
export const addApiKeys = (lines) => apiPost("/apikeys/add", { lines });
export const checkApiKey = (id) => apiPost(`/apikeys/check/${id}`);
export const batchCheckApiKeys = (ids) => apiPost("/apikeys/batch_check", { ids });
export const deleteApiKey = async (id) => {
  const res = await fetch(`${apiBase}/apikeys/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

