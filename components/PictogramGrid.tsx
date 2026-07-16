import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, ImageSourcePropType } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  TIME_OPTIONS,
  HOW_TO_TAKE_OPTIONS,
  SIDE_EFFECT_OPTIONS,
  DURATION_OPTIONS,
  DOSAGE_OPTIONS,
  PRECAUTIONS_OPTIONS,
  PictogramOption,
} from './PictogramData';
import NONE_PICTOGRAMS from './pictogramAssets';

const ALL_OPTIONS: PictogramOption[] = [
  ...TIME_OPTIONS,
  ...HOW_TO_TAKE_OPTIONS,
  ...SIDE_EFFECT_OPTIONS,
  ...DURATION_OPTIONS,
  ...DOSAGE_OPTIONS,
  ...PRECAUTIONS_OPTIONS,
];

function getOriginalIcon(pictogramId: string, size: number): React.ReactElement | null {
  const option = ALL_OPTIONS.find(o => o.id === pictogramId);
  if (!option || !option.variants.length) return null;
  return option.variants[0].icon(size);
}

const BASE_STORAGE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pictograms/v1`;

// Pictogram ids are dot-notation and normally map straight to the stored
// filename as `${pictogram_id}.png`. The only exceptions are pictograms whose
// art file carries a variant suffix.
const FILENAME_OVERRIDES: Record<string, string> = {
  'how_to_take.dissolve_in_water': 'how_to_take.dissolve_in_water_v1.png',
};

// The `none` set on Supabase pluralises dosage units for counts >= 2,
// whereas the language sets (and the pictogram ids) use the singular form.
// Translate the derived filename to the actual `none`-set filename for those.
const NONE_FILENAME_OVERRIDES: Record<string, string> = {
  "dosage.teaspoon_2.png": "dosage.teaspoons_2.png",
  "dosage.teaspoon_3.png": "dosage.teaspoons_3.png",
  "dosage.tablespoon_2.png": "dosage.tablespoons_2.png",
  "dosage.tablespoon_3.png": "dosage.tablespoons_3.png",
  "dosage.ear_drop_2.png": "dosage.ear_drops_2.png",
  "dosage.ear_drop_3.png": "dosage.ear_drops_3.png",
  "dosage.ear_drop_4.png": "dosage.ear_drops_4.png",
  "dosage.eye_drop_2.png": "dosage.eye_drops_2.png",
  "dosage.eye_drop_3.png": "dosage.eye_drops_3.png",
  "dosage.eye_drop_4.png": "dosage.eye_drops_4.png",
};

export function getFriendlyLabel(id: string | null): string {
  if (!id) return '';
  const option = ALL_OPTIONS.find((o) => o.id === id);
  if (option) return option.label;
  // Fallback for ids without a bundled option: format the part after the
  // category prefix (e.g. "dosage.tablet_1" -> "Tablet 1").
  const clean = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
  return clean
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface ImageProps {
  pictogramId: string;
  language: string;
  size: number;
}

export function PictogramImage({ pictogramId, language, size }: ImageProps) {
  const [sources, setSources] = useState<ImageSourcePropType[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pictogramId) {
      setError(true);
      setLoading(false);
      return;
    }
    // Pictogram ids are dot-notation and map directly to the stored filename.
    const filename = FILENAME_OVERRIDES[pictogramId] || `${pictogramId}.png`;

    // Fallback chain:
    //   1. selected language (Supabase) — has the language text baked in
    //   2. bundled no-language pictogram (offline, instant)
    //   3. no-language pictogram (Supabase) — covers anything not bundled
    //   4. original built-in SVG (handled via `error` state below)
    const list: ImageSourcePropType[] = [];
    if (language && language !== 'none') {
      list.push({ uri: `${BASE_STORAGE_URL}/${language}/${filename}` });
    }
    const bundled = NONE_PICTOGRAMS[filename];
    if (bundled) {
      list.push(bundled);
    }
    const noneFilename = NONE_FILENAME_OVERRIDES[filename] || filename;
    list.push({ uri: `${BASE_STORAGE_URL}/none/${noneFilename}` });

    setSources(list);
    setCurrentIdx(0);
    setLoading(true);
    setError(false);
  }, [pictogramId, language]);

  const handleImageError = () => {
    if (currentIdx + 1 < sources.length) {
      setCurrentIdx(prev => prev + 1);
    } else {
      setError(true);
      setLoading(false);
    }
  };

  const handleImageLoad = () => {
    setLoading(false);
  };

  if (error || sources.length === 0) {
    const originalIcon = getOriginalIcon(pictogramId, size);
    if (originalIcon) {
      return (
        <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
          {originalIcon}
        </View>
      );
    }
    return (
      <View style={[styles.placeholderBox, { width: size, height: size }]}>
        <Svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="10" stroke="#B85A3C" strokeWidth="2.5" />
          <Path d="M12 8v4M12 16h.01" stroke="#B85A3C" strokeWidth="2.5" strokeLinecap="round" />
        </Svg>
        <Text style={[styles.placeholderText, { fontSize: Math.max(8, size * 0.08) }]} numberOfLines={2}>
          {getFriendlyLabel(pictogramId)}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
      <Image
        source={sources[currentIdx]}
        style={{ width: size, height: size, resizeMode: 'contain', opacity: loading ? 0 : 1 }}
        onError={handleImageError}
        onLoad={handleImageLoad}
      />
      {loading && (
        <ActivityIndicator
          size="small"
          color="#1B3022"
          style={{ position: 'absolute' }}
        />
      )}
    </View>
  );
}

interface GridProps {
  pictograms: string[];
  language: string;
  layout: 'portrait' | 'landscape';
  maxSlots?: number;
  showLabels?: boolean;
}

function getGridLayout(count: number, layout: 'portrait' | 'landscape'): { cols: number; cellSize: number } {
  if (count <= 0) return { cols: 1, cellSize: 120 };

  if (count === 1) return { cols: 1, cellSize: 160 };
  if (count === 2) return layout === 'landscape' ? { cols: 2, cellSize: 130 } : { cols: 1, cellSize: 140 };
  if (count === 3) return layout === 'landscape' ? { cols: 3, cellSize: 100 } : { cols: 2, cellSize: 120 };
  if (count === 4) return { cols: 2, cellSize: 120 };
  return layout === 'landscape' ? { cols: 3, cellSize: 100 } : { cols: 2, cellSize: 120 };
}

export default function PictogramGrid({ pictograms, language, layout, maxSlots = 6, showLabels = true }: GridProps) {
  const activePictograms = pictograms.filter(Boolean).slice(0, maxSlots);
  const count = activePictograms.length;

  if (count === 0) return null;

  const { cols, cellSize } = getGridLayout(count, layout);

  const rows: string[][] = [];
  for (let i = 0; i < count; i += cols) {
    rows.push(activePictograms.slice(i, i + cols));
  }

  return (
    <View style={styles.gridContainer}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={styles.gridRow}>
          {row.map((id, idx) => (
            <View key={`${id}-${rowIdx * cols + idx}`} style={[styles.gridCell, { width: cellSize }]}>
              <PictogramImage pictogramId={id} language={language} size={cellSize - 16} />
              {showLabels && (
                <Text style={styles.cellLabel} numberOfLines={1}>
                  {getFriendlyLabel(id)}
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gridCell: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(27, 48, 34, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    aspectRatio: 1,
    shadowColor: '#1B3022',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cellLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1B3022',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
    textAlign: 'center',
    width: '100%',
  },
  placeholderBox: {
    backgroundColor: '#FFF2EE',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#D37B5C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  placeholderText: {
    color: '#D37B5C',
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
});
