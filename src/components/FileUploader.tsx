"use client";

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, File as FileIcon, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function FileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [targetFormat, setTargetFormat] = useState('');
  const [status, setStatus] = useState<'idle' | 'converting' | 'success' | 'error'>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'convert' | 'compress'>('convert');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setStatus('idle');
      setDownloadUrl(null);
      setTargetFormat('');
      setMode('convert');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1
  });

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    setStatus('idle');
    setDownloadUrl(null);
  };

  const handleConvert = async () => {
    if (!file) return;
    if (mode === 'convert' && !targetFormat) return;
    
    setStatus('converting');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', mode);
    if (mode === 'convert') {
      formData.append('targetFormat', targetFormat);
    } else {
      // If compressing, target format is same as original
      const ext = file.name.split('.').pop() || '';
      formData.append('targetFormat', ext);
    }

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        setStatus('success');
        setDownloadUrl(data.downloadUrl);
      } else {
        setStatus('error');
        alert(data.error || 'Operation failed');
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  };

  const getAvailableFormats = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return ['png', 'jpg', 'webp', 'gif'];
    if (mimeType.startsWith('video/')) return ['mp4', 'avi', 'mp3'];
    if (mimeType.startsWith('audio/')) return ['mp3', 'wav', 'aac'];
    if (mimeType === 'application/pdf') return ['txt'];
    if (mimeType.includes('wordprocessingml') || mimeType.includes('document')) return ['pdf', 'html', 'txt'];
    return ['pdf', 'png', 'jpg', 'mp3', 'mp4']; // fallback
  };

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {!file ? (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div
              {...getRootProps()}
              className={`
                w-full p-12 rounded-3xl cursor-pointer transition-all duration-300
                flex flex-col items-center justify-center gap-4
                ${isDragActive 
                  ? 'shadow-[var(--shadow-neu-inset)] bg-[#e6e6fa]/10 border-2 border-primary/50' 
                  : 'shadow-[var(--shadow-neu)] bg-background hover:shadow-[var(--shadow-neu-hover)]'
                }
              `}
            >
              <input {...getInputProps()} />
            <div className="w-20 h-20 rounded-full bg-background shadow-[var(--shadow-neu)] flex items-center justify-center text-primary mb-4">
              <UploadCloud className="w-10 h-10" />
            </div>
            <p className="text-2xl font-medium text-gray-700">
              Drag & Drop your file here
            </p>
            <p className="text-gray-500">
              or click to browse from your device
            </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="file-selected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full p-8 rounded-3xl shadow-[var(--shadow-neu)] bg-background flex flex-col items-center gap-6"
          >
            <div className="w-full flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center text-primary flex-shrink-0">
                <FileIcon className="w-8 h-8" />
              </div>
              
              <div className="flex-1 text-left w-full">
                <h3 className="text-lg font-semibold text-gray-800 truncate max-w-[200px] md:max-w-md">
                  {file.name}
                </h3>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB &bull; {file.type || 'Unknown Type'}
                </p>
              </div>
            </div>

            <div className="w-full h-px bg-gray-200 dark:bg-gray-700 my-2 rounded-full shadow-[var(--shadow-neu-inset)]"></div>
            
            <div className="flex flex-col md:flex-row items-center justify-between w-full gap-4">
              {status === 'idle' && (
                <div className="flex items-center gap-3 bg-background shadow-[var(--shadow-neu-inset)] p-1 rounded-2xl">
                  <button 
                    onClick={() => setMode('convert')}
                    className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${mode === 'convert' ? 'bg-primary text-white shadow-[var(--shadow-neu-sm)]' : 'text-gray-500 hover:text-primary'}`}
                  >
                    Convert
                  </button>
                  {file && (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) && (
                    <button 
                      onClick={() => setMode('compress')}
                      className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${mode === 'compress' ? 'bg-primary text-white shadow-[var(--shadow-neu-sm)]' : 'text-gray-500 hover:text-primary'}`}
                    >
                      Compress
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4 w-full md:w-auto">
                {status === 'idle' && (
                  <>
                    {mode === 'convert' && (
                      <select 
                        value={targetFormat}
                        onChange={(e) => setTargetFormat(e.target.value)}
                        className="h-12 flex-1 md:w-40 bg-background shadow-[var(--shadow-neu-inset)] rounded-xl px-4 text-gray-700 outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="">Convert to...</option>
                        {getAvailableFormats(file.type).map(fmt => (
                          <option key={fmt} value={fmt}>{fmt.toUpperCase()}</option>
                        ))}
                      </select>
                    )}
                    
                    <button 
                      onClick={handleConvert}
                      disabled={mode === 'convert' && !targetFormat}
                      className="h-12 px-6 flex items-center justify-center rounded-xl bg-primary text-white font-medium shadow-[4px_4px_10px_rgba(139,92,246,0.4),-4px_-4px_10px_var(--neu-light)] hover:opacity-90 disabled:opacity-50 transition-opacity active:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.2)]"
                    >
                      {mode === 'convert' ? 'Convert' : 'Compress'}
                    </button>
                  </>
                )}

              {status === 'converting' && (
                <div className="h-12 px-6 flex items-center justify-center gap-3 rounded-xl bg-background shadow-[var(--shadow-neu-inset)] text-primary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-medium">Converting...</span>
                </div>
              )}

              {status === 'success' && downloadUrl && (
                <a 
                  href={downloadUrl}
                  download
                  className="h-12 px-6 flex items-center justify-center rounded-xl bg-green-500 text-white font-medium shadow-[4px_4px_10px_rgba(34,197,94,0.5),-4px_-4px_10px_var(--neu-light)] hover:opacity-90 transition-opacity active:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.2)]"
                >
                  Download File
                </a>
              )}
              
              {status !== 'converting' && (
                <button onClick={removeFile} className="w-12 h-12 rounded-xl bg-background shadow-[var(--shadow-neu)] hover:shadow-[var(--shadow-neu-hover)] active:shadow-[var(--shadow-neu-active)] flex items-center justify-center text-red-400 transition-all">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
