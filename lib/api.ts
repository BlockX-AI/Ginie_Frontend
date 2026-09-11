// Use local proxy to avoid cross-origin cookie issues
const DEFAULT_API_BASE = "https://evi-user-apis-production.up.railway.app";
const API_BASE = typeof window !== "undefined"
  ? "/api/proxy"
  : String((process.env.NEXT_PUBLIC_API_BASE_URL as string) || DEFAULT_API_BASE).replace(/\/+$/, "");

// Webbuilder backend (for demo mode — direct calls, no auth needed)
const WEBBUILDER_BASE = String(process.env.NEXT_PUBLIC_WEBBUILDER_API_URL || "https://web-production-7fc87.up.railway.app").replace(/\/+$/, "");

function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
    return new URL(normalizedPath, `${API_BASE}/`).toString();
  }
  return `${API_BASE}${normalizedPath}`;
}

import { apiCache, cacheKeys, cacheTTL } from './cache';

// Global event name for session expiry
export const SESSION_EXPIRED_EVENT = "evi:session-expired";

// Refresh lock to prevent concurrent refresh calls
let refreshPromise: Promise<boolean> | null = null;
let lastRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 2000; // Don't refresh more than once per 2 seconds

// Dispatch session expired event (for AuthProvider to handle)
function dispatchSessionExpired() {
  if (typeof window !== "undefined") {
    console.log('[API] Dispatching session expired event');
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

// Perform refresh with lock - returns true if refresh succeeded
async function doRefreshWithLock(signal?: AbortSignal): Promise<boolean> {
  // Demo mode: the webbuilder backend has no cookie-based /auth/refresh flow.
  // Short-circuit to avoid spamming /auth/refresh (422) on every 401 response.
  return false;

  // eslint-disable-next-line no-unreachable
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    console.log('[API] Refresh already in progress, waiting...');
    return refreshPromise;
  }

  // Check cooldown to avoid hammering the refresh endpoint
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) {
    console.log('[API] Refresh on cooldown, skipping');
    return false;
  }

  // Create a new refresh promise
  refreshPromise = (async () => {
    try {
      const url = buildApiUrl("/auth/refresh");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        signal,
      });
      lastRefreshTime = Date.now();
      if (res.ok) {
        console.log('[API] Refresh succeeded');
        return true;
      }
      console.log('[API] Refresh failed with status', res.status);
      return false;
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      console.log('[API] Refresh error:', e?.message);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

type Json = Record<string, any>;

type RequestExtras = {
  signal?: AbortSignal;
};

function makeAbortError(): any {
  const err: any = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function getCsrf(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )evium_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function request<T = any>(
  path: string,
  opts: { method?: string; body?: Json | undefined; csrf?: boolean; retry?: boolean; accept?: string; responseType?: "json" | "text"; contentType?: string; rawBody?: BodyInit; signal?: AbortSignal } = {},
): Promise<T> {
  if (opts.signal?.aborted) throw makeAbortError();
  const method = opts.method || (opts.body ? "POST" : "GET");
  const url = buildApiUrl(path);
  const headers: Record<string, string> = { "Content-Type": opts.contentType || "application/json", Accept: opts.accept || "application/json" };
  if (method !== "GET" && opts.csrf !== false) {
    let csrf = getCsrf();
    // Skip CSRF for demo mode - webbuilder backend doesn't use CSRF tokens
    // if (!csrf && !opts.retry) {
    //   try {
    //     await request("/auth/refresh", { method: "POST", csrf: false, retry: true, signal: opts.signal });
    //   } catch {}
    //   csrf = getCsrf();
    // }
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  try {
    const hasCsrf = !!headers["x-csrf-token"];
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: "debug", msg: "api.request", method, path, url, hasCsrf }));
  } catch {}
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      signal: opts.signal,
      body: opts.rawBody ? opts.rawBody : (opts.body ? JSON.stringify(opts.body) : undefined),
    });
  } catch (e: any) {
    if (opts.signal?.aborted || e?.name === "AbortError") throw makeAbortError();
    throw e;
  }
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: "debug", msg: "api.response", method, path, status: res.status }));
  } catch {}

  if (res.status === 401 && !opts.retry && path !== "/auth/refresh") {
    // Demo mode: do not attempt token refresh (webbuilder backend has no such flow).
    // Just log and continue so the caller can handle the 401 gracefully.
    console.log('[API] 401 received, continuing without auth (demo mode)');
  }

  const text = await res.text();
  let data: any = {};
  if (opts.responseType === "text") {
    data = text;
  } else if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok && res.status !== 304) {
    const msg = (opts.responseType === "text" ? text : (data?.error?.message || data?.message || data?.detail)) || (text || `Request failed (${res.status})`);
    const err: any = new Error(msg);
    err.status = res.status;
    err.code = data?.error?.code || data?.code;
    try {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({ level: "warn", msg: "api.error", method, path, status: res.status, code: err.code, message: msg?.toString?.().slice?.(0, 200) }));
    } catch {}
    // Skip CSRF refresh for demo mode
    // if (res.status === 400 && !opts.retry) {
    //   try {
    //     await request("/auth/refresh", { method: "POST", csrf: false, retry: true, signal: opts.signal });
    //     return request<T>(path, { ...opts, retry: true, signal: opts.signal });
    //   } catch {}
    // }
    throw err;
  }
  if (res.status === 304) {
    return {} as T;
  }
  return (data ?? ({} as any)) as T;
}

