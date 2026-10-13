import { join } from 'node:path';
import { initialize } from '../src/core/config.mjs';
import { network } from '../src/core/network.mjs';
import { downloadOfficial } from '../src/update/download.mjs';
import { unpack } from '../src/runtime/extract.mjs';

const home = process.argv[2], release = process.argv[3];
if (!home || !release) throw new Error('Usage: prepare-upstream.mjs STATE_HOME SHA8');
const config = await initialize(home, { network: { proxy: process.env.HTTPS_PROXY || null } });
const net = network(config);
try {
  const downloaded = await downloadOfficial(config, release, net.fetch);
  console.log(JSON.stringify({ download: downloaded }));
  console.log(JSON.stringify({ extracted: await unpack(downloaded.binary, join(downloaded.directory, 'prepared')) }));
} finally { await net.close(); }
