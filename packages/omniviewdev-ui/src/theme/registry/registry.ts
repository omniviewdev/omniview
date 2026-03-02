import type { ThemeDefinition, ThemeVariant } from './types';

class ThemeRegistryClass {
  private themes = new Map<string, ThemeDefinition>();

  register(variant: string, definition: ThemeDefinition): void {
    this.themes.set(variant, definition);
  }

  get(variant: ThemeVariant | string): ThemeDefinition {
    return this.themes.get(variant) ?? this.themes.get('default')!;
  }

  getVariants(): string[] {
    return Array.from(this.themes.keys());
  }
}

export const ThemeRegistry = new ThemeRegistryClass();
