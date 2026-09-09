import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CategoryCards } from "@/components/CategoryCards";

export default function Tools() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center w-full max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">Smart Conversion Tools</h1>
        <p className="text-gray-500 mb-12 text-center">Explore our specialized tools for various file formats.</p>
        
        <div className="w-full">
          <CategoryCards />
        </div>
      </main>
      <Footer />
    </div>
  );
}
