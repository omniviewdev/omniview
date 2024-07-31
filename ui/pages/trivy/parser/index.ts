/* eslint @typescript-eslint/naming-convention: 0 */

import {
  type TrivyResult,
  type TrivyMetadata,
  type TrivyResultEntry,
  type TrivyVulnerability,
  type TrivyLicense,
} from '../types';

export class TrivyReport {
  protected report: TrivyResult;

  constructor(jsonData: string | Record<string, unknown>) {
    if (typeof jsonData === 'object') {
      this.report = jsonData as TrivyResult;
    } else {
      this.report = this.parseJSON(jsonData)!;
    }
  }

  public getSchemaVersion(): number {
    return this.report.SchemaVersion;
  }

  public getArtifactName(): string {
    return this.report.ArtifactName;
  }

  public getArtifactType(): string {
    return this.report.ArtifactType;
  }

  public getCreatedAt(): string {
    return this.report.CreatedAt;
  }

  public getMetadata(): TrivyMetadata {
    return this.report.Metadata;
  }

  public getResults(): TrivyResultEntry[] {
    return this.report.Results;
  }

  // ================================== | LICENSES | ================================== //

  public getAllLicenses(): TrivyLicense[] {
    return this.getResults().flatMap(result => result.Licenses ?? []);
  }

  public getLicensesByType(type: string): TrivyLicense[] {
    return this.getAllLicenses().filter(license => license.Name === type);
  }

  // ================================== | VULNERABILITIES | ================================== //

  public getAllVulnerabilities(): TrivyVulnerability[] {
    return this.getResults().flatMap(result => result.Vulnerabilities ?? []);
  }

  public getVulnerabilitiesBySeverity(severity: string): TrivyVulnerability[] {
    return this.getAllVulnerabilities().filter(v => v.Severity === severity);
  }

  public getVulnerabilityBreakdown(): Record<string, { percentage: number; count: number }> {
    const vulnerabilities = this.getAllVulnerabilities();
    const total = vulnerabilities.length;
    return vulnerabilities.reduce<Record<string, { percentage: number; count: number }>>((acc, vulnerability) => {
      const { Severity } = vulnerability;
      if (!acc[Severity]) {
        acc[Severity] = { percentage: 0, count: 0 };
      }

      acc[Severity].count += 1;
      acc[Severity].percentage = Math.round((acc[Severity].count / total) * 100);
      return acc;
    }, {});
  }

  public groupVulnerabilitiesBySeverity(): Record<string, TrivyVulnerability[]> {
    const vulnerabilities = this.getAllVulnerabilities();
    return vulnerabilities.reduce<Record<string, TrivyVulnerability[]>>((acc, vulnerability) => {
      const { Severity } = vulnerability;
      if (!acc[Severity]) {
        acc[Severity] = [];
      }

      acc[Severity].push(vulnerability);
      return acc;
    }, {});
  }

  private parseJSON(jsonData: string): TrivyResult | undefined {
    try {
      const data: TrivyResult = JSON.parse(jsonData);
      this.validateData(data);
      if (!data) {
        throw new Error('No vulnerabilities found in Trivy report');
      }

      return data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Error parsing JSON data: ${error.message}`);
      }
    }
  }

  private validateData(data: TrivyResult): void {
    if (!data.SchemaVersion || !data.Results) {
      throw new Error('Invalid Trivy report data');
    }
  }

}
