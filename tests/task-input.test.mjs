import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDocuments } from '../src/protocol/documents.mjs';
import { structuredOutput } from '../src/protocol/structured-output.mjs';
import { pdfText } from '../src/protocol/documents.mjs';
import { textPdf } from './helpers/pdf.mjs';

test('document and tool-result text is preserved with source identity without mutating input', async () => {
  const input = { messages: [{ role: 'user', content: [{ type: 'document', title: 'Measurement', source: { type: 'text', media_type: 'text/plain', data: 'Observed value: 37' } }] }] };
  const before = JSON.stringify(input);
  const result = await prepareDocuments(input);
  assert.match(result.messages[0].content[0].text, /Measurement/);
  assert.match(result.messages[0].content[0].text, /Observed value: 37/);
  assert.equal(JSON.stringify(input), before);
});

test('DeepSeek JSON mode is paired with independent schema validation', () => {
  const schema = { type: 'object', properties: { mean: { type: 'number' } }, required: ['mean'], additionalProperties: false };
  const format = structuredOutput({ output_config: { format: { type: 'json_schema', schema } } }, { provider: 'deepseek' });
  assert.deepEqual(format.responseFormat, { type: 'json_object' });
  assert.match(format.instruction, /JSON/);
  const message = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
  assert.doesNotThrow(() => format.validate(message('{"mean":4}')));
  assert.throws(() => format.validate(message('{"mean":"4"}')), { code: 'structured_output_invalid' });
  assert.throws(() => format.validate(message('not json')), { code: 'structured_output_invalid' });
  assert.throws(() => format.validate({ ...message('{"mean":4}'), stop_reason: 'max_tokens' }), { code: 'structured_output_invalid' });
});

test('real PDF parser extracts page text; malformed, blank and cancelled PDFs fail explicitly', async () => {
  assert.match(await pdfText(textPdf()), /\[Page 1\][\s\S]*Measured value 37/);
  await assert.rejects(pdfText(Buffer.from('not a PDF')), { code: 'document_invalid' });
  await assert.rejects(pdfText(textPdf('')), { code: 'document_ocr_required' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pdfText(textPdf(), controller.signal), { name: 'AbortError' });
});

test('structured validation preserves array output and validates declared formats', () => {
  const format = structuredOutput({ output_format: { type: 'json_schema', schema: { type: 'array', items: { type: 'integer' } } } }, { provider: 'deepseek' });
  const message = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"result":[2,4]}' }] };
  format.validate(message); assert.equal(message.content[0].text, '[2,4]');
  const dated = structuredOutput({ output_format: { type: 'json_schema', schema: { type: 'object', properties: { date: { type: 'string', format: 'date' } } } } }, { provider: 'deepseek' });
  assert.throws(() => dated.validate({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"date":"yesterday"}' }] }), { code: 'structured_output_invalid' });
});
