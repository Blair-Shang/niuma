export interface SchemaChartTheme {
  text: string
  foreground: string
  border: string
  surface: string
  accent: string
}

export function readSchemaChartTheme(): SchemaChartTheme {
  if (typeof document === 'undefined') {
    return {
      text: '#94a3b8',
      foreground: '#e2e8f0',
      border: '#334155',
      surface: '#1e293b',
      accent: '#3b82f6',
    }
  }
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: pick('--rs-muted', '#94a3b8'),
    foreground: pick('--rs-foreground', '#e2e8f0'),
    border: pick('--rs-border-subtle', '#334155'),
    surface: pick('--rs-surface-subtle', '#1e293b'),
    accent: pick('--rs-accent', '#3b82f6'),
  }
}
