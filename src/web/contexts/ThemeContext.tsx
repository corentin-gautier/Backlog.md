import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
	theme: Theme;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
	const context = useContext(ThemeContext);
	if (context === undefined) {
		throw new Error('useTheme must be used within a ThemeProvider');
	}
	return context;
};

interface ThemeProviderProps {
	children: React.ReactNode;
}

// The theme follows the system, live, unless the user picked one with the toggle. That choice is
// kept under CHOICE_KEY, and dropped when the toggle comes back to the system's theme.
const CHOICE_KEY = 'backlog-theme-choice';
const systemQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');
const systemTheme = (): Theme => (systemQuery()?.matches ? 'dark' : 'light');
const savedChoice = (): Theme | null => {
	const saved = localStorage.getItem(CHOICE_KEY);
	return saved === 'light' || saved === 'dark' ? saved : null;
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
	const [choice, setChoice] = useState<Theme | null>(savedChoice);
	const [system, setSystem] = useState<Theme>(systemTheme);
	const theme = choice ?? system;

	useEffect(() => {
		const query = systemQuery();
		if (!query) return;
		const onChange = () => setSystem(query.matches ? 'dark' : 'light');
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
	}, [theme]);

	const toggleTheme = () => {
		const next: Theme = theme === 'light' ? 'dark' : 'light';
		const picked = next === system ? null : next;
		if (picked) localStorage.setItem(CHOICE_KEY, picked);
		else localStorage.removeItem(CHOICE_KEY);
		setChoice(picked);
	};

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
};
