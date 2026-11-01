import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function About() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center w-full max-w-4xl mx-auto px-4 py-12 text-center">
        <h1 className="text-4xl font-bold text-gray-800 mb-6">About UniCon - Universal Converter</h1>
        <p className="text-xl text-gray-600 leading-relaxed mb-8">
          UniCon (Universal Converter) is a modern, privacy-first file conversion utility.
          We support images, audio, video, and documents. All conversions are performed
          securely and files are deleted shortly after processing.
        </p>
        <div className="p-8 rounded-3xl bg-background shadow-[var(--shadow-neu)] text-gray-700 w-full max-w-2xl mx-auto text-left">
          <h2 className="text-2xl font-semibold mb-4 text-primary">Features</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>Fast local processing with Sharp & FFmpeg</li>
            <li>Beautiful Neumorphic interface</li>
            <li>Secure, temporary file handling</li>
            <li>Zero analytics or tracking</li>
          </ul>
        </div>
      </main>
      <Footer />
    </div>
  );
}
