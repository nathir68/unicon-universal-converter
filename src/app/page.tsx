import { FileUploader } from "@/components/FileUploader";
import { CategoryCards } from "@/components/CategoryCards";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-1 flex flex-col items-center w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <section className="w-full text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-gray-800 mb-6 drop-shadow-sm">
            Convert Anything. <span className="text-primary">Simply.</span>
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-12">
            Seamlessly convert documents, images, audio, and video formats using our powerful, privacy-first Neumorphic platform.
          </p>
          
          <div className="w-full max-w-3xl mx-auto">
            <FileUploader />
          </div>
        </section>

        <section className="w-full mb-16">
          <h2 className="text-2xl font-semibold text-gray-700 mb-8 text-center">Supported Conversions</h2>
          <CategoryCards />
        </section>
      </main>

      <Footer />
    </div>
  );
}
