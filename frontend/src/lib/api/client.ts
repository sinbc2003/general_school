/**
 * API 클라이언트 — JWT 자동 갱신 포함
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getAccessToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("access_token");
  }

  private getRefreshToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("refresh_token");
  }

  private setTokens(access: string, refresh: string) {
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
  }

  clearTokens() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  }

  private async refreshTokens(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      this.setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  async fetch<T = any>(path: string, options: FetchOptions = {}): Promise<T> {
    const { skipAuth, ...fetchOptions } = options;
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const token = this.getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    if (
      !headers["Content-Type"] &&
      !(fetchOptions.body instanceof FormData)
    ) {
      headers["Content-Type"] = "application/json";
    }

    let res = await fetch(url, { ...fetchOptions, headers });

    // 401이면 토큰 갱신 시도
    if (res.status === 401 && !skipAuth) {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        headers["Authorization"] = `Bearer ${this.getAccessToken()}`;
        res = await fetch(url, { ...fetchOptions, headers });
      }
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw { status: res.status, ...error };
    }

    return res.json();
  }

  // 편의 메서드
  get<T = any>(path: string, options?: FetchOptions) {
    return this.fetch<T>(path, { ...options, method: "GET" });
  }

  post<T = any>(path: string, body?: any, options?: FetchOptions) {
    return this.fetch<T>(path, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  }

  put<T = any>(path: string, body?: any, options?: FetchOptions) {
    return this.fetch<T>(path, {
      ...options,
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  patch<T = any>(path: string, body?: any, options?: FetchOptions) {
    return this.fetch<T>(path, {
      ...options,
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  delete<T = any>(path: string, options?: FetchOptions) {
    return this.fetch<T>(path, { ...options, method: "DELETE" });
  }

  // 파일 업로드
  upload<T = any>(path: string, file: File, fieldName = "file") {
    const formData = new FormData();
    formData.append(fieldName, file);
    return this.fetch<T>(path, { method: "POST", body: formData });
  }
}

export const api = new ApiClient(API_URL);
