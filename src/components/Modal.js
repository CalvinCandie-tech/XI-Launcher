import React, { useEffect, useRef } from 'react';

function Modal({ children, onClose, className = '', zIndex = 1000, ariaLabel }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current && onClose) onClose();
  };

  return (
    <div
      ref={overlayRef}
      className={`modal-overlay ${className}`}
      style={{ zIndex }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export default Modal;
