export function validateProvenanceDocument(
  data: Buffer,
  artifactSha256: string,
  expectedPredicateType?: string
): void {
  let documents: unknown[];
  const source = data.toString('utf8');
  try {
    documents = [JSON.parse(source) as unknown];
  } catch {
    try {
      documents = source
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as unknown);
    } catch (error) {
      throw new Error('Managed runtime provenance is not valid JSON or JSONL', { cause: error });
    }
  }

  const digest = artifactSha256.toLowerCase();
  let digestBound = false;
  let predicateMatched = expectedPredicateType === undefined;
  const pending = [...documents];
  let visited = 0;
  while (pending.length > 0) {
    if ((visited += 1) > 100_000) {
      throw new Error('Managed runtime provenance document is too complex');
    }
    const value = pending.pop();
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized === digest || normalized === `sha256:${digest}`) digestBound = true;
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.predicateType === expectedPredicateType) predicateMatched = true;
    for (const entry of Object.values(record)) pending.push(entry);

    // An in-toto DSSE envelope stores its statement as a base64 payload.
    if (typeof record.payload === 'string' && typeof record.payloadType === 'string') {
      try {
        pending.push(JSON.parse(Buffer.from(record.payload, 'base64').toString('utf8')) as unknown);
      } catch {
        throw new Error('Managed runtime provenance DSSE payload is invalid');
      }
    }
  }
  if (!digestBound) {
    throw new Error('Managed runtime provenance does not bind the downloaded artifact SHA-256');
  }
  if (!predicateMatched) {
    throw new Error(
      `Managed runtime provenance predicateType does not match ${expectedPredicateType}`
    );
  }
}
