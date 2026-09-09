import { Image, FileText, FileSpreadsheet, Music, Video, Archive, Type, Wand2 } from 'lucide-react';

const CATEGORIES = [
  { name: 'Images', icon: Image, color: 'text-blue-400' },
  { name: 'Documents', icon: FileText, color: 'text-orange-400' },
  { name: 'Spreadsheets', icon: FileSpreadsheet, color: 'text-green-400' },
  { name: 'Audio', icon: Music, color: 'text-pink-400' },
  { name: 'Video', icon: Video, color: 'text-red-400' },
  { name: 'Archives', icon: Archive, color: 'text-yellow-500' },
  { name: 'Text', icon: Type, color: 'text-gray-600' },
  { name: 'Smart Tools', icon: Wand2, color: 'text-primary' },
];

export function CategoryCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.name}
          className="group flex flex-col items-center justify-center p-6 rounded-3xl bg-background shadow-[var(--shadow-neu)] hover:shadow-[var(--shadow-neu-hover)] active:shadow-[var(--shadow-neu-active)] transition-all duration-300"
        >
          <div className={`w-14 h-14 rounded-2xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center mb-4 ${cat.color} group-hover:scale-110 transition-transform`}>
            <cat.icon className="w-7 h-7" />
          </div>
          <span className="text-gray-700 font-medium">{cat.name}</span>
        </button>
      ))}
    </div>
  );
}
