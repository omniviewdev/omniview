#!/usr/bin/env python3
"""Real local Kubernetes inventory and bounded watch traffic. Python standard library only."""
import argparse
import base64
import json
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
NAME = 'omniview-load-lab'
STATE = ROOT / '.state'
KUBE = STATE / 'kubeconfig'
LABEL = {'app.kubernetes.io/part-of': NAME}
PRESETS = {'smoke': (2, 2), 'baseline': (10, 30), 'large': (20, 50), 'xl': (40, 50)}


def run(args, data=None, capture=False):
    return subprocess.run(args, input=None if data is None else json.dumps(data),
                          text=True, check=True, capture_output=capture).stdout


def kubectl(*args, data=None, capture=False):
    return run(['kubectl', '--kubeconfig', str(KUBE), '--context', 'kind-' + NAME,
                '--request-timeout=60s', *args], data, capture)


def obj(kind, name, namespace=None, **fields):
    metadata = {'name': name, 'labels': LABEL.copy()}
    if namespace:
        metadata['namespace'] = namespace
    return {'apiVersion': 'apps/v1' if kind == 'Deployment' else 'v1',
            'kind': kind, 'metadata': metadata, **fields}


def inventory(preset):
    namespaces, per_namespace = PRESETS[preset]
    for n in range(namespaces):
        ns = f'load-{n:03}'
        yield obj('Namespace', ns)
        for i in range(per_namespace):
            name = f'app-{i:03}'
            selector = {'app': name}
            yield obj('ConfigMap', name, ns, data={'payload': 'x' * 2048})
            yield obj('Secret', name, ns, type='Opaque',
                      data={'synthetic': base64.b64encode(b'x' * 1024).decode()})
            yield obj('Service', name, ns, spec={'selector': selector,
                      'ports': [{'port': 80, 'targetPort': 8080}]})
            for event_index in range(3):
                yield obj('Event', f'{name}-seed-{event_index}', ns,
                          involvedObject={'apiVersion': 'v1', 'kind': 'ConfigMap', 'namespace': ns, 'name': name},
                          reason='SyntheticSeed', message='Synthetic inventory event',
                          type='Normal', source={'component': NAME}, count=1,
                          lastTimestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
            yield obj('Deployment', name, ns, spec={
                'replicas': 1, 'revisionHistoryLimit': 1,
                'selector': {'matchLabels': selector},
                'template': {'metadata': {'labels': {**LABEL, **selector}}, 'spec': {
                    'terminationGracePeriodSeconds': 2,
                    'containers': [{'name': 'http', 'image': 'busybox:1.37.0',
                        'command': ['sh', '-c', 'mkdir -p /tmp/www; echo load-lab > /tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'],
                        'ports': [{'containerPort': 8080}],
                        'resources': {'requests': {'cpu': '1m', 'memory': '4Mi'},
                                      'limits': {'cpu': '50m', 'memory': '16Mi'}},
                        'readinessProbe': {'tcpSocket': {'port': 8080}, 'periodSeconds': 30}}]}}})


def apply(items):
    kubectl('apply', '-f', '-', data={'apiVersion': 'v1', 'kind': 'List', 'items': items})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'seed', 'churn', 'status', 'render', 'delete'])
    parser.add_argument('--preset', choices=PRESETS, default='baseline')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--interval', type=float, default=1.0, help='seconds per churn cycle; three writes per cycle')
    parser.add_argument('--duration', type=float, default=300, help='churn duration in seconds')
    parser.add_argument('--rollout-every', type=int, default=0, help='roll one deployment every N cycles; 0 disables')
    parser.add_argument('--confirm-delete', action='store_true')
    args = parser.parse_args()
    if args.workers < 1 or args.interval < 0.1 or args.duration <= 0:
        parser.error('workers >= 1, interval >= 0.1, duration > 0 required')
    if args.command == 'render':
        print(json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': list(inventory(args.preset))}))
    elif args.command == 'create':
        STATE.mkdir(mode=0o700, exist_ok=True)
        config = {'kind': 'Cluster', 'apiVersion': 'kind.x-k8s.io/v1alpha4',
                  'networking': {'apiServerAddress': '127.0.0.1'},
                  'kubeadmConfigPatches': ['kind: ClusterConfiguration\napiServer:\n  extraArgs:\n    event-ttl: 1h\n'],
                  'nodes': [{'role': 'control-plane'}] + [{'role': 'worker'} for _ in range(args.workers)]}
        config_path = STATE / 'kind.json'
        config_path.write_text(json.dumps(config))
        run(['kind', 'create', 'cluster', '--name', NAME, '--image', 'kindest/node:v1.35.0',
             '--config', str(config_path), '--kubeconfig', str(KUBE), '--wait', '180s'])
    elif args.command == 'seed':
        # Bound request size and let namespaces exist before their children.
        batch = []
        for item in inventory(args.preset):
            batch.append(item)
            if len(batch) >= 81:
                apply(batch)
                batch = []
        if batch:
            apply(batch)
        for n in range(PRESETS[args.preset][0]):
            kubectl('wait', 'deployment', '--all', '-n', f'load-{n:03}',
                    '--for=condition=Available', '--timeout=300s')
    elif args.command == 'churn':
        # Discover actual seeded objects, not assumed preset counts.
        maps = json.loads(kubectl('get', 'configmaps', '-A', '-l',
                                 'app.kubernetes.io/part-of=' + NAME, '-o', 'json', capture=True))['items']
        if not maps:
            parser.error('seed cluster before starting churn')
        end = time.monotonic() + args.duration
        sequence = 0
        rollouts = 0
        while time.monotonic() < end:
            start = time.monotonic()
            target = maps[sequence % len(maps)]['metadata']
            ns, name = target['namespace'], target['name']
            patch = {'data': {'generation': str(sequence)}}
            kubectl('patch', 'configmap', name, '-n', ns, '--type=merge', '-p', json.dumps(patch), capture=True)
            kubectl('patch', 'secret', name, '-n', ns, '--type=merge', '-p',
                    json.dumps({'stringData': {'generation': str(sequence)}}), capture=True)
            if args.rollout_every > 0 and sequence % args.rollout_every == 0:
                kubectl('patch', 'deployment', name, '-n', ns, '--type=merge', '-p',
                        json.dumps({'spec': {'template': {'metadata': {'annotations': {
                            'load-lab/generation': str(time.time_ns())}}}}}), capture=True)
                rollouts += 1
            # A fixed 100-name ring per namespace bounds inventory even during long runs.
            event = obj('Event', f'activity-{sequence % 100:03}', ns,
                        involvedObject={'apiVersion': 'v1', 'kind': 'ConfigMap', 'namespace': ns, 'name': name},
                        reason='SyntheticActivity', message=f'Synthetic update {sequence}',
                        type='Normal', source={'component': NAME}, count=sequence + 1,
                        lastTimestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
            apply([event])
            sequence += 1
            time.sleep(max(0, args.interval - (time.monotonic() - start)))
        print(json.dumps({'cycles': sequence, 'writes': sequence * 3 + rollouts, 'rollouts': rollouts}))
    elif args.command == 'status':
        kubectl('get', 'nodes', '-o', 'wide')
        for resource in ['pods', 'deployments', 'services', 'secrets', 'configmaps', 'events']:
            items = json.loads(kubectl('get', resource, '-A', '-l',
                               'app.kubernetes.io/part-of=' + NAME, '-o', 'json', capture=True))['items']
            print(f'{resource}: {len(items)}')
            if resource == 'pods':
                print('ready pods:', sum(any(c['type'] == 'Ready' and c['status'] == 'True'
                      for c in p.get('status', {}).get('conditions', [])) for p in items))
    elif args.command == 'delete':
        if not args.confirm_delete:
            parser.error('delete requires --confirm-delete; removes only ' + NAME)
        run(['kind', 'delete', 'cluster', '--name', NAME, '--kubeconfig', str(KUBE)])


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
