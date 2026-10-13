import { unpack } from '../src/runtime/extract.mjs';
const [binary, directory] = process.argv.slice(2);
if (!binary || !directory) throw new Error('Usage: unpack-local.mjs VERIFIED_BINARY NEW_DESTINATION');
console.log(JSON.stringify(await unpack(binary, directory)));
