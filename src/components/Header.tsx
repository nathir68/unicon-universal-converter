"use client";

import { Settings, Moon, Sun, Menu } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function Header() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <header className="w-full h-20 grid grid-cols-3 items-center px-6 md:px-12 bg-background sticky top-0 z-50">
      <div className="flex items-center gap-3 justify-self-start">
        <div className="w-10 h-10 rounded-xl bg-background shadow-[var(--shadow-neu)] flex items-center justify-center overflow-hidden border border-white/20">
          <img src="/logo.jpg" alt="UniConvert Logo" className="w-full h-full object-cover mix-blend-multiply dark:mix-blend-normal" />
        </div>
        <span className="text-xl font-bold text-gray-700 tracking-wide dark:text-gray-200">UniConvert</span>
      </div>
      
      <nav className="hidden md:flex items-center gap-8 text-gray-600 dark:text-gray-400 font-medium justify-self-center">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <Link href="/convert" className="hover:text-primary transition-colors">Convert</Link>
        <Link href="/tools" className="hover:text-primary transition-colors">Tools</Link>
        <Link href="/about" className="hover:text-primary transition-colors">About</Link>
      </nav>
      
      <div className="flex items-center gap-4 justify-self-end">
        <button 
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="w-10 h-10 rounded-full bg-background shadow-[var(--shadow-neu)] hover:shadow-[var(--shadow-neu-hover)] active:shadow-[var(--shadow-neu-active)] transition-all flex items-center justify-center text-gray-500 hover:text-primary"
        >
          {mounted && theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button className="md:hidden w-10 h-10 rounded-xl bg-background shadow-[var(--shadow-neu)] hover:shadow-[var(--shadow-neu-hover)] active:shadow-[var(--shadow-neu-active)] transition-all flex items-center justify-center text-gray-500 hover:text-primary">
          <Menu className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
