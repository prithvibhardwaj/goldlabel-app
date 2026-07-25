// Secure-random polyfill for React Native.
//
// crypto-js needs `crypto.getRandomValues` to generate the salt/IV for AES. React
// Native (Hermes) doesn't provide it, so crypto-js throws:
//   "Native crypto module could not be used to get secure random number."
// We back it with expo-crypto's CSPRNG. This file MUST be imported before any
// module that pulls in crypto-js (i.e. first import in App.tsx).
import * as ExpoCrypto from 'expo-crypto';

const g: any = globalThis;

if (!g.crypto) {
  g.crypto = {};
}

if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (typedArray: ArrayBufferView) => {
    const bytes = ExpoCrypto.getRandomBytes(typedArray.byteLength);
    // Write random bytes into the underlying buffer regardless of the view type
    // (e.g. Uint32Array), matching the WebCrypto getRandomValues contract.
    new Uint8Array(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength
    ).set(bytes);
    return typedArray;
  };
}
