import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Isolated worker: no network sources, JavaScript evaluation, attachments, or
// execution of embedded PDF actions. Parent enforces time and memory limits.
let task;
try {
  task = getDocument({ data: new Uint8Array(workerData), isEvalSupported: false,
    useSystemFonts: false, disableFontFace: true, stopAtErrors: true, verbosity: 0 });
  const pdf = await task.promise;
  if (pdf.numPages > 100) throw Error('document_limit');
  const pages = []; let count = 0;
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    const text = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
    count += text.length;
    if (count > 200000) throw Error('document_limit');
    pages.push({ page, text });
  }
  parentPort.postMessage({ pages });
} catch (error) {
  parentPort.postMessage({ error: error.message === 'document_limit' ? 'document_limit' : 'document_invalid' });
} finally { await task?.destroy(); }
