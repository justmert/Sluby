import { useState, useRef, useCallback, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/use-toast';

const TEN_GB = 10 * 1024 * 1024 * 1024;

export interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSize?: number;
  disabled?: boolean;
  className?: string;
}

export function UploadZone({
  onFileSelect,
  accept = 'video/*',
  maxSize = TEN_GB,
  disabled = false,
  className,
}: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback(
    (file: File): boolean => {
      // Check file type
      if (accept !== '*') {
        const acceptTypes = accept.split(',').map((t) => t.trim());
        const isValid = acceptTypes.some((type) => {
          if (type.endsWith('/*')) {
            const category = type.split('/')[0];
            return file.type.startsWith(`${category}/`);
          }
          return file.type === type || file.name.endsWith(type);
        });

        if (!isValid) {
          toast({
            title: 'Invalid file type',
            description: `Please select a valid video file. Accepted types: ${accept}`,
            variant: 'destructive',
          });
          return false;
        }
      }

      // Check file size
      if (file.size > maxSize) {
        const maxSizeGB = (maxSize / (1024 * 1024 * 1024)).toFixed(0);
        toast({
          title: 'File too large',
          description: `Maximum file size is ${maxSizeGB}GB.`,
          variant: 'destructive',
        });
        return false;
      }

      return true;
    },
    [accept, maxSize],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        onFileSelect(file);
      }
    },
    [validateFile, onFileSelect],
  );

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, handleFile],
  );

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be selected again
      e.target.value = '';
    },
    [handleFile],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative h-52 rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] transition-all duration-300 cursor-pointer',
        'flex flex-col items-center justify-center gap-4',
        'hover:border-white/[0.15] hover:bg-white/[0.03]',
        isDragOver && 'border-teal-500/50 bg-teal-500/5 scale-[1.01] shadow-[0_0_30px_rgba(20,184,166,0.1)]',
        disabled && 'opacity-40 pointer-events-none cursor-not-allowed',
        className,
      )}
    >
      <div className={cn(
        'flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/[0.08] transition-all duration-300',
        isDragOver && 'bg-teal-500/10 border-teal-500/20 scale-110',
      )}>
        <Upload
          className={cn(
            'h-6 w-6 text-zinc-500 transition-colors duration-300',
            isDragOver && 'text-teal-400',
          )}
        />
      </div>
      <div className="text-center">
        <p className="text-sm text-zinc-300 font-medium">
          Drop video here or click to browse
        </p>
        <p className="text-xs text-zinc-500 mt-1.5">
          MP4, MOV, WebM, MKV up to 10GB
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
        tabIndex={-1}
      />
    </div>
  );
}
