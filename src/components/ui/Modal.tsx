import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "default" | "wide";
}

const sizeClasses = {
  default: "max-w-lg",
  wide: "max-w-4xl",
};

export function Modal({ open, onClose, title, children, size = "default" }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="backdrop:bg-black/40 bg-transparent p-0 m-0 max-w-none max-h-none w-full h-full fixed inset-0"
    >
      <div className="flex items-end sm:items-center justify-center min-h-full p-0 sm:p-4">
        <div className={`bg-surface rounded-t-xl sm:rounded-xl shadow-lg w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto`}>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-bold">{title}</h2>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text p-1 rounded cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </dialog>
  );
}
