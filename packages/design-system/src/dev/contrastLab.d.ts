export interface ContrastVariantInfo {
  key: string;
  label: string;
  description: string;
}

export const CONTRAST_VARIANTS: ContrastVariantInfo[];

export function getContrastVariant(): string;
export function setContrastVariant(variant: string): void;
export function initContrastVariant(): void;
export function useContrastVariant(): string;
