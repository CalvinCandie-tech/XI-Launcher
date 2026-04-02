import React, { useState } from 'react';
import './CollapsibleSection.css';

function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="section-header collapsible" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className={`collapse-chevron ${open ? 'open' : ''}`}>&#9660;</span>
      </div>
      {open && children}
    </>
  );
}

export default CollapsibleSection;
