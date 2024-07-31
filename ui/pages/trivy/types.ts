/* eslint @typescript-eslint/naming-convention: 0 */

export type TrivyResult = {
  SchemaVersion: number;
  CreatedAt: string;
  ArtifactName: string;
  ArtifactType: string;
  Metadata: TrivyMetadata;
  Results: TrivyResultEntry[];
};

export type TrivyMetadata = {
  OS: {
    Family: string;
    Name: string;
  };
  ImageID: string;
  DiffIDs: string[];
  RepoTags: string[];
  RepoDigests: string[];
  ImageConfig: TrivyImageConfig;
};

export type TrivyImageConfig = {
  architecture: string;
  created: string;
  history: TrivyHistory[];
  os: string;
  rootfs: TrivyRootfs;
  config: TrivyConfig;
};

export type TrivyHistory = {
  created: string;
  created_by: string;
  comment?: string;
  empty_layer?: boolean;
};

export type TrivyRootfs = {
  type: string;
  diff_ids: string[];
};

export type TrivyConfig = {
  Cmd: string[];
  Entrypoint: string[];
  Env: string[];
  User: string;
  WorkingDir: string;
  ExposedPorts: Record<string, Record<string, unknown>>;
  StopSignal: string;
};

export type TrivyResultEntry = {
  Target: string;
  Class: string;
  Type: string;
  Licenses?: TrivyLicense[];
  Vulnerabilities?: TrivyVulnerability[];
};

export type TrivyLicense = {
  Severity: string;
  Category: string;
  PkgName: string;
  FilePath: string;
  Name: string;
  Confidence: number;
  Link: string;
};

export type TrivyVulnerability = {
  VulnerabilityID: string;
  PkgID: string;
  PkgName: string;
  PkgIdentifier: TrivyPackageIdentifier;
  InstalledVersion: string;
  FixedVersion: string;
  Status: string;
  Layer: TrivyLayerInfo;
  SeveritySource: string;
  PrimaryURL: string;
  DataSource: TrivyDataSource;
  Title: string;
  Description: string;
  Severity: string;
  CweIDs: string[];
  VendorSeverity: Record<string, number>;
  CVSS: TrivyCVSSInfo;
  References: string[];
  PublishedDate: string;
  LastModifiedDate: string;
};

export type TrivyPackageIdentifier = {
  PURL: string;
};

export type TrivyLayerInfo = {
  Digest: string;
  DiffID: string;
};

export type TrivyDataSource = {
  ID: string;
  Name: string;
  URL: string;
};

export type TrivyCVSSInfo = {
  nvd: TrivyCVSSScores;
  redhat?: TrivyCVSSScores;
};

export type TrivyCVSSScores = {
  V2Vector?: string;
  V3Vector: string;
  V2Score?: number;
  V3Score: number;
};
