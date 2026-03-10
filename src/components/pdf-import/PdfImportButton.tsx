import { useRef } from "react";
import { Button } from "../ui/Button.tsx";

const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

interface PdfImportButtonProps {
  onFilesSelect: (files: File[]) => void;
  onFilesRejected?: (names: string[]) => void;
}

export function PdfImportButton({ onFilesSelect, onFilesRejected }: PdfImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
      >
        <svg
          className="w-3.5 h-3.5 sm:mr-1 inline-block"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="12" y2="12" />
          <line x1="15" y1="15" x2="12" y2="12" />
        </svg>
        <span className="hidden sm:inline">Import Statement(s)</span>
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const fileList = e.target.files;
          if (fileList && fileList.length > 0) {
            const all = Array.from(fileList).slice(0, MAX_FILES);
            const valid = all.filter((f) => f.size <= MAX_FILE_SIZE);
            const rejected = all.filter((f) => f.size > MAX_FILE_SIZE).map((f) => f.name);
            if (rejected.length > 0) onFilesRejected?.(rejected);
            if (valid.length > 0) onFilesSelect(valid);
            e.target.value = "";
          }
        }}
      />
    </>
  );
}
