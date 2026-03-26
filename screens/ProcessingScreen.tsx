import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

function SparklesIcon() {
  return (
    <Text style={{ fontSize: 56, textAlign: 'center' }}>✨</Text>
  );
}

export default function ProcessingScreen({ navigation }: any) {
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

    const timer = setTimeout(() => {
      navigation.navigate('ConfirmInformation');
    }, 3000);

    return () => {
      clearTimeout(timer);
      pulse.stop();
      dotAnims.stop();
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* Pulsing circle */}
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

      {/* Text */}
      <Animated.Text style={[styles.heading, { opacity: textOpacity }]}>Scanning…</Animated.Text>
      <Text style={styles.subtext}>Reading your medicine label</Text>
      <Text style={styles.subtext2}>Take a moment to relax</Text>

      {/* Progress dots */}
      <View style={styles.dots}>
        {[dot0, dot1, dot2].map((dot, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              { transform: [{ scale: dot }] },
            ]}
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