async function requestBinary(
  path: string,
  opts: { method?: string; accept?: string; signal?: AbortSignal } = {},
): Promise<ArrayBuffer> {
  const method = opts.method || "GET";
  const url = buildApiUrl(path);
  const headers: Record<string, string> = { Accept: opts.accept || "application/octet-stream" };
  if (opts.signal?.aborted) throw makeAbortError();
  const res = await fetch(url, {
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    signal: opts.signal,
  });
  if (res.status === 401 && path !== "/auth/refresh") {
    const refreshed = await doRefreshWithLock(opts.signal);
    if (refreshed) return requestBinary(path, { ...opts });
    dispatchSessionExpired();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err: any = new Error(text || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return await res.arrayBuffer();
}

export const api = {
  // mode: 'auto' | 'signin' | 'signup'
  sendOtp: (identity: string, name: string, mode?: 'auto' | 'signin' | 'signup', captchaToken?: string) =>
    Promise.resolve({ ok: true as const, challengeId: 'demo', expiresAt: Date.now() + 300000 }),
    // request<{ ok: true; challengeId?: string; expiresAt?: number }>("/u/auth/send-otp", {
    //   method: "POST",
    //   body: { identity, name, ...(mode ? { mode } : {}), ...(captchaToken ? { captchaToken } : {}) },
    //   csrf: false,
    // }),
  verifyOtp: (
    identity: string,
    otp: string,
    challengeId?: string,
    opts?: { mode?: 'auto' | 'signin' | 'signup'; name?: string }
  ) =>
    Promise.resolve({ ok: true as const, user: null, entitlements: null }),
    // request<{ ok: true; user: any; entitlements: any }>("/u/auth/verify", {
    //   method: "POST",
    //   body: { identity, otp, ...(challengeId ? { challengeId } : {}), ...(opts?.mode ? { mode: opts.mode } : {}), ...(opts?.name ? { name: opts.name } : {}) },
    //   csrf: false,
    // }),
  refresh: (extra?: RequestExtras) => Promise.resolve({ ok: true as const }),  // Stubbed for demo mode
  me: (extra?: RequestExtras) => Promise.resolve({ ok: true as const, user: null, entitlements: null }),
  meCached: (extra?: RequestExtras & { forceRefresh?: boolean }) =>
    Promise.resolve({ ok: true as const, user: null, entitlements: null }),
  updateProfile: async (payload: {
    display_name: string;
    wallet_address?: string | null;
    profile: {
      organization: string;
      role: string;
      location?: string;
      country?: string;
      state?: string;
      city?: string;
      avatar_url?: string;
      bio?: string;
      phone?: string;
      birthday?: string;
      gender?: string;
      social?: { github?: string; linkedin?: string; twitter?: string; telegram?: string };
    };
  }) => {
    return Promise.resolve({ ok: true as const, user: null, entitlements: null });
  },
  logout: (extra?: RequestExtras) => Promise.resolve({ ok: true as const }),
  redeemKey: async (key: string) => {
    return Promise.resolve({ ok: true as const, user: null, entitlements: null });
  },
  auditByJobMd: (jobId: string, extra?: RequestExtras) =>
    request<string>("/u/proxy/audit/byJob?format=md", {
      method: "POST",
      body: { jobId, model: "gemini-2.0-flash", policy: {} },
      accept: "text/markdown",
      responseType: "text",
      signal: extra?.signal,
    }),
  complianceByJobMd: (jobId: string, extra?: RequestExtras) =>
    request<string>("/u/proxy/compliance/byJob?format=md", {
      method: "POST",
      body: { jobId, model: "gemini-2.0-flash", policy: {} },
      accept: "text/markdown",
      responseType: "text",
      signal: extra?.signal,
    }),
  uploadAvatar: async (file: Blob | ArrayBuffer | Uint8Array, contentType: string) => {
    const res = await request<{ ok: true; avatar: { id: string; url: string } }>("/u/user/avatar", {
      method: "POST",
      accept: "application/json",
      contentType,
      rawBody: (file as any),
    });
    apiCache.invalidate(cacheKeys.user());
    return res;
  },
  deleteAvatar: async (id: string) => {
    const res = await request<{ ok: true }>(`/u/user/avatar/${encodeURIComponent(id)}`, { method: "DELETE" });
    apiCache.invalidate(cacheKeys.user());
    return res;
  },
  pruneAvatars: async (keepLatest?: number) => {
    const res = await request<{ ok: true; pruned?: number }>("/u/user/avatar/prune", {
      method: "POST",
      ...(typeof keepLatest === "number" ? { body: { keepLatest } } : {}),
    });
    apiCache.invalidate(cacheKeys.user());
    return res;
  },
  startPipeline: (payload: StartPipelinePayload) =>
    request<{ status: string; chat_id: string; message: string }>("/demo/chat", { method: "POST", body: { prompt: payload.prompt, model: payload.model || "gpt-4o" } }),
  // Demo mode: fetch project metadata (contracts, files, vercel URL) from webbuilder backend directly
  demoProjectMeta: async (projectId: string, extra?: RequestExtras) => {
    const url = `${WEBBUILDER_BASE}/demo/projects/${encodeURIComponent(projectId)}/meta`;
    const res = await fetch(url, { signal: extra?.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Meta fetch failed (${res.status})`);
    return res.json();
  },
  demoProjectFiles: async (projectId: string, extra?: RequestExtras) => {
    const url = `${WEBBUILDER_BASE}/projects/${encodeURIComponent(projectId)}/files`;
    const res = await fetch(url, { signal: extra?.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Files fetch failed (${res.status})`);
    return res.json();
  },
  demoProjectFile: async (projectId: string, filePath: string, extra?: RequestExtras) => {
    const url = `${WEBBUILDER_BASE}/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`;
    const res = await fetch(url, { signal: extra?.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`File fetch failed (${res.status})`);
    return res.json();
  },
  demoProjectZip: async (projectId: string, extra?: RequestExtras) => {
    const url = `${WEBBUILDER_BASE}/projects/${encodeURIComponent(projectId)}/download`;
    const res = await fetch(url, { signal: extra?.signal, headers: { Accept: "application/zip" } });
    if (!res.ok) throw new Error(`ZIP fetch failed (${res.status})`);
    return res.arrayBuffer();
  },
  jobStatus: (jobId: string, includeMagical = true) =>
    Promise.resolve({ build_status: "building", build_started_at: "", last_build_event: "", task_running: true }),  // Stubbed for demo mode (updates come via /ws/status)
  job: (jobId: string, extra?: RequestExtras) => request<{ chat: any; messages: any[] }>(`/chats/${encodeURIComponent(jobId)}/messages`, { signal: extra?.signal }),
  // Cached version of job details (use for repeated polling)
  jobCached: (jobId: string, extra?: RequestExtras & { forceRefresh?: boolean }) =>
    apiCache.get(
      cacheKeys.job(jobId),
      () => request<{ chat: any; messages: any[] }>(`/chats/${encodeURIComponent(jobId)}/messages`, { signal: extra?.signal }),
      { ttl: cacheTTL.short, forceRefresh: extra?.forceRefresh }
    ),
  // List user jobs (paginated)
  listUserJobs: (params?: { type?: string; state?: string; network?: string; q?: string; limit?: number; cursorCreatedAt?: string; cursorId?: string; }, extra?: RequestExtras) => {
    const qs = new URLSearchParams();
    if (params) {
      if (params.type) qs.set('type', params.type);
      if (params.state) qs.set('state', params.state);
      if (params.network) qs.set('network', params.network);
      if (params.q) qs.set('q', params.q);
      if (typeof params.limit === 'number') qs.set('limit', String(params.limit));
      if (params.cursorCreatedAt) qs.set('cursorCreatedAt', params.cursorCreatedAt);
      if (params.cursorId) qs.set('cursorId', params.cursorId);
    }
    const path = `/u/jobs${qs.toString() ? `?${qs.toString()}` : ''}`;
    return request<{ ok: boolean; jobs: any[]; nextCursor?: { created_at?: string; job_id?: string } }>(path, { signal: extra?.signal });
  },
  listUserJobsCached: (
    params?: { type?: string; state?: string; network?: string; q?: string; limit?: number; cursorCreatedAt?: string; cursorId?: string; },
    extra?: RequestExtras & { forceRefresh?: boolean }
  ) => {
    const qs = new URLSearchParams();
    if (params) {
      if (params.type) qs.set('type', params.type);
      if (params.state) qs.set('state', params.state);
      if (params.network) qs.set('network', params.network);
      if (params.q) qs.set('q', params.q);
      if (typeof params.limit === 'number') qs.set('limit', String(params.limit));
      if (params.cursorCreatedAt) qs.set('cursorCreatedAt', params.cursorCreatedAt);
      if (params.cursorId) qs.set('cursorId', params.cursorId);
    }
    const path = `/u/jobs${qs.toString() ? `?${qs.toString()}` : ''}`;
    const key = `jobs:list:${qs.toString() || 'all'}`;
    return apiCache.get(
      key,
      () => request<{ ok: boolean; jobs: any[]; nextCursor?: { created_at?: string; job_id?: string } }>(path, { signal: extra?.signal }),
      { ttl: cacheTTL.short, forceRefresh: extra?.forceRefresh }
    );
  },
  // Get single user job details
  getUserJob: (jobId: string, extra?: RequestExtras) =>
    request<{ ok: boolean; job: any }>(`/u/jobs/${encodeURIComponent(jobId)}`, { signal: extra?.signal }),
  // Update job metadata (title, description, tags)
  updateJobMeta: async (jobId: string, meta: { title?: string; description?: string; tags?: string[] }) => {
    const res = await request<{ ok: boolean }>(`/u/jobs/${encodeURIComponent(jobId)}/meta`, { method: "PATCH", body: meta });
    apiCache.invalidate(cacheKeys.job(jobId));
    apiCache.invalidatePattern(/^jobs:list:/);
    return res;
  },
  // Update job cache (progress, address, verification status)
  updateJobCache: async (data: {
    jobId: string;
    state?: string;
    progress?: number;
    address?: string;
    fq_name?: string;
    constructor_args?: any[];
    verified?: boolean;
    explorer_url?: string;
    completed_at?: string;
  }) => {
    const res = await request<{ ok: boolean }>(`/u/jobs/cache`, { method: "POST", body: data });
    if (data?.jobId) apiCache.invalidate(cacheKeys.job(data.jobId));
    apiCache.invalidatePattern(/^jobs:list:/);
    return res;
  },
  // Delete a user job
  deleteUserJob: async (jobId: string, extra?: RequestExtras) => {
    const res = await request<{ ok: boolean }>(`/u/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", signal: extra?.signal });
    apiCache.invalidate(cacheKeys.job(jobId));
    apiCache.invalidatePattern(/^jobs:list:/);
    return res;
  },
  // Export a user job bundle (returns text/json blob)
  exportUserJob: (jobId: string, extra?: RequestExtras) =>
    request<string>(`/u/jobs/${encodeURIComponent(jobId)}/export`, { method: "GET", responseType: "text", accept: "application/json", signal: extra?.signal }),
  jobLogs: (jobId: string, afterIndex = 0, includeMagical = true) =>
    Promise.resolve({ ok: true, data: { id: jobId, total: 0, count: 0, logs: [] as JobLog[] } }),  // Stubbed for demo mode (logs come via /ws/status)
  artifacts: (jobId: string, extra?: RequestExtras) =>
    request<ArtifactsCombined>(`/u/proxy/artifacts?jobId=${encodeURIComponent(jobId)}`, { signal: extra?.signal }),
  // Cached version of artifacts (prevents duplicate calls)
  artifactsCached: (jobId: string, extra?: RequestExtras & { forceRefresh?: boolean }) =>
    apiCache.get(
      cacheKeys.jobArtifacts(jobId),
      () => request<ArtifactsCombined>(`/u/proxy/artifacts?jobId=${encodeURIComponent(jobId)}`, { signal: extra?.signal }),
      { ttl: cacheTTL.medium, forceRefresh: extra?.forceRefresh }
    ),
  artifactSources: (jobId: string, extra?: RequestExtras) =>
    request<{ ok: true; jobId: string; scope?: string; sources: ArtifactSource[] }>(
      `/u/proxy/artifacts/sources?jobId=${encodeURIComponent(jobId)}`,
      { signal: extra?.signal }
    ),
  artifactAbis: (jobId: string, extra?: RequestExtras) =>
    request<{ ok: true; jobId: string; scope?: string; abis: ArtifactAbi[] }>(
      `/u/proxy/artifacts/abis?jobId=${encodeURIComponent(jobId)}`,
      { signal: extra?.signal }
    ),
  artifactScripts: (jobId: string, extra?: RequestExtras) =>
    request<{ ok: true; jobId: string; scope?: string; scripts: ArtifactScript[] }>(
      `/u/proxy/artifacts/scripts?jobId=${encodeURIComponent(jobId)}`,
      { signal: extra?.signal }
    ),
  // Wallet Deployment APIs (Pro only)
  walletDeploy: (payload: WalletDeployPayload) =>
    request<WalletDeployResponse>("/u/proxy/wallet/deploy", { method: "POST", body: payload }),
  walletSignSession: (sessionId: string, extra?: RequestExtras) =>
    request<WalletSignSession>(`/u/proxy/wallet/sign/${encodeURIComponent(sessionId)}`, { signal: extra?.signal }),
  walletSubmitTx: (sessionId: string, txHash: string, walletAddress: string) =>
    request<WalletSubmitResponse>(`/u/proxy/wallet/sign/${encodeURIComponent(sessionId)}/submit`, {
      method: "POST",
      body: { txHash, walletAddress },
    }),
  walletSessionStats: (extra?: RequestExtras) =>
    request<{ total: number; active: number; signed: number; expired: number }>("/u/proxy/wallet/sessions/stats", { signal: extra?.signal }),
  // Get available networks for wallet deployment
  walletNetworks: (extra?: RequestExtras) =>
    request<WalletNetworksResponse>("/u/proxy/wallet/networks", { signal: extra?.signal }),
  // Contract Verification APIs
  verifyByAddress: (address: string, network?: string, fullyQualifiedName?: string) =>
    Promise.resolve({ ok: true }),  // Stubbed for demo mode
  verifyByJob: (jobId: string, network?: string, fullyQualifiedName?: string) =>
    Promise.resolve({ ok: true }),  // Stubbed for demo mode
  verifyStatus: (address: string, network?: string, extra?: RequestExtras) =>
    Promise.resolve({ ok: true, verified: false }),  // Stubbed for demo mode

  // Frontend Builder (hosted_frontend entitlement)
  builderCreateProject: (payload: { prompt: string; model?: string }, extra?: RequestExtras) =>
    request<{ ok: true; project: BuilderProject; upstream?: any }>("/u/proxy/builder/projects", {
      method: "POST",
      body: payload,
      signal: extra?.signal,
    }),
  builderListProjects: (params?: { limit?: number; refresh?: boolean }, extra?: RequestExtras) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.refresh) qs.set('refresh', '1');
    const path = `/u/proxy/builder/projects${qs.toString() ? `?${qs.toString()}` : ''}`;
    return request<{ ok: true; projects: BuilderProject[] }>(path, { signal: extra?.signal });
  },
  builderGetProject: (id: string, params?: { includeMessages?: boolean }, extra?: RequestExtras) => {
    const qs = new URLSearchParams();
    if (params?.includeMessages) qs.set('includeMessages', '1');
    const path = `/u/proxy/builder/projects/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`;
    return request<{ ok: true; project: BuilderProject; messages?: any }>(path, { signal: extra?.signal });
  },
  builderDeleteProject: (id: string, extra?: RequestExtras) =>
    request<{ ok: true }>(`/u/proxy/builder/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: extra?.signal,
    }),
  builderGetStatus: (id: string, extra?: RequestExtras) =>
    Promise.resolve({ ok: true as const, project: {} as BuilderProject, status: { build_status: "completed" } }),  // Stubbed for demo mode
  builderListFiles: (id: string, extra?: RequestExtras) =>
    Promise.resolve({ ok: true, files: [] }),  // Stubbed for demo mode
  builderGetFile: (id: string, path: string, extra?: RequestExtras) => {
    const qs = new URLSearchParams();
    qs.set('path', path);
    return request<any>(`/u/proxy/builder/projects/${encodeURIComponent(id)}/file?${qs.toString()}`, { signal: extra?.signal });
  },
  builderDownloadZip: (id: string, extra?: RequestExtras) =>
    requestBinary(`/u/proxy/builder/projects/${encodeURIComponent(id)}/download`, { accept: 'application/zip', signal: extra?.signal }),
  builderExportGithub: (id: string, payload?: { repo_name?: string | null }, extra?: RequestExtras) =>
    request<any>(`/u/proxy/builder/projects/${encodeURIComponent(id)}/export/github`, {
      method: 'POST',
      body: payload || {},
      signal: extra?.signal,
    }),

  // Ensure preview server is running and return embeddable preview_url
  builderStartPreview: (id: string, extra?: RequestExtras) =>
    request<{ ok: boolean; preview_url?: string }>(`/u/proxy/builder/projects/${encodeURIComponent(id)}/preview/start`, {
      method: 'POST',
      signal: extra?.signal,
    }),

  // DApp Integration: unified contract + frontend creation
  builderCreateDapp: (payload: { prompt: string; network?: string; contract_only?: boolean; game_mode?: boolean }, extra?: RequestExtras) =>
    request<{ ok: true; project: { id: string; fb_project_id: string; network: string; project_type: string } }>("/u/proxy/builder/dapp/create", {
      method: "POST",
      body: { network: "avalanche-fuji", ...payload },
      signal: extra?.signal,
    }),
  builderCreateFrontendForContract: (payload: { contract_address: string; abi: any[]; network: string; prompt: string }, extra?: RequestExtras) =>
    request<{ ok: true; project: { id: string; fb_project_id: string; network: string; project_type: string } }>("/u/proxy/builder/dapp/frontend-for-contract", {
      method: "POST",
      body: payload,
      signal: extra?.signal,
    }),
  builderGetContracts: (projectId: string, extra?: RequestExtras) =>
    request<any>(`/u/proxy/builder/projects/${encodeURIComponent(projectId)}/contracts`, { signal: extra?.signal }),
  builderListDapps: (params?: { limit?: number }, extra?: RequestExtras) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    qs.set('type', 'dapp');
    const path = `/u/proxy/builder/projects${qs.toString() ? `?${qs.toString()}` : ''}`;
    return request<{ ok: true; projects: BuilderProject[] }>(path, { signal: extra?.signal });
  },
};

export type { Json };

export type StartPipelinePayload = {
  prompt: string;
  model?: string;
  network?: string;
  maxIters?: number;
  filename?: string;
  strictArgs?: boolean;
  constructorArgs?: any[];
  jobKind?: string;
  providedName?: string;
};

export type JobLog = { i: number; t: number; level: string; msg: string } | { category: string; msg: string; meta?: Record<string, any> };
export type JobStatus = {
  id: string;
  type: string;
  state: string;
  progress?: number;
  step?: string;
  stepHistory?: { step: string; t: number }[];
};
export type JobDetails = {
  id: string;
  type: string;
  state: string;
  progress: number;
  payload: any;
  step?: string;
  result?: any;
  error?: any;
  logs?: JobLog[];
};

export type ArtifactSource = { path: string; content: string };
export type ArtifactAbi = { path: string; name?: string; abi: any[]; bytecode?: string };
export type ArtifactScript = { path: string; content: string };
export type ArtifactsCombined = {
  ok: boolean;
  jobId: string;
  scope?: string;
  sources?: ArtifactSource[];
  abis?: ArtifactAbi[];
  scripts?: ArtifactScript[];
  meta?: Record<string, any>;
};

// Wallet Deployment Types
export type WalletDeployPayload = {
  prompt: string;
  network?: string;
  callbackUrl?: string;
  constructorArgs?: any[];
  strictArgs?: boolean;
};

export type WalletDeployResponse = {
  jobId: string;
  status: string;
  message: string;
  checkStatusUrl?: string;
};

export type WalletSignSession = {
  sessionId: string;
  jobId: string;
  contractName?: string;
  network: string;
  networkName?: string;
  estimatedGas?: string;
  unsignedTx: {
    to?: string;
    data: string;
    value?: string;
    gasLimit?: string;
    chainId: number;
    type?: number;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  chainId: number;
  callbackUrl?: string;
  expiresAt: number;
  status: string;
};

export type WalletSubmitResponse = {
  success: boolean;
  jobId: string;
  txHash: string;
  message: string;
  callbackUrl?: string;
  checkStatusUrl?: string;
};

export type WalletNetworkConfig = {
  id: string;
  name: string;
  chainId: number;
  currency: string;
  explorer: string;
  rpcUrl: string;
  isTestnet: boolean;
};

export type WalletNetworksResponse = {
  ok: boolean;
  networks: WalletNetworkConfig[];
  default: string;
};

export type BuilderProject = {
  id: string;
  user_id: string;
  fb_project_id: string;
  title?: string | null;
  status?: string | null;
  vercel_url?: string | null;
  github_url?: string | null;
  created_at: string;
};
