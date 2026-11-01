"use client";

import { Moon, Sun, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function Header() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="w-full bg-background/90 backdrop-blur-md sticky top-0 z-50 border-b border-black/5 dark:border-white/5 transition-colors">
      <div className="w-full max-w-7xl mx-auto h-16 sm:h-20 flex items-center justify-between px-4 sm:px-6 md:px-12">
        
        {/* Brand / Logo */}
        <Link href="/" className="flex items-center gap-2.5 sm:gap-3 group focus:outline-none" onClick={closeMenu}>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-background shadow-[var(--shadow-neu-sm)] group-hover:shadow-[var(--shadow-neu)] flex items-center justify-center overflow-hidden border border-white/20 transition-all flex-shrink-0 p-1">
            <img 
              src="/logo.png" 
              alt="UniCon Logo" 
              className="w-full h-full object-contain" 
            />
          </div>
          <div className="flex flex-col">
            <span className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100 tracking-tight leading-tight">
              UniCon
            </span>
            <span className="hidden xs:inline text-[10px] text-gray-500 dark:text-gray-400 font-medium tracking-tight -mt-0.5">
              Universal Converter
            </span>
          </div>
        </Link>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8 text-gray-600 dark:text-gray-300 font-medium">
          <Link href="/" className="hover:text-primary transition-colors text-sm font-semibold">Home</Link>
          <Link href="/convert" className="hover:text-primary transition-colors text-sm font-semibold">Convert</Link>
          <Link href="/tools" className="hover:text-primary transition-colors text-sm font-semibold">Tools</Link>
          <Link href="/about" className="hover:text-primary transition-colors text-sm font-semibold">About</Link>
        </nav>
        
        {/* Actions: Theme Toggle & Mobile Menu Trigger */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-background shadow-[var(--shadow-neu-sm)] hover:shadow-[var(--shadow-neu)] active:shadow-[var(--shadow-neu-active)] transition-all flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-primary"
          >
            {mounted && theme === 'dark' ? (
              <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 sm:w-5 sm:h-5" />
            )}
          </button>

          {/* Hamburger button for mobile */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle mobile menu"
            className="md:hidden w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-background shadow-[var(--shadow-neu-sm)] hover:shadow-[var(--shadow-neu)] active:shadow-[var(--shadow-neu-active)] transition-all flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-primary"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="md:hidden overflow-hidden border-t border-black/5 dark:border-white/5 bg-background shadow-[var(--shadow-neu-inset)] px-4 py-4"
          >
            <nav className="flex flex-col gap-2">
              <Link 
                href="/" 
                onClick={closeMenu}
                className="px-4 py-3 rounded-xl text-gray-700 dark:text-gray-200 font-medium hover:bg-primary/10 hover:text-primary active:shadow-[var(--shadow-neu-inset)] transition-all flex items-center justify-between"
              >
                <span>Home</span>
                <span className="text-xs text-gray-400">Main Converter</span>
              </Link>
              <Link 
                href="/convert" 
                onClick={closeMenu}
                className="px-4 py-3 rounded-xl text-gray-700 dark:text-gray-200 font-medium hover:bg-primary/10 hover:text-primary active:shadow-[var(--shadow-neu-inset)] transition-all flex items-center justify-between"
              >
                <span>Convert</span>
                <span className="text-xs text-gray-400">File Converter</span>
              </Link>
              <Link 
                href="/tools" 
                onClick={closeMenu}
                className="px-4 py-3 rounded-xl text-gray-700 dark:text-gray-200 font-medium hover:bg-primary/10 hover:text-primary active:shadow-[var(--shadow-neu-inset)] transition-all flex items-center justify-between"
              >
                <span>Tools</span>
                <span className="text-xs text-gray-400">Smart Features</span>
              </Link>
              <Link 
                href="/about" 
                onClick={closeMenu}
                className="px-4 py-3 rounded-xl text-gray-700 dark:text-gray-200 font-medium hover:bg-primary/10 hover:text-primary active:shadow-[var(--shadow-neu-inset)] transition-all flex items-center justify-between"
              >
                <span>About</span>
                <span className="text-xs text-gray-400">App Info</span>
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
