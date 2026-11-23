import { createPrivateKey } from 'node:crypto';
import { open } from 'node:fs/promises';
import { GoogleAuth, JWT } from 'google-auth-library';
import { z } from 'zod';
import type { Config } from './config.js';

export const READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const serviceAccount = z.object({
  type: z.literal('service_account'),
  client_email: z.string().email().max(254),
  private_key: z.string().min(1).max(16384),
});

async function readServiceAccount(file: string) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_CREDENTIAL_BYTES) throw new Error('Invalid service-account file.');
    // Bound the actual read as well as stat: a concurrently enlarged file must not defeat the size limit.
    const buffer = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_CREDENTIAL_BYTES) throw new Error('Invalid service-account file.');
    const parsed = serviceAccount.safeParse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
    if (!parsed.success) throw new Error('Invalid service-account configuration.');
    const key = createPrivateKey(parsed.data.private_key);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('Invalid service-account key.');
    return parsed.data;
  } finally {
    await handle.close();
  }
}

export async function createGoogleAuth(config: Pick<Config, 'credentialFile' | 'useAdc'>): Promise<GoogleAuth> {
  if (config.credentialFile) {
    const account = await readServiceAccount(config.credentialFile);
    // Choose the credential type explicitly. Never pass generic keyFile/credentials options,
    // or copy token_uri, credential_source, universe_domain or other provider selectors from JSON.
    const authClient = new JWT({ email: account.client_email, key: account.private_key, scopes: [READ_ONLY_SCOPE] });
    return new GoogleAuth({ authClient });
  }
  if (!config.useAdc) throw new Error('Google authentication is not configured.');
  return new GoogleAuth({ scopes: [READ_ONLY_SCOPE] });
}
