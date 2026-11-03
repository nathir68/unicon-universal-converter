"use client";

import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, File as FileIcon, X, CheckCircle, AlertCircle, Trash2, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

type JobStatus = 'queued' | 'converting' | 'success' | 'error';

interface Job {
  id: string;
  file: File;
  targetFormat: string;
  mode: 'convert' | 'compress';
  status: JobStatus;
  progress: number;
  downloadUrl: string | null;
  error: string | null;
  originalSize?: number;
  convertedSize?: number;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function getAvailableFormats(fileName: string, mimeType: string): string[] {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return ['docx', 'txt', 'html'];
  }
  if (['docx', 'doc'].includes(ext) || mimeType.includes('wordprocessingml') || mimeType.includes('msword')) {
    return ['pdf', 'html', 'txt'];
  }
  if (['pptx', 'ppt'].includes(ext) || mimeType.includes('presentationml')) {
    return ['pdf'];
  }
  if (['xlsx', 'xls', 'csv'].includes(ext) || mimeType.includes('spreadsheetml')) {
    return ['pdf', 'csv'];
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(ext) || mimeType.startsWith('image/')) {
    const all = ['png', 'jpg', 'webp', 'pdf', 'gif', 'avif', 'bmp'];
    return all.filter(f => f !== ext && !(ext === 'jpeg' && f === 'jpg'));
  }
  if (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext) || mimeType.startsWith('video/')) {
    const all = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'mp3'];
    return all.filter(f => f !== ext);
  }
  if (['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(ext) || mimeType.startsWith('audio/')) {
    const all = ['mp3', 'wav', 'aac', 'flac', 'ogg'];
    return all.filter(f => f !== ext);
  }
  if (['txt', 'html'].includes(ext) || mimeType.includes('text/plain') || mimeType.includes('text/html')) {
    return ['pdf', 'docx', 'txt', 'html'].filter(f => f !== ext);
  }
  return ['pdf', 'txt', 'docx'];
}

function canCompress(fileName: string, mimeType: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return (
    ext === 'pdf' ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(ext) ||
    mimeType.startsWith('video/') ||
    ['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext) ||
    mimeType.startsWith('audio/') ||
    ['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)
  );
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2.5 sm:h-3 rounded-full bg-background shadow-[var(--shadow-neu-inset)] overflow-hidden">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-primary to-violet-400"
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ ease: 'easeOut', duration: 0.3 }}
      />
    </div>
  );
}

