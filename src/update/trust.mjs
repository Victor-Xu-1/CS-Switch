import { verify } from 'node:crypto';
import { invariant } from '../core/errors.mjs';

// Public release-verification key from the user's installed official Operon
// 0.1.47 binary. Public material only; key rotation requires a bridge update.
export const releaseKey = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAvp7pfXhdcZAKXf1wZ3vM
Tm0aRHQKLv+em25/h3wsjzVqPUZO/I+BooNLpqL+uJ8+3yCEpS1FP27HgjLw0VQc
st4cjfr76qtmkUXmQWb2hdr+zrUt/MzsZVg+l3s//WwoimehlFmtg7FTBt4kvxT3
8MaOOmJeQpQQlQm/iAHtinDZLppc9LoerjsCAI1YsSSDFvNEa83tXXXOYXZunu7Q
v4OVvoHUbUl3WDkALdyoRJGMr9YGo4Y0FfbD5CxgsgBgU98zMS2uOJc1PyJLiUL4
vW9hWqj92vgLnqnRNX3XKOCb28q9Y+KvQDwfrrbHhl1UD3Fs8H/OLV4FbkNopcwx
4ccIHvA7d0qVvRX2ah4KyN+wibneUpV4Z3FFnJjGN8eE2DNcE/vo6cKAohNf3Njj
hYcte+V0ohbGOg3BKG+Ni9hC6+A3htjPomCy8mWyLD6/wnf7XL9NGAn3YmwC06+/
PRDhcF37d+VwnGlal2tPU2KP1JXoIUiqnEvJjmMhGYJIFr4qz7hQdaf7VwvE2A55
kKZCeTZ69aaK2wc5qseYxSlnZDQdKbh/2V0J75zzbWqQ4zCLc/ePno6ATGSR5NdY
xEExA8FJs0kIzHt/o2oP/NughSeNtqphqisjRcWaZPrkoupFnneFLbvC4FM7DG18
rK4rsjMhpClpG962m+WONJ8CAwEAAQ==
-----END PUBLIC KEY-----`;

export function verifyBinarySignature(id, filename, digest, signature, key = releaseKey) {
  invariant(/^[a-f0-9]{8}$/.test(id) && /^[a-f0-9]{64}$/.test(digest), 'signature_format', 'Invalid signed release identity.');
  const message = Buffer.concat([Buffer.from(`operon-binary-sig-v2\n${id}\n${filename}\n`, 'latin1'), Buffer.from(digest, 'hex')]);
  invariant(verify('RSA-SHA256', message, key, signature), 'release_signature', 'Official binary signature verification failed. No update will run.', 409);
}

export function verifyOrdering(id, ordering, signature, floor = 0, key = releaseKey) {
  invariant(ordering.sha8 === id && ordering.run_attempt === 1 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ordering.staged_at), 'ordering_format', 'Invalid release ordering statement.');
  const message = Buffer.from(`operon-release-ordering-v1\n${id}\n${ordering.staged_at}\n1\n`, 'latin1');
  invariant(verify('RSA-SHA256', message, key, signature), 'ordering_signature', 'Release ordering signature verification failed.', 409);
  const epoch = Date.parse(ordering.staged_at);
  invariant(Number.isFinite(epoch) && epoch >= floor, 'release_downgrade', 'Upstream release is below the accepted version floor.', 409);
  return epoch;
}
