import type { MaterialType } from '../api/documents'

const DATABASE = 'projectf-uploads'
const STORE = 'sessions'

export interface SavedUploadSession {
  fingerprint: string
  sessionId: string
  filename: string
  size: number
  lastModified: number
  materialType: MaterialType
  confirmedOffset: number
  transferProgress: number
  importProgress: number
  status: string
  updatedAt: number
}

export function uploadFingerprint(file: File, materialType: MaterialType) {
  return [file.name, file.size, file.lastModified, materialType].join(':')
}

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'fingerprint' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database()
  if (!db) return undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function findUploadSession(
  file: File,
  materialType: MaterialType,
) {
  return transaction<SavedUploadSession | undefined>('readonly', (store) =>
    store.get(uploadFingerprint(file, materialType)),
  )
}

export async function saveUploadSession(session: SavedUploadSession) {
  await transaction('readwrite', (store) => store.put(session))
}

export async function removeUploadSession(
  file: File,
  materialType: MaterialType,
) {
  await transaction('readwrite', (store) =>
    store.delete(uploadFingerprint(file, materialType)),
  )
}
