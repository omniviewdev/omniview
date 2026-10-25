import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const filename = fileURLToPath(import.meta.url);

// Each scenario imports the genuine installed package in its own strict process.
// A late unhandled rejection must fail the process, not be hidden by a listener.
async function runScenario(name) {
  if (name === 'reused-call-id') {
    // Control only correlation entropy, not Call or promise implementation.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues(bytes) { bytes.fill(0); return bytes; } },
    });
  }
  const { Call, CancelError, CancellablePromise, objectNames, setTransport } = await import('@wailsio/runtime');
  const requests = [];
  const cancellations = [];
  let cancellationAck;
  setTransport({
    call(object, method, _windowName, args) {
      assert.equal(method, 0);
      if (object === objectNames.Call) {
        const response = Promise.withResolvers();
        requests.push({ id: args['call-id'], args, response });
        return response.promise;
      }
      assert.equal(object, objectNames.CancelCall);
      cancellations.push(args['call-id']);
      return cancellationAck?.promise ?? Promise.resolve(null);
    },
  });

  const open = (methodID) => {
    const promise = Call.ByID(methodID, 'owned argument');
    assert.ok(promise instanceof CancellablePromise);
    const request = requests.at(-1);
    assert.equal(request.args.methodID, methodID);
    assert.deepEqual(request.args.args, ['owned argument']);
    return { promise, request };
  };
  const cancellationFailure = () => new Call.RuntimeError(JSON.stringify({
    type: 'omniview:cancelled', code: 'CANCELLED', status: 499,
    title: 'Cancelled', detail: 'The operation was cancelled.',
  }));

  switch (name) {
    case 'success': {
      const { promise, request } = open(1);
      request.response.resolve({ value: 'native result' });
      assert.deepEqual(await promise, { value: 'native result' });
      await promise.cancel();
      assert.deepEqual(cancellations, []);
      break;
    }
    case 'ordinary-errors': {
      for (const error of [new Call.RuntimeError('FORBIDDEN'), new Error('network failure'), new TypeError('invalid argument')]) {
        const { promise, request } = open(2);
        const rejected = assert.rejects(promise, (actual) => actual === error);
        request.response.reject(error);
        await rejected;
        await promise.cancel();
      }
      assert.deepEqual(cancellations, []);
      break;
    }
    case 'late-cancelled-error': {
      cancellationAck = Promise.withResolvers();
      const { promise, request } = open(3);
      const rejected = assert.rejects(promise, (error) => error instanceof CancelError);
      const cancelled = promise.cancel();
      await rejected;
      await nextTurn();
      assert.deepEqual(cancellations, [request.id]);
      request.response.reject(cancellationFailure());
      await nextTurn();
      cancellationAck.resolve(null);
      await cancelled;
      break;
    }
    case 'late-cancelled-success': {
      const { promise, request } = open(4);
      const rejected = assert.rejects(promise, (error) => error instanceof CancelError);
      await promise.cancel();
      await rejected;
      request.response.resolve({ value: 'too late' });
      await nextTurn();
      assert.deepEqual(cancellations, [request.id]);
      break;
    }
    case 'independent-call-ids': {
      const first = open(5);
      const second = open(6);
      assert.notEqual(first.request.id, second.request.id);
      const rejected = assert.rejects(first.promise, (error) => error instanceof CancelError);
      await first.promise.cancel();
      await rejected;
      first.request.response.reject(cancellationFailure());
      second.request.response.resolve({ owner: 'second' });
      assert.deepEqual(await second.promise, { owner: 'second' });
      await nextTurn();
      assert.deepEqual(cancellations, [first.request.id]);
      break;
    }
    case 'reused-call-id': {
      for (const outcome of ['success', 'error']) {
        const first = open(8);
        const rejected = assert.rejects(first.promise, (error) => error instanceof CancelError);
        await first.promise.cancel();
        await rejected;
        const second = open(9);
        assert.equal(second.request.id, first.request.id, 'the completed cancellation releases its correlation ID');
        let secondSettled = false;
        const observed = second.promise.then(() => { secondSettled = true; }, () => { secondSettled = true; });
        if (outcome === 'success') first.request.response.resolve({ owner: 'first' });
        else first.request.response.reject(cancellationFailure());
        await nextTurn();
        assert.equal(secondSettled, false, 'an old response cannot settle a new owner of the same ID');
        second.request.response.resolve({ owner: 'second' });
        assert.deepEqual(await second.promise, { owner: 'second' });
        await observed;
      }
      break;
    }
    case 'void-completion': {
      const { promise, request } = open(7);
      request.response.resolve(undefined);
      assert.equal(await promise, undefined, 'a void method result must complete, not remain pending');
      await promise.cancel();
      assert.deepEqual(cancellations, []);
      break;
    }
    case 'generic-late-error-policy': {
      let rejectWork;
      const promise = new CancellablePromise((_resolve, reject) => { rejectWork = reject; });
      const rejected = assert.rejects(promise, (error) => error instanceof CancelError);
      await promise.cancel();
      await rejected;
      rejectWork(new Error('unrelated generic late failure'));
      await nextTurn();
      break;
    }
    default:
      throw new Error(`Unknown Call regression scenario: ${name}`);
  }
  await nextTurn();
  setTransport(null);
}

if (process.argv[2] === '--call-case') {
  await runScenario(process.argv[3]);
} else {
  for (const name of [
    'success', 'ordinary-errors', 'late-cancelled-error', 'late-cancelled-success',
    'independent-call-ids', 'reused-call-id', 'void-completion',
  ]) {
    test(`real Wails Call preserves ${name}`, () => {
      const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', filename, '--call-case', name], {
        encoding: 'utf8', timeout: 10_000, env: process.env,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${name}\n${result.stdout}\n${result.stderr}`);
    });
  }
  test('real generic CancellablePromise still reports unrelated late rejection', () => {
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', filename, '--call-case', 'generic-late-error-policy'], {
      encoding: 'utf8', timeout: 10_000, env: process.env,
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CancelledRejectionError/);
    assert.match(result.stderr, /unrelated generic late failure/);
  });
}
