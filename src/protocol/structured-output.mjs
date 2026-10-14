import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { invariant, BridgeError } from '../core/errors.mjs';

export function structuredOutput(input, profile) {
  invariant(!(input.output_format && input.output_config?.format), 'invalid_schema', 'Specify one structured output format.');
  const format = input.output_config?.format || input.output_format;
  if (!format) return null;
  invariant(format.type === 'json_schema' && format.schema && typeof format.schema === 'object', 'invalid_schema', 'A JSON Schema output format is required.');
  const serialized = JSON.stringify(format.schema);
  invariant(serialized.length <= 65536, 'invalid_schema', 'Output schema exceeds its size limit.');
  // No remote schema loading, coercion, defaults, or removal of model output.
  let validate;
  try {
    const Constructor = format.schema.$schema?.includes('2020-12') ? Ajv2020 : Ajv;
    validate = addFormats(new Constructor({ strict: true, strictRequired: false, allErrors: false, addUsedSchema: false })).compile(format.schema);
  } catch { throw new BridgeError('invalid_schema', 'Unsupported or invalid JSON Schema. External references are not loaded.'); }
  const wrap = profile.provider === 'deepseek' && format.schema.type !== 'object';
  const instructionSchema = wrap ? JSON.stringify({ type: 'object', properties: { result: format.schema }, required: ['result'], additionalProperties: false }) : serialized;
  return {
    // Generic compatible endpoints may reject provider-specific JSON Schema
    // wire flags. Their JSON is still required and validated before delivery.
    responseFormat: profile.provider === 'deepseek' ? { type: 'json_object' } : undefined,
    instruction: `Return only valid JSON matching this JSON Schema. Do not add Markdown fences or commentary.\n${instructionSchema}`,
    validate(message) {
      if (message.stop_reason === 'tool_use') return;
      invariant(message.stop_reason === 'end_turn', 'structured_output_invalid', 'Structured output was incomplete or refused.', 502);
      let value;
      try { value = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')); }
      catch { throw new BridgeError('structured_output_invalid', 'Provider did not return valid JSON.', 502); }
      if (wrap) {
        invariant(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'result' in value, 'structured_output_invalid', 'Provider omitted the JSON output envelope.', 502);
        value = value.result;
      }
      invariant(validate(value), 'structured_output_invalid', 'Provider JSON failed the requested schema. No successful structured result was returned.', 502);
      if (wrap) message.content = [{ type: 'text', text: JSON.stringify(value) }];
    },
  };
}
