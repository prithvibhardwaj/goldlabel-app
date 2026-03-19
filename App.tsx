import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './utils/supabase';

const BACKEND_URL = 'http://172.20.10.6:4000';

export default function App() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to scan labels.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setImageUri(uri);
      setOcrText(null);
      await runOcr(uri);
    }
  };

  const runOcr = async (uri: string) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri,
        name: 'photo.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);

      const response = await fetch(`${BACKEND_URL}/api/ocr/extract`, {
        method: 'POST',
        body: formData,
      });

      const json = await response.json();

      if (!response.ok) {
        Alert.alert('OCR Error', json.error ?? 'Something went wrong.');
        return;
      }
      const extractedText = json.text || 'No text found in image.';
      setOcrText(extractedText);
      console.log("Supabase URL:", process.env.EXPO_PUBLIC_SUPABASE_URL);
      await saveRawOcrToSupabase(extractedText);
      // setOcrText(json.text || 'No text found in image.');
    } catch (err) {
      console.error('OCR request failed:', err);
      Alert.alert('Network Error', 'Could not reach the OCR backend. Is the server running?');
    } finally {
      setLoading(false);
    }
  };


const saveRawOcrToSupabase = async (text: string) => {
  try {
    const { data, error } = await supabase
      .from('Labels') // Your table name
      .insert([
        { raw_text: text } 
      ])
      .select();

    if (error) {
      throw error;
    }

    console.log('Successfully saved to Supabase:', data);
    return data;
  } catch (err) {
    console.error('Supabase Upload Error:', err);
    Alert.alert('Database Error', 'Could not save the scan results.');
  }
};

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar style="dark" />

      <Text style={styles.title}>GoldLabel</Text>
      <Text style={styles.subtitle}>Scan a medication label</Text>

      <TouchableOpacity style={styles.button} onPress={takePhoto} disabled={loading}>
        <Text style={styles.buttonText}>📷 Take Photo</Text>
      </TouchableOpacity>

      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
      )}

      {loading && <ActivityIndicator size="large" color="#000" style={{ marginTop: 20 }} />}

      {ocrText && !loading && (
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>Extracted Text</Text>
          <Text style={styles.resultText}>{ocrText}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingTop: 80,
    paddingHorizontal: 24,
    paddingBottom: 40,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#000',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  preview: {
    width: '100%',
    height: 280,
    borderRadius: 12,
    marginBottom: 24,
    backgroundColor: '#f0f0f0',
  },
  resultBox: {
    width: '100%',
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 16,
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  resultText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#111',
  },
});
