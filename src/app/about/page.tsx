import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function About() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <Header />
      <main className="flex-1 flex flex-col items-center w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 text-center">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-background shadow-[var(--shadow-neu)] p-2.5 mb-6 flex items-center justify-center border border-white/20">
          <img 
            src="/logo.png" 
            alt="UniCon Logo" 
            className="w-full h-full object-contain" 
          />
        </div>
        <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-800 dark:text-gray-100 mb-4 sm:mb-6">
          About UniCon
        </h1>
        <p className="text-sm sm:text-lg text-gray-600 dark:text-gray-300 leading-relaxed mb-6 sm:mb-8 max-w-2xl">
          UniCon (Universal Converter) is a modern, privacy-first file conversion utility.
          We support images, audio, video, documents, and PDFs. All conversions are performed
          securely and files are automatically deleted after processing.
        </p>
        <div className="p-5 sm:p-8 rounded-2xl sm:rounded-3xl bg-background shadow-[var(--shadow-neu)] text-gray-700 dark:text-gray-200 w-full max-w-xl mx-auto text-left">
          <h2 className="text-lg sm:text-2xl font-bold mb-3 sm:mb-4 text-primary">Key Features</h2>
          <ul className="list-disc pl-5 sm:pl-6 space-y-2 text-xs sm:text-sm">
            <li>High-fidelity PDF to Word (DOCX) conversion</li>
            <li>Fast local processing with Sharp & FFmpeg</li>
            <li>Batch upload & queue processing</li>
            <li>Beautiful Neumorphic design optimized for mobile & desktop</li>
            <li>Automatic temporary file cleanup</li>
            <li>Zero analytics or tracking</li>
          </ul>
        </div>
      </main>
      <Footer />
    </div>
  );
}
