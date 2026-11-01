import { Image, FileText, FileSpreadsheet, Music, Video, Archive, Type, Wand2 } from 'lucide-react';

const CATEGORIES = [
  { name: 'Images', icon: Image, color: 'text-blue-500 dark:text-blue-400' },
  { name: 'Documents', icon: FileText, color: 'text-orange-500 dark:text-orange-400' },
  { name: 'Spreadsheets', icon: FileSpreadsheet, color: 'text-green-500 dark:text-green-400' },
  { name: 'Audio', icon: Music, color: 'text-pink-500 dark:text-pink-400' },
  { name: 'Video', icon: Video, color: 'text-red-500 dark:text-red-400' },
  { name: 'Archives', icon: Archive, color: 'text-amber-500 dark:text-amber-400' },
  { name: 'Text', icon: Type, color: 'text-gray-600 dark:text-gray-300' },
  { name: 'Smart Tools', icon: Wand2, color: 'text-primary' },
];

export function CategoryCards() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.name}
          className="group flex flex-col items-center justify-center p-3.5 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl bg-background shadow-[var(--shadow-neu-sm)] hover:shadow-[var(--shadow-neu)] active:shadow-[var(--shadow-neu-active)] transition-all duration-200"
        >
          <div className={`w-11 h-11 sm:w-13 sm:h-13 md:w-14 md:h-14 rounded-xl sm:rounded-2xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center mb-2 sm:mb-3.5 ${cat.color} group-hover:scale-105 transition-transform`}>
            <cat.icon className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" />
          </div>
          <span className="text-gray-700 dark:text-gray-200 text-xs sm:text-sm font-semibold">{cat.name}</span>
        </button>
      ))}
    </div>
  );
}
