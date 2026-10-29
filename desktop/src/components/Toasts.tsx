import { useStore } from "../store";
import { CheckIcon, XIcon } from "./Icons";

export function Toasts() {
  const toasts = useStore((state) => state.toasts);
  const remove = useStore((state) => state.removeToast);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.level}`} key={toast.id}>
          <span className="toast-icon">
            {toast.level === "success" ? <CheckIcon size={15} /> : toast.level === "error" ? "!" : "i"}
          </span>
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => remove(toast.id)} title="Закрыть">
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
