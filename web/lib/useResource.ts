import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from './api';
export interface Resource<T> { state: 'loading' | 'ready' | 'error'; data: T | null; error: string | null; errorCode?: string | null; reload: () => void }
export function useResource<T>(path: string | null): Resource<T> {
  const { api } = useAuth(); const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string | null; revision: number; state: Resource<T>['state']; data: T | null; error: string | null; errorCode?: string | null }>({ key: path, revision, state: 'loading', data: null, error: null });
  useEffect(() => {
    const abort = new AbortController(); let active = true;
    setResult({ key: path, revision, state: 'loading', data: null, error: null });
    if (path) api.get<T>(path, abort.signal).then(data => { if (active) setResult({ key: path, revision, state: 'ready', data, error: null }); }).catch(error => { if (active && error?.name !== 'AbortError') setResult({ key: path, revision, state: 'error', data: null, error: error instanceof ApiError ? error.message : 'Data tidak dapat dimuat. Coba lagi.', errorCode: error instanceof ApiError ? error.code : null }); });
    return () => { active = false; abort.abort(); };
  }, [api, path, revision]);
  const current = result.key === path && result.revision === revision ? result : { state: 'loading' as const, data: null, error: null };
  return { ...current, reload: () => setRevision(value => value + 1) };
}
