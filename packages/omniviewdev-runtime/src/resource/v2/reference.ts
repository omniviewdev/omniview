// The canonical resource identity and access route are transport-independent.
export interface ScopeEntry { dimension: string; value: string }
export interface ResourceAddress {
  provider: string;
  authority: string;
  type: string;
  scope: readonly ScopeEntry[];
  id: string;
}
export interface AccessRoute { connection: string }
export interface ResourceReference { address: ResourceAddress; incarnation?: string }
