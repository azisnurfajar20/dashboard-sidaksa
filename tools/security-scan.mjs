import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist/client');
const extensions = new Set(['.js', '.css', '.html', '.json', '.map', '.svg', '.txt']);
const files = [];
const findings = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      findings.push({ file: path.relative(root, file), kind: 'symbolic-link' });
    } else if (entry.isDirectory()) {
      await walk(file);
    } else if (entry.isFile() && extensions.has(path.extname(file))) {
      files.push(file);
    }
  }
}
try {
  await walk(root);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const relative = path.relative(root, file);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      findings.push({ file: relative, kind: 'private-key-material' });
    }
    if (/\bsb_secret_[A-Za-z0-9_-]{8,}/.test(content)) {
      findings.push({ file: relative, kind: 'supabase-secret-key' });
    }
    for (const match of content.matchAll(/\b[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\b/g)) {
      try {
        const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        if (claims.role === 'service_role') {
          findings.push({ file: relative, kind: 'privileged-service-jwt' });
          break;
        }
      } catch {
        // Candidate token is not a decodable JWT; no authentication is done here.
      }
    }
  }
  console.log(JSON.stringify({ scannedFiles: files.length, findingCount: findings.length, findings }, null, 2));
  process.exitCode = findings.length ? 1 : 0;
} catch {
  console.error(JSON.stringify({ error: 'Bundle tidak dapat dibaca; jalankan build dan periksa direktori target.' }));
  process.exitCode = 2;
}
