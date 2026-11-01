import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CategoryCards } from "@/components/CategoryCards";

export default function Tools() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <Header />
      <main className="flex-1 flex flex-col items-center w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-800 dark:text-gray-100 mb-2 sm:mb-3 text-center">
          Smart Conversion Tools
        </h1>
        <p className="text-xs sm:text-base text-gray-500 dark:text-gray-400 mb-6 sm:mb-10 text-center max-w-md">
          Explore specialized tools designed for documents, media, and images.
        </p>
        
        <div className="w-full">
          <CategoryCards />
        </div>
      </main>
      <Footer />
    </div>
  );
}
