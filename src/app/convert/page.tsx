import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { FileUploader } from "@/components/FileUploader";

export default function Convert() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center w-full max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">Convert a File</h1>
        <p className="text-gray-500 mb-12 text-center">Select your file below to begin the conversion process.</p>
        
        <div className="w-full">
          <FileUploader />
        </div>
      </main>
      <Footer />
    </div>
  );
}
