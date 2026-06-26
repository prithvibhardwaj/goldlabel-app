import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Alert } from 'react-native';
import { GeminiResponse } from '../types';

const VISION_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_VISION_API_KEY || '';
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

const MEDICATION_SCHEMA = {
  type: 'object',
  required: ['raw_ocr_reference', 'medication_name', 'language', 'pictogram_categories'],
  properties: {
    raw_ocr_reference: { type: 'string' },
    medication_name: { type: 'string' },
    language: { type: 'string', enum: ['none', 'en', 'bn', 'hi', 'kn', 'ml', 'te', 'my', 'th', 'vi', 'zh', 'ms', 'ta'] },
    pictogram_categories: {
      type: 'object',
      required: ['how_to_take', 'side_effects', 'duration', 'dosage', 'time_of_day', 'precautions'],
      properties: {
        how_to_take: { type: ['string', 'null'] },
        side_effects: { type: ['string', 'null'] },
        duration: { type: ['string', 'null'] },
        dosage: { type: ['string', 'null'] },
        time_of_day: { type: ['string', 'null'] },
        precautions: { type: ['string', 'null'] }
      }
    }
  }
};

function SparklesIcon() {
  return (
    <Text style={{ fontSize: 56, textAlign: 'center' }}>✨</Text>
  );
}

