let count = 0;
const initialName = process.env.AWS_LAMBDA_FUNCTION_NAME;
exports.lambda = (event, context) => {
    count++;
    if (event.action === 'descendantHang' || event.action === 'descendantReturn') {
        const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' });
        if (event.action === 'descendantHang') while (true) {}
        return { childPid: child.pid };
    }
    if (event.action === 'signalHang') { require('node:fs').writeFileSync(event.pidFile, String(process.pid)); while (true) {} }
    if (event.action === 'throw') throw new Error('fixture failure');
    if (event.action === 'primitive') throw 'fixture primitive';
    if (event.action === 'hang') while (true) {}
    if (event.action === 'exit') process.exit(7);
    if (event.action === 'uncaught') return new Promise(() => setImmediate(() => { throw new Error('uncaught fixture'); }));
    if (event.action === 'deferredLog') { setTimeout(() => console.log('background-from-request-A'), 40); return count; }
    if (event.action === 'unicode') { process.stdout.write('한글'.repeat(200)); return true; }
    if (event.action === 'reject') { Promise.reject(new Error('unhandled fixture')); return 'must not succeed'; }
    if (event.action === 'logs') { process.stdout.write('O'.repeat(20000)); process.stderr.write('E'.repeat(20000)); return count; }
    if (event.action === 'bigint') return 10n;
    if (event.action === 'wait') return new Promise(resolve => setTimeout(() => resolve({ before: event.before, remaining: context.getRemainingTimeInMillis() }), event.ms));
    if (event.action === 'env') return { env: process.env, initialName };
    if (event.action === 'context') return { ...context, remaining: context.getRemainingTimeInMillis() };
    return { count, event, pid: process.pid };
};