function JobCard({ job, onRemove, onUpdate }: {
  job: Job;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Job>) => void;
}) {
  const formats = getAvailableFormats(job.file.name, job.file.type);
  const compressable = canCompress(job.file.name, job.file.type);
  const ext = job.file.name.split('.').pop() || '';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="w-full p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-[var(--shadow-neu)] bg-background flex flex-col gap-3.5 sm:gap-4 transition-all"
    >
      {/* File info */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center text-primary flex-shrink-0">
          <FileIcon className="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm sm:text-base truncate">
            {job.file.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {(job.file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
        {job.status !== 'converting' && (
          <button 
            onClick={() => onRemove(job.id)} 
            aria-label="Remove file"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-background shadow-[var(--shadow-neu-sm)] hover:shadow-[var(--shadow-neu)] active:shadow-[var(--shadow-neu-active)] flex items-center justify-center text-red-400 hover:text-red-500 transition-all flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Controls — only when queued */}
      {job.status === 'queued' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Mode toggle */}
            <div className="flex items-center gap-1 bg-background shadow-[var(--shadow-neu-inset)] p-1 rounded-xl">
              <button
                onClick={() => onUpdate(job.id, { mode: 'convert', targetFormat: formats[0] || '' })}
                className={`px-3.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  job.mode === 'convert' 
                    ? 'bg-primary text-white shadow-sm' 
                    : 'text-gray-500 hover:text-primary dark:text-gray-400'
                }`}
              >
                Convert
              </button>
              {compressable && (
                <button
                  onClick={() => onUpdate(job.id, { mode: 'compress', targetFormat: ext })}
                  className={`px-3.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    job.mode === 'compress' 
                      ? 'bg-primary text-white shadow-sm' 
                      : 'text-gray-500 hover:text-primary dark:text-gray-400'
                  }`}
                >
                  Compress
                </button>
              )}
            </div>

            {/* Format picker */}
            {job.mode === 'convert' && (
              <select
                value={job.targetFormat}
                onChange={(e) => onUpdate(job.id, { targetFormat: e.target.value })}
                className="h-9 bg-background shadow-[var(--shadow-neu-inset)] rounded-xl px-3 text-xs sm:text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-primary/50 flex-1 sm:flex-initial"
              >
                <option value="">Convert to…</option>
                {formats.map(f => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
            )}
          </div>

          <span className="self-end sm:self-auto text-[11px] sm:text-xs px-2.5 py-0.5 sm:py-1 rounded-full shadow-[var(--shadow-neu-inset)] font-medium text-gray-400 dark:text-gray-500">
            Queued
          </span>
        </div>
      )}

      {/* Progress bar while converting */}
      {job.status === 'converting' && (
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <ProgressBar value={job.progress} />
          <div className="flex items-center justify-between text-xs text-primary font-medium">
            <span>{job.progress < 100 ? 'Converting…' : 'Finalizing…'}</span>
            <span>{job.progress}%</span>
          </div>
        </div>
      )}

      {/* Success */}
      {job.status === 'success' && job.downloadUrl && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-green-500 w-5 h-5 flex-shrink-0" />
            <a
              href={job.downloadUrl}
              download={`converted-${job.file.name.replace(/\.[^/.]+$/, "")}.${job.targetFormat || 'bin'}`}
              className="flex-1 h-10 sm:h-9 flex items-center justify-center rounded-xl bg-green-500 hover:bg-green-600 text-white text-xs sm:text-sm font-semibold shadow-[var(--shadow-neu-sm)] active:shadow-[var(--shadow-neu-active)] transition-all"
            >
              Download Converted File
            </a>
          </div>

          {job.originalSize !== undefined && job.convertedSize !== undefined && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 pl-8">
              <span>{(job.originalSize / 1024 / 1024).toFixed(2)} MB</span>
              <span>➔</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {(job.convertedSize / 1024 / 1024).toFixed(2)} MB
              </span>
              {job.convertedSize < job.originalSize && (
                <span className="bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400 font-bold px-2 py-0.5 rounded-full text-[10px]">
                  -{(((job.originalSize - job.convertedSize) / job.originalSize) * 100).toFixed(0)}%
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {job.status === 'error' && (
        <div className="flex items-start gap-2 text-red-500 text-xs bg-red-50 dark:bg-red-950/30 p-2.5 rounded-xl border border-red-200 dark:border-red-900/50">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="leading-tight">{job.error || 'Conversion failed.'}</span>
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FileUploader() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  const updateJob = (id: string, patch: Partial<Job>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  };

  const removeJob = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const clearAll = () => setJobs([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newJobs: Job[] = acceptedFiles.map(file => {
      const formats = getAvailableFormats(file.name, file.type);
      return {
        id: uid(),
        file,
        targetFormat: formats[0] || '',
        mode: 'convert',
        status: 'queued',
        progress: 0,
        downloadUrl: null,
        error: null,
      };
    });
    setJobs(prev => [...prev, ...newJobs]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true });

  // ── Job queue runner ────────────────────────────────────────────────────────
  const processQueue = async (currentJobs: Job[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    const queue = currentJobs.filter(j => j.status === 'queued');

    for (const job of queue) {
      const tf = job.mode === 'compress' ? (job.file.name.split('.').pop() || job.targetFormat) : job.targetFormat;
      if (!tf) { 
        updateJob(job.id, { status: 'error', error: 'No target format selected.' }); 
        continue; 
      }

      updateJob(job.id, { status: 'converting', progress: 10 });

      const formData = new FormData();
      formData.append('file', job.file);
      formData.append('action', job.mode);
      formData.append('targetFormat', tf);

      try {
        const resPromise = fetch('/api/convert', { method: 'POST', body: formData }).then(r => r.json());
        const res = await resPromise;

        if (res.success && (res.downloadDataUrl || res.downloadUrl)) {
          updateJob(job.id, {
            status: 'success',
            downloadUrl: res.downloadDataUrl || res.downloadUrl,
            progress: 100,
            originalSize: res.originalSize,
            convertedSize: res.convertedSize,
          });
        } else {
          updateJob(job.id, { status: 'error', error: res.error || 'Operation failed.' });
        }
      } catch (err: any) {
        updateJob(job.id, { status: 'error', error: err.message || 'Network error.' });
      }
    }

    processingRef.current = false;
    setIsProcessing(false);
  };

  const handleConvertAll = () => {
    processQueue(jobs);
  };

  const hasQueued = jobs.some(j => j.status === 'queued');
  const allDone = jobs.length > 0 && jobs.every(j => j.status === 'success' || j.status === 'error');

  return (
    <div className="w-full flex flex-col gap-5 sm:gap-6">

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`
          w-full p-6 sm:p-10 md:p-12 rounded-3xl cursor-pointer transition-all duration-300
          flex flex-col items-center justify-center gap-2.5 sm:gap-3
          ${isDragActive
            ? 'shadow-[var(--shadow-neu-inset)] bg-[#e6e6fa]/10 border-2 border-primary/50'
            : 'shadow-[var(--shadow-neu)] bg-background hover:shadow-[var(--shadow-neu-hover)] active:shadow-[var(--shadow-neu-active)]'
          }
        `}
      >
        <input {...getInputProps()} />
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-background shadow-[var(--shadow-neu)] flex items-center justify-center text-primary mb-1">
          <UploadCloud className="w-6 h-6 sm:w-8 sm:h-8" />
        </div>
        <p className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100 text-center">
          {isDragActive ? 'Drop files here!' : 'Tap or Drop files here'}
        </p>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 text-center max-w-xs">
          Select multiple images, videos, audio, or PDFs
        </p>
        {jobs.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-primary text-xs sm:text-sm font-semibold shadow-[var(--shadow-neu-inset)] bg-background px-3.5 py-1.5 rounded-xl">
            <Plus className="w-4 h-4" /> Add more files
          </div>
        )}
      </div>

      {/* Job list */}
      <AnimatePresence>
        {jobs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-3"
          >
            <div className="flex items-center justify-between px-1 mb-0.5">
              <p className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-300">
                {jobs.length} file{jobs.length > 1 ? 's' : ''} queued
              </p>
              <button 
                onClick={clearAll} 
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors py-1 px-2 rounded-lg"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear all
              </button>
            </div>

            <AnimatePresence>
              {jobs.map(job => (
                <JobCard key={job.id} job={job} onRemove={removeJob} onUpdate={updateJob} />
              ))}
            </AnimatePresence>

            {/* Action bar */}
            {hasQueued && !isProcessing && (
              <motion.button
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={handleConvertAll}
                className="w-full min-h-[48px] py-3 mt-2 rounded-2xl bg-primary text-white font-bold text-sm sm:text-base shadow-[4px_4px_14px_rgba(139,92,246,0.45),-4px_-4px_14px_var(--neu-light)] hover:opacity-90 active:opacity-95 transition-all flex items-center justify-center gap-2"
              >
                Convert All ({jobs.filter(j => j.status === 'queued').length})
              </motion.button>
            )}

            {isProcessing && (
              <div className="w-full min-h-[48px] py-3 mt-2 rounded-2xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center gap-2.5 text-primary font-semibold text-sm sm:text-base">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Processing queue…
              </div>
            )}

            {allDone && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={clearAll}
                className="w-full py-3 mt-1 rounded-2xl text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 shadow-[var(--shadow-neu-sm)] hover:shadow-[var(--shadow-neu)] active:shadow-[var(--shadow-neu-active)] transition-all"
              >
                Clear & Convert More
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
