export interface MedicationRecord {
  id: string;
  name: string;
  dosage: {
    amount: number;
    unit: string;
  };
  timing: {
    morning: boolean;
    noon: boolean;
    night: boolean;
  };
  withFood: boolean | null;
  instructions: string;
  scannedAt: Date;
  imageUrl?: string;
}

export interface OptionSelection {
  optionId: string;
  variantId: string;
}
