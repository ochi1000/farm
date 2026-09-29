import assert from 'node:assert/strict';
import recover from '../desktop/recovery.cjs';
const record = { serial: 'fixture-usb', wirelessTarget: '192.0.2.1:5555' };
const result = stdout => ({ ok: true, stdout, stderr: '' });
let calls = [];
const deps = {
  connect: async () => { throw new Error('offline'); },
  exec: async (_command, args) => {
    calls.push(args);
    if (args[0] === 'devices') return result('List of devices attached\nfixture-usb\tdevice\n');
    if (args.includes('ro.serialno')) return result('fixture-usb\n');
    return result('');
  }
};
assert.equal((await recover(record, deps)).ok, true);
assert.ok(calls.some(args => args.includes('com.ocorp.xrunner/.MainActivity')));
assert.ok(calls.some(args => args.includes('tcpip') && args.includes('5555')));
assert.ok(!calls.some(args => args.includes('force-stop')));
calls = [];
assert.equal((await recover(record, { ...deps, connect: async () => {} })).ok, true);
assert.equal(calls.length, 0);
calls = [];
const wrong = await recover(record, { ...deps, exec: async (command, args) => args.includes('ro.serialno') ? result('other-device') : deps.exec(command, args) });
assert.equal(wrong.ok, false);
assert.ok(!calls.some(args => args.includes('com.ocorp.xrunner/.MainActivity')));
console.log('PASS: remote reconnect, authorized ADB recovery, no force-stop, wrong-device rejection');
