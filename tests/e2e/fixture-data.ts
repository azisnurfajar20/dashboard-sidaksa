import path from 'node:path';
export const SNAPSHOT_CONTROL_FILE = path.resolve('.private/test-tmp/e2e-snapshot-control.json');
import { syntheticWorkbook } from '../domain/fixture';
import type { Role } from '../../shared/contracts';

// Fictitious identities used ONLY by the isolated browser-test server.
export const FIXTURE_URL = 'http://127.0.0.1:4181';
export const PUBLIC_URL = 'http://127.0.0.1:4180';
export const AUTH_URL = 'https://sidaksa-e2e.supabase.co';
export const ROLES: Role[] = ['admin', 'recruiter', 'leader'];
export const USERS = Object.fromEntries(ROLES.map((role, index) => [role, {
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  email: `${role}@sidaksa.invalid`, role,
}])) as Record<Role, { id: string; email: string; role: Role }>;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const TOKENS = Object.fromEntries(ROLES.map(role => [role,
  `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: USERS[role].id, aud: 'authenticated', role: 'authenticated', iss: `${AUTH_URL}/auth/v1`, exp: Math.floor(Date.UTC(2100, 0, 1) / 1000) })}.TEST_ONLY_INVALID_SIGNATURE`,
])) as Record<Role, string>;

export function browserWorkbook() {
  const raw = syntheticWorkbook();
  raw.fetchedAt = new Date().toISOString();
  const candidates = raw.sheets.find(sheet => sheet.name === 'Data Kandidat')!;
  const candidate = structuredClone(candidates.rows[1]!);
  candidate.rowNumber = 3;
  candidate.cells[0]!.value = 'DK_002';
  candidate.cells[1]!.value = 'Peserta Uji Dua';
  candidate.cells[3]!.value = 2025;
  candidate.cells[6]!.value = 'TEST_PRIVATE_CONTACT_TWO';
  candidates.rows.push(candidate);
  const applications = raw.sheets.find(sheet => sheet.name === 'Proses Rekrutment')!;
  const daily = structuredClone(applications.rows[1]!);
  daily.rowNumber = 3;
  daily.cells[0]!.value = '15 Januari 2025';
  daily.cells[13]!.value = '';
  daily.cells[14]!.value = 'In Progress';
  applications.rows.push(daily);
  const unknown = structuredClone(applications.rows[1]!);
  unknown.rowNumber = 4;
  unknown.cells[0]!.value = 'Februari 2025';
  unknown.cells[1]!.value = 'UNKNOWN_LITERAL_ID';
  unknown.cells[2]!.value = 'Peserta Uji Belum Terverifikasi';
  unknown.cells[4]!.value = 'Test Agent Alias';
  unknown.cells[13]!.value = '';
  unknown.cells[14]!.value = '';
  applications.rows.push(unknown);
  return raw;
}
