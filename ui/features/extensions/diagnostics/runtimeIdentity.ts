type DiagnosticRuntimeIdentity = {
  windowName: string | null;
  identityError: string | null;
};
type RuntimeRegistration = {
  windowName: string;
  token: string;
  pending?: boolean;
};
type RegistrationClient = {
  Register(): Promise<RuntimeRegistration>;
  Unregister(token: string): Promise<void>;
};
const UNAVAILABLE = 'Extension diagnostics runtime identity is unavailable.';

export function createDiagnosticRuntimeIdentity() {
  let snapshot: DiagnosticRuntimeIdentity = { windowName: null, identityError: null };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (owner: number, value: DiagnosticRuntimeIdentity) => {
    if (owner !== generation) {
      return;
    }

    snapshot = value;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    begin() {
      generation++;
      publish(generation, { windowName: null, identityError: null });
      return generation;
    },
    ready(owner: number, windowName: string) {
      publish(owner, { windowName, identityError: null });
    },
    fail(owner: number) {
      publish(owner, { windowName: null, identityError: UNAVAILABLE });
    },
    clear(owner: number) {
      publish(owner, { windowName: null, identityError: null });
    },
  };
}

export const diagnosticRuntimeIdentity = createDiagnosticRuntimeIdentity();

export function registerDiagnosticRuntime(client: RegistrationClient, identity = diagnosticRuntimeIdentity) {
  const owner = identity.begin();
  const deadline = Date.now() + 5000;
  let disposed = false;
  let token: string | undefined;
  let timer: number | undefined;
  const register = async () => {
    try {
      const registration = await client.Register();
      if (disposed) {
        if (registration.token) {
          void client.Unregister(registration.token).catch(() => undefined);
        }

        return;
      }

      if (registration.pending === true) {
        if (Date.now() + 250 > deadline) {
          identity.fail(owner);
          return;
        }

        timer = window.setTimeout(() => {
          timer = undefined;
          void register();
        }, 250);
        return;
      }

      if (!registration.windowName || !registration.token) {
        identity.fail(owner);
        return;
      }

      token = registration.token;
      identity.ready(owner, registration.windowName);
    } catch {
      if (!disposed) {
        identity.fail(owner);
      }
    }
  };

  void register();
  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    window.clearTimeout(timer);
    if (token) {
      void client.Unregister(token).catch(() => undefined);
    }

    identity.clear(owner);
  };
}