export default function ProcessingScreen({ navigation, route }: any) {
  const { imageUri, imageBase64 } = route.params || {};

  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const innerScale = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(1)).current;
  const dot0 = useRef(new Animated.Value(1)).current;
  const dot1 = useRef(new Animated.Value(1)).current;
  const dot2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.15, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.6, duration: 1000, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(innerScale, { toValue: 1.08, duration: 1000, useNativeDriver: true }),
          Animated.timing(innerScale, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(textOpacity, { toValue: 0.75, duration: 1000, useNativeDriver: true }),
          Animated.timing(textOpacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
      ])
    );
    pulse.start();

    const makeDotAnim = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.sequence([
              Animated.timing(anim, { toValue: 1.6, duration: 667, useNativeDriver: true }),
              Animated.timing(anim, { toValue: 1, duration: 667, useNativeDriver: true }),
            ]),
          ]),
        ])
      );

    const dotAnims = Animated.parallel([
      makeDotAnim(dot0, 0),
      makeDotAnim(dot1, 300),
      makeDotAnim(dot2, 600),
    ]);
    dotAnims.start();

    processImage();

    return () => {
      pulse.stop();
      dotAnims.stop();
    };
  }, []);

  const processImage = async () => {
    try {
      if (!imageBase64) throw new Error('No image provided');

      // 1. Call Google Vision API for OCR
      const visionResponse = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: imageBase64 },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            }],
          }),
        }
      );

      const visionJson = await visionResponse.json();
      if (!visionResponse.ok || visionJson.error) {
        throw new Error(visionJson.error?.message || 'Vision API request failed.');
      }

      const extractedText: string = visionJson.responses?.[0]?.fullTextAnnotation?.text || '';
      if (!extractedText) throw new Error('Could not detect any text in the image.');

      // 3. Call Gemini API to parse text into structured data
      const prompt = `Extract medication information from the following OCR text.
Return the data strictly following this JSON schema: ${JSON.stringify(MEDICATION_SCHEMA)}

Instructions:
1. The 'raw_ocr_reference' field MUST be the exact text provided below.
2. Under 'pictogram_categories', for each of the 6 fields, choose the best matching option from these valid IDs or null if not applicable:
   - how_to_take: how_to_take_swallow_whole, how_to_take_dissolve_in_water, how_to_take_take_with_food, how_to_take_take_with_water, how_to_take_take_on_empty_stomach, how_to_take_take_30min_before_food, how_to_take_take_30min_after_food
   - side_effects: side_effects_may_cause_drowsiness, side_effects_may_cause_dizziness, side_effects_avoid_driving, side_effects_may_cause_headache, side_effects_may_cause_blurred_vision, side_effects_may_cause_tremors, side_effects_may_cause_nausea, side_effects_may_cause_vomiting, side_effects_may_cause_diarrhea, side_effects_may_cause_constipation, side_effects_may_cause_dry_mouth, side_effects_may_cause_light_sensitivity, side_effects_may_cause_allergic_reaction, side_effects_may_cause_muscle_weakness, side_effects_may_cause_fast_heartbeat, side_effects_may_cause_fever, side_effects_increased_fall_risk
   - duration: duration_1_day, duration_2_days, duration_3_days, duration_4_days, duration_5_days, duration_6_days, duration_7_days, duration_8_days, duration_9_days, duration_10_days, duration_1_week, duration_2_weeks, duration_3_weeks, duration_4_weeks, duration_5_weeks, duration_6_weeks, duration_7_weeks, duration_8_weeks, duration_9_weeks, duration_10_weeks, duration_1_month, duration_2_months, duration_3_months, duration_4_months, duration_5_months, duration_6_months, duration_7_months, duration_8_months, duration_9_months, duration_10_months, duration_11_months, duration_12_months, duration_complete_course, duration_stop_on_doctors_advice, duration_take_until_symptoms_resolve, duration_repeat_cycle
   - dosage: dosage_half_tablet, dosage_1_tablet, dosage_1_and_half_tablets, dosage_2_tablets, dosage_2_and_half_tablets, dosage_3_tablets, dosage_3_and_half_tablets, dosage_4_tablets, dosage_4_and_half_tablets, dosage_1_teaspoon, dosage_2_teaspoons, dosage_3_teaspoons, dosage_1_tablespoon, dosage_2_tablespoons, dosage_3_tablespoons, dosage_1_ear_drop, dosage_2_ear_drops, dosage_3_ear_drops, dosage_4_ear_drops, dosage_1_eye_drop, dosage_2_eye_drops, dosage_3_eye_drops, dosage_4_eye_drops, dosage_injection_5ml, dosage_injection_10ml, dosage_injection_15ml, dosage_injection_20ml
   - time_of_day: time_of_day_once_daily, time_of_day_twice_daily, time_of_day_thrice_daily, time_of_day_morning, time_of_day_noon, time_of_day_night, time_of_day_upon_waking_up, time_of_day_before_bed, time_of_day_every_4_hours, time_of_day_every_8_hours, time_of_day_with_breakfast, time_of_day_with_lunch, time_of_day_with_dinner
   - precautions: precautions_avoid_alcohol, precautions_avoid_dairy, precautions_avoid_grapefruit, precautions_keep_refrigerated, precautions_keep_refrigerated_do_not_freeze, precautions_keep_away_from_light, precautions_keep_away_from_children, precautions_keep_away_from_pets, precautions_dispose_properly, precautions_do_not_share, precautions_do_not_take_if_pregnant, precautions_do_not_take_if_breastfeeding, precautions_consult_doctor_before_taking, precautions_consult_doctor_if_symptoms_worsen, precautions_check_expiry_date, precautions_discard_8_weeks_after_opening, precautions_store_in_cool_dry_place
3. For 'language', identify the primary language of the text (e.g. 'en', 'bn', 'hi', 'kn'). Default to 'en' if English. If no text is found, set to 'none'.

OCR Text: "${extractedText}"`;

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );

      const geminiJson = await geminiResponse.json();
      if (!geminiResponse.ok || geminiJson.error) {
        throw new Error(geminiJson.error?.message || 'Gemini API request failed.');
      }

      const textContent = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textContent) throw new Error('No response from Gemini API.');

      const data: GeminiResponse = JSON.parse(textContent);
      navigation.replace('ConfirmInformation', {
        medicationData: data,
        imageUri,
        imageBase64
      });
    } catch (err: any) {
      Alert.alert(
        'Processing Failed',
        err.message || 'Could not read the label. Please try again.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.outerCircle,
          { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
        ]}
      >
        <Animated.View style={[styles.innerCircle, { transform: [{ scale: innerScale }] }]}>
          <SparklesIcon />
        </Animated.View>
      </Animated.View>

      <Animated.Text style={[styles.heading, { opacity: textOpacity }]}>Scanning…</Animated.Text>
      <Text style={styles.subtext}>Reading your medicine label</Text>
      <Text style={styles.subtext2}>Take a moment to relax</Text>

      <View style={styles.dots}>
        {[dot0, dot1, dot2].map((dot, i) => (
          <Animated.View
            key={i}
            style={[styles.dot, { transform: [{ scale: dot }] }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2ED',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  outerCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(27,48,34,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 48,
  },
  innerCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: '#1B3022',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  heading: {
    fontSize: 44,
    fontWeight: '700',
    color: '#1B3022',
    fontFamily: 'Georgia',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 20,
    color: 'rgba(27,48,34,0.7)',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtext2: {
    fontSize: 18,
    color: 'rgba(27,48,34,0.5)',
    textAlign: 'center',
    lineHeight: 26,
  },
  dots: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 48,
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1B3022',
    opacity: 0.4,
  },
});
