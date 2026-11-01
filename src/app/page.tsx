import { FileUploader } from "@/components/FileUploader";
import { CategoryCards } from "@/components/CategoryCards";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <Header />
      
      <main className="flex-1 flex flex-col items-center w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 md:py-14">
        <section className="w-full text-center mb-10 sm:mb-14 md:mb-16">
          {/* Prominent Brand Emblem Badge */}
          <div className="flex justify-center mb-6 sm:mb-8">
            <div className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-3xl bg-white/70 dark:bg-dark-card/70 shadow-[var(--shadow-neu)] p-3 sm:p-4 flex items-center justify-center border border-white/40 dark:border-white/10 hover:scale-105 transition-all duration-300">
              <img 
                src="/logo.png" 
                alt="UniCon Universal Converter" 
                className="w-full h-full object-contain filter drop-shadow-md" 
              />
            </div>
          </div>

          <h1 className="text-3xl xs:text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-gray-800 dark:text-gray-100 mb-3 sm:mb-5 drop-shadow-sm leading-tight">
            Convert Anything. <span className="text-primary">Simply.</span>
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-8 sm:mb-10 px-2 leading-relaxed">
            Fast, high-fidelity conversions for documents, images, audio, and video formats using our privacy-first Neumorphic platform.
          </p>
          
          <div className="w-full max-w-3xl mx-auto">
            <FileUploader />
          </div>
        </section>

        <section className="w-full mb-8 sm:mb-12">
          <h2 className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-200 mb-5 sm:mb-8 text-center">
            Supported Conversions
          </h2>
          <CategoryCards />
        </section>
      </main>

      <Footer />
    </div>
  );
}
