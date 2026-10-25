import { applicationRequest } from '../../scripts/application-client.mjs';
import type { Descriptor, SettingSelection } from './workspace';

type Response = { status: string; result: unknown; operationID?: string; error?: { code: string } };

/** Browser profiles own mutable runtime state, never a source/build graph. */
export class ApplicationWorkspace {
  readonly name: string;
  readonly liveFrontend: boolean;
  private descriptor!: Descriptor;
  private readonly baselines = new Map<string, { selection: SettingSelection; value: unknown }>();
  private poisoned = false;

  constructor(name: string, liveFrontend: boolean) {
    this.name = name;
    this.liveFrontend = liveFrontend;
  }

  async open(): Promise<this> {
    this.descriptor = await applicationRequest<Descriptor>({ operation: 'open', name: this.name, liveFrontend: this.liveFrontend });
    return this;
  }

  assertOwned(): void {
    if (process.env.OMNIVIEW_E2E_MODE !== 'owned' || !process.env.OMNIVIEW_E2E_APPLICATION || this.poisoned) {
      throw new Error('A healthy invocation-owned application profile is required');
    }
  }

  browserURL(): string {
    const endpoint = this.descriptor.endpoints.browser;
    if (!endpoint) {
      throw new Error('Actual application has no observed browser endpoint');
    }

    return endpoint;
  }

  async verify(): Promise<Descriptor> {
    this.assertOwned();
    const next = await applicationRequest<Descriptor>({ operation: 'inspect', name: this.name, liveFrontend: this.liveFrontend });
    if (next.workspaceID !== this.descriptor.workspaceID || next.stateRoot !== this.descriptor.stateRoot || next.generation !== this.descriptor.generation || next.process.startIdentity !== this.descriptor.process.startIdentity) {
      throw new Error('Application profile changed outside its owned lifecycle');
    }

    return next;
  }

  async restart(): Promise<Descriptor> {
    const before = await this.verify();
    const next = await applicationRequest<Descriptor>({ operation: 'restart', name: this.name, liveFrontend: this.liveFrontend });
    if (next.workspaceID !== before.workspaceID || next.stateRoot !== before.stateRoot || next.generation === before.generation || next.process.startIdentity === before.process.startIdentity || next.endpoints.browser !== before.endpoints.browser) {
      throw new Error('Actual process replacement did not preserve state/origin and rotate identity');
    }

    this.descriptor = next;
    return next;
  }

  async control(command: string, params: unknown): Promise<Response> {
    this.assertOwned();
    return applicationRequest<Response>({ operation: 'control', name: this.name, liveFrontend: this.liveFrontend, command, params });
  }

  async rememberSetting(selection: SettingSelection): Promise<void> {
    const response = await this.control('settings.get', selection);
    if (Boolean(response.error) || response.status !== 'succeeded' || response.result === undefined) {
      throw new Error('Actual provider baseline is unavailable');
    }

    const key = JSON.stringify(selection);
    if (!this.baselines.has(key)) {
      this.baselines.set(key, { selection, value: structuredClone(response.result) });
    }
  }

  async restoreSettings(): Promise<void> {
    try {
      for (const { selection, value } of this.baselines.values()) {
        const current = await this.control('settings.get', selection);
        if (Boolean(current.error) || current.status !== 'succeeded') {
          throw new Error('Actual settings reset inspection failed');
        }

        if (JSON.stringify(current.result) === JSON.stringify(value)) {
          continue;
        }

        const accepted = await this.control('settings.set', { ...selection, value });
        if (Boolean(accepted.error) || accepted.status !== 'accepted' || !accepted.operationID) {
          throw new Error('Validated settings reset was not accepted');
        }

        const completed = await this.control('operation.wait', { operationID: accepted.operationID, timeoutMS: 10_000 });
        if (Boolean(completed.error) || completed.status !== 'succeeded' || completed.operationID !== accepted.operationID) {
          throw new Error('Validated settings reset did not complete');
        }

        const restored = await this.control('settings.get', selection);
        if (Boolean(restored.error) || restored.status !== 'succeeded' || JSON.stringify(restored.result) !== JSON.stringify(value)) {
          throw new Error('Actual provider did not persist the restored baseline');
        }
      }
    } catch (error) {
      this.poisoned = true; throw error; 
    }
  }
}
