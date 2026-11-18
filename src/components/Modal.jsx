import { BsX } from "react-icons/bs";

export default function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-2xl text-slate-500 hover:text-slate-800"><BsX /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
