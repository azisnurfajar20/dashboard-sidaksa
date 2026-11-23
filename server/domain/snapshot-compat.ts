import { createHash } from 'node:crypto';
import type { RawWorkbook, Snapshot } from '../../shared/contracts.js';
import { NORMALIZATION_REVISION, normalizeWorkbook, type NormalizeOptions } from './normalize.js';

// This replay is intentionally pinned. A future semantic change needs its own reviewed migration.
const LEGACY_COMPAT_TARGET = 'be001-verified-attributes-v1';
export function compatibleSnapshot(raw: RawWorkbook, cached: Snapshot, options: NormalizeOptions): Snapshot {
  const canonical = normalizeWorkbook(raw, options);
  const exact = (value: unknown) => JSON.stringify(value) === JSON.stringify(cached);
  if (exact(canonical)) return canonical;
  if (NORMALIZATION_REVISION !== LEGACY_COMPAT_TARGET || Object.hasOwn(cached, 'normalizationRevision')) throw new Error('Integritas snapshot tidak valid');

  // Only the two fully reproducible, revisionless BE001-era representations are recognized.
  const legacy: Partial<Snapshot> = structuredClone(canonical);
  delete legacy.normalizationRevision;
  const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  const oldId = 's_' + createHash('sha256').update(hash + JSON.stringify(options)).digest('hex').slice(0, 24);
  legacy.id = oldId;
  const rebase = (id: string) => id.startsWith(canonical.id + ':') ? oldId + id.slice(canonical.id.length) : id;
  for (const a of legacy.applications!) a.id = rebase(a.id);
  for (const d of legacy.departures!) d.id = rebase(d.id);
  for (const issue of legacy.issues!) {
    issue.id = rebase(issue.id);
    if (['application', 'departure', 'reference', 'rejected-row'].includes(issue.entityType)) issue.entityId = rebase(issue.entityId);
  }
  if (exact(legacy)) return canonical; // Revisionless BE001 output with already-correct attributes.
  for (const a of legacy.applications!) {
    const candidates = canonical.candidates.filter(c => c.id === a.candidateId);
    a.candidateGraduationYear = candidates.length === 1 ? candidates[0]!.graduationYear : null;
    a.candidateCategory = candidates.length === 1 ? candidates[0]!.category : null;
  }
  if (exact(legacy)) return canonical; // Exact pre-BE001 unique-ID borrowing, not a field allowlist.
  throw new Error('Integritas snapshot tidak valid');
}