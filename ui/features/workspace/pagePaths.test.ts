import { describe, expect, it } from 'vitest';
import { connectionKeyOfPath, derivePageTitle, parsePagePath, type PageTitleLookup } from './pagePaths';

const lookup: PageTitleLookup = {
  pluginName: (pluginId) => pluginId === 'kubernetes' ? 'Kubernetes' : undefined,
  connectionName: (pluginId, connectionId) =>
    pluginId === 'kubernetes' && connectionId === 'arn:aws:eks/prod' ? 'Production' : undefined,
};

const nothingLoaded: PageTitleLookup = { pluginName: () => undefined, connectionName: () => undefined };

describe('derivePageTitle', () => {
  it.each([
    ['/', 'Home'],
    ['/plugins', 'Plugins'],
    ['/plugins/kubernetes', 'Plugins'],
    ['/settings?category=developer', 'Settings'],
  ])('names the core page %s', (path, title) => {
    expect(derivePageTitle(path, nothingLoaded)).toBe(title);
  });

  it('names a plugin page after the plugin', () => {
    expect(derivePageTitle('/_plugin/kubernetes', lookup)).toBe('Kubernetes');
    expect(derivePageTitle('/_plugin/kubernetes/settings?tab=general', lookup)).toBe('Kubernetes');
  });

  it('names a connection page after the connection, decoding its id', () => {
    const encoded = encodeURIComponent('arn:aws:eks/prod');
    expect(derivePageTitle(`/_plugin/kubernetes/cluster/${encoded}/resources`, lookup)).toBe('Production');
    expect(derivePageTitle(`/_plugin/kubernetes/connection/${encoded}`, lookup)).toBe('Production');
  });

  it('falls back to the plugin name while the connection name is unknown', () => {
    expect(derivePageTitle('/_plugin/kubernetes/cluster/staging/resources', lookup)).toBe('Kubernetes');
  });

  it('returns null when the names it needs are not loaded', () => {
    expect(derivePageTitle('/_plugin/kubernetes/cluster/staging', nothingLoaded)).toBeNull();
    expect(derivePageTitle('/_plugin/unknown', lookup)).toBeNull();
    expect(derivePageTitle('/something-else', lookup)).toBeNull();
  });
});

describe('parsePagePath', () => {
  it('needs a connection id after the connection segment', () => {
    expect(parsePagePath('/_plugin/kubernetes/cluster')).toEqual({ kind: 'plugin', pluginId: 'kubernetes' });
  });
});

describe('connectionKeyOfPath', () => {
  it('is shared by every page of one connection and absent elsewhere', () => {
    expect(connectionKeyOfPath('/_plugin/kubernetes/cluster/a/resources'))
      .toBe(connectionKeyOfPath('/_plugin/kubernetes/cluster/a/edit?x=1'));
    expect(connectionKeyOfPath('/_plugin/kubernetes/cluster/a')).not.toBe(connectionKeyOfPath('/_plugin/kubernetes/cluster/b'));
    expect(connectionKeyOfPath('/_plugin/kubernetes')).toBeNull();
  });
});
