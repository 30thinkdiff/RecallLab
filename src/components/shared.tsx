import { Component, useEffect, useRef, type ReactNode } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { errorMessage, useAction } from './actions';

export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="error-notice" role="alert">
      <AlertCircle size={17} />
      {message}
    </div>
  ) : null;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  description,
  onClose,
  onConfirm,
  confirmLabel = '确认删除',
}: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
}) {
  const action = useAction();
  return (
    <Modal title={title} onClose={onClose}>
      <p>{description}</p>
      <ErrorNotice message={action.error} />
      <div className="form-actions">
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button danger"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await onConfirm();
              onClose();
            })
          }
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export class DataBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorMessage(error) };
  }
  render() {
    if (this.state.error)
      return (
        <div className="page-content">
          <h1>暂时无法读取本地数据</h1>
          <ErrorNotice message={this.state.error} />
          <p>请检查浏览器是否允许 IndexedDB 存储，然后重试。已有数据不会被自动清空。</p>
          <button className="button" onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      );
    return this.props.children;
  }
}
