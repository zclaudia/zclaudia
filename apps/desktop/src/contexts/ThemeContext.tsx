import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'light-cool' | 'dark-neutral' | 'dark-warm' | 'dark-cool' | 'system';
export type ResolvedTheme = 'light' | 'light-cool' | 'dark-neutral' | 'dark-warm' | 'dark-cool';

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return theme === 'dark-neutral' || theme === 'dark-warm' || theme === 'dark-cool';
}

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'zclaudia-theme';
const DEFAULT_DARK: ResolvedTheme = 'dark-neutral';
const DARK_VARIANT_CLASSES = ['dark-neutral', 'dark-warm', 'dark-cool'];
const LIGHT_VARIANT_CLASSES = ['light-cool'];
const VALID_THEMES: Theme[] = [
  'light',
  'light-cool',
  'dark-neutral',
  'dark-warm',
  'dark-cool',
  'system',
];

const THEME_META_COLORS: Record<ResolvedTheme, string> = {
  light: '#f9f7f2',
  'light-cool': '#f6f7f9',
  'dark-neutral': '#171514',
  'dark-warm': '#161413',
  'dark-cool': '#131519',
};

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? DEFAULT_DARK : 'light';
  }
  return DEFAULT_DARK;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

function applyThemeClasses(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove('dark');
  DARK_VARIANT_CLASSES.forEach(cls => root.classList.remove(cls));
  LIGHT_VARIANT_CLASSES.forEach(cls => root.classList.remove(cls));
  if (isDarkTheme(resolved)) {
    root.classList.add('dark');
    root.classList.add(resolved); // e.g. 'dark-neutral'
  } else if (resolved !== 'light') {
    root.classList.add(resolved); // e.g. 'light-cool'
  }

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', THEME_META_COLORS[resolved]);
  }
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    const saved = localStorage.getItem(STORAGE_KEY);
    // Migrate old 'dark' value
    if (saved === 'dark') {
      localStorage.setItem(STORAGE_KEY, DEFAULT_DARK);
      return DEFAULT_DARK;
    }
    if (saved && VALID_THEMES.includes(saved as Theme)) {
      return saved as Theme;
    }
    return defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  // Update resolved theme when theme changes
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyThemeClasses(resolved);
  }, [theme]);

  // Listen for system theme changes when using 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const newResolved: ResolvedTheme = e.matches ? DEFAULT_DARK : 'light';
      setResolvedTheme(newResolved);
      applyThemeClasses(newResolved);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
