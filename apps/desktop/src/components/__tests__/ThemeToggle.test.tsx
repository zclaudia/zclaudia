import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockSetTheme = vi.fn();
let mockTheme = 'dark-neutral';
let mockResolvedTheme = 'dark-neutral';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: mockTheme,
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
  isDarkTheme: (t: string) => t !== 'light',
}));

import { ThemeToggle } from '../../features/settings/ThemeToggle';

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Change theme' }));
};

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = 'dark-neutral';
    mockResolvedTheme = 'dark-neutral';
  });

  it('renders without crashing', () => {
    const { container } = render(<ThemeToggle />);
    expect(container.firstChild).toBeDefined();
  });

  it('renders a toggle button', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Change theme' })).toBeTruthy();
  });

  it('displays the current theme label', () => {
    render(<ThemeToggle />);
    expect(screen.getByText('Dark')).toBeTruthy();
  });

  it('opens the menu when the button is clicked', () => {
    render(<ThemeToggle />);
    openMenu();
    expect(screen.getByRole('menu', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.getByText('Light Cool')).toBeTruthy();
    expect(screen.getByText('Dark Warm')).toBeTruthy();
    expect(screen.getByText('Dark Cool')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
  });

  it('renders all six theme options in the menu', () => {
    render(<ThemeToggle />);
    openMenu();
    expect(screen.getAllByRole('menuitem').length).toBe(6);
  });

  it('closes the menu when the toggle button is clicked again', () => {
    render(<ThemeToggle />);
    openMenu();
    expect(screen.getByText('Dark Warm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    expect(screen.queryByText('Dark Warm')).toBeNull();
  });

  it('calls setTheme when a theme option is selected', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Light$/ }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('selects system theme', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'System' }));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('selects dark-warm theme', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark Warm' }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark-warm');
  });

  it('selects dark-cool theme', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark Cool' }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark-cool');
  });

  it('selects light-cool theme', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Light Cool' }));
    expect(mockSetTheme).toHaveBeenCalledWith('light-cool');
  });

  it('marks the current theme option with primary styling', () => {
    mockTheme = 'light-cool';
    mockResolvedTheme = 'light-cool';
    render(<ThemeToggle />);
    openMenu();
    const item = screen.getByRole('menuitem', { name: 'Light Cool' });
    expect(item.querySelector('.text-primary')).toBeTruthy();
    const other = screen.getByRole('menuitem', { name: 'System' });
    expect(other.querySelector('.text-primary')).toBeNull();
  });

  it('closes the menu after selecting a theme', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Light$/ }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu when clicking outside', () => {
    render(
      <div>
        <ThemeToggle />
        <div data-testid="outside">outside</div>
      </div>
    );
    openMenu();
    expect(screen.getByText('Dark Warm')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Dark Warm')).toBeNull();
  });

  it('closes the menu on Escape and returns focus to the trigger', () => {
    render(<ThemeToggle />);
    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change theme' }));
  });

  it('renders light label when theme is light', () => {
    mockTheme = 'light';
    mockResolvedTheme = 'light';
    render(<ThemeToggle />);
    expect(screen.getByText('Light')).toBeTruthy();
  });

  it('renders system label when theme is system', () => {
    mockTheme = 'system';
    mockResolvedTheme = 'dark-neutral';
    render(<ThemeToggle />);
    expect(screen.getByText('System')).toBeTruthy();
  });
});
