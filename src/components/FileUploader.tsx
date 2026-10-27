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
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function getAvailableFormats(fileName: string, mimeType: string): string[] {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return ['txt'];
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
    const all = ['png', 'jpg', 'webp', 'gif', 'avif', 'bmp'];
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
  return ['pdf', 'txt'];
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
    <div className="w-full h-3 rounded-full bg-background shadow-[var(--shadow-neu-inset)] overflow-hidden">
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
      className="w-full p-5 rounded-2xl shadow-[var(--shadow-neu)] bg-background flex flex-col gap-4"
    >
      {/* File info */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center text-primary flex-shrink-0">
          <FileIcon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 truncate">{job.file.name}</p>
          <p className="text-xs text-gray-500">{(job.file.size / 1024 / 1024).toFixed(2)} MB</p>
        </div>
        {job.status !== 'converting' && (
          <button onClick={() => onRemove(job.id)} className="w-9 h-9 rounded-xl bg-background shadow-[var(--shadow-neu)] hover:shadow-[var(--shadow-neu-hover)] flex items-center justify-center text-red-400 transition-all">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Controls — only when queued */}
      {job.status === 'queued' && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-background shadow-[var(--shadow-neu-inset)] p-1 rounded-xl">
            <button
              onClick={() => onUpdate(job.id, { mode: 'convert', targetFormat: formats[0] })}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${job.mode === 'convert' ? 'bg-primary text-white shadow-sm' : 'text-gray-500'}`}
            >Convert</button>
            {compressable && (
              <button
                onClick={() => onUpdate(job.id, { mode: 'compress', targetFormat: ext })}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${job.mode === 'compress' ? 'bg-primary text-white shadow-sm' : 'text-gray-500'}`}
              >Compress</button>
            )}
          </div>

          {/* Format picker */}
          {job.mode === 'convert' && (
            <select
              value={job.targetFormat}
              onChange={(e) => onUpdate(job.id, { targetFormat: e.target.value })}
              className="h-9 bg-background shadow-[var(--shadow-neu-inset)] rounded-xl px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Convert to…</option>
              {formats.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          )}

          <span className={`ml-auto text-xs px-3 py-1 rounded-full shadow-[var(--shadow-neu-inset)] font-medium ${
            job.status === 'queued' ? 'text-gray-400' : ''
          }`}>Queued</span>
        </div>
      )}

      {/* Progress bar while converting */}
      {job.status === 'converting' && (
        <div className="flex flex-col gap-2">
          <ProgressBar value={job.progress} />
          <p className="text-xs text-primary font-medium">{job.progress < 100 ? `${job.progress}% — Converting…` : 'Finalizing…'}</p>
        </div>
      )}

      {/* Success */}
      {job.status === 'success' && job.downloadUrl && (
        <div className="flex items-center gap-3">
          <CheckCircle className="text-green-500 w-5 h-5 flex-shrink-0" />
          <a
            href={job.downloadUrl}
            download
            className="flex-1 h-9 flex items-center justify-center rounded-xl bg-green-500 text-white text-sm font-medium shadow-[4px_4px_10px_rgba(34,197,94,0.4)] hover:opacity-90 transition-opacity"
          >Download</a>
        </div>
      )}

      {/* Error */}
      {job.status === 'error' && (
        <div className="flex items-start gap-2 text-red-500 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{job.error || 'Conversion failed.'}</span>
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
      // Re-read latest jobs to avoid stale closure
      const tf = job.mode === 'compress' ? (job.file.name.split('.').pop() || job.targetFormat) : job.targetFormat;
      if (!tf) { updateJob(job.id, { status: 'error', error: 'No target format selected.' }); continue; }

      updateJob(job.id, { status: 'converting', progress: 0 });

      const formData = new FormData();
      formData.append('file', job.file);
      formData.append('action', job.mode);
      formData.append('targetFormat', tf);

      try {
        // Start SSE progress listener
        let serverJobId: string | null = null;
        let progressDone = false;

        // Kick off the conversion
        const resPromise = fetch('/api/convert', { method: 'POST', body: formData }).then(r => r.json());

        // We don't have the jobId yet — poll after we get it (or just use interval)
        // Use a simple polling approach with setInterval watching the response
        const res = await resPromise;

        if (res.success && res.downloadUrl) {
          serverJobId = res.jobId;
          updateJob(job.id, { status: 'success', downloadUrl: res.downloadUrl, progress: 100 });
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
    <div className="w-full flex flex-col gap-6">

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`
          w-full p-10 rounded-3xl cursor-pointer transition-all duration-300
          flex flex-col items-center justify-center gap-3
          ${isDragActive
            ? 'shadow-[var(--shadow-neu-inset)] bg-[#e6e6fa]/10 border-2 border-primary/50'
            : 'shadow-[var(--shadow-neu)] bg-background hover:shadow-[var(--shadow-neu-hover)]'
          }
        `}
      >
        <input {...getInputProps()} />
        <div className="w-16 h-16 rounded-full bg-background shadow-[var(--shadow-neu)] flex items-center justify-center text-primary">
          <UploadCloud className="w-8 h-8" />
        </div>
        <p className="text-xl font-medium text-gray-700">
          {isDragActive ? 'Drop files here!' : 'Drag & Drop files here'}
        </p>
        <p className="text-sm text-gray-400">or click to browse — multiple files supported</p>
        {jobs.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-primary text-sm font-medium shadow-[var(--shadow-neu-inset)] bg-background px-4 py-2 rounded-xl">
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
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-600">{jobs.length} file{jobs.length > 1 ? 's' : ''} selected</p>
              <button onClick={clearAll} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors">
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
                className="w-full h-13 py-3.5 mt-2 rounded-2xl bg-primary text-white font-semibold text-base shadow-[4px_4px_14px_rgba(139,92,246,0.45),-4px_-4px_14px_var(--neu-light)] hover:opacity-90 transition-opacity active:shadow-[inset_3px_3px_8px_rgba(0,0,0,0.2)]"
              >
                Convert All ({jobs.filter(j => j.status === 'queued').length})
              </motion.button>
            )}

            {isProcessing && (
              <div className="w-full py-3.5 mt-2 rounded-2xl bg-background shadow-[var(--shadow-neu-inset)] flex items-center justify-center gap-3 text-primary font-medium">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Processing queue…
              </div>
            )}

            {allDone && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={clearAll}
                className="w-full py-3 mt-2 rounded-2xl text-sm text-gray-500 shadow-[var(--shadow-neu)] hover:shadow-[var(--shadow-neu-hover)] transition-all"
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
