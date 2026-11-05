import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  userId?: string;
  role?: string;
  method?: string;
  path?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function setRequestContextUser(userId: string, role?: string): void {
  const store = requestContextStorage.getStore();
  if (store) {
    store.userId = userId;
    if (role) {
      store.role = role;
    }
  }
}

