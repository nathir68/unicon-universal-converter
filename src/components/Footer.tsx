import Link from 'next/link';

export function Footer() {
  return (
    <footer className="w-full py-8 mt-12 bg-background border-t border-[var(--neu-dark)]/30">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} UniCon - Universal Converter. All rights reserved.
        </p>
        <div className="flex gap-6 text-sm text-gray-500">
          <Link href="/about" className="hover:text-primary transition-colors">About</Link>
          <Link href="/formats" className="hover:text-primary transition-colors">Supported Formats</Link>
          <Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-primary transition-colors">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
