import { ref } from "vue";
export const serverUrl = ref(localStorage.getItem("yamide.server") ?? "");
export const token = ref(localStorage.getItem("yamide.token") ?? "");
export const error = ref("");
export type Resource = {
  id: string;
  type: "explorer" | "terminal" | "agent";
  name: string;
  status: string;
  error?: string;
  exitCode?: number;
};
export type Workspace = {
  id: string;
  name: string;
  directory: string;
  createdAt: string;
  resources: Resource[];
};
export type RuntimeEvent = {
  seq: number;
  resourceId: string;
  type: string;
  data: unknown;
};
export function saveConnection() {
  localStorage.setItem("yamide.server", serverUrl.value.replace(/\/$/, ""));
  localStorage.setItem("yamide.token", token.value);
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const base = new URL(serverUrl.value);
  if (!["http:", "https:"].includes(base.protocol))
    throw new Error("请输入 HTTP 或 HTTPS 服务端地址");
  const response = await fetch(
    `${serverUrl.value.replace(/\/$/, "")}/api${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(40000),
    },
  );
  if (!response.ok) {
    const message = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    throw new Error(String(message.message ?? response.status));
  }
  return response.json() as Promise<T>;
}
export async function attempt(action: () => Promise<void>) {
  error.value = "";
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
