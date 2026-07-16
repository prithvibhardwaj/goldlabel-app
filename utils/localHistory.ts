// On-device, encrypted-at-rest scan history.
//
// Design: the user's personal medication history never leaves the phone. It is
// stored encrypted in AsyncStorage; the AES key lives in the OS keychain/keystore
// via expo-secure-store. We keep the *key* (small) in SecureStore rather than the
// whole history, because SecureStore is meant for small secrets and warns above
// ~2KB on Android — a growing history list would exceed that.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import CryptoJS from 'crypto-js';
import { LabelRecord } from '../types';

const DATA_KEY = 'goldlabel.history.v1';        // AsyncStorage: encrypted blob
const CRYPTO_KEY_ID = 'goldlabel_history_key';  // SecureStore: AES key (hex)

// SecureStore is unavailable on web (react-native-web dev builds); fall back to
// AsyncStorage there. Web is dev-only, so this is not a production path.
async function secureGet(k: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem('secure.' + k);
  return SecureStore.getItemAsync(k);
}
async function secureSet(k: string, v: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.setItem('secure.' + k, v);
  return SecureStore.setItemAsync(k, v);
}

async function getKey(): Promise<string> {
  let key = await secureGet(CRYPTO_KEY_ID);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32); // 256-bit CSPRNG
    key = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await secureSet(CRYPTO_KEY_ID, key);
  }
  return key;
}

export async function getHistory(): Promise<LabelRecord[]> {
  try {
    const blob = await AsyncStorage.getItem(DATA_KEY);
    if (!blob) return [];
    const key = await getKey();
    const decrypted = CryptoJS.AES.decrypt(blob, key).toString(CryptoJS.enc.Utf8);
    if (!decrypted) return [];
    const arr = JSON.parse(decrypted);
    return Array.isArray(arr) ? arr : [];
  } catch {
    // Corrupt/rotated key -> start clean rather than crash the history screen.
    return [];
  }
}

async function saveHistory(records: LabelRecord[]): Promise<void> {
  const key = await getKey();
  const cipher = CryptoJS.AES.encrypt(JSON.stringify(records), key).toString();
  await AsyncStorage.setItem(DATA_KEY, cipher);
}

type NewRecord = Omit<LabelRecord, 'id' | 'created_at'> &
  Partial<Pick<LabelRecord, 'id' | 'created_at'>>;

export async function addRecord(rec: NewRecord): Promise<LabelRecord> {
  const history = await getHistory();
  const full = {
    ...rec,
    id: rec.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: rec.created_at || new Date().toISOString(),
  } as LabelRecord;
  history.unshift(full); // newest first
  await saveHistory(history);
  return full;
}

export async function updateRecord(id: string, patch: Partial<LabelRecord>): Promise<void> {
  const history = await getHistory();
  const next = history.map((r) => (r.id === id ? { ...r, ...patch } : r));
  await saveHistory(next);
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(DATA_KEY);
}
