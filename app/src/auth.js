const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function waitForGoogleIdentity(timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (globalThis.google?.accounts?.oauth2) {
        resolve(globalThis.google.accounts.oauth2);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("No se pudo cargar Google Identity Services"));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

export function isGoogleClientIdConfigured(clientId) {
  return Boolean(clientId && !String(clientId).includes("REPLACE_WITH") && String(clientId).endsWith(".apps.googleusercontent.com"));
}

export class GoogleOAuthClient extends EventTarget {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.tokenClient = null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.pendingRequest = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    if (!isGoogleClientIdConfigured(this.clientId)) {
      throw new Error("Falta configurar el OAuth Client ID de Google");
    }
    const oauth2 = await waitForGoogleIdentity();
    this.tokenClient = oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_FILE_SCOPE,
      include_granted_scopes: true,
      callback: response => this.#handleTokenResponse(response),
      error_callback: error => this.#handlePopupError(error)
    });
    this.initialized = true;
  }

  hasValidToken() {
    return Boolean(this.accessToken && Date.now() < this.expiresAt - 60_000);
  }

  getAccessToken() {
    return this.hasValidToken() ? this.accessToken : null;
  }

  async requestAccessToken({ prompt } = {}) {
    await this.init();
    if (this.pendingRequest) return this.pendingRequest.promise;

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    this.pendingRequest = { promise, resolve: resolvePromise, reject: rejectPromise };

    const options = {};
    if (prompt != null) options.prompt = prompt;
    this.tokenClient.requestAccessToken(options);
    return promise;
  }

  markExpired() {
    this.accessToken = null;
    this.expiresAt = 0;
    this.dispatchEvent(new CustomEvent("authchange", { detail: { connected: false, reason: "expired" } }));
  }

  async disconnect() {
    const token = this.accessToken;
    this.accessToken = null;
    this.expiresAt = 0;
    if (token && globalThis.google?.accounts?.oauth2?.revoke) {
      await new Promise(resolve => globalThis.google.accounts.oauth2.revoke(token, resolve));
    }
    this.dispatchEvent(new CustomEvent("authchange", { detail: { connected: false, reason: "disconnect" } }));
  }

  #handleTokenResponse(response) {
    const pending = this.pendingRequest;
    this.pendingRequest = null;
    if (response?.error) {
      const error = new Error(response.error_description || response.error);
      error.code = response.error;
      pending?.reject(error);
      return;
    }
    this.accessToken = response.access_token;
    const expiresInSeconds = Number(response.expires_in || 3600);
    this.expiresAt = Date.now() + expiresInSeconds * 1000;
    this.dispatchEvent(new CustomEvent("authchange", {
      detail: { connected: true, expiresAt: this.expiresAt, scope: response.scope || DRIVE_FILE_SCOPE }
    }));
    pending?.resolve(response);
  }

  #handlePopupError(errorResponse) {
    const pending = this.pendingRequest;
    this.pendingRequest = null;
    const error = new Error(errorResponse?.message || "No se pudo abrir la ventana de Google");
    error.code = errorResponse?.type || "popup_error";
    pending?.reject(error);
  }
}

export { DRIVE_FILE_SCOPE };
