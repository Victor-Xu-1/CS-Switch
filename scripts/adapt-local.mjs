import { adaptPrepared } from '../src/runtime/adapter.mjs';
if (!process.argv[2]) throw new Error('Usage: adapt-local.mjs PREPARED_RUNTIME');
console.log(JSON.stringify(await adaptPrepared(process.argv[2]), null, 2));
