// Anonymized contribution to the shared training/feedback dataset.
//
// Fire-and-forget: this must never block or fail the user's flow. The backend
// scrubs personal info from the OCR text server-side, then inserts into the
// insert-only `scan_contributions` table.
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const CONSENT_KEY = 'goldlabel.contribute.consent.v1';

type CategoryMap = Record<string, string | null>;

export interface ContributionInput {
  raw_ocr_reference: string;
  language: string;
  suggested: CategoryMap; // what the model originally proposed
  correction: CategoryMap; // what the user finalized
}

export async function getContributionConsent(): Promise<boolean | null> {
  const v = await AsyncStorage.getItem(CONSENT_KEY);
  if (v === null) return null; // never asked
  return v === 'true';
}

export async function setContributionConsent(value: boolean): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, value ? 'true' : 'false');
}

// One-time opt-in prompt. Resolves to the user's choice.
function askConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Help improve GoldLabel?',
      'May we save an anonymized copy of this label — with names, dates, phone ' +
        'numbers and ID numbers removed — to improve pictogram suggestions for ' +
        'everyone? Your personal scan history always stays only on this phone.',
      [
        { text: 'No thanks', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Yes, help', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

// Checks consent (asking once if needed), then sends the contribution.
// Safe to call without awaiting — it swallows all errors.
export async function maybeContribute(input: ContributionInput): Promise<void> {
  try {
    if (!BACKEND_URL) return;

    let consent = await getContributionConsent();
    if (consent === null) {
      consent = await askConsent();
      await setContributionConsent(consent);
    }
    if (!consent) return;

    await fetch(`${BACKEND_URL}/api/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    // Never surface contribution failures to the user.
  }
}
