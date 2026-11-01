import Link from 'next/link';

export function Footer() {
  return (
    <footer className="w-full py-6 sm:py-8 mt-8 sm:mt-12 bg-background border-t border-[var(--neu-dark)]/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 text-center sm:text-left">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="UniCon" className="w-6 h-6 object-contain" />
          <p className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm font-medium">
            &copy; {new Date().getFullYear()} UniCon - Universal Converter. All rights reserved.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
          <Link href="/about" className="hover:text-primary transition-colors py-1">About</Link>
          <Link href="/convert" className="hover:text-primary transition-colors py-1">Convert</Link>
          <Link href="/tools" className="hover:text-primary transition-colors py-1">Tools</Link>
        </div>
      </div>
    </footer>
  );
}
